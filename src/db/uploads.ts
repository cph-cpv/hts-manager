/** Database operations for the file upload lifecycle. */
import { getDb } from './db'
import type { FileRow } from './files'
import { nowIso } from './utils'

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
 * Queue every not-yet-uploaded file in a run for upload (whole-run upload button):
 * mark them requested + `queued` and clear any prior error. Already-uploaded rows
 * are left alone. Returns the number of files newly queued.
 */
export function requestUploadForRun(runId: number): number {
  const info = getDb()
    .prepare(
      `UPDATE files
          SET upload_requested = 1, upload_status = 'queued', upload_error = NULL
        WHERE run_id = ? AND uploaded = 0`,
    )
    .run(runId)
  return info.changes
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
