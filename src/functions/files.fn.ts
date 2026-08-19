/**
 * File-list server functions. `listFiles` powers the searchable, paginated table;
 * `requestUpload` queues a single file when its row button is pressed. Both gate on
 * {@link authMiddleware}. See plan.md (step 8).
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authMiddleware } from '../server/auth-middleware'
import { ensureWorkersStarted } from '../server/bootstrap'
import {
  countFiles,
  getFilesForRun,
  searchFiles,
} from '../db/files'
import {
  getRunById,
  listRuns as listRunsQuery,
} from '../db/runs'
import {
  requestUpload as requestUploadRow,
  requestUploadForRun as requestUploadForRunRows,
} from '../db/uploads'
import type { FileWithRun } from '../db/files'
import type { RunSummary, RunWithTransferActivity } from '../db/runs'

const listInput = z
  .object({
    q: z.string().optional(),
    includeUndetermined: z.boolean().optional(),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .optional()

/** A page of files plus the total count matching the filter (for pagination). */
export interface ListFilesResult {
  files: FileWithRun[]
  total: number
}

/** Search visible files by name (paginated, newest run first) and report the total. */
export const listFiles = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator((data: unknown) => listInput.parse(data))
  .handler(async ({ data }): Promise<ListFilesResult> => {
    const options = data ?? {}
    return {
      files: searchFiles(options),
      total: countFiles({ q: options.q, includeUndetermined: options.includeUndetermined }),
    }
  })

/** All runs ordered newest-first with file counts. */
export const listRuns = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async (): Promise<RunSummary[]> => listRunsQuery())

const runInput = z.object({ runId: z.number().int().positive() })

/** A single run plus its files, or `run: null` when the id is unknown. */
export interface GetRunResult {
  run: RunWithTransferActivity | null
  files: FileWithRun[]
}

/** Fetch one run and its files for the run detail page. */
export const getRun = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator((data: unknown) => runInput.parse(data))
  .handler(async ({ data }): Promise<GetRunResult> => {
    const run = getRunById(data.runId)
    if (!run) return { run: null, files: [] }
    return { run, files: getFilesForRun(data.runId) }
  })

/**
 * Queue every not-yet-uploaded file in a run (whole-run upload). Returns how many
 * files were newly queued. Ensures the uploader loop is running so they drain.
 */
export const requestRunUpload = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator((data: unknown) => runInput.parse(data))
  .handler(async ({ data }) => {
    ensureWorkersStarted()
    return { queued: requestUploadForRunRows(data.runId) }
  })

const requestUploadInput = z.object({ id: z.number().int().positive() })

/**
 * Queue a file for upload. Returns whether a row changed (false if it was already
 * uploaded). Ensures the uploader loop is running so the queued file actually drains.
 */
export const requestUpload = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator((data: unknown) => requestUploadInput.parse(data))
  .handler(async ({ data }) => {
    ensureWorkersStarted()
    return { ok: requestUploadRow(data.id) }
  })
