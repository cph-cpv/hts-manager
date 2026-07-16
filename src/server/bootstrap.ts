/**
 * One-time startup hook for the in-process background workers. TanStack Start
 * server functions are request-scoped, so the scanner and uploader live as
 * guarded singletons started here. {@link ensureWorkersStarted} is safe to call
 * on every request (from the root loader / first authed fn) — a `globalThis`
 * flag ensures the workers spin up exactly once per server process. See plan.md
 * (step 6).
 */
import { requestScan } from './scanner'
import { readTransferConfig } from './transfer-config'
import { startUploader } from './uploader'

declare global {
  // eslint-disable-next-line no-var
  var __htsmWorkersStarted: boolean | undefined
}

/**
 * Start the scanner and uploader loops (and kick off the startup scan) once per
 * process. Subsequent calls are no-ops.
 */
export function ensureWorkersStarted(): void {
  if (globalThis.__htsmWorkersStarted) return

  readTransferConfig()
  globalThis.__htsmWorkersStarted = true

  // Startup scan; a no-op if HTSM_SCAN_PATH is unset (reason: 'no-scan-path').
  requestScan()
  startUploader()
}
