import type { Migration } from './types'

/** Initialize the normalized baseline schema, but only for an empty database. */
export const initializeSchema: Migration = {
  version: 1,
  name: 'initialize schema',
  up(db) {
    const applicationTables = db
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE type = 'table'
            AND name NOT IN ('schema_migrations', 'sqlite_sequence')
          ORDER BY name`,
      )
      .all() as Array<{ name: string }>

    // Existing databases are production data. Migration 1 must not infer,
    // normalize, rebuild, or otherwise modify their schema or contents.
    if (applicationTables.length > 0) return

    db.exec(`
      CREATE TABLE runs (
        id              INTEGER PRIMARY KEY,
        run_folder      TEXT UNIQUE NOT NULL,
        run_date        TEXT NOT NULL,
        instrument      TEXT NOT NULL,
        run_number      TEXT NOT NULL,
        flowcell        TEXT NOT NULL,
        first_seen_at   TEXT NOT NULL,
        last_scanned_at TEXT NOT NULL
      );

      CREATE INDEX idx_runs_run_date ON runs(run_date);

      CREATE TABLE files (
        id               INTEGER PRIMARY KEY,
        run_id           INTEGER REFERENCES runs(id),
        path             TEXT UNIQUE NOT NULL,
        name             TEXT NOT NULL,
        size             INTEGER NOT NULL,
        lane             TEXT,
        missing          INTEGER NOT NULL DEFAULT 0,
        upload_requested INTEGER NOT NULL DEFAULT 0,
        uploaded         INTEGER NOT NULL DEFAULT 0,
        upload_status    TEXT NOT NULL DEFAULT 'idle',
        upload_error     TEXT,
        uploaded_at      TEXT,
        first_seen_at    TEXT NOT NULL,
        last_scanned_at  TEXT NOT NULL
      );

      CREATE INDEX idx_files_name ON files(name);
      CREATE INDEX idx_files_run_id ON files(run_id);
      CREATE INDEX idx_files_upload_requested ON files(upload_requested);
      CREATE INDEX idx_files_uploaded ON files(uploaded);
    `)
  },
}
