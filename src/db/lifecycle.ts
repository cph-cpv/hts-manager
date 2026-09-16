import { getDb } from './db'

export type StatusTransitions<Status extends string> = Record<
  Status,
  readonly Status[]
>

type LifecycleTable = 'runs' | 'analyses'

const LIFECYCLE_TABLES = {
  runs: {
    entity: 'run',
    getStatus: 'SELECT status FROM runs WHERE id = ?',
    updateStatus: 'UPDATE runs SET status = ? WHERE id = ? AND status = ?',
  },
  analyses: {
    entity: 'analysis',
    getStatus: 'SELECT status FROM analyses WHERE id = ?',
    updateStatus: 'UPDATE analyses SET status = ? WHERE id = ? AND status = ?',
  },
} as const

/**
 * Validate and atomically apply one durable lifecycle transition.
 *
 * Each domain owns its states and transition map; this shared boundary owns
 * fetching the current state, validating the edge, and guarding the update
 * against a concurrent change.
 */
export function transitionLifecycleStatus<Status extends string>(input: {
  table: LifecycleTable
  id: number
  nextStatus: Status
  transitions: StatusTransitions<Status>
}): void {
  const db = getDb()
  const table = LIFECYCLE_TABLES[input.table]
  const current = db.prepare(table.getStatus).get(input.id) as
    | { status: Status }
    | undefined

  if (!current) throw new Error(`${table.entity} ${input.id} not found`)
  if (!input.transitions[current.status].includes(input.nextStatus)) {
    throw new Error(
      `cannot transition ${table.entity} ${input.id} from ${current.status} to ${input.nextStatus}`,
    )
  }

  const result = db.prepare(table.updateStatus).run(
    input.nextStatus,
    input.id,
    current.status,
  )
  if (!result.changes) {
    throw new Error(`${table.entity} ${input.id} changed while transitioning`)
  }
}
