/** Discover source runs and their independently tracked analyses. */
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { markAnalysisComplete, upsertSourceAnalysis } from '../../db/analyses'
import { getRunByFolder, type RunRow } from '../../db/runs'
import { markRunComplete, upsertManagedRun } from '../../db/transfer'
import { parseRunFolder } from '../../scan/parse'
import { hasCode } from '../copy'

export type DiscoverySummary = {
  added: number
  known: number
  manual: number
  skipped: number
}

async function hasRegularMarker(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile()
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false
    throw error
  }
}

async function discoverAnalyses(run: RunRow): Promise<void> {
  if (run.status === 'manually_copied' || run.status === 'source_deleted' || !run.source_path) return

  let entries
  try {
    entries = await readdir(join(run.source_path, 'Analysis'), {
      withFileTypes: true,
    })
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return
    throw error
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') || !entry.isDirectory()) continue
    const analysis = upsertSourceAnalysis(run.id, entry.name)
    if (
      analysis.status === 'running' &&
      await hasRegularMarker(join(run.source_path, 'Analysis', entry.name, 'Data', 'report.html'))
    ) {
      markAnalysisComplete(analysis.id)
    }
  }
}

/** Register source runs, advance exact completion markers, and reconcile analyses. */
export async function discoverSourceRuns(sourceRoot: string): Promise<DiscoverySummary> {
  const summary: DiscoverySummary = { added: 0, known: 0, manual: 0, skipped: 0 }
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || !entry.isDirectory()) {
      summary.skipped += 1
      continue
    }

    const metadata = parseRunFolder(entry.name)
    if (!metadata) {
      summary.skipped += 1
      continue
    }

    const sourcePath = join(sourceRoot, entry.name)
    const existing = getRunByFolder(entry.name)
    const run = upsertManagedRun({
      runFolder: entry.name,
      sourcePath,
      ...metadata,
    })
    if (!existing) summary.added += 1
    else if (existing.status === 'manually_copied') summary.manual += 1
    else summary.known += 1

    if (
      run.status === 'sequencing' &&
      await hasRegularMarker(join(sourcePath, 'CopyComplete.txt'))
    ) {
      markRunComplete(run.id)
    }
    await discoverAnalyses(run)
  }
  return summary
}
