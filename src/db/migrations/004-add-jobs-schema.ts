import type { Migration } from './types'

/** Add generic persisted background job storage. */
export const addJobsSchema: Migration = {
  version: 4,
  name: 'add jobs schema',
  up(db) {
    db.exec(`
      CREATE TABLE jobs (
        id             INTEGER PRIMARY KEY,
        kind           TEXT NOT NULL,
        target_type    TEXT,
        target_id      INTEGER,
        payload        TEXT NOT NULL CHECK (json_valid(payload)),
        state          TEXT NOT NULL DEFAULT 'waiting' CHECK (
                         state IN ('waiting', 'running', 'complete', 'error')
                       ),
        created_at     TEXT NOT NULL,
        started_at     TEXT,
        finished_at    TEXT,
        error_message  TEXT,
        CHECK (state <> 'running' OR started_at IS NOT NULL),
        CHECK (state NOT IN ('complete', 'error') OR finished_at IS NOT NULL),
        CHECK (state IN ('complete', 'error') OR finished_at IS NULL),
        CHECK (
          state <> 'error'
          OR (error_message IS NOT NULL AND length(trim(error_message)) > 0)
        ),
        CHECK (state = 'error' OR error_message IS NULL),
        CHECK (
          (target_type IS NULL AND target_id IS NULL)
          OR (
            target_type IS NOT NULL
            AND length(trim(target_type)) > 0
            AND target_id IS NOT NULL
            AND typeof(target_id) = 'integer'
          )
        )
      );

      CREATE INDEX idx_jobs_kind_state
        ON jobs(kind, state);

      CREATE INDEX idx_jobs_target_kind_state
        ON jobs(target_type, target_id, kind, state);
    `)
  },
}
