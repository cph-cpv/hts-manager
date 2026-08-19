import { getDb } from './db'

/** Durable transfer milestone for a run; temporary activity lives on jobs. */
export type RunTransferStatus =
  | 'manual'
  | 'detected'
  | 'ready'
  | 'transferred'
  | 'removed'

/** Row shape of the `runs` table. */
export interface RunRow {
  id: number
  run_folder: string
  source_path: string | null
  transfer_status: RunTransferStatus
  run_date: string
  instrument: string
  run_number: string
  flowcell: string
  first_seen_at: string
  last_scanned_at: string | null
}

export type TransferActivity = 'copying' | 'removing' | null

export interface RunWithTransferActivity extends RunRow {
  transfer_activity: TransferActivity
}

/** A run with the number of associated files. */
export interface RunSummary extends RunWithTransferActivity {
  file_count: number
}

/** List all runs, newest run date first. */
export function listRuns(): RunSummary[] {
  return getDb()
    .prepare(
      `SELECT r.*,
              COUNT(f.id) AS file_count,
              CASE
                  WHEN EXISTS (
                    SELECT 1 FROM jobs
                     WHERE target_type = 'run'
                       AND target_id = r.id
                       AND kind = 'remove'
                       AND state = 'running'
                  ) THEN 'removing'
                  WHEN EXISTS (
                    SELECT 1 FROM jobs
                     WHERE target_type = 'run'
                       AND target_id = r.id
                       AND kind = 'copy'
                       AND state = 'running'
                  ) THEN 'copying'
                  ELSE NULL
                END AS transfer_activity
         FROM runs r
         LEFT JOIN files f ON f.run_id = r.id
        GROUP BY r.id
        ORDER BY r.run_date DESC, r.run_folder ASC`,
    )
    .all() as RunSummary[]
}

/** Fetch a single run by id, or undefined if not found. */
export function getRunById(
  id: number,
): RunWithTransferActivity | undefined {
  return getDb()
    .prepare(
      `SELECT run.*,
              CASE
                WHEN EXISTS (
                  SELECT 1 FROM jobs
                   WHERE target_type = 'run'
                     AND target_id = run.id
                     AND kind = 'remove'
                     AND state = 'running'
                ) THEN 'removing'
                WHEN EXISTS (
                  SELECT 1 FROM jobs
                   WHERE target_type = 'run'
                     AND target_id = run.id
                     AND kind = 'copy'
                     AND state = 'running'
                ) THEN 'copying'
                ELSE NULL
              END AS transfer_activity
         FROM runs AS run
        WHERE id = ?`,
    )
    .get(id) as RunWithTransferActivity | undefined
}
