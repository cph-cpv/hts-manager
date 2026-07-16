import {
  createTransferSourcesTable,
  TRANSFER_SCHEMA,
} from '../transfer-schema'
import type { Migration } from './types'

/** Add sequencer-source discovery, copy, and removal state tracking. */
export const addTransferSchema: Migration = {
  version: 2,
  name: 'add transfer schema',
  disableForeignKeys: true,
  up(db) {
    const table = db
      .prepare(
        `SELECT sql FROM sqlite_master
          WHERE type = 'table' AND name = 'transfer_sources'`,
      )
      .get() as { sql: string } | undefined

    // Rebuild databases created while this branch was under development so
    // they receive the final block_reason constraints too.
    if (table && !table.sql.includes('block_reason IS NOT NULL')) {
      db.exec(`
        DROP VIEW IF EXISTS transfer_source_status;
        DROP TABLE IF EXISTS transfer_sources_new;
        ${createTransferSourcesTable('transfer_sources_new')}
        INSERT INTO transfer_sources_new
          (id, folder_name, source_path, readiness_status, first_seen_at, block_reason)
        SELECT
          id,
          folder_name,
          source_path,
          readiness_status,
          first_seen_at,
          CASE
            WHEN readiness_status = 'blocked' AND block_reason IS NULL
              THEN 'Block reason unavailable (migrated)'
            ELSE block_reason
          END
        FROM transfer_sources;
        DROP TABLE transfer_sources;
        ALTER TABLE transfer_sources_new RENAME TO transfer_sources;
      `)
    }

    db.exec(TRANSFER_SCHEMA)

    const foreignKeyViolations = db.pragma('foreign_key_check') as unknown[]
    if (foreignKeyViolations.length > 0) {
      throw new Error('foreign key violation after adding transfer schema')
    }
  },
}
