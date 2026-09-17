import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('copies analyses independently and indexes each publication directly', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'htsm-copy-'))
  const sourceRoot = join(directory, 'source')
  const destinationRoot = join(directory, 'destination')
  mkdirSync(sourceRoot)
  mkdirSync(destinationRoot)
  process.env.HTSM_DB_PATH = join(directory, 'db.sqlite')
  process.env.HTSM_PIN = 'test'
  process.env.HTSM_SESSION_SECRET = 'secret'
  process.env.HTSM_TRANSFER_SOURCE_PATH = sourceRoot
  process.env.HTSM_SCAN_PATH = destinationRoot

  const { getDb, migrateDatabase } = await import('../../src/db/db')
  const { getConfig } = await import('../../src/server/config')
  const { discoverSourceRuns } = await import('../../src/server/jobs/discovery')
  const { getRunByFolder } = await import('../../src/db/runs')
  const { queueRunCopyJob } = await import('../../src/db/transfer')
  const {
    getAnalysisById,
    listAnalysesByRun,
    markAnalysisTransferred,
    queueAnalysisCopyJob,
  } = await import('../../src/db/analyses')
  const { getJob } = await import('../../src/db/jobs')
  const { handleCopyRunJob } = await import('../../src/server/jobs/copy-run')
  const {
    handleCopyAnalysisJob,
    queueEligibleAnalysisCopyJobs,
  } = await import('../../src/server/jobs/copy-analysis')
  const { JobRegistry, runNextJob } = await import('../../src/server/jobs/job-worker')
  const { runScan } = await import('../../src/scan/scan')
  migrateDatabase()
  const db = getDb()
  const config = getConfig().transfer
  const runs = new JobRegistry()
  runs.register('copy-run', async () => {}, (job) => handleCopyRunJob(job, config))
  const analyses = new JobRegistry()
  analyses.register('copy-analysis', queueEligibleAnalysisCopyJobs, (job) => handleCopyAnalysisJob(job, config))
  let sequence = 0

  function makeSource(analysisSpecs: Array<{ name: string; fastq?: boolean }>) {
    const runName = `260101_NS123_${String(++sequence).padStart(4, '0')}_FLOW`
    const source = join(sourceRoot, runName)
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'CopyComplete.txt'), 'done')
    writeFileSync(join(source, 'RunInfo.xml'), '<Run/>')
    for (const spec of analysisSpecs) {
      const analysis = join(source, 'Analysis', spec.name)
      mkdirSync(join(analysis, 'Data', 'fastq'), { recursive: true })
      writeFileSync(join(analysis, 'report.html'), 'done')
      if (spec.fastq !== false) {
        writeFileSync(join(analysis, 'Data', 'fastq', `${spec.name}_L001_R1.fastq.gz`), spec.name)
      }
    }
    return { runName, source, destination: join(destinationRoot, runName) }
  }

  async function discoverAndCopyBase(specs: Array<{ name: string; fastq?: boolean }>) {
    const paths = makeSource(specs)
    await discoverSourceRuns(sourceRoot)
    const run = getRunByFolder(paths.runName)!
    const job = queueRunCopyJob(run.id)
    await runNextJob(runs)
    assert.equal(getJob(job.id)?.state, 'complete')
    assert.equal(getRunByFolder(paths.runName)?.status, 'transferred')
    assert.equal(existsSync(join(paths.destination, 'Analysis')), false)
    return { ...paths, run }
  }

  t.beforeEach(() => {
    db.exec('DELETE FROM files; DELETE FROM jobs; DELETE FROM runs;')
    for (const root of [sourceRoot, destinationRoot]) {
      for (const name of readdirSync(root)) rmSync(join(root, name), { recursive: true, force: true })
    }
  })

  try {
    await t.test('blocks a conflicting base destination without overwriting it', async () => {
      const paths = makeSource([{ name: 'one' }])
      await discoverSourceRuns(sourceRoot)
      const run = getRunByFolder(paths.runName)!
      mkdirSync(paths.destination)
      writeFileSync(join(paths.destination, 'keep'), 'operator data')
      const job = queueRunCopyJob(run.id)
      await runNextJob(runs)
      assert.equal(getJob(job.id)?.state, 'error')
      assert.equal(getRunByFolder(paths.runName)?.status, 'blocked')
      assert.equal(existsSync(join(paths.destination, 'keep')), true)
    })

    await t.test('leaves a run processing after a retryable source failure', async () => {
      const paths = makeSource([{ name: 'one' }])
      await discoverSourceRuns(sourceRoot)
      const run = getRunByFolder(paths.runName)!
      rmSync(paths.source, { recursive: true })
      const job = queueRunCopyJob(run.id)
      await runNextJob(runs)
      assert.equal(getJob(job.id)?.state, 'error')
      assert.equal(getRunByFolder(paths.runName)?.status, 'processing')
      assert.equal(existsSync(paths.destination), false)
    })

    await t.test('recovers when publication completed before the state transition', async () => {
      const paths = makeSource([{ name: 'one' }])
      await discoverSourceRuns(sourceRoot)
      const run = getRunByFolder(paths.runName)!
      cpSync(paths.source, paths.destination, { recursive: true })
      const job = queueRunCopyJob(run.id)
      await runNextJob(runs)
      assert.equal(getJob(job.id)?.state, 'complete')
      assert.equal(getRunByFolder(paths.runName)?.status, 'transferred')
    })

    await t.test('discards an owned stale base staging directory before retrying', async () => {
      const paths = makeSource([{ name: 'one' }])
      await discoverSourceRuns(sourceRoot)
      const run = getRunByFolder(paths.runName)!
      const staging = join(destinationRoot, `.htsm-copy-${run.id}.partial`)
      mkdirSync(staging)
      writeFileSync(join(staging, 'stale'), 'partial')
      const job = queueRunCopyJob(run.id)
      await runNextJob(runs)
      assert.equal(getJob(job.id)?.state, 'complete')
      assert.equal(existsSync(staging), false)
      assert.equal(existsSync(join(paths.destination, 'stale')), false)
    })

    await t.test('publishes, indexes, and makes FASTQs uploadable without a scan job', async () => {
      const { run, destination } = await discoverAndCopyBase([{ name: 'one' }])
      const analysis = listAnalysesByRun(run.id)[0]!
      const job = queueAnalysisCopyJob(analysis.id)
      await runNextJob(analyses)
      assert.equal(getJob(job.id)?.state, 'complete')
      assert.equal(getAnalysisById(analysis.id)?.status, 'indexed')
      assert.equal(existsSync(join(destination, 'Analysis', 'one')), true)
      assert.deepEqual(db.prepare(
        'SELECT run_id, analysis_id, name, missing FROM files',
      ).get(), {
        run_id: run.id,
        analysis_id: analysis.id,
        name: 'one_L001_R1.fastq.gz',
        missing: 0,
      })
      await runScan(destinationRoot)
      assert.equal(
        db.prepare('SELECT analysis_id FROM files').get()!.analysis_id,
        analysis.id,
      )
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE kind = 'scan'").get()!.n, 0)
    })

    await t.test('blocks empty content without preventing a sibling analysis', async () => {
      const { run } = await discoverAndCopyBase([
        { name: 'empty', fastq: false },
        { name: 'good' },
      ])
      await queueEligibleAnalysisCopyJobs()
      await runNextJob(analyses)
      await runNextJob(analyses)
      const summaries = listAnalysesByRun(run.id)
      assert.equal(summaries.find((a) => a.analysis_folder === 'empty')?.status, 'blocked')
      assert.match(
        summaries.find((a) => a.analysis_folder === 'empty')?.last_blocking_reason ?? '',
        /no FASTQ/i,
      )
      assert.equal(summaries.find((a) => a.analysis_folder === 'good')?.status, 'indexed')
    })

    await t.test('verifies an existing destination and attaches an existing same-run row', async () => {
      const { run, source, destination } = await discoverAndCopyBase([{ name: 'restored' }])
      const analysis = listAnalysesByRun(run.id)[0]!
      const sourceAnalysis = join(source, 'Analysis', 'restored')
      const destinationAnalysis = join(destination, 'Analysis', 'restored')
      mkdirSync(join(destination, 'Analysis'))
      cpSync(sourceAnalysis, destinationAnalysis, { recursive: true })
      const path = join(destinationAnalysis, 'Data', 'fastq', 'restored_L001_R1.fastq.gz')
      db.prepare(`
        INSERT INTO files (
          run_id, path, name, size, upload_requested, upload_status,
          first_seen_at, last_scanned_at
        ) VALUES (?, ?, ?, ?, 1, 'queued', 'original', 'original')
      `).run(run.id, path, 'restored_L001_R1.fastq.gz', 1)
      const job = queueAnalysisCopyJob(analysis.id)
      await runNextJob(analyses)
      assert.equal(getJob(job.id)?.state, 'complete')
      assert.deepEqual(db.prepare(`
        SELECT analysis_id, upload_requested, upload_status, first_seen_at
          FROM files WHERE path = ?
      `).get(path), {
        analysis_id: analysis.id,
        upload_requested: 1,
        upload_status: 'queued',
        first_seen_at: 'original',
      })
    })

    await t.test('retries indexing from the transferred state without copying again', async () => {
      const { run, source, destination } = await discoverAndCopyBase([{ name: 'resume' }])
      const analysis = listAnalysesByRun(run.id)[0]!
      markAnalysisTransferred(analysis.id)

      const failed = queueAnalysisCopyJob(analysis.id)
      await runNextJob(analyses)
      assert.equal(getJob(failed.id)?.state, 'error')
      assert.equal(getAnalysisById(analysis.id)?.status, 'transferred')

      const destinationAnalysis = join(destination, 'Analysis', 'resume')
      mkdirSync(join(destination, 'Analysis'))
      cpSync(join(source, 'Analysis', 'resume'), destinationAnalysis, { recursive: true })
      const retry = queueAnalysisCopyJob(analysis.id)
      await runNextJob(analyses)
      assert.equal(getJob(retry.id)?.state, 'complete')
      assert.equal(getAnalysisById(analysis.id)?.status, 'indexed')
    })

    await t.test('completes a stale job after the scanner indexes a transferred analysis', async () => {
      const { run, source, destination } = await discoverAndCopyBase([{ name: 'scanned' }])
      const analysis = listAnalysesByRun(run.id)[0]!
      const destinationAnalysis = join(destination, 'Analysis', 'scanned')
      mkdirSync(join(destination, 'Analysis'))
      cpSync(join(source, 'Analysis', 'scanned'), destinationAnalysis, { recursive: true })
      markAnalysisTransferred(analysis.id)
      const job = queueAnalysisCopyJob(analysis.id)

      await runScan(destinationRoot)
      assert.equal(getAnalysisById(analysis.id)?.status, 'indexed')
      await runNextJob(analyses)
      assert.equal(getJob(job.id)?.state, 'complete')
    })

    await t.test('a conflicting published destination is retained and blocks only that analysis', async () => {
      const { run, destination } = await discoverAndCopyBase([{ name: 'conflict' }])
      const analysis = listAnalysesByRun(run.id)[0]!
      mkdirSync(join(destination, 'Analysis', 'conflict'), { recursive: true })
      writeFileSync(join(destination, 'Analysis', 'conflict', 'keep'), 'operator data')
      const job = queueAnalysisCopyJob(analysis.id)
      await runNextJob(analyses)
      assert.equal(getJob(job.id)?.state, 'error')
      assert.equal(getAnalysisById(analysis.id)?.status, 'blocked')
      assert.equal(existsSync(join(destination, 'Analysis', 'conflict', 'keep')), true)
    })
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
