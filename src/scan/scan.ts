/**
 * Pure, reusable scan core. Walks the run folders directly under a scan root,
 * indexes the FASTQ files inside them, and reconciles the `missing` flag. Used
 * by both the background scanner worker (`src/server/jobs/scanner.ts`) and the
 * optional `scan` CLI — there is no scan logic anywhere else.
 *
 * Analysis ownership is recognized below each immediate analysis directory.
 * The generic fallback never enters the top-level `Analysis` subtree, so an
 * analysis FASTQ cannot be indexed as a run-only file.
 */
import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { deriveRecord, isFastqGz, parseRunFolder } from './parse'
import { flagMissingExcept, getKnownPaths, insertIfNew } from '../db/files'
import { indexScannedAnalysisFiles } from '../db/analyses'
import { upsertScannedRun } from '../db/runs'
import { collectAnalysisFastqs } from './analysis'

/** Live progress reported during a scan (for the top-bar scanning indicator). */
export interface ScanProgress {
  /** FASTQ files visited so far (both new and already-known). */
  processed: number
  /** New rows inserted so far. */
  added: number
}

/** Summary returned when a scan completes. */
export interface ScanResult {
  /** New rows inserted. */
  added: number
  /** FASTQ files visited without inserting a new row. */
  skipped: number
  /** Rows under `root` flagged `missing` because their file was not seen. */
  missing: number
}

/** Report progress to the callback at most once every this many files. */
const PROGRESS_EVERY = 50

/**
 * Scan `root` for FASTQ files inside its run folders.
 *
 * Run folders are the direct children of `root` whose name matches the Illumina
 * run-folder pattern (see {@link parseRunFolder}); top-level entries that don't
 * match — and any loose files directly under `root` — are skipped wholesale.
 * Immediate `<run>/Analysis/<analysis>` directories are handled first, and
 * every FASTQ recursively below each directory receives an `analysis_id`.
 * The recursive fallback indexes every FASTQ outside `Analysis` with run
 * ownership only.
 * After the walk, rows under `root` whose file was not seen are flagged
 * `missing`.
 *
 * `onProgress` (if given) is invoked periodically during the walk and once more
 * when it finishes, so a caller can surface live progress.
 */
export async function runScan(
  root: string,
  onProgress?: (progress: ScanProgress) => void,
): Promise<ScanResult> {
  const absRoot = resolve(root)
  const known = getKnownPaths()
  const seenPaths: string[] = []
  let added = 0
  let skipped = 0
  let processed = 0

  function reportProcessed(): void {
    if (onProgress && processed % PROGRESS_EVERY === 0) {
      onProgress({ processed, added })
    }
  }

  async function processFile(path: string, runFolder: string): Promise<void> {
    seenPaths.push(path)
    processed += 1

    if (known.has(path)) {
      skipped += 1
    } else {
      const record = await deriveRecord(path, runFolder)
      if (insertIfNew(record)) added += 1
      else skipped += 1 // inserted concurrently between the check and now
    }

    reportProcessed()
  }

  async function readDirectoryIfPresent(dir: string) {
    try {
      return await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error.code === 'ENOENT' || error.code === 'ENOTDIR')
      ) {
        return []
      }
      throw error
    }
  }

  /** Index analysis FASTQs before the generic recursive walk. */
  async function indexAnalyses(
    runPath: string,
    runFolder: string,
    runMetadata: NonNullable<ReturnType<typeof parseRunFolder>>,
  ): Promise<void> {
    const analysisRoot = join(runPath, 'Analysis')
    const entries = await readDirectoryIfPresent(analysisRoot)
    const analysisEntries = entries.filter(
      (entry) => !entry.name.startsWith('.') && entry.isDirectory(),
    )
    if (analysisEntries.length === 0) return

    const run = upsertScannedRun({ run_folder: runFolder, ...runMetadata })
    for (const entry of analysisEntries) {
      const records = await collectAnalysisFastqs(
        join(analysisRoot, entry.name),
        runFolder,
      )
      const result = indexScannedAnalysisFiles(run.id, entry.name, records)

      added += result.added
      skipped += result.skipped
      for (const record of records) {
        seenPaths.push(record.path)
        processed += 1
        reportProcessed()
      }
    }
  }

  const topEntries = await readdir(absRoot, { withFileTypes: true })
  for (const entry of topEntries) {
    if (!entry.isDirectory()) continue
    const runMetadata = parseRunFolder(entry.name)
    if (!runMetadata) continue // not a run folder → skip subtree
    const runPath = join(absRoot, entry.name)
    await indexAnalyses(runPath, entry.name, runMetadata)

    async function walkRemaining(dir: string, isRunRoot = false): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const child of entries) {
        const full = join(dir, child.name)
        if (child.isDirectory()) {
          if (isRunRoot && child.name === 'Analysis') continue
          await walkRemaining(full)
        } else if (child.isFile() && isFastqGz(child.name)) {
          await processFile(full, entry.name)
        }
      }
    }

    await walkRemaining(runPath, true)
  }

  const missing = flagMissingExcept(absRoot, seenPaths)

  onProgress?.({ processed, added })

  return { added, skipped, missing }
}
