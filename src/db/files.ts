import { getDb } from './db'

/** Upload lifecycle for a file row. */
export type UploadStatus =
  | 'idle'
  | 'queued'
  | 'uploading'
  | 'uploaded'
  | 'error'

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

/** Filter + paginate options for {@link searchFiles}/{@link countFiles}. */
export interface SearchOptions {
  /** Case-insensitive substring matched against `name`; empty matches all. */
  q?: string
  /**
   * Include Illumina `Undetermined_*` reads (unassigned by demultiplexing).
   * Defaults to `false` — these are noise and are hidden unless opted in.
   */
  includeUndetermined?: boolean
  limit?: number
  offset?: number
}

/** Aggregate counts for the status bar. */
export interface AggregateCounts {
  total: number
  uploaded: number
  queued: number
  missing: number
  errors: number
}

/**
 * Escape SQLite `LIKE` metacharacters (`%`, `_`, and the escape char itself) so
 * user search input is matched literally. Pair with an `ESCAPE '\'` clause.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/** WHERE fragment hiding `Undetermined_*` files unless explicitly included. */
function undeterminedClause(includeUndetermined: boolean): string {
  return includeUndetermined ? '' : " AND name NOT LIKE 'Undetermined\\_%' ESCAPE '\\'"
}

/**
 * Search visible (`missing = 0`) files by name substring, newest run first.
 * `Undetermined_*` reads are hidden unless explicitly included.
 */
export function searchFiles(options: SearchOptions = {}): FileWithRun[] {
  const { q = '', includeUndetermined = false, limit = 100, offset = 0 } = options
  const pattern = `%${escapeLike(q)}%`
  return getDb()
    .prepare(
      `SELECT f.*, r.run_date, r.run_folder, r.instrument, r.run_number, r.flowcell
         FROM files f
         JOIN runs r ON r.id = f.run_id
        WHERE f.name LIKE ? ESCAPE '\\' AND f.missing = 0${undeterminedClause(includeUndetermined)}
        ORDER BY r.run_date DESC, f.name ASC, f.id ASC
        LIMIT ? OFFSET ?`,
    )
    .all(pattern, limit, offset) as FileWithRun[]
}

/** Count visible files matching the same filter as {@link searchFiles}. */
export function countFiles(
  options: Pick<SearchOptions, 'q' | 'includeUndetermined'> = {},
): number {
  const { q = '', includeUndetermined = false } = options
  const pattern = `%${escapeLike(q)}%`
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM files
        WHERE name LIKE ? ESCAPE '\\' AND missing = 0${undeterminedClause(includeUndetermined)}`,
    )
    .get(pattern) as { n: number }
  return row.n
}

/** One-pass aggregate counts across all file rows, for the status snapshot. */
export function getAggregateCounts(): AggregateCounts {
  return getDb()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(uploaded = 1), 0) AS uploaded,
         COALESCE(SUM(upload_requested = 1 AND uploaded = 0), 0) AS queued,
         COALESCE(SUM(missing = 1), 0) AS missing,
         COALESCE(SUM(upload_status = 'error'), 0) AS errors
       FROM files`,
    )
    .get() as AggregateCounts
}

/** All files belonging to a run, joined with their run metadata. */
export function getFilesForRun(runId: number): FileWithRun[] {
  return getDb()
    .prepare(
      `SELECT f.*, r.run_date, r.run_folder, r.instrument, r.run_number, r.flowcell
         FROM files f
         JOIN runs r ON r.id = f.run_id
        WHERE f.run_id = ?
        ORDER BY f.name ASC`,
    )
    .all(runId) as FileWithRun[]
}
