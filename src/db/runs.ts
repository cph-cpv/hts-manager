import type { DerivedRecord, ParsedRunFolder } from '../scan/parse'
import { getDb } from './db'
import { nowIso } from './utils'

export type RunStatus =
  | 'manually_copied'
  | 'sequencing'
  | 'processing'
  | 'transferred'
  | 'source_deleted'
  | 'blocked'

export type RunRow = {
  id: number
  run_folder: string
  source_path: string | null
  status: RunStatus
  run_date: string
  instrument: string
  run_number: string
  flowcell: string
  first_seen_at: string
  last_scanned_at: string | null
}

/** The complete current workflow state for a run, including related work. */
export type RunState = RunRow & {
  analysis_count: number
  indexed_analysis_count: number
  blocked_analysis_count: number
  active_transfer_count: number
  last_blocking_reason: string | null
}

export type RunSummary = RunState & { file_count: number }

type RunAggregateRow = RunState & {
  file_count?: number
}

const RUN_AGGREGATES_SQL = `
  (SELECT COUNT(*) FROM analyses a WHERE a.run_id = r.id) AS analysis_count,
  (SELECT COUNT(*) FROM analyses a
    WHERE a.run_id = r.id AND a.status = 'indexed') AS indexed_analysis_count,
  (SELECT COUNT(*) FROM analyses a
    WHERE a.run_id = r.id AND a.status = 'blocked') AS blocked_analysis_count,
  (
    SELECT COUNT(*) FROM jobs j
     WHERE j.state IN ('waiting', 'running')
       AND (
         (j.target_type = 'run' AND j.target_id = r.id AND j.kind = 'copy-run')
         OR
         (j.target_type = 'analysis' AND j.kind = 'copy-analysis'
           AND j.target_id IN (SELECT id FROM analyses WHERE run_id = r.id))
       )
  ) AS active_transfer_count,
  (
    SELECT j.error_message FROM jobs j
     WHERE j.state = 'error'
       AND (
         (j.target_type = 'run' AND j.target_id = r.id)
         OR
         (j.target_type = 'analysis'
           AND j.target_id IN (SELECT id FROM analyses WHERE run_id = r.id))
       )
     ORDER BY j.id DESC LIMIT 1
  ) AS last_blocking_reason
`

type ScannedRun = ParsedRunFolder & { run_folder: string }

/** Insert or look up a manually copied run from its parsed folder metadata. */
export function upsertScannedRun(run: ScannedRun): RunRow {
  const db = getDb()
  const now = nowIso()
  db.prepare(
    `INSERT OR IGNORE INTO runs
       (run_folder, source_path, status, run_date, instrument,
        run_number, flowcell, first_seen_at, last_scanned_at)
     VALUES
       (@run_folder, NULL, 'manually_copied', @run_date, @instrument,
        @run_number, @flowcell, @first_seen_at, @last_scanned_at)`,
  ).run({ ...run, first_seen_at: now, last_scanned_at: now })
  return db.prepare('SELECT * FROM runs WHERE run_folder = ?').get(
    run.run_folder,
  ) as RunRow
}

/** Insert or look up the run owning a freshly derived scanner file. */
export function upsertRun(file: DerivedRecord): number {
  return upsertScannedRun(file).id
}

/** List complete workflow state for every run, newest first. */
export function listRunStates(): RunSummary[] {
  const rows = getDb().prepare(`
    SELECT r.*,
           (SELECT COUNT(*) FROM files f WHERE f.run_id = r.id) AS file_count,
           ${RUN_AGGREGATES_SQL}
      FROM runs r
     ORDER BY r.run_date DESC, r.run_folder ASC
  `).all() as RunAggregateRow[]
  return rows as RunSummary[]
}

/** Get the complete current workflow state for one run. */
export function getRunState(id: number): RunState | undefined {
  const row = getDb().prepare(`
    SELECT r.*, ${RUN_AGGREGATES_SQL}
      FROM runs r
     WHERE r.id = ?
  `).get(id) as RunAggregateRow | undefined
  return row
}

export function getRunRowById(id: number): RunRow | undefined {
  return getDb().prepare('SELECT * FROM runs WHERE id = ?').get(id) as
    | RunRow
    | undefined
}

/** Fetch a run by its authoritative Illumina folder name. */
export function getRunByFolder(runFolder: string): RunRow | undefined {
  return getDb().prepare('SELECT * FROM runs WHERE run_folder = ?').get(
    runFolder,
  ) as RunRow | undefined
}
