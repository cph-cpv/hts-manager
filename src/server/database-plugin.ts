import { definePlugin } from 'nitro'
import { migrateDatabase } from '../db/db'
import { ensureWorkersStarted } from './bootstrap'
import { readTransferConfig } from './config'

/** Prepare storage and start background workers before Nitro accepts requests. */
export default definePlugin(() => {
  const transferConfig = readTransferConfig()
  migrateDatabase()
  ensureWorkersStarted(transferConfig)
})
