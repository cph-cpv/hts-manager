/**
 * SQLite access via better-sqlite3 (synchronous). A single module-level
 * instance is shared by the server workers and the CLI — both import `getDb()`.
 */
import Database from 'better-sqlite3'
import type { Database as DB } from 'better-sqlite3'

/** Upload lifecycle for a file row. */
export type UploadStatus =
  | 'idle'
  | 'queued'
  | 'uploading'
  | 'uploaded'
  | 'error'

/** Row shape of the `runs` table. */
export interface RunRow {
  id: number
  run_folder: string
  run_date: string
  instrument: string | null
  run_number: string | null
  flowcell: string | null
  first_seen_at: string | null
  last_scanned_at: string | null
}

/** Row shape of the `files` table. */
export interface FileRow {
  id: number
  run_id: number | null
  path: string
  name: string
  size: number
  run_date: string
  run_folder: string | null
  instrument: string | null
  run_number: string | null
  flowcell: string | null
  lane: string | null
  missing: number
  upload_requested: number
  uploaded: number
  upload_status: UploadStatus
  upload_error: string | null
  uploaded_at: string | null
  first_seen_at: string | null
  last_scanned_at: string | null
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id              INTEGER PRIMARY KEY,
  run_folder      TEXT UNIQUE NOT NULL,
  run_date        TEXT NOT NULL,
  instrument      TEXT,
  run_number      TEXT,
  flowcell        TEXT,
  first_seen_at   TEXT,
  last_scanned_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_run_date ON runs(run_date);

CREATE TABLE IF NOT EXISTS files (
  id               INTEGER PRIMARY KEY,
  run_id           INTEGER REFERENCES runs(id),
  path             TEXT UNIQUE NOT NULL,
  name             TEXT NOT NULL,
  size             INTEGER NOT NULL,
  run_date         TEXT NOT NULL,
  run_folder       TEXT,
  instrument       TEXT,
  run_number       TEXT,
  flowcell         TEXT,
  lane             TEXT,
  missing          INTEGER NOT NULL DEFAULT 0,
  upload_requested INTEGER NOT NULL DEFAULT 0,
  uploaded         INTEGER NOT NULL DEFAULT 0,
  upload_status    TEXT NOT NULL DEFAULT 'idle',
  upload_error     TEXT,
  uploaded_at      TEXT,
  first_seen_at    TEXT,
  last_scanned_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
CREATE INDEX IF NOT EXISTS idx_files_run_date ON files(run_date);
CREATE INDEX IF NOT EXISTS idx_files_upload_requested ON files(upload_requested);
CREATE INDEX IF NOT EXISTS idx_files_uploaded ON files(uploaded);
`

/**
 * Versioned migrations applied once each. Each migration is idempotent so it's
 * safe to re-run if the version record was lost, but the `schema_migrations`
 * table prevents redundant work on normal startup.
 */
const MIGRATIONS: Array<{ version: number; up: (db: DB) => void }> = [
  {
    version: 1,
    up(db) {
      // Add run_id FK to files (new databases already have it from SCHEMA above;
      // existing databases need ALTER TABLE).
      const cols = (
        db.prepare('PRAGMA table_info(files)').all() as Array<{ name: string }>
      ).map((c) => c.name)
      if (!cols.includes('run_id')) {
        db.exec('ALTER TABLE files ADD COLUMN run_id INTEGER REFERENCES runs(id)')
      }

      // Backfill runs from the denormalized columns still on each file row.
      db.exec(`
        INSERT OR IGNORE INTO runs
          (run_folder, run_date, instrument, run_number, flowcell,
           first_seen_at, last_scanned_at)
        SELECT run_folder, run_date, instrument, run_number, flowcell,
               MIN(first_seen_at), MAX(last_scanned_at)
          FROM files
         WHERE run_folder IS NOT NULL
         GROUP BY run_folder
      `)

      // Wire run_id on any file row that doesn't have it yet.
      db.exec(`
        UPDATE files
           SET run_id = (SELECT id FROM runs WHERE runs.run_folder = files.run_folder)
         WHERE run_folder IS NOT NULL AND run_id IS NULL
      `)

      // Now that the column exists, create the index (safe to re-run).
      db.exec('CREATE INDEX IF NOT EXISTS idx_files_run_id ON files(run_id)')
    },
  },
]

let db: DB | undefined

/** Open (once) and return the shared database, applying schema + migrations. */
export function getDb(): DB {
  if (db) return db

  const path = process.env.HTSM_DB_PATH ?? './hts-manager.db'
  const instance = new Database(path)
  instance.pragma('journal_mode = WAL')
  instance.pragma('foreign_keys = ON')
  instance.exec(SCHEMA)

  const appliedVersions = new Set(
    (
      instance
        .prepare('SELECT version FROM schema_migrations')
        .all() as Array<{ version: number }>
    ).map((r) => r.version),
  )

  const stamp = instance.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  )

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue
    instance.transaction(() => {
      migration.up(instance)
      stamp.run(migration.version, new Date().toISOString())
    })()
  }

  db = instance
  return db
}
