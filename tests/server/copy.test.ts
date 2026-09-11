import assert from 'node:assert/strict'
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('stages whole runs and run-owned analyses with rsync', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'htsm-copy-test-'))
  const sourceRoot = join(directory, 'source with spaces')
  const destinationRoot = join(directory, 'destination')
  mkdirSync(sourceRoot)
  mkdirSync(destinationRoot)
  process.env.HTSM_DB_PATH = join(directory, 'test.db')
  process.env.HTSM_PIN = 'test'
  process.env.HTSM_SESSION_SECRET = 'test-session-secret'
  process.env.HTSM_TRANSFER_SOURCE_PATH = sourceRoot
  process.env.HTSM_SCAN_PATH = destinationRoot

  const { getDb, migrateDatabase } = await import('../../src/db/db')
  const { getConfig } = await import('../../src/server/config')
  const { getRunById } = await import('../../src/db/runs')
  const {
    markRunReady,
    queueReadyRunCopies,
    queueRunAnalysisCopyJob,
    queueRunCopyJob,
    upsertDetectedRun,
  } = await import('../../src/db/transfer')
  const { claimJob, failInterruptedJobs, getJob } = await import('../../src/db/jobs')
  const { inventoryRun, rsyncDirectory } = await import('../../src/server/copy')
  const {
    handleCopyAnalysisJob,
    queueReadyRunAnalysisCopies,
  } = await import('../../src/server/copy-analysis')
  const { handleCopyRunJob } = await import('../../src/server/copy-run')
  const { publishDirectory } = await import('../../src/server/publish-directory')
  const { JobRegistry, runNextJob } = await import(
    '../../src/server/job-worker'
  )
  const { runScan } = await import('../../src/scan/scan')
  const { reconcileFastqLinks } = await import('../../src/fastq-links/reconcile')
  const { discoverSourceRuns } = await import('../../src/server/discovery')
  migrateDatabase()
  const db = getDb()
  const config = getConfig().transfer
  let sequence = 0
  const copyRegistry = new JobRegistry()
  copyRegistry.register(
    'copy-run',
    queueReadyRunCopies,
    (job) => handleCopyRunJob(job, config),
  )
  const analysisRegistry = new JobRegistry()
  analysisRegistry.register(
    'copy-analysis',
    () => queueReadyRunAnalysisCopies(config),
    (job) => handleCopyAnalysisJob(job, config),
  )

  function makeRun() {
    const name = `260101_NS123_${String(++sequence).padStart(4, '0')}_FLOW`
    const source = join(sourceRoot, name)
    const destination = join(destinationRoot, name)
    mkdirSync(join(source, 'fastq', 'Empty'), { recursive: true })
    writeFileSync(join(source, '.hidden'), 'metadata')
    writeFileSync(join(source, 'CopyComplete.txt'), 'ready')
    writeFileSync(join(source, 'fastq', 'sample_L001_R1.fastq.gz'), Buffer.alloc(1024 * 1024 + 37, 42))
    writeFileSync(join(source, 'RunInfo.xml'), '<Run/>')
    const run = upsertDetectedRun({ runFolder: name, sourcePath: source })
    markRunReady(run.id)
    return { ...run, source, destination }
  }

  function makeAnalysis(run: ReturnType<typeof makeRun>, folder: string, ready = false) {
    const source = join(run.source, 'Analysis', folder)
    mkdirSync(join(source, 'Data', 'fastq'), { recursive: true })
    writeFileSync(join(source, 'Data', 'fastq', 'analysis_L001_R1.fastq.gz'), 'analysis reads')
    if (ready) writeFileSync(join(source, 'report.html'), 'report')
    return source
  }

  async function attempt(runId: number) {
    const job = queueRunCopyJob(runId)
    await runNextJob(copyRegistry)
    return getJob(job.id)!
  }

  async function attemptAnalyses(runId: number) {
    const job = queueRunAnalysisCopyJob(runId)
    await runNextJob(analysisRegistry)
    return getJob(job.id)!
  }

  t.beforeEach(async () => {
    const { getScanState } = await import('../../src/server/scanner')
    const { setTimeout } = await import('node:timers/promises')
    while (getScanState().scanning) await setTimeout(5)
    db.exec('DELETE FROM files; DELETE FROM jobs; DELETE FROM runs;')
    for (const root of [sourceRoot, destinationRoot]) {
      for (const name of readdirSync(root)) rmSync(join(root, name), { recursive: true, force: true })
    }
  })

  try {
    await t.test('copies and verifies the base run while excluding the Analysis tree', async () => {
      const run = makeRun()
      makeAnalysis(run, '1')
      makeAnalysis(run, '2')
      const result = await attempt(run.id)
      assert.equal(result.state, 'complete')
      assert.equal(getRunById(run.id)?.transfer_status, 'transferred')
      assert.equal(existsSync(join(run.destination, 'Analysis')), false)
      assert.deepEqual(await inventoryRun(run.destination), await inventoryRun(run.source, true))
      assert.deepEqual(readFileSync(join(run.destination, 'fastq', 'sample_L001_R1.fastq.gz')),
        readFileSync(join(run.source, 'fastq', 'sample_L001_R1.fastq.gz')))
      assert.deepEqual(readdirSync(destinationRoot), [run.run_folder])
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE kind = 'scan'").get()
          ?.count,
        0,
      )
    })

    for (const shape of ['empty directory', 'file', 'symlink'] as const) {
      await t.test(`existing destination ${shape} is a permanent conflict`, async () => {
        const run = makeRun()
        if (shape === 'empty directory') mkdirSync(run.destination)
        if (shape === 'file') writeFileSync(run.destination, 'keep')
        if (shape === 'symlink') symlinkSync(run.source, run.destination)
        const job = await attempt(run.id)
        assert.equal(job.state, 'error')
        assert.match(
          job.error_message!,
          /Destination is missing|Not a regular directory/,
        )
        assert.equal(getRunById(run.id)?.transfer_status, 'error')
        assert.equal(existsSync(join(destinationRoot, `.htsm-copy-${run.id}.partial`)), false)
        await discoverSourceRuns(sourceRoot)
        await queueReadyRunCopies()
        assert.equal(db.prepare("SELECT count(*) AS n FROM jobs WHERE state = 'waiting'").get()!.n, 0)
        if (shape === 'file') assert.equal(readFileSync(run.destination, 'utf8'), 'keep')
        if (shape === 'empty directory') assert.deepEqual(readdirSync(run.destination), [])
      })
    }

    await t.test('a matching manually restored destination is verified and accepted', async () => {
      const run = makeRun()
      cpSync(run.source, run.destination, { recursive: true })

      const job = await attempt(run.id)

      assert.equal(job.state, 'complete')
      assert.equal(getRunById(run.id)?.transfer_status, 'transferred')
      assert.deepEqual(
        await inventoryRun(run.destination),
        await inventoryRun(run.source, true),
      )
    })

    await t.test('an interrupted copy is invisible and its staging contents are discarded on retry', async () => {
      const run = makeRun()
      const staging = join(destinationRoot, `.htsm-copy-${run.id}.partial`)
      mkdirSync(staging)
      writeFileSync(join(staging, 'stale'), 'must disappear')
      await runScan(destinationRoot)
      assert.equal(db.prepare('SELECT count(*) AS n FROM files').get()!.n, 0)
      const links = join(directory, 'links')
      await reconcileFastqLinks(destinationRoot, links)
      assert.deepEqual(readdirSync(links), [])
      assert.equal(existsSync(run.destination), false)
      assert.ok(existsSync(staging))
      assert.equal((await attempt(run.id)).state, 'complete')
      assert.equal(existsSync(staging), false)
      assert.equal(existsSync(join(run.destination, 'stale')), false)
    })

    await t.test('a failed rsync attempt cannot publish partial output', async () => {
      const run = makeRun()
      rmSync(run.source, { recursive: true })
      const job = await attempt(run.id)
      assert.equal(job.state, 'error')
      assert.equal(getRunById(run.id)?.transfer_status, 'ready')
      assert.equal(existsSync(run.destination), false)
    })

    await t.test('destination mismatches and unsupported source entries prevent publication', async () => {
      const run = makeRun()
      cpSync(run.source, run.destination, { recursive: true })
      writeFileSync(join(run.destination, 'RunInfo.xml'), 'wrong size')
      const job = await attempt(run.id)
      assert.equal(job.state, 'error')
      assert.equal(readFileSync(join(run.destination, 'RunInfo.xml'), 'utf8'), 'wrong size')
      const linked = makeRun()
      symlinkSync('RunInfo.xml', join(linked.source, 'link'))
      assert.equal((await attempt(linked.id)).state, 'error')
      assert.equal(existsSync(linked.destination), false)
    })

    await t.test('restart after publication but before recording completion verifies and recovers', async () => {
      const run = makeRun()
      const job = queueRunCopyJob(run.id)
      claimJob(['copy-run'])
      const staging = join(destinationRoot, `.htsm-copy-${run.id}.partial`)
      mkdirSync(staging)
      await rsyncDirectory(run.source, staging, true)
      await publishDirectory(staging, run.destination)
      failInterruptedJobs()
      assert.equal(getJob(job.id)?.state, 'error')
      assert.equal((await attempt(run.id)).state, 'complete')
      assert.equal(getRunById(run.id)?.transfer_status, 'transferred')
      assert.deepEqual(await inventoryRun(run.destination), await inventoryRun(run.source, true))
    })

    await t.test('one job copies all ready analyses and later readiness queues new work', async () => {
      const run = makeRun()
      makeAnalysis(run, '1', true)
      const second = makeAnalysis(run, '2')
      mkdirSync(join(second, 'nested'))
      writeFileSync(join(second, 'nested', 'report.html'), 'not a marker')
      writeFileSync(join(second, 'Report.html'), 'not a marker')
      await attempt(run.id)
      assert.equal(existsSync(join(run.destination, 'Analysis')), false)

      await queueReadyRunAnalysisCopies(config)
      await queueReadyRunAnalysisCopies(config)
      const firstJob = db
        .prepare(
          `SELECT id FROM jobs
            WHERE kind = 'copy-analysis' AND target_id = ? AND state = 'waiting'`,
        )
        .get(run.id) as { id: number }
      assert.equal(
        db.prepare(
          `SELECT COUNT(*) AS count FROM jobs
            WHERE kind = 'copy-analysis' AND target_id = ? AND state = 'waiting'`,
        ).get(run.id)?.count,
        1,
      )
      await runNextJob(analysisRegistry)
      assert.equal(getJob(firstJob.id)?.state, 'complete')
      assert.deepEqual(readdirSync(join(run.destination, 'Analysis')), ['1'])
      assert.deepEqual(await inventoryRun(join(run.destination, 'Analysis', '1')),
        await inventoryRun(join(run.source, 'Analysis', '1')))
      assert.equal(
        db.prepare(
          "SELECT COUNT(*) AS count FROM jobs WHERE kind = 'scan' AND state = 'waiting'",
        ).get()?.count,
        1,
      )

      writeFileSync(join(second, 'report.html'), 'finished')
      db.prepare("DELETE FROM jobs WHERE kind = 'scan'").run()
      await queueReadyRunAnalysisCopies(config)
      assert.equal((await attemptAnalyses(run.id)).state, 'complete')
      assert.equal(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM jobs WHERE kind = 'scan' AND state = 'waiting'",
          )
          .get()!.count,
        1,
      )
      assert.deepEqual(await inventoryRun(join(run.destination, 'Analysis', '2')), await inventoryRun(second))
      writeFileSync(join(second, 'report.html'), 'later change is not synced')
      db.prepare("DELETE FROM jobs WHERE kind = 'scan'").run()
      await queueReadyRunAnalysisCopies(config)
      assert.equal(
        db.prepare(
          `SELECT COUNT(*) AS count FROM jobs
            WHERE kind = 'copy-analysis' AND state = 'waiting'`,
        ).get()?.count,
        0,
      )
      assert.equal(readFileSync(join(run.destination, 'Analysis', '2', 'report.html'), 'utf8'), 'finished')
    })

    await t.test('directory and symlink reports are not completion markers', async () => {
      const run = makeRun()
      const directoryMarker = makeAnalysis(run, 'directory')
      const linkMarker = makeAnalysis(run, 'symlink')
      mkdirSync(join(directoryMarker, 'report.html'))
      symlinkSync(join(run.source, 'RunInfo.xml'), join(linkMarker, 'report.html'))
      await attempt(run.id)
      await queueReadyRunAnalysisCopies(config)
      assert.equal(existsSync(join(run.destination, 'Analysis')), false)
      assert.equal(
        db.prepare(
          "SELECT COUNT(*) AS count FROM jobs WHERE kind = 'copy-analysis'",
        ).get()?.count,
        0,
      )
    })

    await t.test('partial analysis failure publishes siblings, queues a scan, and errors the job', async () => {
      const run = makeRun()
      await attempt(run.id)
      makeAnalysis(run, 'collision', true)
      makeAnalysis(run, 'retry', true)
      makeAnalysis(run, 'success', true)
      mkdirSync(join(run.destination, 'Analysis'), { recursive: true })
      writeFileSync(join(run.destination, 'Analysis', 'collision'), 'keep')
      const stage = join(destinationRoot, `.htsm-analysis-${run.id}-retry.partial`)
      mkdirSync(stage)
      writeFileSync(join(stage, 'stale'), 'discard')
      const job = await attemptAnalyses(run.id)
      assert.equal(job.state, 'error')
      assert.match(job.error_message ?? '', /collision/)
      assert.equal(getRunById(run.id)?.transfer_status, 'transferred')
      assert.equal(existsSync(stage), false)
      assert.equal(existsSync(join(run.destination, 'Analysis', 'retry', 'stale')), false)
      assert.equal(readFileSync(join(run.destination, 'Analysis', 'collision'), 'utf8'), 'keep')
      assert.deepEqual(await inventoryRun(join(run.destination, 'Analysis', 'success')),
        await inventoryRun(join(run.source, 'Analysis', 'success')))
      assert.equal(
        db.prepare(
          "SELECT COUNT(*) AS count FROM jobs WHERE kind = 'scan' AND state = 'waiting'",
        ).get()?.count,
        1,
      )
      await queueReadyRunAnalysisCopies(config)
      assert.equal(
        db.prepare(
          `SELECT COUNT(*) AS count FROM jobs
            WHERE kind = 'copy-analysis' AND state = 'waiting'`,
        ).get()?.count,
        1,
      )
    })

    await t.test('scan enqueue failure does not fail a successful analysis job', async () => {
      const run = makeRun()
      await attempt(run.id)
      makeAnalysis(run, 'ready', true)
      db.exec(`
        CREATE TRIGGER reject_scan_job
        BEFORE INSERT ON jobs
        WHEN NEW.kind = 'scan'
        BEGIN
          SELECT RAISE(ABORT, 'scan queue failed');
        END;
      `)
      const originalConsoleError = console.error
      console.error = () => undefined
      try {
        const job = await attemptAnalyses(run.id)
        assert.equal(job.state, 'complete')
      } finally {
        console.error = originalConsoleError
        db.exec('DROP TRIGGER reject_scan_job')
      }
      assert.ok(existsSync(join(run.destination, 'Analysis', 'ready')))
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE kind = 'scan'").get()
          ?.count,
        0,
      )
    })
  } finally {
    const { getScanState } = await import('../../src/server/scanner')
    const { setTimeout } = await import('node:timers/promises')
    while (getScanState().scanning) await setTimeout(5)
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
