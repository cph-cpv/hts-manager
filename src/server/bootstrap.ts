/**
 * One-time startup hook for the in-process background workers. TanStack Start
 * server functions are request-scoped, so the scanner, uploader, and transfer
 * job loops live as guarded singletons started here. {@link ensureWorkersStarted}
 * is safe to call on every request (from the root loader / first authed fn) — a
 * `globalThis` flag ensures the workers spin up exactly once per server process.
 */
import { requestScan } from './scanner'
import { readTransferConfig } from './config'
import { startJobWorkers } from './job-worker'
import { startUploader } from './uploader'

declare global {
  // eslint-disable-next-line no-var
  var __htsmWorkersStarted: boolean | undefined
}

/**
 * Start the scanner and uploader loops (and kick off the startup scan) once per
 * process. Start transfer job loops too when transfer is enabled. Subsequent
 * calls are no-ops.
 */
export function ensureWorkersStarted(): void {
  if (globalThis.__htsmWorkersStarted) return

  const transferConfig = readTransferConfig()
  globalThis.__htsmWorkersStarted = true

  // Startup scan; a no-op if HTSM_SCAN_PATH is unset (reason: 'no-scan-path').
  requestScan()
  startUploader()
  if (transferConfig.enabled) startJobWorkers()
}
