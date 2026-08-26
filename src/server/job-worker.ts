/** Registry-driven spawning and serial execution for persisted jobs. */
import { claimJob, type JobRow, updateJobState } from '../db/jobs'

export type JobSpawner = () => void | Promise<void>

export type JobHandler = (job: JobRow) => void | Promise<void>

export type JobSpawnerRegistry = Readonly<Record<string, JobSpawner>>

export type JobHandlerRegistry = Readonly<Record<string, JobHandler>>

/**
 * Production callbacks that discover eligible work and persist waiting jobs.
 *
 * Each key is a job kind and its spawner is invoked once per polling cycle by
 * the shared spawner loop. Spawners may be synchronous or asynchronous and are
 * responsible only for deciding what work should be queued and enqueueing it;
 * the generic runner later claims and executes the persisted jobs.
 *
 * Job-specific follow-up issues add the production registrations.
 */
export const JOB_SPAWNERS: JobSpawnerRegistry = {}

/**
 * Production callbacks that execute jobs claimed by the generic runner.
 *
 * Each key is a supported job kind and its handler receives the corresponding
 * persisted job after it has entered the running state. The shared runner owns
 * claiming the job and marking it complete or errored based on whether the
 * handler returns successfully or throws.
 *
 * Job-specific follow-up issues add the production registrations. Registering
 * new kinds here lets the same runner execute different kinds of work without
 * requiring a dedicated worker loop for each one.
 */
export const JOB_HANDLERS: JobHandlerRegistry = {}

/** Fixed cadence for spawning and checking for newly queued work. */
const POLL_INTERVAL_MS = 30_000

let started = false

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.trim() ? message : 'job handler failed without an error message'
}

/** Invoke every registered spawner once without letting one failure block another. */
export async function runJobSpawners(
  spawners: JobSpawnerRegistry,
): Promise<void> {
  for (const [kind, spawn] of Object.entries(spawners)) {
    try {
      await spawn()
    } catch (error) {
      console.error(`job spawner failed for kind ${kind}`, error)
    }
  }
}

/**
 * Claim and process the oldest job supported by the universal worker.
 * Returns whether a job was processed so the runner can drain the queue.
 */
export async function runNextJob(
  handlers: JobHandlerRegistry,
): Promise<boolean> {
  const handlerEntries = Object.entries(handlers)
  const job = claimJob(handlerEntries.map(([kind]) => kind))
  if (!job) return false

  const handler = handlerEntries.find(([kind]) => kind === job.kind)?.[1]
  if (!handler) {
    throw new Error(`claimed job ${job.id} without a handler for ${job.kind}`)
  }

  try {
    await handler(job)
  } catch (error) {
    updateJobState(job.id, 'error', errorMessage(error))
    return true
  }

  updateJobState(job.id, 'complete')
  return true
}

function schedule(nextCycle: () => Promise<void>): void {
  const timer = setTimeout(() => void nextCycle(), POLL_INTERVAL_MS)
  timer.unref()
}

async function spawnerLoop(spawners: JobSpawnerRegistry): Promise<void> {
  await runJobSpawners(spawners)
  schedule(() => spawnerLoop(spawners))
}

async function runnerLoop(handlers: JobHandlerRegistry): Promise<void> {
  try {
    while (await runNextJob(handlers)) {
      // Drain all currently waiting supported jobs serially before polling again.
    }
  } catch (error) {
    // Database/state-transition failures should not permanently stop the worker.
    console.error('job runner failed', error)
  }
  schedule(() => runnerLoop(handlers))
}

/** Start the spawner and universal runner loops once for this server process. */
export function startJobWorkers(
  spawners: JobSpawnerRegistry = JOB_SPAWNERS,
  handlers: JobHandlerRegistry = JOB_HANDLERS,
): void {
  if (started) return
  started = true
  void spawnerLoop(spawners)
  void runnerLoop(handlers)
}
