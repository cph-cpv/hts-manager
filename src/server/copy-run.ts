/** Copy-run job handling and durable run transfer transitions. */
import { join } from 'node:path'
import type { JobRow } from '../db/jobs'
import { getRunById } from '../db/runs'
import { markRunCopyError, markRunTransferred } from '../db/transfer'
import type { TransferConfig } from './config'
import {
  CopyConflictError,
  copyDirectory,
  doesPathExist,
  getRunPaths,
  isRetryableCopyError,
  requireDirectory,
  verifyPublishedDirectory,
} from './copy'

/** Copy and verify a ready base run without its root Analysis directory. */
async function copyRun(runId: number, config: TransferConfig): Promise<void> {
  const run = getRunById(runId)
  if (!run || run.transfer_status !== 'ready') {
    throw new CopyConflictError(`Run ${runId} is not a managed ready run`)
  }

  const { source, root, destination } = getRunPaths(run, config)
  await requireDirectory(root)
  if (await doesPathExist(destination)) {
    await verifyPublishedDirectory(source, destination, true)
  } else {
    await copyDirectory(
      source,
      destination,
      join(root, `.htsm-copy-${runId}.partial`),
      true,
    )
  }
  markRunTransferred(runId)
}

/** Translate base-run copy failures into the durable run lifecycle. */
export async function handleCopyRunJob(
  job: JobRow,
  config: TransferConfig,
): Promise<void> {
  if (job.target_type !== 'run' || job.target_id === null) {
    throw new CopyConflictError(`Copy-run job ${job.id} requires a run target`)
  }

  try {
    await copyRun(job.target_id, config)
  } catch (error) {
    if (
      !isRetryableCopyError(error) &&
      getRunById(job.target_id)?.transfer_status === 'ready'
    ) {
      markRunCopyError(job.target_id)
    }
    throw error
  }
}
