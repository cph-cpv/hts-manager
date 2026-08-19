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
