/** Typed state transitions for persisted background jobs. */
import { getDb } from './schema'
import { nowIso } from './utils'

export type JobState = 'waiting' | 'running' | 'complete' | 'error'

export interface JobRow {
  id: number
  kind: string
  target_type: string | null
  target_id: number | null
  payload: string
  state: JobState
  created_at: string
  started_at: string | null
  finished_at: string | null
  error_message: string | null
}

export interface JobTarget {
  type: string
  id: number
}

export interface EnqueueJobInput {
  kind: string
  target?: JobTarget
  payload?: unknown
}

/** The only allowed changes to a persisted job's state. */
export const JOB_STATE_TRANSITIONS = {
  waiting: ['running'],
  running: ['complete', 'error'],
  complete: [],
  error: [],
} as const satisfies Record<JobState, readonly JobState[]>

function getJob(id: number): JobRow | undefined {
  return getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as
    | JobRow
    | undefined
}

/** Persist a waiting job for a worker to claim. */
export function enqueueJob({
  kind,
  target,
  payload = {},
}: EnqueueJobInput): JobRow {
  if (!kind.trim()) throw new Error('job kind must not be empty')
  if (target && !target.type.trim()) {
    throw new Error('job target type must not be empty')
  }
  if (target && !Number.isInteger(target.id)) {
    throw new Error('job target id must be an integer')
  }

  let serializedPayload: string | undefined
  try {
    serializedPayload = JSON.stringify(payload)
  } catch {
    throw new Error('job payload must be JSON-serializable')
  }
  if (serializedPayload === undefined) {
    throw new Error('job payload must be JSON-serializable')
  }

  return getDb()
    .prepare(
      `INSERT INTO jobs
         (kind, target_type, target_id, payload, created_at)
       VALUES (@kind, @target_type, @target_id, @payload, @created_at)
       RETURNING *`,
    )
    .get({
      kind,
      target_type: target?.type ?? null,
      target_id: target?.id ?? null,
      payload: serializedPayload,
      created_at: nowIso(),
    }) as JobRow
}

/** Atomically claim the oldest waiting job. */
export function claimJob(): JobRow | undefined {
  return getDb()
    .prepare(
      `UPDATE jobs
          SET state = 'running',
              started_at = ?,
              error_message = NULL
        WHERE id = (
          SELECT id FROM jobs
           WHERE state = 'waiting'
           ORDER BY created_at ASC, id ASC
           LIMIT 1
        )
          AND state = 'waiting'
      RETURNING *`,
    )
    .get(nowIso()) as JobRow | undefined
}

/**
 * Advance a job through its lifecycle and set state-dependent metadata.
 *
 * Use this when the caller already knows which job should change state.
 */
export function updateJobState(
  id: number,
  nextState: JobState,
  errorMessage?: string,
): JobRow {
  if (nextState === 'error' && !errorMessage?.trim()) {
    throw new Error('error message must not be empty')
  }
  if (nextState !== 'error' && errorMessage !== undefined) {
    throw new Error('error message is only valid for the error state')
  }

  const db = getDb()
  return db.transaction(() => {
    const current = getJob(id)
    if (!current) throw new Error(`job ${id} not found`)

    const allowedStates: readonly JobState[] =
      JOB_STATE_TRANSITIONS[current.state]
    if (!allowedStates.includes(nextState)) {
      throw new Error(
        `cannot transition job ${id} from ${current.state} to ${nextState}`,
      )
    }

    const now = nowIso()
    const result = db
      .prepare(
        `UPDATE jobs
            SET state = @next_state,
                started_at = CASE
                  WHEN @next_state = 'running' THEN @now
                  ELSE started_at
                END,
                finished_at = CASE
                  WHEN @next_state IN ('complete', 'error') THEN @now
                  ELSE NULL
                END,
                error_message = CASE
                  WHEN @next_state = 'error' THEN @error_message
                  ELSE NULL
                END
          WHERE id = @id AND state = @current_state`,
      )
      .run({
        id,
        next_state: nextState,
        current_state: current.state,
        now,
        error_message: errorMessage ?? null,
      })

    if (result.changes === 0) {
      throw new Error(`job ${id} changed while transitioning to ${nextState}`)
    }

    return getJob(id)!
  })()
}
