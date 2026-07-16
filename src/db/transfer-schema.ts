export function createTransferSourcesTable(
  tableName: 'transfer_sources' | 'transfer_sources_new',
): string {
  return `
CREATE TABLE IF NOT EXISTS ${tableName} (
  id               INTEGER PRIMARY KEY,
  folder_name      TEXT NOT NULL,
  source_path      TEXT UNIQUE NOT NULL,
  readiness_status TEXT NOT NULL DEFAULT 'waiting' CHECK (
                     readiness_status IN ('waiting', 'ready', 'blocked')
                   ),
  first_seen_at    TEXT NOT NULL,
  block_reason     TEXT,
  CHECK (
    readiness_status <> 'blocked'
    OR (block_reason IS NOT NULL AND length(trim(block_reason)) > 0)
  ),
  CHECK (readiness_status = 'blocked' OR block_reason IS NULL)
);
`
}

export const TRANSFER_SOURCE_STATUS_VIEW = `
CREATE VIEW IF NOT EXISTS transfer_source_status AS
SELECT
  transfer_source.*,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM transfer_jobs
       WHERE source_id = transfer_source.id
         AND kind = 'remove'
         AND state = 'complete'
    ) THEN 'removed'
    WHEN EXISTS (
      SELECT 1 FROM transfer_jobs
       WHERE source_id = transfer_source.id
         AND kind = 'remove'
         AND state = 'running'
    ) THEN 'removing'
    WHEN EXISTS (
      SELECT 1 FROM transfer_jobs
       WHERE source_id = transfer_source.id
         AND kind = 'copy'
         AND state = 'running'
    ) THEN 'copying'
    WHEN transfer_source.readiness_status = 'blocked'
      AND NOT EXISTS (
        SELECT 1 FROM transfer_jobs
         WHERE source_id = transfer_source.id
           AND kind = 'copy'
           AND state = 'complete'
      ) THEN 'blocked'
    WHEN (
      SELECT state FROM transfer_jobs
       WHERE source_id = transfer_source.id
       ORDER BY id DESC
       LIMIT 1
    ) = 'error' THEN 'error'
    WHEN EXISTS (
      SELECT 1 FROM transfer_jobs
       WHERE source_id = transfer_source.id
         AND kind = 'copy'
         AND state = 'complete'
    ) THEN 'copied'
    ELSE transfer_source.readiness_status
  END AS status,
  (
    SELECT error_message FROM transfer_jobs
     WHERE source_id = transfer_source.id
       AND state = 'error'
     ORDER BY id DESC
     LIMIT 1
  ) AS last_error
FROM transfer_sources AS transfer_source;
`

export const TRANSFER_SCHEMA = `
${createTransferSourcesTable('transfer_sources')}

CREATE INDEX IF NOT EXISTS idx_transfer_sources_readiness_status
  ON transfer_sources(readiness_status);

CREATE TABLE IF NOT EXISTS transfer_jobs (
  id             INTEGER PRIMARY KEY,
  source_id      INTEGER REFERENCES transfer_sources(id) ON DELETE RESTRICT,
  kind           TEXT NOT NULL CHECK (kind IN ('discover', 'copy', 'remove')),
  state          TEXT NOT NULL DEFAULT 'waiting' CHECK (
                   state IN ('waiting', 'running', 'complete', 'error')
                 ),
  created_at     TEXT NOT NULL,
  started_at     TEXT,
  finished_at    TEXT,
  error_message  TEXT,
  CHECK (
    (kind = 'discover' AND source_id IS NULL)
    OR (kind IN ('copy', 'remove') AND source_id IS NOT NULL)
  ),
  CHECK (state <> 'running' OR started_at IS NOT NULL),
  CHECK (state NOT IN ('complete', 'error') OR finished_at IS NOT NULL),
  CHECK (state IN ('complete', 'error') OR finished_at IS NULL),
  CHECK (state <> 'error' OR length(trim(error_message)) > 0),
  CHECK (state = 'error' OR error_message IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_transfer_jobs_source_id
  ON transfer_jobs(source_id);
CREATE INDEX IF NOT EXISTS idx_transfer_jobs_kind_state
  ON transfer_jobs(kind, state);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transfer_jobs_one_active_discover
  ON transfer_jobs(kind)
  WHERE kind = 'discover' AND state IN ('waiting', 'running');
CREATE UNIQUE INDEX IF NOT EXISTS idx_transfer_jobs_one_active_copy_per_run
  ON transfer_jobs(source_id, kind)
  WHERE kind = 'copy' AND state IN ('waiting', 'running');
CREATE UNIQUE INDEX IF NOT EXISTS idx_transfer_jobs_one_running_copy
  ON transfer_jobs(kind)
  WHERE kind = 'copy' AND state = 'running';
CREATE UNIQUE INDEX IF NOT EXISTS idx_transfer_jobs_one_active_remove_per_run
  ON transfer_jobs(source_id, kind)
  WHERE kind = 'remove' AND state IN ('waiting', 'running');

CREATE TRIGGER IF NOT EXISTS transfer_remove_requires_completed_copy_insert
BEFORE INSERT ON transfer_jobs
WHEN NEW.kind = 'remove'
  AND NOT EXISTS (
    SELECT 1 FROM transfer_jobs
     WHERE source_id = NEW.source_id
       AND kind = 'copy'
       AND state = 'complete'
  )
BEGIN
  SELECT RAISE(ABORT, 'transfer removal requires completed copy');
END;

CREATE TRIGGER IF NOT EXISTS transfer_remove_requires_completed_copy_update
BEFORE UPDATE OF kind, source_id ON transfer_jobs
WHEN NEW.kind = 'remove'
  AND NOT EXISTS (
    SELECT 1 FROM transfer_jobs
     WHERE source_id = NEW.source_id
       AND kind = 'copy'
       AND state = 'complete'
  )
BEGIN
  SELECT RAISE(ABORT, 'transfer removal requires completed copy');
END;

${TRANSFER_SOURCE_STATUS_VIEW}
`
