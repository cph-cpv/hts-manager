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
