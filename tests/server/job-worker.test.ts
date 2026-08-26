import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('spawns and serially runs every supported job kind', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'htsm-job-worker-'))
  process.env.HTSM_DB_PATH = join(directory, 'hts-manager.db')

  const { getDb, migrateDatabase } = await import('../../src/db/db')
  const { enqueueJob } = await import('../../src/db/jobs')
  const {
    JOB_HANDLERS,
    JOB_SPAWNERS,
    runJobSpawners,
    runNextJob,
    startJobWorkers,
  } = await import('../../src/server/job-worker')

  migrateDatabase()
  const db = getDb()

  try {
    let spawnedJobId: number | undefined
    await runJobSpawners({
      'test.complete': () => {
        spawnedJobId = enqueueJob({ kind: 'test.complete' }).id
      },
    })

    assert.ok(spawnedJobId)
    assert.deepEqual(
      db.prepare('SELECT state FROM jobs WHERE id = ?').get(spawnedJobId),
      { state: 'waiting' },
    )

    let handlerState: string | undefined
    assert.equal(
      await runNextJob({
        'test.complete': (job) => {
          handlerState = job.state
          assert.deepEqual(
            db.prepare('SELECT state FROM jobs WHERE id = ?').get(job.id),
            { state: 'running' },
          )
        },
      }),
      true,
    )
    assert.equal(handlerState, 'running')
    assert.deepEqual(
      db.prepare('SELECT state FROM jobs WHERE id = ?').get(spawnedJobId),
      { state: 'complete' },
    )

    const unsupported = enqueueJob({ kind: 'test.unsupported' })
    const failing = enqueueJob({ kind: 'test.failure' })
    const succeeding = enqueueJob({ kind: 'test.success' })
    const handledKinds: string[] = []
    const handlers = {
      'test.failure': (job: { kind: string }) => {
        handledKinds.push(job.kind)
        throw new Error('handler exploded')
      },
      'test.success': (job: { kind: string }) => {
        handledKinds.push(job.kind)
      },
    }

    assert.equal(await runNextJob(handlers), true)
    assert.equal(await runNextJob(handlers), true)
    assert.deepEqual(handledKinds, ['test.failure', 'test.success'])
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

    assert.deepEqual(Object.keys(JOB_SPAWNERS), [])
    assert.deepEqual(Object.keys(JOB_HANDLERS), [])
    await runJobSpawners(JOB_SPAWNERS)
    assert.equal(await runNextJob(JOB_HANDLERS), false)

    let starts = 0
    const startRegistrations = {
      'test.start': () => {
        starts += 1
      },
    }
    startJobWorkers(startRegistrations, {})
    startJobWorkers(startRegistrations, {})
    assert.equal(starts, 1)
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
