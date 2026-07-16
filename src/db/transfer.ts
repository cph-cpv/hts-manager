/**
 * Typed query helpers for sequencer-output transfer state. This intentionally
 * stays separate from uploadable destination-run queries: transfer sources are
 * sequencer-side folders, not rows in the existing `runs` table.
 */
import {
  getDb,
  type TransferJobKind,
  type TransferJobRow,
  type TransferSourceRow,
} from './schema'

function nowIso(): string {
  return new Date().toISOString()
}

function requireMessage(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} must not be empty`)
}

function getTransferSource(id: number): TransferSourceRow | undefined {
  return getDb()
    .prepare('SELECT * FROM transfer_source_status WHERE id = ?')
    .get(id) as TransferSourceRow | undefined
}

function getTransferJob(id: number): TransferJobRow {
  return getDb()
    .prepare('SELECT * FROM transfer_jobs WHERE id = ?')
    .get(id) as TransferJobRow
}

function hasCompletedTransferJob(
  sourceId: number,
  kind: Exclude<TransferJobKind, 'discover'>,
): boolean {
  return Boolean(
    getDb()
      .prepare(
        `SELECT 1 FROM transfer_jobs
          WHERE source_id = ? AND kind = ? AND state = 'complete'
          LIMIT 1`,
      )
      .get(sourceId, kind),
  )
}

export interface UpsertTransferSourceInput {
  folderName: string
  sourcePath: string
}

/**
 * Insert or refresh a transfer source by its absolute source path.
 * The folder name is persisted as the eventual destination folder name.
 */
export function upsertTransferSource(
  input: UpsertTransferSourceInput,
): TransferSourceRow {
  const db = getDb()
  const now = nowIso()

  db.prepare(
    `INSERT INTO transfer_sources
       (folder_name, source_path, readiness_status, first_seen_at)
     VALUES
       (@folder_name, @source_path, 'waiting', @first_seen_at)
     ON CONFLICT(source_path) DO UPDATE SET
       folder_name = excluded.folder_name`,
  ).run({
    folder_name: input.folderName,
    source_path: input.sourcePath,
    first_seen_at: now,
  })

  const row = db
    .prepare('SELECT * FROM transfer_source_status WHERE source_path = ?')
    .get(input.sourcePath) as TransferSourceRow | undefined
  if (!row) throw new Error('failed to upsert transfer source')
  return row
}

/** Mark a source as waiting for readiness checks. */
export function markTransferSourceWaiting(id: number): boolean {
  const info = getDb()
    .prepare(
      `UPDATE transfer_sources
          SET readiness_status = 'waiting',
              block_reason = NULL
        WHERE id = ?
          AND NOT EXISTS (
            SELECT 1 FROM transfer_jobs
             WHERE source_id = transfer_sources.id
               AND kind = 'copy'
               AND state = 'complete'
          )`,
    )
    .run(id)
  return info.changes > 0
}

/** Mark a source as ready to copy. */
export function markTransferSourceReady(id: number): boolean {
  const info = getDb()
    .prepare(
      `UPDATE transfer_sources
          SET readiness_status = 'ready',
              block_reason = NULL
        WHERE id = ?
          AND NOT EXISTS (
            SELECT 1 FROM transfer_jobs
             WHERE source_id = transfer_sources.id
               AND kind = 'copy'
               AND state = 'complete'
          )`,
    )
    .run(id)
  return info.changes > 0
}

/** Mark a source blocked by a readiness or non-recoverable copy problem. */
export function markTransferSourceBlocked(
  id: number,
  reason: string,
): boolean {
  requireMessage(reason, 'block reason')

  const info = getDb()
    .prepare(
      `UPDATE transfer_sources
          SET readiness_status = 'blocked',
              block_reason = ?
        WHERE id = ?
          AND NOT EXISTS (
            SELECT 1 FROM transfer_jobs
             WHERE source_id = transfer_sources.id
               AND kind = 'copy'
               AND state = 'complete'
          )`,
    )
    .run(reason, id)
  return info.changes > 0
}

/**
 * A copy claim contains the source snapshot and the running job that records
 * the attempt.
 */
export interface ClaimedTransferSource {
  source: TransferSourceRow
  job: TransferJobRow
}

/**
 * Atomically claim the oldest ready source and create its running copy job.
 * Returns undefined while another copy is running or no run is ready.
 */
export function claimReadyTransferSource(): ClaimedTransferSource | undefined {
  const db = getDb()
  return db.transaction(() => {
    const runningCopy = db
      .prepare(
        `SELECT 1 FROM transfer_jobs
          WHERE kind = 'copy' AND state = 'running'
          LIMIT 1`,
      )
      .get()
    if (runningCopy) return undefined

    const row = db
      .prepare(
        `SELECT * FROM transfer_source_status AS transfer_source
          WHERE readiness_status = 'ready'
            AND NOT EXISTS (
              SELECT 1 FROM transfer_jobs
               WHERE source_id = transfer_source.id
                 AND (
                   (kind = 'copy' AND state IN ('waiting', 'running', 'complete'))
                   OR (kind = 'remove' AND state = 'complete')
                 )
            )
          ORDER BY first_seen_at ASC, id ASC
          LIMIT 1`,
      )
      .get() as TransferSourceRow | undefined
    if (!row) return undefined

    const now = nowIso()
    const info = db
      .prepare(
        `INSERT INTO transfer_jobs
           (source_id, kind, state, created_at, started_at)
         VALUES (?, 'copy', 'running', ?, ?)`,
      )
      .run(row.id, now, now)

    return {
      source: getTransferSource(row.id)!,
      job: getTransferJob(Number(info.lastInsertRowid)),
    }
  })()
}

/** Complete the source's running copy job. */
export function markTransferSourceCopied(id: number): boolean {
  const job = getDb()
    .prepare(
      `SELECT * FROM transfer_jobs
        WHERE source_id = ? AND kind = 'copy' AND state = 'running'
        ORDER BY id DESC
        LIMIT 1`,
    )
    .get(id) as TransferJobRow | undefined
  return job ? markTransferJobComplete(job.id) : false
}

/** Fail a source's currently running copy or removal job. */
export function markTransferSourceError(id: number, message: string): boolean {
  requireMessage(message, 'error message')

  const job = getDb()
    .prepare(
      `SELECT * FROM transfer_jobs
        WHERE source_id = ?
          AND kind IN ('copy', 'remove')
          AND state = 'running'
        ORDER BY id DESC
        LIMIT 1`,
    )
    .get(id) as TransferJobRow | undefined
  return job ? markTransferJobError(job.id, message) : false
}

/** Claim this source's queued removal job. */
export function markTransferSourceRemoving(id: number): boolean {
  const db = getDb()
  return db.transaction(() => {
    const job = db
      .prepare(
        `SELECT id FROM transfer_jobs
          WHERE source_id = ? AND kind = 'remove' AND state = 'waiting'
          ORDER BY created_at ASC, id ASC
          LIMIT 1`,
      )
      .get(id) as { id: number } | undefined
    if (!job) return false

    return (
      db
        .prepare(
          `UPDATE transfer_jobs
              SET state = 'running', started_at = ?
            WHERE id = ? AND state = 'waiting'`,
        )
        .run(nowIso(), job.id).changes > 0
    )
  })()
}

/** Complete the source's running removal job. */
export function markTransferSourceRemoved(id: number): boolean {
  const job = getDb()
    .prepare(
      `SELECT * FROM transfer_jobs
        WHERE source_id = ? AND kind = 'remove' AND state = 'running'
        ORDER BY id DESC
        LIMIT 1`,
    )
    .get(id) as TransferJobRow | undefined
  return job ? markTransferJobComplete(job.id) : false
}

export interface QueueTransferJobInput {
  kind: TransferJobKind
  sourceId?: number
}

/**
 * Queue discover/copy/remove work. SQLite constraints enforce one active
 * discovery job, one active copy/removal per source, and one running copy.
 */
export function queueTransferJob(input: QueueTransferJobInput): TransferJobRow {
  const db = getDb()
  const sourceId = input.kind === 'discover' ? null : input.sourceId
  if (input.kind !== 'discover' && sourceId === undefined) {
    throw new Error(`${input.kind} transfer jobs require a source id`)
  }

  if (input.kind === 'copy') {
    const source = getTransferSource(sourceId!)
    if (!source) {
      throw new Error(`transfer source ${sourceId} not found`)
    }
    if (
      source.readiness_status !== 'ready' ||
      hasCompletedTransferJob(sourceId!, 'copy')
    ) {
      throw new Error('copy jobs require a ready, uncopied source')
    }
  }

  const info = db
    .prepare(
      `INSERT INTO transfer_jobs
         (source_id, kind, state, created_at)
       VALUES (?, ?, 'waiting', ?)`,
    )
    .run(sourceId, input.kind, nowIso())

  return getTransferJob(Number(info.lastInsertRowid))
}

/** Queue source removal only when the source has a completed copy. */
export function queueTransferRemovalJob(sourceId: number): TransferJobRow {
  const source = getTransferSource(sourceId)
  if (!source) throw new Error(`transfer source ${sourceId} not found`)
  if (!hasCompletedTransferJob(sourceId, 'copy')) {
    throw new Error('transfer removal requires completed copy')
  }
  if (hasCompletedTransferJob(sourceId, 'remove')) {
    throw new Error('transfer source has already been removed')
  }

  return queueTransferJob({ kind: 'remove', sourceId })
}

/** Claim the oldest waiting transfer job of a kind and mark it running. */
export function claimNextTransferJob(
  kind: TransferJobKind,
): TransferJobRow | undefined {
  const db = getDb()
  return db.transaction(() => {
    if (kind === 'copy') {
      const runningCopy = db
        .prepare(
          `SELECT * FROM transfer_jobs
            WHERE kind = 'copy' AND state = 'running'
            ORDER BY started_at ASC, id ASC
            LIMIT 1`,
        )
        .get() as TransferJobRow | undefined
      if (runningCopy) return undefined
    }

    const row = (
      kind === 'copy'
        ? db
            .prepare(
              `SELECT job.* FROM transfer_jobs AS job
                JOIN transfer_sources AS transfer_source
                  ON transfer_source.id = job.source_id
               WHERE job.kind = 'copy'
                 AND job.state = 'waiting'
                 AND transfer_source.readiness_status = 'ready'
                 AND NOT EXISTS (
                   SELECT 1 FROM transfer_jobs AS completed_job
                    WHERE completed_job.source_id = transfer_source.id
                      AND completed_job.kind = 'copy'
                      AND completed_job.state = 'complete'
                 )
               ORDER BY job.created_at ASC, job.id ASC
               LIMIT 1`,
            )
            .get()
        : db
            .prepare(
              `SELECT * FROM transfer_jobs
                WHERE kind = ? AND state = 'waiting'
                ORDER BY created_at ASC, id ASC
                LIMIT 1`,
            )
            .get(kind)
    ) as TransferJobRow | undefined
    if (!row) return undefined

    db.prepare(
      `UPDATE transfer_jobs
          SET state = 'running',
              started_at = ?,
              error_message = NULL
        WHERE id = ? AND state = 'waiting'`,
    ).run(nowIso(), row.id)

    return getTransferJob(row.id)
  })()
}

/**
 * Mark a running job complete. Source copy/removal status is derived from the
 * completed job rather than persisted separately.
 */
export function markTransferJobComplete(id: number): boolean {
  const db = getDb()
  return db.transaction(() => {
    const job = db
      .prepare('SELECT * FROM transfer_jobs WHERE id = ?')
      .get(id) as TransferJobRow | undefined
    if (!job || job.state !== 'running') return false

    const now = nowIso()
    const info = db
      .prepare(
        `UPDATE transfer_jobs
            SET state = 'complete',
                finished_at = ?,
                error_message = NULL
          WHERE id = ? AND state = 'running'`,
      )
      .run(now, id)
    if (info.changes === 0) return false

    return true
  })()
}

/** Mark a transfer job failed. */
export function markTransferJobError(id: number, message: string): boolean {
  requireMessage(message, 'error message')

  const info = getDb()
    .prepare(
      `UPDATE transfer_jobs
          SET state = 'error',
              finished_at = ?,
              error_message = ?
        WHERE id = ? AND state = 'running'`,
    )
    .run(nowIso(), message, id)
  return info.changes > 0
}

export interface TransferCounts {
  total: number
  waiting: number
  ready: number
  blocked: number
  copying: number
  copied: number
  removing: number
  removed: number
  errors: number
  activeJobs: number
  jobErrors: number
}

/** Aggregate source and job counts for transfer status views. */
export function getTransferCounts(): TransferCounts {
  return getDb()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(status = 'waiting'), 0) AS waiting,
         COALESCE(SUM(status = 'ready'), 0) AS ready,
         COALESCE(SUM(status = 'blocked'), 0) AS blocked,
         COALESCE(SUM(status = 'copying'), 0) AS copying,
         COALESCE(SUM(status = 'copied'), 0) AS copied,
         COALESCE(SUM(status = 'removing'), 0) AS removing,
         COALESCE(SUM(status = 'removed'), 0) AS removed,
         COALESCE(SUM(status = 'error'), 0) AS errors,
         (
           SELECT COUNT(*) FROM transfer_jobs
            WHERE state IN ('waiting', 'running')
         ) AS activeJobs,
         (
           SELECT COUNT(*) FROM transfer_jobs
            WHERE state = 'error'
         ) AS jobErrors
       FROM transfer_source_status`,
    )
    .get() as TransferCounts
}

/** Recent sources for UI/status surfaces. */
export function listRecentTransferSources(
  limit = 20,
): TransferSourceRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM transfer_source_status
        ORDER BY first_seen_at DESC, id DESC
        LIMIT ?`,
    )
    .all(limit) as TransferSourceRow[]
}

/** Problem sources for UI/status surfaces. */
export function listProblemTransferSources(
  limit = 20,
): TransferSourceRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM transfer_source_status
        WHERE status IN ('blocked', 'error')
        ORDER BY first_seen_at DESC, id DESC
        LIMIT ?`,
    )
    .all(limit) as TransferSourceRow[]
}
