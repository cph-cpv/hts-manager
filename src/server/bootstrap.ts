/**
 * One-time startup hook for the in-process background workers. The Nitro startup
 * plugin calls {@link ensureWorkersStarted} after configuration validation and
 * database migration. A `globalThis` flag prevents duplicate loops if Nitro is
 * initialized more than once in the same process.
 */
import type { Config } from './config'
import { startFastqLinkWorker } from './fastq-link-worker'
import { startJobWorkers } from './jobs/job-worker'
import { startUploader } from './uploader'

declare global {
  // eslint-disable-next-line no-var
  var __htsmWorkersStarted: boolean | undefined
}

/**
 * Start background workers once per process. Start FASTQ link reconciliation
 * when configured; job registries select enabled jobs and schedule scans.
 */
export function ensureWorkersStarted(config: Config): void {
  if (globalThis.__htsmWorkersStarted) return

  globalThis.__htsmWorkersStarted = true

  startUploader()

  if (config.fastqLinks.enabled) startFastqLinkWorker(config.fastqLinks)
  startJobWorkers()
}
