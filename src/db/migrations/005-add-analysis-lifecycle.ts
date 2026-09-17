import type { Migration } from './types'

/** Split run management from analysis transfer and indexing state. */
export const addAnalysisLifecycle: Migration = {
  version: 5,
  name: 'add analysis lifecycle',
  disableForeignKeys: true,
  up(db) {
    db.exec(`
      DROP INDEX IF EXISTS idx_runs_transfer_status;

      CREATE TABLE runs_new (
        id               INTEGER PRIMARY KEY,
        run_folder       TEXT UNIQUE NOT NULL,
        source_path      TEXT UNIQUE,
        status           TEXT NOT NULL CHECK (
                           status IN (
                             'manually_copied', 'sequencing', 'processing',
                             'transferred', 'source_deleted', 'blocked'
                           )
                         ),
        run_date         TEXT NOT NULL,
        instrument       TEXT NOT NULL,
        run_number       TEXT NOT NULL,
        flowcell         TEXT NOT NULL,
        first_seen_at    TEXT NOT NULL,
        last_scanned_at  TEXT,
        CHECK (
          (status = 'manually_copied' AND source_path IS NULL)
          OR
          (status <> 'manually_copied' AND source_path IS NOT NULL)
        )
      );

      INSERT INTO runs_new (
        id, run_folder, source_path, status, run_date,
        instrument, run_number, flowcell, first_seen_at, last_scanned_at
      )
      SELECT
        id,
        run_folder,
        source_path,
        CASE transfer_status
          WHEN 'manual' THEN 'manually_copied'
          WHEN 'detected' THEN 'sequencing'
          WHEN 'ready' THEN 'processing'
          WHEN 'transferred' THEN 'transferred'
          WHEN 'removed' THEN 'source_deleted'
          WHEN 'error' THEN 'blocked'
        END,
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
      CREATE INDEX idx_runs_status ON runs(status);

      CREATE TABLE analyses (
        id               INTEGER PRIMARY KEY,
        run_id           INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        analysis_folder  TEXT NOT NULL,
        status           TEXT NOT NULL DEFAULT 'running' CHECK (
                           status IN (
                             'running', 'analysis_complete', 'transferred',
                             'indexed', 'blocked'
                           )
                         ),
        first_seen_at    TEXT NOT NULL,
        UNIQUE(run_id, analysis_folder)
      );

      ALTER TABLE files
        ADD COLUMN analysis_id INTEGER REFERENCES analyses(id);

      CREATE INDEX idx_analyses_copy_eligibility
        ON analyses(status, run_id);
      CREATE INDEX idx_files_analysis_id ON files(analysis_id);

      UPDATE jobs
         SET state = 'error',
             finished_at = COALESCE(finished_at, datetime('now')),
             error_message = 'Superseded by per-analysis copy jobs'
       WHERE kind = 'copy-analysis'
         AND target_type = 'run'
         AND state IN ('waiting', 'running');
    `)

    if ((db.pragma('foreign_key_check') as unknown[]).length > 0) {
      throw new Error('foreign key violation after adding analysis lifecycle')
    }
  },
}
