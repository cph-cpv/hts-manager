import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('spawns and serially runs every supported job kind', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'htsm-job-worker-'))
  process.env.HTSM_DB_PATH = join(directory, 'hts-manager.db')
  process.env.HTSM_PIN = 'test'
  process.env.HTSM_SESSION_SECRET = 'test-session-secret'

  const auth = {
    HTSM_PIN: process.env.HTSM_PIN,
    HTSM_SESSION_SECRET: process.env.HTSM_SESSION_SECRET,
  }

  const { getDb, migrateDatabase } = await import('../../src/db/db')
  const { claimJob, enqueueJob } = await import('../../src/db/jobs')
  const {
    createJobRegistry,
    JobRegistry,
    runJobSpawners,
    runNextJob,
    startJobWorkers,
  } = await import('../../src/server/job-worker')

  migrateDatabase()
  const db = getDb()

  try {
    let spawnedJobId: number | undefined
    let handlerState: string | undefined
    const discoveryRegistry = new JobRegistry()
    discoveryRegistry.register(
      'discover',
      async () => {
        spawnedJobId = enqueueJob({ kind: 'discover' }).id
      },
      async (job) => {
        handlerState = job.state
        assert.deepEqual(
          db.prepare('SELECT state FROM jobs WHERE id = ?').get(job.id),
          { state: 'running' },
        )
      },
    )
    await runJobSpawners(discoveryRegistry)

    assert.ok(spawnedJobId)
    assert.deepEqual(
      db.prepare('SELECT state FROM jobs WHERE id = ?').get(spawnedJobId),
      { state: 'waiting' },
    )

    assert.equal(await runNextJob(discoveryRegistry), true)
    assert.equal(handlerState, 'running')
    assert.deepEqual(
      db.prepare('SELECT state FROM jobs WHERE id = ?').get(spawnedJobId),
      { state: 'complete' },
    )

    const unsupported = enqueueJob({ kind: 'discover' })
    const failing = enqueueJob({ kind: 'copy-run' })
    const succeeding = enqueueJob({ kind: 'copy-analysis' })
    const handledKinds: string[] = []
    const copyRegistry = new JobRegistry()
    copyRegistry.register(
      'copy-run',
      async () => {},
      async (job) => {
        handledKinds.push(job.kind)
        throw new Error('handler exploded')
      },
    )
    copyRegistry.register(
      'copy-analysis',
      async () => {},
      async (job) => {
        handledKinds.push(job.kind)
      },
    )

    assert.equal(await runNextJob(copyRegistry), true)
    assert.equal(await runNextJob(copyRegistry), true)
    assert.deepEqual(handledKinds, ['copy-run', 'copy-analysis'])
    assert.deepEqual(
      db
        .prepare('SELECT state, error_message FROM jobs WHERE id = ?')
        .get(failing.id),
      { state: 'error', error_message: 'handler exploded' },
    )
    assert.deepEqual(
      db.prepare('SELECT state FROM jobs WHERE id = ?').get(succeeding.id),
      { state: 'complete' },
    )
    assert.deepEqual(
      db.prepare('SELECT state FROM jobs WHERE id = ?').get(unsupported.id),
      { state: 'waiting' },
    )

    const { readConfig } = await import('../../src/server/config')
    const disabled = createJobRegistry(readConfig(auth))
    assert.equal(disabled.size, 0)
    assert.deepEqual(disabled.kinds, [])
    await runJobSpawners(disabled)
    assert.equal(await runNextJob(disabled), false)
    assert.deepEqual(
      db.prepare('SELECT state FROM jobs WHERE id = ?').get(unsupported.id),
      { state: 'waiting' },
    )

    const sourcePath = join(directory, 'source')
    const destinationPath = join(directory, 'destination')
    mkdirSync(sourcePath)
    mkdirSync(destinationPath)
    const configured = createJobRegistry(readConfig({
      ...auth,
      HTSM_DB_PATH: process.env.HTSM_DB_PATH,
      HTSM_SCAN_PATH: destinationPath,
      HTSM_TRANSFER_SOURCE_PATH: sourcePath,
    }))
    assert.deepEqual(configured.kinds, [
      'scan',
      'copy-run',
      'copy-analysis',
      'discover',
    ])

    let starts = 0
    const interrupted = [claimJob(['discover'])!]
    for (const kind of ['copy-run', 'copy-analysis', 'remove'] as const) {
      enqueueJob({ kind })
      interrupted.push(claimJob([kind])!)
    }
    const startRegistry = new JobRegistry()
    startRegistry.register(
      'remove',
      async () => {
        starts += 1
      },
      async () => {},
    )
    startJobWorkers(startRegistry)
    startJobWorkers(startRegistry)
    assert.equal(starts, 1)
    assert.deepEqual(
      interrupted.map((job) => db
        .prepare('SELECT state, error_message FROM jobs WHERE id = ?')
        .get(job.id)),
      interrupted.map(() => ({
        state: 'error',
        error_message: 'Job interrupted by server restart',
      })),
    )
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
