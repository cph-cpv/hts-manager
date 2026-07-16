import { definePlugin } from 'nitro'
import { initializeDatabase } from '../db/schema'

/** Initialize and migrate SQLite synchronously before Nitro accepts requests. */
export default definePlugin(() => {
  initializeDatabase()
})
