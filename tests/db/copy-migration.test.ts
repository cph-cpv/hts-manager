import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import { initializeSchema } from '../../src/db/migrations/001-initialize-schema'
import { addRunTransferSchema } from '../../src/db/migrations/002-add-run-transfer-schema'
import { addJobsSchema } from '../../src/db/migrations/003-add-jobs-schema'
import { applyMigrations } from '../../src/db/migrations'

test('run error migration preserves managed milestones, uploaded files, and job history', () => {
  const db = new Database(':memory:')
  try {
    initializeSchema.up(db)
    addRunTransferSchema.up(db)
    addJobsSchema.up(db)
    db.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES (1, 'then'), (2, 'then'), (3, 'then');
      INSERT INTO runs (
        id, run_folder, source_path, transfer_status, run_date, instrument,
        run_number, flowcell, first_seen_at, last_scanned_at
      ) VALUES
        (1, '260101_NS123_0001_FLOW', '/source/one', 'ready', '2026-01-01',
         'NS123', '0001', 'FLOW', 'then', NULL),
        (2, '260101_NS123_0002_FLOW', '/source/two', 'transferred', '2026-01-01',
         'NS123', '0002', 'FLOW', 'then', 'now');
      INSERT INTO files (
        id, run_id, path, name, size, uploaded, upload_status,
        uploaded_at, first_seen_at, last_scanned_at
      ) VALUES (7, 2, '/destination/two/file.fastq.gz', 'file.fastq.gz', 50,
                1, 'complete', 'now', 'then', 'now');
      INSERT INTO jobs (
        id, kind, target_type, target_id, payload, state,
        created_at, started_at, finished_at, error_message
      ) VALUES (9, 'copy', 'run', 1, '{}', 'error', 'then', 'then', 'now', 'NFS failed');
    `)
    db.pragma('foreign_keys = ON')
    const before = ['runs', 'files', 'jobs'].map((table) => db.prepare(`SELECT * FROM ${table}`).all())
    applyMigrations(db)
    assert.deepEqual(['runs', 'files', 'jobs'].map((table) => db.prepare(`SELECT * FROM ${table}`).all()), before)
    assert.deepEqual(db.pragma('foreign_key_check'), [])
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1)
    db.prepare("UPDATE runs SET transfer_status = 'error' WHERE id = 1").run()
    assert.throws(() => db.prepare("UPDATE runs SET transfer_status = 'invalid' WHERE id = 1").run())
    applyMigrations(db)
    assert.deepEqual(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all(), [
      { version: 1 }, { version: 2 }, { version: 3 }, { version: 4 },
    ])
  } finally {
    db.close()
  }
})
