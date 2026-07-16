/**
 * SQLite access via better-sqlite3 (synchronous). A single module-level
 * instance is initialized by the server entry point and shared by all workers.
 */
import Database from 'better-sqlite3'
import type { Database as DB } from 'better-sqlite3'
import { getConfig } from '../server/config'
import { applyMigrations } from './migrations'
import { TRANSFER_SCHEMA } from './transfer-schema'

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

export type TransferReadinessStatus = 'waiting' | 'ready' | 'blocked'

/**
 * Effective source status exposed by the transfer status view. Execution
 * states are derived from jobs instead of being duplicated on the source row.
 */
export type TransferSourceStatus =
  | 'waiting'
  | 'ready'
  | 'blocked'
  | 'copying'
  | 'copied'
  | 'removing'
  | 'removed'
  | 'error'

export type TransferJobKind = 'discover' | 'copy' | 'remove'

export type TransferJobState = 'waiting' | 'running' | 'complete' | 'error'

export interface TransferSourceRow {
  id: number
  folder_name: string
  source_path: string
  readiness_status: TransferReadinessStatus
  status: TransferSourceStatus
  first_seen_at: string
  last_error: string | null
  block_reason: string | null
}

export interface TransferJobRow {
  id: number
  source_id: number | null
  kind: TransferJobKind
  state: TransferJobState
  created_at: string
  started_at: string | null
  finished_at: string | null
  error_message: string | null
}

const SCHEMA = `
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

${TRANSFER_SCHEMA}
`

let db: DB | undefined
let initialized = false

/** Open the database and apply all pending migrations once during startup. */
export function initializeDatabase(): void {
  if (initialized) return

  const path = getConfig().dbPath
  const instance = new Database(path)
  instance.pragma('journal_mode = WAL')
  instance.pragma('foreign_keys = ON')
  applyMigrations(instance)
  instance.exec(SCHEMA)

  db = instance
  initialized = true
}

/** Return the database initialized by the server startup hook. */
export function getDb(): DB {
  if (!db || !initialized) {
    throw new Error('database accessed before startup initialization')
  }
  return db
}
