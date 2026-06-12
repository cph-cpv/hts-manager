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
  instrument: string
  run_number: string
  flowcell: string
  first_seen_at: string
  last_scanned_at: string
}

/**
 * Row shape of the `files` table. Run-level metadata (date, folder, instrument,
 * …) lives only on `runs` now — join via `run_id` to get it (see {@link FileWithRun}).
 */
export interface FileRow {
  id: number
  run_id: number | null
  path: string
  name: string
  size: number
  lane: string | null
  missing: number
  upload_requested: number
  uploaded: number
  upload_status: UploadStatus
  upload_error: string | null
  uploaded_at: string | null
  first_seen_at: string
  last_scanned_at: string
}

/**
 * A file row joined with its run's metadata — what the file-list UI consumes.
 * Returned by the display queries (e.g. `searchFiles`) that `JOIN runs`.
 */
export interface FileWithRun extends FileRow {
  run_date: string
  run_folder: string
  instrument: string
  run_number: string
  flowcell: string
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
  instrument      TEXT NOT NULL,
  run_number      TEXT NOT NULL,
  flowcell        TEXT NOT NULL,
  first_seen_at   TEXT NOT NULL,
  last_scanned_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_run_date ON runs(run_date);

CREATE TABLE IF NOT EXISTS files (
  id               INTEGER PRIMARY KEY,
  run_id           INTEGER REFERENCES runs(id),
  path             TEXT UNIQUE NOT NULL,
  name             TEXT NOT NULL,
  size             INTEGER NOT NULL,
  lane             TEXT,
  missing          INTEGER NOT NULL DEFAULT 0,
  upload_requested INTEGER NOT NULL DEFAULT 0,
  uploaded         INTEGER NOT NULL DEFAULT 0,
  upload_status    TEXT NOT NULL DEFAULT 'idle',
  upload_error     TEXT,
  uploaded_at      TEXT,
  first_seen_at    TEXT NOT NULL,
  last_scanned_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
CREATE INDEX IF NOT EXISTS idx_files_run_id ON files(run_id);
CREATE INDEX IF NOT EXISTS idx_files_upload_requested ON files(upload_requested);
CREATE INDEX IF NOT EXISTS idx_files_uploaded ON files(uploaded);
`

/**
 * Versioned migrations applied once each. Each migration is idempotent so it's
 * safe to re-run if the version record was lost, but the `schema_migrations`
 * table prevents redundant work on normal startup.
 */
const MIGRATIONS: Array<{ version: number; up: (db: DB) => void }> = []

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
