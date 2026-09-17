import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import { initializeSchema } from '../../src/db/migrations/001-initialize-schema'
import { addRunTransferSchema } from '../../src/db/migrations/002-add-run-transfer-schema'
import { addJobsSchema } from '../../src/db/migrations/003-add-jobs-schema'
import { addRunErrorStatus } from '../../src/db/migrations/004-add-run-error-status'
import { applyMigrations } from '../../src/db/migrations'

test('migration 5 maps every legacy state and preserves related data', () => {
  const db = new Database(':memory:')
  try {
    initializeSchema.up(db)
    addRunTransferSchema.up(db)
    addJobsSchema.up(db)
    addRunErrorStatus.up(db)
    db.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES (1,'then'),(2,'then'),(3,'then'),(4,'then');
      INSERT INTO runs (
        id, run_folder, source_path, transfer_status, run_date, instrument,
        run_number, flowcell, first_seen_at, last_scanned_at
      ) VALUES
        (1,'260101_NS_1_A',NULL,'manual','2026-01-01','NS','1','A','then','now'),
        (2,'260101_NS_2_B','/s/2','detected','2026-01-01','NS','2','B','then',NULL),
        (3,'260101_NS_3_C','/s/3','ready','2026-01-01','NS','3','C','then',NULL),
        (4,'260101_NS_4_D','/s/4','transferred','2026-01-01','NS','4','D','then','now'),
        (5,'260101_NS_5_E','/s/5','removed','2026-01-01','NS','5','E','then','now'),
        (6,'260101_NS_6_F','/s/6','error','2026-01-01','NS','6','F','then',NULL);
      INSERT INTO files (
        id, run_id, path, name, size, uploaded, upload_status, uploaded_at,
        first_seen_at, last_scanned_at
      ) VALUES (10,4,'/d/4/a.fastq.gz','a.fastq.gz',7,1,'uploaded','now','then','now');
      INSERT INTO jobs (
        id, kind, target_type, target_id, payload, state, created_at, started_at
      ) VALUES
        (20,'copy-analysis','run',4,'{}','waiting','then',NULL),
        (21,'copy-analysis','run',4,'{}','running','then','then');
    `)
    db.pragma('foreign_keys = ON')

    applyMigrations(db)

    assert.deepEqual(db.prepare(
      'SELECT id, status, source_path FROM runs ORDER BY id',
    ).all(), [
      { id: 1, status: 'manually_copied', source_path: null },
      { id: 2, status: 'sequencing', source_path: '/s/2' },
      { id: 3, status: 'processing', source_path: '/s/3' },
      { id: 4, status: 'transferred', source_path: '/s/4' },
      { id: 5, status: 'source_deleted', source_path: '/s/5' },
      { id: 6, status: 'blocked', source_path: '/s/6' },
    ])
    assert.deepEqual(db.prepare(
      'SELECT id, run_id, analysis_id, uploaded, first_seen_at FROM files',
    ).get(), { id: 10, run_id: 4, analysis_id: null, uploaded: 1, first_seen_at: 'then' })
    assert.deepEqual(db.prepare(
      'SELECT id, state, error_message FROM jobs ORDER BY id',
    ).all(), [20, 21].map((id) => ({
      id,
      state: 'error',
      error_message: 'Superseded by per-analysis copy jobs',
    })))
    assert.deepEqual(db.pragma('foreign_key_check'), [])
    assert.throws(() => db.prepare(`INSERT INTO runs (
      run_folder, source_path, status, run_date, instrument,
      run_number, flowcell, first_seen_at
    ) VALUES ('bad',NULL,'sequencing','now','','','','now')`).run(), /CHECK constraint/)
  } finally {
    db.close()
  }
})
