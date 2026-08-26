/**
 * Status server functions. `getStatus` returns the combined scanner + uploader +
 * counts snapshot polled by the top bar; `requestScan` triggers a manual "Scan
 * now". Both gate on {@link authMiddleware}; background workers are started by
 * the Nitro startup plugin. See plan.md (step 7).
 */
import { createServerFn } from '@tanstack/react-start'
import { authMiddleware } from '../server/auth-middleware'
import { requestScan as requestScanWorker } from '../server/scanner'
import { getStatus as buildStatus, type StatusSnapshot } from '../server/status'

/** Return the combined status snapshot for the top-bar indicators. */
export const getStatus = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async (): Promise<StatusSnapshot> => buildStatus())

/**
 * Kick off a manual scan. Returns whether a scan was started or one was already
 * running (the scanner ignores overlapping requests).
 */
export const requestScan = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .handler(async () => requestScanWorker())
