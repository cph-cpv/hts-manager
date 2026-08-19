import { sep } from 'node:path'
import type { DerivedRecord } from '../scan/parse'
import { getDb } from './db'
import { upsertRun } from './runs'
import { nowIso } from './utils'

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
export type FileRow = {
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
export type FileWithRun = FileRow & {
  run_date: string
  run_folder: string
  instrument: string
  run_number: string
  flowcell: string
}

/** Filter + paginate options for {@link searchFiles}/{@link countFiles}. */
export type SearchOptions = {
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
export type AggregateCounts = {
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

/** Fetch a single file by id, or undefined if not found. */
export function getFileById(id: number): FileRow | undefined {
  return getDb()
    .prepare('SELECT * FROM files WHERE id = ?')
    .get(id) as FileRow | undefined
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

/**
 * Insert a freshly-derived file row if its path is not already known. Existing
 * rows are left untouched (the scan reconciles their `missing`/`last_scanned_at`
 * separately via {@link flagMissingExcept}). Returns true if a row was inserted.
 */
export function insertIfNew(file: DerivedRecord): boolean {
  const now = nowIso()
  const runId = upsertRun(file)
  const info = getDb()
    .prepare(
      `INSERT OR IGNORE INTO files
         (run_id, path, name, size, lane, first_seen_at, last_scanned_at)
       VALUES
         (@run_id, @path, @name, @size, @lane, @first_seen_at, @last_scanned_at)`,
    )
    .run({
      run_id: runId,
      path: file.path,
      name: file.name,
      size: file.size,
      lane: file.lane,
      first_seen_at: now,
      last_scanned_at: now,
    })
  return info.changes > 0
}

/**
 * Reconcile the `missing` flag after a scan walk under `root`:
 * every still-present path in `seenPaths` is marked `missing = 0`, and every row
 * whose path lives under `root` but was *not* seen is marked `missing = 1`. Both
 * sets get a fresh `last_scanned_at`. Returns the number of rows now flagged
 * missing under `root`.
 *
 * Uses a temp table of seen paths so it scales past SQLite's bound-parameter
 * limit, and a prefix-equality test (`substr(...) = prefix`) rather than `LIKE`
 * so path separators and `_`/`%` in `root` are matched literally.
 */
export function flagMissingExcept(root: string, seenPaths: string[]): number {
  const db = getDb()
  const now = nowIso()
  const prefix = root.endsWith(sep) ? root : root + sep

  const reconcile = db.transaction((paths: string[]) => {
    db.exec('CREATE TEMP TABLE IF NOT EXISTS _seen (path TEXT PRIMARY KEY)')
    db.exec('DELETE FROM _seen')

    const insertSeen = db.prepare('INSERT OR IGNORE INTO _seen(path) VALUES (?)')
    for (const path of paths) insertSeen.run(path)

    db.prepare(
      `UPDATE files
          SET missing = 0, last_scanned_at = ?
        WHERE path IN (SELECT path FROM _seen)`,
    ).run(now)

    const missing = db
      .prepare(
        `UPDATE files
            SET missing = 1, last_scanned_at = ?
          WHERE substr(path, 1, ?) = ?
            AND path NOT IN (SELECT path FROM _seen)`,
      )
      .run(now, prefix.length, prefix)

    // Refresh last_scanned_at on every run that had at least one file seen.
    db.prepare(
      `UPDATE runs
          SET last_scanned_at = ?
        WHERE id IN (
          SELECT DISTINCT run_id FROM files
           WHERE path IN (SELECT path FROM _seen)
             AND run_id IS NOT NULL
        )`,
    ).run(now)

    return missing.changes
  })

  return reconcile(seenPaths)
}

/**
 * All file paths currently in the DB, as a Set. The scan walk consults this to
 * skip files it already knows about *before* doing an `fs.stat`, so a re-scan of
 * an unchanged tree costs no stat calls.
 */
export function getKnownPaths(): Set<string> {
  const rows = getDb().prepare('SELECT path FROM files').all() as {
    path: string
  }[]
  return new Set(rows.map((row) => row.path))
}
