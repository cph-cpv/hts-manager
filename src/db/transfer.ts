import type { ParsedRunFolder } from '../scan/parse'
import { getDb } from './db'
import { enqueueJob, type JobRow } from './jobs'
import { transitionLifecycleStatus } from './lifecycle'
import { getRunRowById, type RunRow, type RunStatus } from './runs'
import { nowIso } from './utils'

export const RUN_STATUS_TRANSITIONS = {
  manually_copied: [],
  running: ['run_complete'],
  run_complete: ['transferred', 'blocked'],
  blocked: ['run_complete'],
  transferred: ['source_deleted'],
  source_deleted: [],
} as const satisfies Record<RunStatus, readonly RunStatus[]>

export function transitionRunStatus(id: number, nextStatus: RunStatus): void {
  transitionLifecycleStatus({
    table: 'runs',
    id,
    nextStatus,
    transitions: RUN_STATUS_TRANSITIONS,
  })
}

export function markRunComplete(id: number): void {
  transitionRunStatus(id, 'run_complete')
}

export function markRunTransferred(id: number): void {
  transitionRunStatus(id, 'transferred')
}

export function markRunBlocked(id: number): void {
  transitionRunStatus(id, 'blocked')
}

export function markRunSourceDeleted(id: number): void {
  transitionRunStatus(id, 'source_deleted')
}

export function recoverBlockedRun(id: number): void {
  transitionRunStatus(id, 'run_complete')
}

export type UpsertManagedRunInput = ParsedRunFolder & {
  runFolder: string
  sourcePath: string
}

/** Insert a newly observed source run, without converting manually copied runs. */
export function upsertManagedRun(input: UpsertManagedRunInput): RunRow {
  if (!input.sourcePath.trim()) throw new Error('source path must not be empty')
  const db = getDb()
  return db.transaction(() => {
    const existing = db.prepare('SELECT * FROM runs WHERE run_folder = ?')
      .get(input.runFolder) as RunRow | undefined
    if (existing) {
      if (existing.status === 'manually_copied') return existing
      if (existing.source_path !== input.sourcePath) {
        throw new Error(
          `run folder ${input.runFolder} is already associated with source path ${existing.source_path}`,
        )
      }
      return existing
    }
    const owner = db.prepare('SELECT run_folder FROM runs WHERE source_path = ?')
      .get(input.sourcePath) as { run_folder: string } | undefined
    if (owner) {
      throw new Error(
        `source path ${input.sourcePath} is already associated with run folder ${owner.run_folder}`,
      )
    }
    return db.prepare(`
      INSERT INTO runs (
        run_folder, source_path, status, run_date, instrument,
        run_number, flowcell, first_seen_at, last_scanned_at
      ) VALUES (
        @run_folder, @source_path, 'running', @run_date, @instrument,
        @run_number, @flowcell, @first_seen_at, NULL
      ) RETURNING *
    `).get({
      run_folder: input.runFolder,
      source_path: input.sourcePath,
      run_date: input.run_date,
      instrument: input.instrument,
      run_number: input.run_number,
      flowcell: input.flowcell,
      first_seen_at: nowIso(),
    }) as RunRow
  })()
}

function requireSourceRun(runId: number): RunRow {
  const run = getRunRowById(runId)
  if (!run) throw new Error(`run ${runId} not found`)
  if (run.status === 'manually_copied' || !run.source_path) {
    throw new Error(`run ${runId} requires a source path`)
  }
  return run
}

export async function queueDiscoveryJob(): Promise<void> {
  const db = getDb()
  db.transaction(() => {
    const active = db.prepare(`
      SELECT id FROM jobs WHERE kind = 'discover'
        AND target_type IS NULL AND target_id IS NULL
        AND state IN ('waiting', 'running') LIMIT 1
    `).get()
    if (!active) enqueueJob({ kind: 'discover' })
  })()
}

export function queueRunCopyJob(runId: number): JobRow {
  const db = getDb()
  return db.transaction(() => {
    const run = requireSourceRun(runId)
    if (run.status !== 'run_complete') {
      throw new Error('copy-run jobs require a run_complete source run')
    }
    const active = db.prepare(`
      SELECT * FROM jobs WHERE kind = 'copy-run' AND target_type = 'run'
        AND target_id = ? AND state IN ('waiting', 'running')
      ORDER BY id LIMIT 1
    `).get(runId) as JobRow | undefined
    return active ?? enqueueJob({ kind: 'copy-run', target: { type: 'run', id: runId } })
  })()
}

export function listCopyEligibleRuns(): RunRow[] {
  return getDb().prepare(`
    SELECT * FROM runs
     WHERE status = 'run_complete'
       AND source_path IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM jobs WHERE kind = 'copy-run' AND target_type = 'run'
           AND target_id = runs.id AND state IN ('waiting', 'running')
       ) ORDER BY id
  `).all() as RunRow[]
}

export async function queueCompletedRunCopies(): Promise<void> {
  for (const run of listCopyEligibleRuns()) queueRunCopyJob(run.id)
}

/** Dormant helper for the later source-deletion worker. */
export function queueRunRemovalJob(runId: number): JobRow {
  const run = requireSourceRun(runId)
  if (run.status !== 'transferred') {
    throw new Error('remove jobs require a transferred run')
  }
  return enqueueJob({ kind: 'remove', target: { type: 'run', id: runId } })
}

export function listProblemTransferRuns(limit = 20): Array<RunRow & { last_error: string | null }> {
  return getDb().prepare(`
    SELECT r.*,
           (SELECT error_message FROM jobs j
             WHERE j.target_type = 'run' AND j.target_id = r.id
               AND j.state = 'error' ORDER BY j.id DESC LIMIT 1) AS last_error
      FROM runs r WHERE r.status = 'blocked'
     ORDER BY r.first_seen_at DESC, r.id DESC LIMIT ?
  `).all(limit) as Array<RunRow & { last_error: string | null }>
}
