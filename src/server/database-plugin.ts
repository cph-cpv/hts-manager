import { definePlugin } from 'nitro'
import { migrateDatabase } from '../db/schema'

/** Initialize and migrate SQLite synchronously before Nitro accepts requests. */
export default definePlugin(() => {
  migrateDatabase()
})
