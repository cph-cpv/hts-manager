import type { Database } from 'better-sqlite3'

export interface Migration {
  version: number
  name: string
  disableForeignKeys?: boolean
  up: (db: Database) => void
}
