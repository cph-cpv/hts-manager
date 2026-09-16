import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
    '../../src/server/jobs/job-worker'
  )
  const { getScanState, requestScan } = await import(
    '../../src/server/jobs/scanner'
  )
  const { runScan } = await import('../../src/scan/scan')
  const { deriveRecord, parseRunFolder } = await import('../../src/scan/parse')
  const {
    getAnalysisById,
    listAnalysesByRun,
    upsertSourceAnalysis,
  } = await import('../../src/db/analyses')
  const {
    getFilesForRun,
    insertFileRowIfNew,
    insertIfNew,
  } = await import('../../src/db/files')
  const { getRunByFolder, upsertScannedRun } = await import('../../src/db/runs')

  migrateDatabase()
  const db = getDb()

  function makeFile(path: string): void {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'reads')
  }

  t.beforeEach(() => {
    db.exec('DELETE FROM files; DELETE FROM jobs; DELETE FROM runs;')
    rmSync(run, { recursive: true, force: true })
    mkdirSync(run, { recursive: true })
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

    await t.test('associates recursive FASTQs only below immediate analyses', async () => {
      const analysisFastq = join(run, 'Analysis', 'alpha', 'Data', 'fastq')
      const direct = join(analysisFastq, 'direct_L001_R1.fastq.gz')
      const nested = join(analysisFastq, 'nested', 'nested.fq.gz')
      const outside = join(run, 'other', 'outside.fastq.gz')
      const nestedAnalysis = join(
        run,
        'other',
        'Analysis',
        'beta',
        'Data',
        'fastq',
        'lookalike.fastq.gz',
      )
      const hidden = join(
        run,
        'Analysis',
        '.hidden',
        'Data',
        'fastq',
        'hidden.fastq.gz',
      )
      makeFile(direct)
      makeFile(nested)
      makeFile(outside)
      makeFile(nestedAnalysis)
      makeFile(hidden)

      assert.deepEqual(await runScan(root), {
        added: 4,
        skipped: 0,
        missing: 0,
      })

      const runRow = getRunByFolder('260101_NS123_0001_FLOW')!
      const analyses = listAnalysesByRun(runRow.id)
      assert.deepEqual(
        analyses.map(({ analysis_folder, status }) => ({ analysis_folder, status })),
        [{ analysis_folder: 'alpha', status: 'indexed' }],
      )

      const files = new Map(
        getFilesForRun(runRow.id).map((file) => [file.path, file]),
      )
      assert.equal(files.get(direct)?.analysis_id, analyses[0]?.id)
      assert.equal(files.get(nested)?.analysis_id, analyses[0]?.id)
      assert.equal(files.get(outside)?.analysis_id, null)
      assert.equal(files.get(nestedAnalysis)?.analysis_id, null)
      assert.equal(files.has(hidden), false)

      const later = join(analysisFastq, 'later', 'later.fastq.gz')
      makeFile(later)
      assert.deepEqual(await runScan(root), {
        added: 1,
        skipped: 4,
        missing: 0,
      })
      assert.equal(
        getFilesForRun(runRow.id).find((file) => file.path === later)
          ?.analysis_id,
        analyses[0]?.id,
      )
    })

    await t.test('ignores empty analyses and keeps indexed state when files disappear', async () => {
      const fastqDirectory = join(run, 'Analysis', '1', 'Data', 'fastq')
      mkdirSync(fastqDirectory, { recursive: true })

      assert.deepEqual(await runScan(root), {
        added: 0,
        skipped: 0,
        missing: 0,
      })
      const runRow = getRunByFolder('260101_NS123_0001_FLOW')!
      assert.deepEqual(listAnalysesByRun(runRow.id), [])

      const path = join(fastqDirectory, 'recovered.fastq.gz')
      makeFile(path)
      assert.deepEqual(await runScan(root), {
        added: 1,
        skipped: 0,
        missing: 0,
      })
      const analysis = listAnalysesByRun(runRow.id)[0]!
      assert.equal(getAnalysisById(analysis.id)?.status, 'indexed')

      rmSync(path)
      assert.deepEqual(await runScan(root), {
        added: 0,
        skipped: 0,
        missing: 1,
      })
      assert.equal(getAnalysisById(analysis.id)?.status, 'indexed')
    })

    await t.test('attaches existing run files without changing upload history', async () => {
      const path = join(
        run,
        'Analysis',
        '2',
        'Data',
        'fastq',
        'existing.fastq.gz',
      )
      makeFile(path)
      assert.equal(
        insertIfNew(await deriveRecord(path, '260101_NS123_0001_FLOW')),
        true,
      )
      db.prepare(`
        UPDATE files
           SET upload_requested = 1, upload_status = 'queued', first_seen_at = 'then'
         WHERE path = ?
      `).run(path)

      assert.deepEqual(await runScan(root), {
        added: 0,
        skipped: 1,
        missing: 0,
      })
      const runRow = getRunByFolder('260101_NS123_0001_FLOW')!
      const analysis = listAnalysesByRun(runRow.id)[0]!
      const file = getFilesForRun(runRow.id)[0]!
      assert.equal(file.analysis_id, analysis.id)
      assert.equal(file.upload_requested, 1)
      assert.equal(file.upload_status, 'queued')
      assert.equal(file.first_seen_at, 'then')
    })

    await t.test('preserves conflicting analysis ownership and continues indexing', async () => {
      const runFolder = '260101_NS123_0001_FLOW'
      const metadata = parseRunFolder(runFolder)!
      const runRow = upsertScannedRun({ run_folder: runFolder, ...metadata })
      const owner = upsertSourceAnalysis(runRow.id, 'owner')
      const targetDirectory = join(run, 'Analysis', 'target', 'Data', 'fastq')
      const conflictPath = join(targetDirectory, 'conflict.fastq.gz')
      const newPath = join(targetDirectory, 'new.fastq.gz')
      const siblingPath = join(
        run,
        'Analysis',
        'sibling',
        'Data',
        'fastq',
        'sibling.fastq.gz',
      )
      makeFile(conflictPath)
      makeFile(newPath)
      makeFile(siblingPath)
      assert.equal(
        insertFileRowIfNew(
          await deriveRecord(conflictPath, runFolder),
          runRow.id,
          owner.id,
          'then',
        ),
        true,
      )

      assert.deepEqual(await runScan(root), {
        added: 1,
        skipped: 2,
        missing: 0,
      })
      const target = listAnalysesByRun(runRow.id).find(
        (analysis) => analysis.analysis_folder === 'target',
      )!
      const sibling = listAnalysesByRun(runRow.id).find(
        (analysis) => analysis.analysis_folder === 'sibling',
      )!
      const files = new Map(
        getFilesForRun(runRow.id).map((file) => [file.path, file]),
      )
      assert.equal(target.status, 'blocked')
      assert.equal(sibling.status, 'indexed')
      assert.equal(files.get(conflictPath)?.analysis_id, owner.id)
      assert.equal(files.has(newPath), false)
      assert.equal(files.get(siblingPath)?.analysis_id, sibling.id)
    })

    await t.test('does not advance managed analyses before publication', async () => {
      const { upsertManagedRun } = await import('../../src/db/transfer')
      const runFolder = '260101_NS123_0001_FLOW'
      const managedRun = upsertManagedRun({
        runFolder,
        sourcePath: join(directory, 'source', runFolder),
        run_date: '2026-01-01',
        instrument: 'NS123',
        run_number: '0001',
        flowcell: 'FLOW',
      })
      const analysis = upsertSourceAnalysis(managedRun.id, 'managed')
      const path = join(
        run,
        'Analysis',
        'managed',
        'Data',
        'fastq',
        'managed.fastq.gz',
      )
      makeFile(path)

      assert.deepEqual(await runScan(root), {
        added: 0,
        skipped: 1,
        missing: 0,
      })
      assert.equal(getAnalysisById(analysis.id)?.status, 'running')
      assert.deepEqual(getFilesForRun(managedRun.id), [])
    })
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
