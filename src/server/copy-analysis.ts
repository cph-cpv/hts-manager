/** Run-scoped analysis reconciliation jobs. */
import { lstat, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { JobRow } from '../db/jobs'
import { getRunById, type RunRow } from '../db/runs'
import { queueRequestedScanJob } from '../db/scan-jobs'
import {
  listAnalysisCopyEligibleRuns,
  queueRunAnalysisCopyJob,
} from '../db/transfer'
import type { TransferConfig } from './config'
import {
  CopyConflictError,
  copyDirectory,
  getRunPaths,
  hasCode,
  isPublishedDirectory,
  requireDirectory,
} from './copy'

type ReadyAnalysis = {
  name: string
  source: string
}

type AnalysisFailure = {
  name: string
  error: unknown
}

type AnalysisInspection = {
  ready: ReadyAnalysis[]
  failures: AnalysisFailure[]
}

class AnalysisCopyError extends Error {
  constructor(runId: number, failures: AnalysisFailure[]) {
    const details = failures.map(({ name, error }) => {
      const message = error instanceof Error ? error.message : String(error)
      return `${name}: ${message}`
    })
    super(`Analysis copy failed for run ${runId}: ${details.join('; ')}`)
  }
}

async function isReadyAnalysis(path: string): Promise<boolean> {
  try {
    return (await lstat(join(path, 'report.html'))).isFile()
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false
    throw error
  }
}

async function inspectReadyAnalyses(
  run: RunRow,
  config: TransferConfig,
): Promise<AnalysisInspection> {
  const { source } = getRunPaths(run, config)
  const sourceParent = join(source, 'Analysis')
  try {
    await requireDirectory(sourceParent)
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return { ready: [], failures: [] }
    throw error
  }

  const inspection: AnalysisInspection = { ready: [], failures: [] }
  for (const entry of await readdir(sourceParent, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const analysisSource = join(sourceParent, entry.name)
    try {
      if (await isReadyAnalysis(analysisSource)) {
        inspection.ready.push({ name: entry.name, source: analysisSource })
      }
    } catch (error) {
      inspection.failures.push({ name: entry.name, error })
    }
  }
  return inspection
}

async function hasUnpublishedReadyAnalysis(
  run: RunRow,
  config: TransferConfig,
): Promise<boolean> {
  const { destination } = getRunPaths(run, config)
  let inspection: AnalysisInspection
  try {
    inspection = await inspectReadyAnalyses(run, config)
  } catch {
    // Let a persisted job record and retry run-level inspection failures.
    return true
  }
  if (inspection.failures.length > 0) return true
  for (const analysis of inspection.ready) {
    try {
      const stat = await lstat(join(destination, 'Analysis', analysis.name))
      if (!stat.isDirectory()) return true
    } catch (error) {
      if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) return true
      throw error
    }
  }
  return false
}

/** Queue one reconciliation job for each transferred run with pending analyses. */
export async function queueReadyRunAnalysisCopies(
  config: TransferConfig,
): Promise<void> {
  for (const run of listAnalysisCopyEligibleRuns()) {
    try {
      if (await hasUnpublishedReadyAnalysis(run, config)) {
        queueRunAnalysisCopyJob(run.id)
      }
    } catch (error) {
      console.error(`Analysis copy discovery failed for run ${run.id}`, error)
    }
  }
}

/** Copy every currently ready, unpublished analysis belonging to one run. */
async function copyRunAnalyses(
  run: RunRow,
  config: TransferConfig,
): Promise<void> {
  const { root, destination } = getRunPaths(run, config)
  await requireDirectory(root)
  await requireDirectory(destination)
  const inspection = await inspectReadyAnalyses(run, config)
  if (inspection.ready.length === 0 && inspection.failures.length === 0) return

  const destinationParent = join(destination, 'Analysis')
  try {
    await mkdir(destinationParent)
  } catch (error) {
    if (!hasCode(error, 'EEXIST')) throw error
  }
  await requireDirectory(destinationParent)

  let copied = 0
  const failures = [...inspection.failures]
  for (const analysis of inspection.ready) {
    try {
      const analysisDestination = join(destinationParent, analysis.name)
      if (await isPublishedDirectory(analysisDestination)) continue
      await copyDirectory(
        analysis.source,
        analysisDestination,
        join(root, `.htsm-analysis-${run.id}-${analysis.name}.partial`),
        false,
      )
      copied += 1
    } catch (error) {
      failures.push({ name: analysis.name, error })
    }
  }

  if (copied > 0) {
    try {
      queueRequestedScanJob()
    } catch (error) {
      console.error(
        `Could not queue scan after copying analyses for run ${run.id}`,
        error,
      )
    }
  }

  if (failures.length > 0) throw new AnalysisCopyError(run.id, failures)
}

/** Validate and execute one run-scoped analysis copy job. */
export async function handleCopyAnalysisJob(
  job: JobRow,
  config: TransferConfig,
): Promise<void> {
  if (job.target_type !== 'run' || job.target_id === null) {
    throw new CopyConflictError(
      `Copy-analysis job ${job.id} requires a run target`,
    )
  }

  const run = getRunById(job.target_id)
  if (!run || run.transfer_status !== 'transferred') {
    throw new CopyConflictError(
      `Run ${job.target_id} is not a managed transferred run`,
    )
  }
  await copyRunAnalyses(run, config)
}
