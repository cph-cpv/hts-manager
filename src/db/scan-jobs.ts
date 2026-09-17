/** Persisted scan-job scheduling and request deduplication. */
import { enqueueJob, type JobRow } from './jobs'
import { getDb } from './db'

const SCAN_INTERVAL_MS = 60 * 60 * 1000

export type QueueRequestedScanJobResult = {
  job: JobRow
  queued: boolean
}

/** Queue a requested scan unless one is already waiting. */
export function queueRequestedScanJob(): QueueRequestedScanJobResult {
  const db = getDb()
  return db.transaction(() => {
    const waiting = db
      .prepare(
        `SELECT * FROM jobs
          WHERE kind = 'scan' AND state = 'waiting'
          ORDER BY created_at ASC, id ASC
          LIMIT 1`,
      )
      .get() as JobRow | undefined

    if (waiting) return { job: waiting, queued: false }
    return { job: enqueueJob({ kind: 'scan' }), queued: true }
  })()
}

/**
 * Queue an hourly scan when no scan is active and none finished recently.
 * Both successful and failed attempts count toward the cooldown.
 */
export async function queueScheduledScanJob(): Promise<JobRow | undefined> {
  const db = getDb()
  return db.transaction(() => {
    const active = db
      .prepare(
        `SELECT 1 FROM jobs
          WHERE kind = 'scan' AND state IN ('waiting', 'running')
          LIMIT 1`,
      )
      .get()
    if (active) return undefined

    const cutoff = new Date(Date.now() - SCAN_INTERVAL_MS).toISOString()
    const recentlyFinished = db
      .prepare(
        `SELECT 1 FROM jobs
          WHERE kind = 'scan'
            AND state IN ('complete', 'error')
            AND finished_at > ?
          LIMIT 1`,
      )
      .get(cutoff)
    if (recentlyFinished) return undefined

    return enqueueJob({ kind: 'scan' })
  })()
}

/** Return whether a scan is waiting for the serial job worker. */
export function isScanJobWaiting(): boolean {
  return Boolean(
    getDb()
      .prepare(
        `SELECT 1 FROM jobs
          WHERE kind = 'scan' AND state = 'waiting'
          LIMIT 1`,
      )
      .get(),
  )
}
