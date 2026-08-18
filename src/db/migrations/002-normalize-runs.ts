import type { Migration } from './types'

/** Normalize run metadata from legacy file rows into the runs table. */
export const normalizeRuns: Migration = {
  version: 2,
  name: 'normalize runs',
  up(db) {
    const columns = (
      db.prepare('PRAGMA table_info(files)').all() as Array<{ name: string }>
    ).map((column) => column.name)

    // Fresh databases initialized by migration 1 and already-normalized
    // production databases have no file-level run_folder column.
    if (!columns.includes('run_folder')) return

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
