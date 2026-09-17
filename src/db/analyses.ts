import { basename } from 'node:path'
import type { DerivedRecord } from '../scan/parse'
import { getDb } from './db'
import { deriveAnalysisDisplayStatus, type AnalysisDisplayStatus } from './display-status'
import { insertFileRowIfNew, type FileRow } from './files'
import { enqueueJob, type JobRow } from './jobs'
import { transitionLifecycleStatus } from './lifecycle'
import type { RunRow } from './runs'
import { nowIso } from './utils'

export type AnalysisStatus =
  | 'running'
  | 'analysis_complete'
  | 'transferred'
  | 'indexed'
  | 'blocked'

export type AnalysisRow = {
  id: number
  run_id: number
  analysis_folder: string
  status: AnalysisStatus
  first_seen_at: string
}

export type AnalysisSummary = AnalysisRow & {
  display_status: AnalysisDisplayStatus
  indexed_file_count: number
  last_blocking_reason: string | null
}

export type AnalysisWithRun = AnalysisRow & {
  run: RunRow
}

export type AnalysisFileIndexResult = {
  handled: boolean
  added: number
  skipped: number
  blocked: boolean
}

/** Explicit managed-copy transitions; scanner-owned updates are guarded separately. */
export const ANALYSIS_STATUS_TRANSITIONS = {
  running: ['analysis_complete'],
  analysis_complete: ['transferred', 'blocked'],
  transferred: ['indexed', 'blocked'],
  indexed: [],
  blocked: ['analysis_complete'],
} as const satisfies Record<AnalysisStatus, readonly AnalysisStatus[]>

function requireFolderName(value: string): void {
  if (!value.trim() || basename(value) !== value || value === '.' || value === '..') {
    throw new Error('analysis folder must be a single non-empty path segment')
  }
}

/** Record an analysis observed at its source without regressing it. */
export function upsertSourceAnalysis(
  runId: number,
  analysisFolder: string,
): AnalysisRow {
  requireFolderName(analysisFolder)
  const db = getDb()
  return db.transaction(() => {
    const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as
      | RunRow
      | undefined
    if (!run) throw new Error(`run ${runId} not found`)
    db.prepare(
      `INSERT OR IGNORE INTO analyses
         (run_id, analysis_folder, status, first_seen_at)
       VALUES (?, ?, 'running', ?)`,
    ).run(runId, analysisFolder, nowIso())
    return db.prepare(
      'SELECT * FROM analyses WHERE run_id = ? AND analysis_folder = ?',
    ).get(runId, analysisFolder) as AnalysisRow
  })()
}

/**
 * Claim or insert every FASTQ for an existing transferred/indexed analysis.
 * Ownership is validated before any file row changes, so a conflict cannot
 * leave the analysis partially indexed.
 */
export function indexAnalysisFiles(
  analysisId: number,
  records: DerivedRecord[],
): AnalysisFileIndexResult {
  const db = getDb()
  return db.transaction(() => {
    const analysis = getAnalysisWithRun(analysisId)
    if (!analysis) throw new Error(`analysis ${analysisId} not found`)
    if (analysis.status !== 'transferred' && analysis.status !== 'indexed') {
      return {
        handled: false,
        added: 0,
        skipped: records.length,
        blocked: false,
      }
    }

    const stamp = nowIso()
    let added = 0
    let skipped = 0

    // Validate the complete ownership set before changing any file rows.
    for (const record of records) {
      const existing = db.prepare('SELECT * FROM files WHERE path = ?')
        .get(record.path) as FileRow | undefined
      if (
        existing &&
        (existing.run_id !== analysis.run_id ||
          (existing.analysis_id !== null && existing.analysis_id !== analysisId))
      ) {
        return {
          handled: true,
          added: 0,
          skipped: records.length,
          blocked: true,
        }
      }
    }

    db.prepare(
      `UPDATE files SET missing = 1, last_scanned_at = ?
        WHERE analysis_id = ?`,
    ).run(stamp, analysisId)

    for (const record of records) {
      const existing = db.prepare('SELECT * FROM files WHERE path = ?')
        .get(record.path) as FileRow | undefined
      if (existing) {
        skipped += 1
        db.prepare(`
          UPDATE files
             SET analysis_id = ?, name = ?, size = ?, lane = ?, missing = 0,
                 last_scanned_at = ?
           WHERE id = ?
        `).run(analysisId, record.name, record.size, record.lane, stamp, existing.id)
        continue
      }

      if (
        insertFileRowIfNew(record, analysis.run_id, analysisId, stamp)
      ) {
        added += 1
      } else {
        throw new Error(`FASTQ path changed while indexing: ${record.path}`)
      }
    }

    db.prepare('UPDATE runs SET last_scanned_at = ? WHERE id = ?')
      .run(stamp, analysis.run_id)

    if (analysis.status === 'transferred') {
      const transitioned = db.prepare(`
        UPDATE analyses SET status = 'indexed'
         WHERE id = ? AND status = 'transferred'
      `).run(analysisId)
      if (!transitioned.changes) {
        throw new Error(`analysis ${analysisId} changed while indexing`)
      }
    }

    return { handled: true, added, skipped, blocked: false }
  })()
}

/**
 * Discover and index one analysis found in the destination scan tree.
 *
 * An unseen non-empty analysis enters at `transferred` and is indexed in this
 * transaction, so successful scan-path discovery exposes only `indexed` state.
 * Existing source-owned states are left for the managed copy workflow.
 */
export function indexScannedAnalysisFiles(
  runId: number,
  analysisFolder: string,
  records: DerivedRecord[],
): AnalysisFileIndexResult {
  requireFolderName(analysisFolder)
  if (records.length === 0) {
    return { handled: false, added: 0, skipped: 0, blocked: false }
  }

  const db = getDb()
  return db.transaction(() => {
    const run = db.prepare('SELECT id FROM runs WHERE id = ?').get(runId)
    if (!run) throw new Error(`run ${runId} not found`)

    let analysis = db.prepare(
      'SELECT * FROM analyses WHERE run_id = ? AND analysis_folder = ?',
    ).get(runId, analysisFolder) as AnalysisRow | undefined

    if (!analysis) {
      db.prepare(
        `INSERT INTO analyses
           (run_id, analysis_folder, status, first_seen_at)
         VALUES (?, ?, 'transferred', ?)`,
      ).run(runId, analysisFolder, nowIso())
      analysis = db.prepare(
        'SELECT * FROM analyses WHERE run_id = ? AND analysis_folder = ?',
      ).get(runId, analysisFolder) as AnalysisRow
    }

    const result = indexAnalysisFiles(analysis.id, records)
    if (result.blocked) {
      db.prepare(`
        UPDATE analyses SET status = 'blocked'
         WHERE id = ? AND status IN ('transferred', 'indexed')
      `).run(analysis.id)
    }
    return result
  })()
}

export function getAnalysisById(id: number): AnalysisRow | undefined {
  return getDb().prepare('SELECT * FROM analyses WHERE id = ?').get(id) as
    | AnalysisRow
    | undefined
}

export function getAnalysisWithRun(id: number): AnalysisWithRun | undefined {
  const row = getDb().prepare(`
    SELECT a.*,
           r.id AS r_id, r.run_folder AS r_run_folder,
           r.source_path AS r_source_path,
           r.status AS r_status,
           r.run_date AS r_run_date, r.instrument AS r_instrument,
           r.run_number AS r_run_number, r.flowcell AS r_flowcell,
           r.first_seen_at AS r_first_seen_at,
           r.last_scanned_at AS r_last_scanned_at
      FROM analyses a JOIN runs r ON r.id = a.run_id
     WHERE a.id = ?
  `).get(id) as Record<string, unknown> | undefined
  if (!row) return undefined
  return {
    id: row.id as number,
    run_id: row.run_id as number,
    analysis_folder: row.analysis_folder as string,
    status: row.status as AnalysisStatus,
    first_seen_at: row.first_seen_at as string,
    run: {
      id: row.r_id as number,
      run_folder: row.r_run_folder as string,
      source_path: row.r_source_path as string | null,
      status: row.r_status as RunRow['status'],
      run_date: row.r_run_date as string,
      instrument: row.r_instrument as string,
      run_number: row.r_run_number as string,
      flowcell: row.r_flowcell as string,
      first_seen_at: row.r_first_seen_at as string,
      last_scanned_at: row.r_last_scanned_at as string | null,
    },
  }
}

export function listAnalysesByRun(runId: number): AnalysisSummary[] {
  const rows = getDb().prepare(`
    SELECT a.*,
           (SELECT COUNT(*) FROM files f
             WHERE f.analysis_id = a.id AND f.missing = 0) AS indexed_file_count,
           (SELECT j.error_message FROM jobs j
             WHERE j.target_type = 'analysis' AND j.target_id = a.id
               AND j.state = 'error'
             ORDER BY j.id DESC LIMIT 1) AS last_blocking_reason
      FROM analyses a WHERE a.run_id = ?
     ORDER BY a.analysis_folder COLLATE NOCASE, a.id
  `).all(runId) as Array<AnalysisRow & {
    indexed_file_count: number
    last_blocking_reason: string | null
  }>
  return rows.map((row) => ({
    ...row,
    display_status: deriveAnalysisDisplayStatus({
      status: row.status,
    }),
  }))
}

export function transitionAnalysisStatus(id: number, nextStatus: AnalysisStatus): void {
  transitionLifecycleStatus({
    table: 'analyses',
    id,
    nextStatus,
    transitions: ANALYSIS_STATUS_TRANSITIONS,
  })
}

export function markAnalysisComplete(id: number): void {
  transitionAnalysisStatus(id, 'analysis_complete')
}

export function markAnalysisTransferred(id: number): void {
  transitionAnalysisStatus(id, 'transferred')
}

export function markAnalysisBlocked(id: number): void {
  transitionAnalysisStatus(id, 'blocked')
}

export function recoverBlockedAnalysis(id: number): void {
  transitionAnalysisStatus(id, 'analysis_complete')
}

/** Analyses that can make progress and have no active attempt. */
export function listCopyEligibleAnalyses(): AnalysisRow[] {
  return getDb().prepare(`
    SELECT a.* FROM analyses a JOIN runs r ON r.id = a.run_id
     WHERE a.status IN ('analysis_complete', 'transferred')
       AND r.status = 'transferred'
       AND r.source_path IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM jobs j WHERE j.kind = 'copy-analysis'
           AND j.target_type = 'analysis' AND j.target_id = a.id
           AND j.state IN ('waiting', 'running')
       )
     ORDER BY a.id
  `).all() as AnalysisRow[]
}

/** Queue one independent copy/index attempt, deduplicating active attempts. */
export function queueAnalysisCopyJob(analysisId: number): JobRow {
  const db = getDb()
  return db.transaction(() => {
    const analysis = getAnalysisWithRun(analysisId)
    if (!analysis) throw new Error(`analysis ${analysisId} not found`)
    if (analysis.run.status !== 'transferred') {
      throw new Error('copy-analysis jobs require a transferred parent run')
    }
    if (!['analysis_complete', 'transferred'].includes(analysis.status)) {
      throw new Error('copy-analysis jobs require an eligible analysis status')
    }
    const active = db.prepare(`
      SELECT * FROM jobs WHERE kind = 'copy-analysis'
        AND target_type = 'analysis' AND target_id = ?
        AND state IN ('waiting', 'running') ORDER BY id LIMIT 1
    `).get(analysisId) as JobRow | undefined
    return active ?? enqueueJob({
      kind: 'copy-analysis',
      target: { type: 'analysis', id: analysisId },
    })
  })()
}

export function queueEligibleAnalysisCopies(): void {
  for (const analysis of listCopyEligibleAnalyses()) {
    queueAnalysisCopyJob(analysis.id)
  }
}
