/** Shared whole-directory copy primitives and managed-run path validation. */
import { execFile } from 'node:child_process'
import { lstat, mkdir, readdir, rm } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { RunRow } from '../db/runs'
import type { TransferConfig } from './config'
import { publishDirectory } from './publish-directory'

const execute = promisify(execFile)
export class CopyConflictError extends Error {}
export class RetryableCopyError extends Error {}

export type CopyEntry =
  | { path: string; type: 'directory' }
  | { path: string; type: 'file'; size: number }

const RETRYABLE_CODES = new Set([
  'EIO', 'ESTALE', 'ETIMEDOUT', 'EAGAIN', 'EBUSY', 'EINTR', 'ENOENT',
  'ENOSPC', 'EDQUOT', 'EMFILE', 'ENFILE', 'ENOMEM', 'ENETDOWN', 'ENETUNREACH',
  'EHOSTDOWN', 'EHOSTUNREACH', 'ECONNRESET', 'ECONNREFUSED', 'ENOTCONN',
])

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

export function isRetryableCopyError(error: unknown): boolean {
  return error instanceof RetryableCopyError || (
    !(error instanceof CopyConflictError) && error instanceof Error &&
    'code' in error && typeof error.code === 'string' && RETRYABLE_CODES.has(error.code)
  )
}

export async function doesPathExist(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false
    throw error
  }
}

export async function isPublishedDirectory(path: string): Promise<boolean> {
  try {
    if (!(await lstat(path)).isDirectory()) {
      throw new CopyConflictError(`Analysis destination is not a directory: ${path}`)
    }
    return true
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false
    throw error
  }
}

export async function requireDirectory(path: string): Promise<void> {
  if (!(await lstat(path)).isDirectory()) {
    throw new CopyConflictError(`Not a regular directory: ${path}`)
  }
}

/** Enumerate metadata only; no checksums or readiness decisions belong here. */
export async function inventoryRun(root: string, excludeAnalysis = false): Promise<CopyEntry[]> {
  const entries: CopyEntry[] = []
  async function walk(relativePath: string): Promise<void> {
    const path = join(root, relativePath)
    const stat = await lstat(path)
    if (stat.isDirectory()) {
      if (relativePath) entries.push({ path: relativePath, type: 'directory' })
      for (const name of (await readdir(path)).sort()) {
        if (excludeAnalysis && !relativePath && name === 'Analysis') continue
        await walk(join(relativePath, name))
      }
    } else if (relativePath && stat.isFile()) {
      entries.push({ path: relativePath, type: 'file', size: stat.size })
    } else {
      throw new CopyConflictError(`Unsupported filesystem entry: ${path}`)
    }
  }
  await walk('')
  return entries
}

function doEntriesMatch(left: CopyEntry, right: CopyEntry): boolean {
  return (
    left.path === right.path && left.type === right.type &&
    (left.type !== 'file' || (right.type === 'file' && left.size === right.size))
  )
}

function requireInventory(
  expected: CopyEntry[],
  actual: CopyEntry[],
  label: string,
): void {
  const expectedByPath = new Map(expected.map((entry) => [entry.path, entry]))
  for (const entry of actual) {
    const match = expectedByPath.get(entry.path)
    if (!match || !doEntriesMatch(match, entry)) {
      throw new CopyConflictError(`${label} inventory differs at ${entry.path}`)
    }
  }
  if (expected.length !== actual.length) {
    const actualPaths = new Set(actual.map((entry) => entry.path))
    const missing = expected.find((entry) => !actualPaths.has(entry.path))
    throw new CopyConflictError(`${label} is missing ${missing?.path ?? 'entries'}`)
  }
}

/** Confirm a previously published directory is the stable copy of its source. */
export async function verifyPublishedDirectory(
  source: string,
  destination: string,
  excludeAnalysis: boolean,
): Promise<void> {
  const inventory = await inventoryRun(source, excludeAnalysis)
  await requireDirectory(destination)
  requireInventory(
    inventory,
    await inventoryRun(destination, excludeAnalysis),
    'Destination',
  )
  requireInventory(
    inventory,
    await inventoryRun(source, excludeAnalysis),
    'Source after verifying',
  )
}

export async function rsyncDirectory(source: string, staging: string, excludeAnalysis: boolean): Promise<void> {
  try {
    await execute('rsync', [
      '--recursive', '--perms', '--times', '--fsync',
      ...(excludeAnalysis ? ['--exclude=/Analysis/'] : []),
      '--', `${source}/`, `${staging}/`,
    ])
  } catch (error) {
    if (error instanceof Error && 'code' in error &&
      typeof error.code === 'number' && [10, 11, 12, 20, 21, 22, 23, 24, 30, 35].includes(error.code)) {
      throw new RetryableCopyError(error.message, { cause: error })
    }
    // Missing executables/configuration errors need operator intervention.
    throw new CopyConflictError(error instanceof Error ? error.message : String(error), { cause: error })
  }
}

/** Only the reserved application staging path is ever removed. */
export async function copyDirectory(
  source: string,
  destination: string,
  staging: string,
  excludeAnalysis: boolean,
): Promise<void> {
  const inventory = await inventoryRun(source, excludeAnalysis)
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { mode: 0o744 })
  await rsyncDirectory(source, staging, excludeAnalysis)
  try {
    requireInventory(inventory, await inventoryRun(source, excludeAnalysis), 'Source after copying')
    requireInventory(inventory, await inventoryRun(staging), 'Staged copy')
  } catch (error) {
    // report.html can precede the final analysis writes. Retry verification
    // mismatches instead of permanently rejecting an analysis that is settling.
    if (!excludeAnalysis && error instanceof CopyConflictError) {
      throw new RetryableCopyError(error.message, { cause: error })
    }
    throw error
  }
  await publishDirectory(staging, destination)
}

export function getRunPaths(run: RunRow, config: TransferConfig) {
  if (!config.enabled || !config.sourcePath || !config.destinationPath || !run.source_path) {
    throw new CopyConflictError('Transfer is not configured for this run')
  }
  const source = resolve(run.source_path)
  const root = resolve(config.destinationPath)
  if (basename(run.run_folder) !== run.run_folder ||
    source !== join(resolve(config.sourcePath), run.run_folder)) {
    throw new CopyConflictError(`Run ${run.id} no longer belongs to the configured source`)
  }
  return { source, root, destination: join(root, run.run_folder) }
}
