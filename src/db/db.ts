/**
 * SQLite access via better-sqlite3 (synchronous). A single module-level
 * instance is initialized by the server entry point and shared by all workers.
 */
import Database from 'better-sqlite3'
import type { Database as DB } from 'better-sqlite3'
import { getConfig } from '../server/config'
import { applyMigrations } from './migrations'

let db: DB | undefined

function openDatabase(): DB {
  const instance = new Database(getConfig().dbPath)
  instance.pragma('journal_mode = WAL')
  instance.pragma('foreign_keys = ON')
  return instance
}

/** Apply pending migrations before Nitro begins accepting requests. */
export function migrateDatabase(): void {
  const instance = openDatabase()
  try {
    applyMigrations(instance)
  } finally {
    instance.close()
  }
}

/** Open once and return the long-lived application database connection. */
export function getDb(): DB {
  db ??= openDatabase()
  return db
}
