import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('persists scheduled and requested scans as regular jobs', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'htsm-scanner-test-'))
  const root = join(directory, 'destination')
  const run = join(root, '260101_NS123_0001_FLOW')
  mkdirSync(run, { recursive: true })
  process.env.HTSM_DB_PATH = join(directory, 'test.db')
  process.env.HTSM_PIN = 'test'
  process.env.HTSM_SESSION_SECRET = 'test-session-secret'
  process.env.HTSM_SCAN_PATH = root

  const { getDb, migrateDatabase } = await import('../../src/db/db')
  const { claimJob, getJob, updateJobState } = await import(
    '../../src/db/jobs'
  )
  const {
    queueRequestedScanJob,
    queueScheduledScanJob,
  } = await import('../../src/db/scan-jobs')
  const { readConfig } = await import('../../src/server/config')
  const { createJobRegistry, runNextJob } = await import(
    '../../src/server/job-worker'
  )
  const { getScanState, requestScan } = await import(
    '../../src/server/scanner'
  )

  migrateDatabase()
  const db = getDb()

  t.beforeEach(() => {
    db.exec('DELETE FROM files; DELETE FROM jobs; DELETE FROM runs;')
    rmSync(run, { recursive: true, force: true })
    mkdirSync(run)
  })

  try {
    await t.test('scheduled scans require an idle hour', async () => {
      const first = (await queueScheduledScanJob())!
      assert.equal(first.state, 'waiting')
      assert.equal(await queueScheduledScanJob(), undefined)

      const running = claimJob(['scan'])!
      assert.equal(running.id, first.id)
      assert.equal(await queueScheduledScanJob(), undefined)
      updateJobState(running.id, 'complete')
      assert.equal(await queueScheduledScanJob(), undefined)

      db.prepare('UPDATE jobs SET finished_at = ? WHERE id = ?').run(
        new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        running.id,
      )
      assert.equal((await queueScheduledScanJob())?.state, 'waiting')
    })

    await t.test('failed scans also impose the scheduled cooldown', async () => {
      queueRequestedScanJob()
      const running = claimJob(['scan'])!
      updateJobState(running.id, 'error', 'scan failed')
      assert.equal(await queueScheduledScanJob(), undefined)

      db.prepare('UPDATE jobs SET finished_at = ? WHERE id = ?').run(
        new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        running.id,
      )
      assert.equal((await queueScheduledScanJob())?.state, 'waiting')
    })

    await t.test('requested scans allow one waiting follow-up', async () => {
      assert.deepEqual(requestScan(), { queued: true })
      const first = db
        .prepare("SELECT * FROM jobs WHERE kind = 'scan'")
        .get() as { id: number }

      assert.deepEqual(requestScan(), {
        queued: false,
        reason: 'already-waiting',
      })
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE kind = 'scan'").get()
          ?.count,
        1,
      )

      const running = claimJob(['scan'])!
      assert.equal(running.id, first.id)
      assert.deepEqual(requestScan(), { queued: true })
      const followUp = queueRequestedScanJob()
      assert.equal(followUp.queued, false)
      assert.notEqual(followUp.job.id, running.id)
      assert.equal(getScanState().queued, true)
      assert.equal(await queueScheduledScanJob(), undefined)
    })

    await t.test('the generic runner completes and fails scan jobs', async () => {
      writeFileSync(join(run, 'sample_L001_R1.fastq.gz'), 'reads')
      const config = readConfig({
        HTSM_DB_PATH: process.env.HTSM_DB_PATH,
        HTSM_PIN: process.env.HTSM_PIN,
        HTSM_SESSION_SECRET: process.env.HTSM_SESSION_SECRET,
        HTSM_SCAN_PATH: root,
      })
      const registrations = createJobRegistry(config)
      assert.deepEqual(registrations.kinds, ['scan'])

      const success = queueRequestedScanJob().job
      assert.equal(await runNextJob(registrations), true)
      assert.equal(getJob(success.id)?.state, 'complete')
      assert.equal(getScanState().scanning, false)
      assert.equal(getScanState().queued, false)
      assert.deepEqual(getScanState().lastResult, {
        added: 1,
        skipped: 0,
        missing: 0,
      })

      const failure = queueRequestedScanJob().job
      rmSync(root, { recursive: true })
      assert.equal(await runNextJob(registrations), true)
      assert.equal(getJob(failure.id)?.state, 'error')
      assert.match(getJob(failure.id)?.error_message ?? '', /ENOENT/)
      assert.match(getScanState().error ?? '', /ENOENT/)
    })
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
