/** Independent copy and direct indexing for one completed analysis. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  getAnalysisById,
  getAnalysisWithRun,
  markAnalysisBlocked,
  markAnalysisTransferred,
  queueEligibleAnalysisCopies,
} from '../../db/analyses'
import type { JobRow } from '../../db/jobs'
import type { TransferConfig } from '../config'
import {
  CopyConflictError,
  copyDirectory,
  doesPathExist,
  getRunPaths,
  hasCode,
  requireDirectory,
  verifyPublishedDirectory,
} from '../copy'
import { AnalysisContentError, indexPublishedAnalysis } from './index-analysis'

/** Queue one active job per eligible analysis. */
export async function queueEligibleAnalysisCopyJobs(): Promise<void> {
  queueEligibleAnalysisCopies()
}

async function ensureTransferred(analysisId: number, config: TransferConfig): Promise<string> {
  const analysis = getAnalysisWithRun(analysisId)
  if (!analysis) throw new CopyConflictError(`Analysis ${analysisId} not found`)
  if (analysis.run.status !== 'transferred') {
    throw new CopyConflictError(`Analysis ${analysisId} does not belong to a transferred run`)
  }

  const { source: runSource, root, destination: runDestination } = getRunPaths(
    analysis.run,
    config,
  )
  const source = join(runSource, 'Analysis', analysis.analysis_folder)
  const destinationParent = join(runDestination, 'Analysis')
  const destination = join(destinationParent, analysis.analysis_folder)

  if (analysis.status === 'transferred') {
    await requireDirectory(destination)
    return destination
  }
  if (analysis.status !== 'analysis_complete') {
    throw new CopyConflictError(`Analysis ${analysisId} is not copy eligible`)
  }

  await requireDirectory(root)
  await requireDirectory(runDestination)
  try {
    await mkdir(destinationParent)
  } catch (error) {
    if (!hasCode(error, 'EEXIST')) throw error
  }
  await requireDirectory(destinationParent)

  if (await doesPathExist(destination)) {
    await verifyPublishedDirectory(source, destination, false)
  } else {
    await copyDirectory(
      source,
      destination,
      join(root, `.htsm-analysis-${analysis.id}.partial`),
      false,
    )
  }
  markAnalysisTransferred(analysis.id)
  return destination
}

export async function handleCopyAnalysisJob(
  job: JobRow,
  config: TransferConfig,
): Promise<void> {
  if (job.target_type !== 'analysis' || job.target_id === null) {
    throw new CopyConflictError(`Copy-analysis job ${job.id} requires an analysis target`)
  }
  if (getAnalysisById(job.target_id)?.status === 'indexed') return

  try {
    const destination = await ensureTransferred(job.target_id, config)
    await indexPublishedAnalysis(job.target_id, destination)
  } catch (error) {
    const current = getAnalysisById(job.target_id)
    if (
      (error instanceof CopyConflictError || error instanceof AnalysisContentError) &&
      current &&
      (current.status === 'analysis_complete' || current.status === 'transferred')
    ) {
      markAnalysisBlocked(current.id)
    }
    throw error
  }
}
