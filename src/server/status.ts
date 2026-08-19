/**
 * Combined status snapshot for the top bar. Folds the scanner's live scan state,
 * the uploader's live state, and one-pass aggregate DB counts into a single
 * object so the UI can drive both indicators (scanning + upload activity) from a
 * single `getStatus` poll. See plan.md (step 7).
 */
import { getAggregateCounts, type AggregateCounts } from '../db/files'
import { getScanState, type ScanState } from './scanner'
import { getUploadState, type UploadState } from './uploader'

/** Everything the top bar needs in one poll. */
export interface StatusSnapshot {
  /** Live scanner state (spinner + progress while a scan runs). */
  scan: ScanState
  /** Live uploader state (current file + queue depth). */
  upload: UploadState
  /** One-pass aggregate counts across all rows. */
  counts: AggregateCounts
  /**
   * When the most-recent scan finished (`null` while a scan is in flight or
   * before the first scan completes). Mirrors `scan.finishedAt`, surfaced at the
   * top level for the "Last scan: <time>" label.
   */
  lastScanFinishedAt: string | null
}

/** Build the current status snapshot from the workers and the DB. */
export function getStatus(): StatusSnapshot {
  const scan = getScanState()
  return {
    scan,
    upload: getUploadState(),
    counts: getAggregateCounts(),
    lastScanFinishedAt: scan.finishedAt,
  }
}
