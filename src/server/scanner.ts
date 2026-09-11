/**
 * Scan job handler and live progress state polled by the status function.
 */
import {
  isScanJobWaiting,
  queueRequestedScanJob,
} from '../db/scan-jobs'
import { runScan, type ScanResult } from '../scan/scan'
import { getConfig } from './config'

/** Snapshot of the scanner, surfaced through `getStatus`. */
export type ScanState = {
  /** A scan is persisted and waiting for the serial job worker. */
  queued: boolean
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

let state: Omit<ScanState, 'queued'> = {
  scanning: false,
  startedAt: null,
  finishedAt: null,
  processed: 0,
  added: 0,
  lastResult: null,
  error: null,
}

/** Why a `requestScan()` call did not add a scan job. */
export type ScanSkipReason = 'already-waiting' | 'no-scan-path'

/** Outcome of a `requestScan()` call. */
export type RequestScanResult = {
  queued: boolean
  reason?: ScanSkipReason
}

/** Current scanner snapshot (a copy, so callers can't mutate internal state). */
export function getScanState(): ScanState {
  return { ...state, queued: isScanJobWaiting() }
}

/**
 * Persist a user-requested scan of `HTSM_SCAN_PATH`. A running scan may have one
 * follow-up waiting, but repeated requests never add more waiting jobs.
 */
export function requestScan(): RequestScanResult {
  const root = getConfig().scanPath
  if (!root) return { queued: false, reason: 'no-scan-path' }

  const result = queueRequestedScanJob()
  return result.queued
    ? { queued: true }
    : { queued: false, reason: 'already-waiting' }
}

/** Run one claimed scan job and expose its live progress. */
export async function handleScanJob(root: string): Promise<void> {
  state = {
    scanning: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    processed: 0,
    added: 0,
    lastResult: null,
    error: null,
  }

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
    const error = err instanceof Error ? err.message : String(err)
    state = {
      ...state,
      scanning: false,
      finishedAt: new Date().toISOString(),
      error,
    }
    throw err
  }
}
