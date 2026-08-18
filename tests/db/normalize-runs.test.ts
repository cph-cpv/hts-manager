import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import { normalizeRuns } from '../../src/db/migrations/002-normalize-runs'
import { applyMigrations } from '../../src/db/migrations'

function createLegacyDatabase(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE runs (
      id INTEGER PRIMARY KEY,
      run_folder TEXT UNIQUE NOT NULL,
      run_date TEXT NOT NULL,
      instrument TEXT NOT NULL,
      run_number TEXT NOT NULL,
      flowcell TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_scanned_at TEXT NOT NULL
    );
    CREATE TABLE files (
      id INTEGER PRIMARY KEY,
      path TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      run_date TEXT NOT NULL,
      run_folder TEXT,
      instrument TEXT NOT NULL,
      run_number TEXT NOT NULL,
      flowcell TEXT NOT NULL,
      lane TEXT,
      missing INTEGER NOT NULL DEFAULT 0,
      upload_requested INTEGER NOT NULL DEFAULT 0,
      uploaded INTEGER NOT NULL DEFAULT 0,
      upload_status TEXT NOT NULL DEFAULT 'idle',
      upload_error TEXT,
      uploaded_at TEXT,
      first_seen_at TEXT NOT NULL,
      last_scanned_at TEXT NOT NULL
    );
    INSERT INTO files (
      id, path, name, size, run_date, run_folder, instrument, run_number,
      flowcell, first_seen_at, last_scanned_at
    ) VALUES
      (1, '/reads/a.fastq.gz', 'a.fastq.gz', 100, '2026-01-01',
       '260101_NS123_0001_FLOW', 'NS123', '0001', 'FLOW',
       '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
      (2, '/reads/b.fastq.gz', 'b.fastq.gz', 200, '2026-01-01',
       '260101_NS123_0001_FLOW', 'NS123', '0001', 'FLOW',
       '2026-01-01T01:00:00.000Z', '2026-01-03T00:00:00.000Z');
  `)
  return db
}

test('migration 2 normalizes legacy file rows and is idempotent', () => {
  const db = createLegacyDatabase()

  try {
    normalizeRuns.up(db)
    normalizeRuns.up(db)

    assert.deepEqual(
      db
        .prepare(
          `SELECT run_folder, first_seen_at, last_scanned_at FROM runs`,
        )
        .all(),
      [
        {
          run_folder: '260101_NS123_0001_FLOW',
          first_seen_at: '2026-01-01T00:00:00.000Z',
          last_scanned_at: '2026-01-03T00:00:00.000Z',
        },
      ],
    )
    assert.deepEqual(
      db.prepare('SELECT id, run_id FROM files ORDER BY id').all(),
      [
        { id: 1, run_id: 1 },
        { id: 2, run_id: 1 },
      ],
    )
    assert.deepEqual(db.pragma('foreign_key_check'), [])
  } finally {
    db.close()
  }
})

test('migration 2 leaves an already-normalized database unchanged', () => {
  const db = new Database(':memory:')

  try {
    db.exec(`
      CREATE TABLE runs (id INTEGER PRIMARY KEY, run_folder TEXT UNIQUE NOT NULL);
      CREATE TABLE files (
        id INTEGER PRIMARY KEY,
        run_id INTEGER REFERENCES runs(id),
        path TEXT UNIQUE NOT NULL
      );
      INSERT INTO runs (id, run_folder) VALUES (7, 'existing-run');
      INSERT INTO files (id, run_id, path) VALUES (11, 7, '/existing-file');
    `)
    const before = db
      .prepare(
        `SELECT type, name, sql FROM sqlite_master
          WHERE name NOT LIKE 'sqlite_%'
          ORDER BY type, name`,
      )
      .all()

    normalizeRuns.up(db)

    assert.deepEqual(
      db
        .prepare(
          `SELECT type, name, sql FROM sqlite_master
            WHERE name NOT LIKE 'sqlite_%'
            ORDER BY type, name`,
        )
        .all(),
      before,
    )
    assert.deepEqual(db.prepare('SELECT * FROM files').all(), [
      { id: 11, run_id: 7, path: '/existing-file' },
    ])
  } finally {
    db.close()
  }
})

test('the registry safely upgrades a legacy production database without a ledger', () => {
  const db = createLegacyDatabase()

  try {
    applyMigrations(db)

    assert.deepEqual(
      db
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all(),
      [{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }],
    )
    assert.deepEqual(
      db
        .prepare(
          `SELECT run_folder, source_path, transfer_status,
                  first_seen_at, last_scanned_at
             FROM runs`,
        )
        .all(),
      [
        {
          run_folder: '260101_NS123_0001_FLOW',
          source_path: null,
          transfer_status: 'manual',
          first_seen_at: '2026-01-01T00:00:00.000Z',
          last_scanned_at: '2026-01-03T00:00:00.000Z',
        },
      ],
    )
    assert.deepEqual(
      db.prepare('SELECT id, run_id, path FROM files ORDER BY id').all(),
      [
        { id: 1, run_id: 1, path: '/reads/a.fastq.gz' },
        { id: 2, run_id: 1, path: '/reads/b.fastq.gz' },
      ],
    )
    assert.deepEqual(db.pragma('foreign_key_check'), [])
  } finally {
    db.close()
  }
})
