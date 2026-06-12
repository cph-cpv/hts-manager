/**
 * Pure run-folder-name + filename parsing. No file reads (except `deriveRecord`,
 * which only does a single `fs.stat` for size). All sequencing metadata is
 * derived from the Illumina run-folder name and the FASTQ filename — nothing is
 * decompressed. See plan.md (steps 3-4) for the rationale.
 */
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'

/** Metadata parsed from an Illumina run-folder segment name. */
export interface ParsedRunFolder {
  /** ISO date (YYYY-MM-DD) from the leading 6-digit YYMMDD. */
  run_date: string
  /** From the tail after the date (full names only); null for date-only folders. */
  instrument: string | null
  run_number: string | null
  flowcell: string | null
}

/** A scanned FASTQ file ready to be inserted into the `files` table. */
export interface DerivedRecord extends ParsedRunFolder {
  path: string
  name: string
  size: number
  /** The run-folder segment the metadata came from, for provenance. */
  run_folder: string
  /** From the filename `_L00N_` token; null if absent (e.g. merged outputs). */
  lane: string | null
}

const RUN_FOLDER_RE = /^(\d{6})(?:_(.+))?$/
const LANE_RE = /_L(\d{3})_/
const FASTQ_RE = /\.f(ast)?q\.gz$/i

/**
 * Parse an Illumina run-folder segment name.
 *
 * A full name `230615_A00123_0456_BHGV7DSX3` yields the date plus instrument
 * (`A00123`), run number (`0456`), and flowcell (`BHGV7DSX3`). A stripped name
 * `230615` yields only the date. Returns `null` when the segment is not a run
 * folder (so non-conforming top-level dirs are skipped wholesale).
 *
 * The 6 leading digits are interpreted as `YYMMDD` and calendar-validated
 * (month 01-12, day 01-31) so stray 6-digit directories don't match. Century
 * pivot: `00-69` → 20xx, `70-99` → 19xx.
 */
export function parseRunFolder(segment: string): ParsedRunFolder | null {
  const match = RUN_FOLDER_RE.exec(segment)
  if (!match) return null

  const digits = match[1]!
  const yy = Number(digits.slice(0, 2))
  const mm = Number(digits.slice(2, 4))
  const dd = Number(digits.slice(4, 6))

  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null

  const year = yy <= 69 ? 2000 + yy : 1900 + yy
  const run_date = `${year}-${pad2(mm)}-${pad2(dd)}`

  const tail = match[2]
  if (!tail) {
    return { run_date, instrument: null, run_number: null, flowcell: null }
  }

  // Best-effort split: instrument _ run_number _ flowcell. Tolerate extra
  // trailing fields by folding them into the flowcell segment.
  const [instrument = null, run_number = null, ...rest] = tail.split('_')
  const flowcell = rest.length > 0 ? rest.join('_') : null

  return { run_date, instrument, run_number, flowcell }
}

/** Extract the lane token (`L001`) from a FASTQ filename, or null if absent. */
export function parseLane(filename: string): string | null {
  const match = LANE_RE.exec(filename)
  return match ? `L${match[1]}` : null
}

/** True if the filename is a gzipped FASTQ (`.fastq.gz` or `.fq.gz`). */
export function isFastqGz(filename: string): boolean {
  return FASTQ_RE.test(filename)
}

/**
 * Merge run-folder metadata + filename lane + `fs.stat` size into a record.
 * `runFolderSegment` is the matching run-folder name chosen by the scan walk
 * (its `parseRunFolder` is guaranteed non-null by the caller).
 */
export async function deriveRecord(
  path: string,
  runFolderSegment: string,
): Promise<DerivedRecord> {
  const parsed = parseRunFolder(runFolderSegment)
  if (!parsed) {
    throw new Error(`run folder segment is not parseable: ${runFolderSegment}`)
  }

  const name = basename(path)
  const { size } = await stat(path)

  return {
    ...parsed,
    path,
    name,
    size,
    run_folder: runFolderSegment,
    lane: parseLane(name),
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}
