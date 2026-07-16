/**
 * Background scanner singleton. Holds the live scan state polled by the status
 * function and exposes `requestScan()` to kick off a scan (on server startup and
 * from the "Scan now" button). At most one scan runs at a time; a second request
 * while one is in flight is a no-op. Errors are captured into the state, never
 * thrown to the caller. See plan.md (step 4).
 */
import { runScan, type ScanResult } from '../scan/scan'
import { getConfig } from './config'

/** Snapshot of the scanner, surfaced through `getStatus`. */
export interface ScanState {
  scanning: boolean
  startedAt: string | null
  finishedAt: string | null
  /** FASTQ files visited in the current/most-recent scan. */
  processed: number
  /** New rows inserted in the current/most-recent scan. */
  added: number
  /** Summary of the most-recent completed scan, or null if none has finished. */
  lastResult: ScanResult | null
  /** Message from the most-recent scan that threw, else null. */
  error: string | null
}

let state: ScanState = {
  scanning: false,
  startedAt: null,
  finishedAt: null,
  processed: 0,
  added: 0,
  lastResult: null,
  error: null,
}

/** Why a `requestScan()` call did not start a scan. */
export type ScanSkipReason = 'already-running' | 'no-scan-path'

/** Outcome of a `requestScan()` call. */
export interface RequestScanResult {
  started: boolean
  reason?: ScanSkipReason
}

/** Current scanner snapshot (a copy, so callers can't mutate internal state). */
export function getScanState(): ScanState {
  return { ...state }
}

/**
 * Start a scan of `HTSM_SCAN_PATH` unless one is already running (or no scan path
 * is configured). Returns immediately; the scan runs in the background and
 * updates {@link getScanState}.
 */
export function requestScan(): RequestScanResult {
  if (state.scanning) return { started: false, reason: 'already-running' }

  const root = getConfig().scanPath
  if (!root) return { started: false, reason: 'no-scan-path' }

  state = {
    scanning: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    processed: 0,
    added: 0,
    lastResult: null,
    error: null,
  }

  void runScanJob(root)
  return { started: true }
}

async function runScanJob(root: string): Promise<void> {
  try {
    const result = await runScan(root, ({ processed, added }) => {
      state = { ...state, processed, added }
    })
    state = {
      ...state,
      scanning: false,
      finishedAt: new Date().toISOString(),
      added: result.added,
      lastResult: result,
      error: null,
    }
  } catch (err) {
    state = {
      ...state,
      scanning: false,
      finishedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
