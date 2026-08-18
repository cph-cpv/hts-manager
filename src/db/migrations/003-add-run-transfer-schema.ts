import type { Migration } from './types'

/** Add the run-level transfer lifecycle. */
export const addRunTransferSchema: Migration = {
  version: 3,
  name: 'add run transfer schema',
  disableForeignKeys: true,
  up(db) {
    // Add source_path and transfer_status for managed transfers, and make
    // last_scanned_at nullable because detected runs have not been scanned yet.
    // SQLite requires a table rebuild to change the existing NOT NULL column.
    db.exec(`
      CREATE TABLE runs_new (
        id               INTEGER PRIMARY KEY,
        run_folder       TEXT UNIQUE NOT NULL,
        source_path      TEXT UNIQUE,
        transfer_status  TEXT NOT NULL DEFAULT 'manual' CHECK (
                           transfer_status IN (
                             'manual', 'detected', 'ready', 'transferred',
                             'removed'
                           )
                         ),
        run_date         TEXT NOT NULL,
        instrument       TEXT NOT NULL,
        run_number       TEXT NOT NULL,
        flowcell         TEXT NOT NULL,
        first_seen_at    TEXT NOT NULL,
        last_scanned_at  TEXT
      );

      INSERT INTO runs_new
        (id, run_folder, source_path, transfer_status, run_date, instrument,
         run_number, flowcell, first_seen_at, last_scanned_at)
      SELECT
        id,
        run_folder,
        NULL,
        'manual',
        run_date,
        instrument,
        run_number,
        flowcell,
        first_seen_at,
        last_scanned_at
      FROM runs;
      DROP TABLE runs;
      ALTER TABLE runs_new RENAME TO runs;

      CREATE INDEX idx_runs_run_date ON runs(run_date);
      CREATE INDEX idx_runs_transfer_status ON runs(transfer_status);
    `)

    const foreignKeyViolations = db.pragma('foreign_key_check') as unknown[]
    if (foreignKeyViolations.length > 0) {
      throw new Error('foreign key violation after adding run transfer schema')
    }
  },
}
