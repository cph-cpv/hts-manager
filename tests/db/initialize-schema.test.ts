import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import { initializeSchema } from '../../src/db/migrations/001-initialize-schema'

test('migration 1 does not alter an existing application database', () => {
  const db = new Database(':memory:')

  try {
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE production_data (
        id INTEGER PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO production_data (id, value) VALUES (1, 'preserve me');
    `)

    const before = db
      .prepare(
        `SELECT type, name, sql FROM sqlite_master
          WHERE name NOT LIKE 'sqlite_%'
          ORDER BY type, name`,
      )
      .all()

    initializeSchema.up(db)

    const after = db
      .prepare(
        `SELECT type, name, sql FROM sqlite_master
          WHERE name NOT LIKE 'sqlite_%'
          ORDER BY type, name`,
      )
      .all()
    assert.deepEqual(after, before)
    assert.deepEqual(db.prepare('SELECT * FROM production_data').all(), [
      { id: 1, value: 'preserve me' },
    ])
  } finally {
    db.close()
  }
})

test('migration 1 initializes a database containing only its ledger', () => {
  const db = new Database(':memory:')

  try {
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `)

    initializeSchema.up(db)

    assert.deepEqual(
      db
        .prepare(
          `SELECT name FROM sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
            ORDER BY name`,
        )
        .all(),
      [
        { name: 'files' },
        { name: 'runs' },
        { name: 'schema_migrations' },
      ],
    )
  } finally {
    db.close()
  }
})
