/**
 * Typed query helpers over the `files` table. Both the scanner/uploader workers
 * and the CLI go through these — there is no other SQL in the app. better-sqlite3
 * caches prepared statements by source string, so preparing inline per call is
 * cheap.
 */
import { sep } from 'node:path'
import { getDb, type FileRow, type FileWithRun, type RunRow } from './schema'
import type { DerivedRecord } from '../scan/parse'

/** Current UTC timestamp as an ISO-8601 string (how all `*_at` columns store time). */
function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Escape SQLite `LIKE` metacharacters (`%`, `_`, and the escape char itself) so
 * user search input and filesystem prefixes are matched literally. Pair with an
 * `ESCAPE '\'` clause.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/**
 * Insert or look up the run record for a derived file, returning its id.
 * The `runs` table deduplicates by `run_folder`; subsequent files in the same
 * run folder get the same id. `last_scanned_at` is refreshed on every call so
 * it reflects the most-recent scan that visited this run.
 */
export function upsertRun(file: DerivedRecord): number {
  const db = getDb()
  const now = nowIso()
  db.prepare(
    `INSERT OR IGNORE INTO runs
       (run_folder, run_date, instrument, run_number, flowcell,
        first_seen_at, last_scanned_at)
     VALUES
       (@run_folder, @run_date, @instrument, @run_number, @flowcell,
        @first_seen_at, @last_scanned_at)`,
  ).run({
    run_folder: file.run_folder,
    run_date: file.run_date,
    instrument: file.instrument,
    run_number: file.run_number,
    flowcell: file.flowcell,
    first_seen_at: now,
    last_scanned_at: now,
  })
  return (
    db.prepare('SELECT id FROM runs WHERE run_folder = ?').get(file.run_folder) as {
      id: number
    }
  ).id
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

/** Filter + paginate options for {@link searchFiles}/{@link countFiles}. */
export interface SearchOptions {
  /** Case-insensitive substring matched against `name`; empty matches all. */
  q?: string
  limit?: number
  offset?: number
}

/**
 * Search visible (`missing = 0`) files by name substring, newest run first.
 * `q` is matched literally (metacharacters escaped); an empty/absent `q` lists
 * everything.
 */
export function searchFiles(options: SearchOptions = {}): FileWithRun[] {
  const { q = '', limit = 100, offset = 0 } = options
  const pattern = `%${escapeLike(q)}%`
  return getDb()
    .prepare(
      `SELECT f.*, r.run_date, r.run_folder, r.instrument, r.run_number, r.flowcell
         FROM files f
         JOIN runs r ON r.id = f.run_id
        WHERE f.name LIKE ? ESCAPE '\\' AND f.missing = 0
        ORDER BY r.run_date DESC, f.name ASC, f.id ASC
        LIMIT ? OFFSET ?`,
    )
    .all(pattern, limit, offset) as FileWithRun[]
}

/** Count visible files matching the same filter as {@link searchFiles} (for pagination). */
export function countFiles(options: Pick<SearchOptions, 'q'> = {}): number {
  const { q = '' } = options
  const pattern = `%${escapeLike(q)}%`
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM files
        WHERE name LIKE ? ESCAPE '\\' AND missing = 0`,
    )
    .get(pattern) as { n: number }
  return row.n
}

/** Aggregate counts for the status bar. */
export interface AggregateCounts {
  total: number
  uploaded: number
  queued: number
  missing: number
  errors: number
}

/** One-pass aggregate counts across all rows, for the status snapshot. */
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

/** Live queue depth for the upload indicator. */
export interface UploadCounts {
  /** Files requested and waiting, not yet started and not errored. */
  queued: number
  /** Files whose last upload attempt failed (retryable). */
  errors: number
}

/**
 * Cheap counts for the upload indicator, read fresh on each status poll so the
 * numbers stay accurate across restarts (the uploader's in-memory state does
 * not). The currently-`uploading` row is in neither bucket — it is surfaced
 * separately by the worker as the "current" file.
 */
export function getUploadCounts(): UploadCounts {
  return getDb()
    .prepare(
      `SELECT
         COALESCE(SUM(upload_status = 'queued'), 0) AS queued,
         COALESCE(SUM(upload_status = 'error'), 0) AS errors
       FROM files`,
    )
    .get() as UploadCounts
}

/**
 * Queue a file for upload (button press): mark it requested + `queued` and clear
 * any prior error. No-op for already-uploaded rows. Returns true if a row changed.
 */
export function requestUpload(id: number): boolean {
  const info = getDb()
    .prepare(
      `UPDATE files
          SET upload_requested = 1, upload_status = 'queued', upload_error = NULL
        WHERE id = ? AND uploaded = 0`,
    )
    .run(id)
  return info.changes > 0
}

/**
 * Claim the next file for the serial uploader. An interrupted `uploading` row
 * (from a previous process that died mid-flight) wins, since Virtool has no
 * resumable upload and it must be re-POSTed whole; otherwise the oldest
 * requested-but-unfinished row (`queued` or retryable `error`) is taken.
 * Returns `undefined` when there is nothing to do.
 */
export function claimNext(): FileRow | undefined {
  const db = getDb()

  const interrupted = db
    .prepare(
      `SELECT * FROM files
        WHERE upload_status = 'uploading'
        ORDER BY id ASC
        LIMIT 1`,
    )
    .get() as FileRow | undefined
  if (interrupted) return interrupted

  return db
    .prepare(
      `SELECT * FROM files
        WHERE upload_requested = 1 AND uploaded = 0
          AND upload_status IN ('queued', 'error')
        ORDER BY first_seen_at ASC, id ASC
        LIMIT 1`,
    )
    .get() as FileRow | undefined
}

/** Mark a claimed row as actively uploading and clear any prior error. */
export function setUploading(id: number): void {
  getDb()
    .prepare(
      `UPDATE files
          SET upload_status = 'uploading', upload_error = NULL
        WHERE id = ?`,
    )
    .run(id)
}

/** Mark a row uploaded (HTTP 201): set the success flags and stamp `uploaded_at`. */
export function markUploaded(id: number): void {
  getDb()
    .prepare(
      `UPDATE files
          SET uploaded = 1, upload_status = 'uploaded',
              upload_error = NULL, uploaded_at = ?
        WHERE id = ?`,
    )
    .run(nowIso(), id)
}

/**
 * Mark a row's upload as errored, recording the message. `upload_requested`
 * stays 1 so the uploader retries it after its backoff.
 */
export function markError(id: number, message: string): void {
  getDb()
    .prepare(
      `UPDATE files
          SET upload_status = 'error', upload_error = ?
        WHERE id = ?`,
    )
    .run(message, id)
}

// ---------------------------------------------------------------------------
// Run queries
// ---------------------------------------------------------------------------

/** All runs ordered newest-first, with a count of their associated files. */
export interface RunSummary extends RunRow {
  file_count: number
}

/** List all runs, newest run date first. */
export function listRuns(): RunSummary[] {
  return getDb()
    .prepare(
      `SELECT r.*, COUNT(f.id) AS file_count
         FROM runs r
         LEFT JOIN files f ON f.run_id = r.id
        GROUP BY r.id
        ORDER BY r.run_date DESC, r.run_folder ASC`,
    )
    .all() as RunSummary[]
}

/** Fetch a single run by id, or undefined if not found. */
export function getRunById(id: number): RunRow | undefined {
  return getDb()
    .prepare('SELECT * FROM runs WHERE id = ?')
    .get(id) as RunRow | undefined
}

/** All files belonging to a run (by run_id). */
export function getFilesForRun(runId: number): FileRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM files WHERE run_id = ? ORDER BY name ASC`,
    )
    .all(runId) as FileRow[]
}
