import type { Migration } from './types'

/**
 * Historical migration retained because version 1 is already recorded in
 * existing databases. Never reuse its version for a different migration.
 */
export const normalizeRuns: Migration = {
  version: 1,
  name: 'normalize runs',
  up(db) {
    const columns = (
      db.prepare('PRAGMA table_info(files)').all() as Array<{ name: string }>
    ).map((column) => column.name)

    // A fresh database receives the current schema after migrations run.
    if (columns.length === 0 || !columns.includes('run_folder')) return

    if (!columns.includes('run_id')) {
      db.exec('ALTER TABLE files ADD COLUMN run_id INTEGER REFERENCES runs(id)')
    }

    db.exec(`
      INSERT OR IGNORE INTO runs
        (run_folder, run_date, instrument, run_number, flowcell,
         first_seen_at, last_scanned_at)
      SELECT run_folder, run_date, instrument, run_number, flowcell,
             MIN(first_seen_at), MAX(last_scanned_at)
        FROM files
       WHERE run_folder IS NOT NULL
       GROUP BY run_folder;

      UPDATE files
         SET run_id = (SELECT id FROM runs WHERE runs.run_folder = files.run_folder)
       WHERE run_folder IS NOT NULL AND run_id IS NULL;

      CREATE INDEX IF NOT EXISTS idx_files_run_id ON files(run_id);
    `)
  },
}
