import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { deriveRecord, isFastqGz, type DerivedRecord } from './parse'

/** Recursively collect every regular FASTQ belonging to one analysis tree. */
export async function collectAnalysisFastqs(
  root: string,
  runFolder: string,
): Promise<DerivedRecord[]> {
  const records: DerivedRecord[] = []

  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
      } else if (entry.isFile() && isFastqGz(entry.name)) {
        records.push(await deriveRecord(path, runFolder))
      }
    }
  }

  await walk(root)
  return records
}
