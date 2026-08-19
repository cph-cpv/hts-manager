import type { Database } from 'better-sqlite3'
import { initializeSchema } from './001-initialize-schema'
import { addRunTransferSchema } from './002-add-run-transfer-schema'
import { addJobsSchema } from './003-add-jobs-schema'
import type { Migration } from './types'
import { nowIso } from '../utils'

const migrations: Migration[] = [
  initializeSchema,
  addRunTransferSchema,
  addJobsSchema,
]

function validateRegistry(): void {
  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1
    if (migration.version !== expectedVersion) {
      throw new Error(
        `invalid migration registry: expected version ${expectedVersion}, ` +
          `found ${migration.version} (${migration.name})`,
      )
    }
  })
}

/**
 * Apply only the unapplied suffix of the ordered migration registry.
 *
 * `schema_migrations` is an append-only ledger containing every applied
 * version. A missing version below the highest applied version is unsafe: it
 * means database history has diverged, so startup fails instead of applying an
 * old migration to a newer schema.
 */
export function applyMigrations(db: Database): void {
  validateRegistry()

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)

  const appliedVersions = new Set(
    (
      db
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all() as Array<{ version: number }>
    ).map((row) => row.version),
  )
  const registeredVersions = new Set(
    migrations.map((migration) => migration.version),
  )

  const unknownVersions = [...appliedVersions].filter(
    (version) => !registeredVersions.has(version),
  )
  if (unknownVersions.length > 0) {
    throw new Error(
      `database contains unknown migration versions: ${unknownVersions.join(', ')}`,
    )
  }

  const highestAppliedVersion = Math.max(0, ...appliedVersions)
  const missingEarlierVersions = migrations
    .filter((migration) => migration.version < highestAppliedVersion)
    .filter((migration) => !appliedVersions.has(migration.version))
    .map((migration) => migration.version)

  if (missingEarlierVersions.length > 0) {
    throw new Error(
      `database migration history has unsafe gaps before version ` +
        `${highestAppliedVersion}: missing ${missingEarlierVersions.join(', ')}`,
    )
  }

  const stamp = db.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  )

  for (const migration of migrations) {
    if (migration.version <= highestAppliedVersion) continue

    const foreignKeysWereEnabled = db.pragma('foreign_keys', {
      simple: true,
    }) as number
    if (migration.disableForeignKeys) db.pragma('foreign_keys = OFF')

    try {
      db.transaction(() => {
        migration.up(db)
        stamp.run(migration.version, nowIso())
      })()
    } finally {
      if (migration.disableForeignKeys && foreignKeysWereEnabled) {
        db.pragma('foreign_keys = ON')
      }
    }
  }
}
