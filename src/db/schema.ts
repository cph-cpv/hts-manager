/**
 * SQLite access via better-sqlite3 (synchronous). A single module-level
 * instance is initialized by the server entry point and shared by all workers.
 */
import Database from 'better-sqlite3'
import type { Database as DB } from 'better-sqlite3'
import { getConfig } from '../server/config'
import { applyMigrations } from './migrations'

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
  source_path: string | null
  transfer_status: RunTransferStatus
  run_date: string
  instrument: string
  run_number: string
  flowcell: string
  first_seen_at: string
  last_scanned_at: string | null
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

/** Durable transfer milestone for a run; temporary activity lives on jobs. */
export type RunTransferStatus =
  | 'manual'
  | 'detected'
  | 'ready'
  | 'transferred'
  | 'removed'

export type TransferActivity = 'copying' | 'removing' | null

export type TransferJobKind = 'discover' | 'copy' | 'remove'

export type TransferJobState = 'waiting' | 'running' | 'complete' | 'error'

export interface RunWithTransferActivity extends RunRow {
  transfer_activity: TransferActivity
}

export interface TransferJobRow {
  id: number
  run_id: number | null
  kind: TransferJobKind
  state: TransferJobState
  created_at: string
  started_at: string | null
  finished_at: string | null
  error_message: string | null
}

let db: DB | undefined

function openDatabase(): DB {
  const instance = new Database(getConfig().dbPath)
  instance.pragma('journal_mode = WAL')
  instance.pragma('foreign_keys = ON')
  return instance
}

/** Apply pending migrations before Nitro begins accepting requests. */
export function migrateDatabase(): void {
  const instance = openDatabase()
  try {
    applyMigrations(instance)
  } finally {
    instance.close()
  }
}

/** Open once and return the long-lived application database connection. */
export function getDb(): DB {
  db ??= openDatabase()
  return db
}
