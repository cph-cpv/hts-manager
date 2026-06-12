/**
 * Pure, reusable scan core. Walks the run folders directly under a scan root,
 * indexes the FASTQ files inside them, and reconciles the `missing` flag. Used
 * by both the background scanner worker (`src/server/scanner.ts`) and the
 * optional `scan` CLI — there is no scan logic anywhere else.
 *
 * The walk is deliberately layout-agnostic: a run folder's internal structure
 * varies by platform (NextSeq 500 puts FASTQ files under `fastq/`, others nest
 * them under `Data/Intensities/BaseCalls/`, MiSeq drops them at the run-folder
 * root), so once a top-level directory is recognised as a run folder we recurse
 * through all of it. See plan.md (step 4) for the full rationale.
 */
import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { deriveRecord, isFastqGz, parseRunFolder } from './parse'
import { flagMissingExcept, getKnownPaths, insertIfNew } from '../db/queries'

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
  /** FASTQ files seen that were already indexed (left untouched). */
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
 * match — and any loose files directly under `root` — are skipped wholesale. New
 * files are inserted; already-known files are left untouched. After the walk,
 * rows under `root` whose file was not seen are flagged `missing`.
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

    if (onProgress && processed % PROGRESS_EVERY === 0) {
      onProgress({ processed, added })
    }
  }

  // Recurse through a known run folder, collecting FASTQ files at any depth.
  async function walk(dir: string, runFolder: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full, runFolder)
      } else if (entry.isFile() && isFastqGz(entry.name)) {
        await processFile(full, runFolder)
      }
    }
  }

  const topEntries = await readdir(absRoot, { withFileTypes: true })
  for (const entry of topEntries) {
    if (!entry.isDirectory()) continue
    if (!parseRunFolder(entry.name)) continue // not a run folder → skip subtree
    await walk(join(absRoot, entry.name), entry.name)
  }

  const missing = flagMissingExcept(absRoot, seenPaths)

  onProgress?.({ processed, added })

  return { added, skipped, missing }
}
