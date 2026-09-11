/** Registry-driven spawning and serial execution for persisted jobs. */
import {
  claimJob,
  type JobKind,
  type JobRow,
  failInterruptedJobs,
  updateJobState,
} from '../db/jobs'
import {
  queueDiscoveryJob,
  queueReadyRunCopies,
} from '../db/transfer'
import { queueScheduledScanJob } from '../db/scan-jobs'
import { getConfig, type Config } from './config'
import { discoverSourceRuns } from './discovery'
import {
  handleCopyAnalysisJob,
  queueReadyRunAnalysisCopies,
} from './copy-analysis'
import { handleCopyRunJob } from './copy-run'
import { handleScanJob } from './scanner'

export type JobSpawner = () => Promise<unknown>

export type JobHandler = (job: JobRow) => Promise<void>

type JobRegistration = {
  spawner: JobSpawner
  handler: JobHandler
}

/** Paired job spawners and handlers registered as one atomic operation. */
export class JobRegistry {
  readonly #registrations = new Map<JobKind, JobRegistration>()

  get kinds(): readonly JobKind[] {
    return [...this.#registrations.keys()]
  }

  get size(): number {
    return this.#registrations.size
  }

  /** Register all behavior required to spawn and execute one job kind. */
  register(
    kind: JobKind,
    spawner: JobSpawner,
    handler: JobHandler,
  ): void {
    if (this.#registrations.has(kind)) {
      throw new Error(`job kind ${kind} is already registered`)
    }

    this.#registrations.set(kind, { spawner, handler })
  }

  /** Return all registered spawners in registration order. */
  getSpawners(): readonly [JobKind, JobSpawner][] {
    return [...this.#registrations].map(
      ([kind, registration]) => [kind, registration.spawner],
    )
  }

  /** Return the handler paired with a registered job kind. */
  getHandler(kind: JobKind): JobHandler {
    const registration = this.#registrations.get(kind)
    if (!registration) {
      throw new Error(`job kind ${kind} is not registered`)
    }
    return registration.handler
  }
}

/** Build matching spawners and handlers for the jobs enabled at startup. */
export function createJobRegistry(config: Config): JobRegistry {
  const registry = new JobRegistry()
  const { scanPath } = config
  const { enabled, sourcePath } = config.transfer

  if (scanPath) {
    registry.register(
      'scan',
      queueScheduledScanJob,
      () => handleScanJob(scanPath),
    )
  }

  if (enabled && sourcePath) {
    registry.register(
      'copy-run',
      queueReadyRunCopies,
      (job) => handleCopyRunJob(job, config.transfer),
    )
    registry.register(
      'copy-analysis',
      () => queueReadyRunAnalysisCopies(config.transfer),
      (job) => handleCopyAnalysisJob(job, config.transfer),
    )
    registry.register(
      'discover',
      queueDiscoveryJob,
      async () => {
        await discoverSourceRuns(sourcePath)
      },
    )
  }

  return registry
}

/** Fixed cadence for spawning and checking for newly queued work. */
const POLL_INTERVAL_MS = 30_000

let started = false

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.trim() ? message : 'job handler failed without an error message'
}

/** Invoke every registered spawner once without letting one failure block another. */
export async function runJobSpawners(
  registry: JobRegistry,
): Promise<void> {
  for (const [kind, spawn] of registry.getSpawners()) {
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
  registry: JobRegistry,
): Promise<boolean> {
  const job = claimJob(registry.kinds)
  if (!job) return false

  const handler = registry.getHandler(job.kind)

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

async function spawnerLoop(registry: JobRegistry): Promise<void> {
  await runJobSpawners(registry)
  schedule(() => spawnerLoop(registry))
}

async function runnerLoop(registry: JobRegistry): Promise<void> {
  try {
    while (await runNextJob(registry)) {
      // Drain all currently waiting supported jobs serially before polling again.
    }
  } catch (error) {
    // Database/state-transition failures should not permanently stop the worker.
    console.error('job runner failed', error)
  }
  schedule(() => runnerLoop(registry))
}

/** Start the spawner and universal runner loops once for this server process. */
export function startJobWorkers(registry?: JobRegistry): void {
  if (started) return
  const jobRegistry = registry ?? createJobRegistry(getConfig())
  failInterruptedJobs()
  started = true
  if (jobRegistry.size) {
    void spawnerLoop(jobRegistry)
    void runnerLoop(jobRegistry)
  }
}
