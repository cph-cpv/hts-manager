import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('enforces independent run and analysis lifecycles and job eligibility', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'htsm-transfer-'))
  process.env.HTSM_DB_PATH = join(directory, 'db.sqlite')
  process.env.HTSM_PIN = 'test'
  process.env.HTSM_SESSION_SECRET = 'secret'
  const { getDb, migrateDatabase } = await import('../../src/db/db')
  const {
    markRunBlocked,
    markRunComplete,
    markRunSourceDeleted,
    markRunTransferred,
    recoverBlockedRun,
    transitionRunStatus,
    upsertManagedRun,
  } = await import('../../src/db/transfer')
  const {
    getAnalysisById,
    listAnalysesByRun,
    markAnalysisBlocked,
    markAnalysisComplete,
    markAnalysisTransferred,
    queueAnalysisCopyJob,
    transitionAnalysisStatus,
    upsertSourceAnalysis,
  } = await import('../../src/db/analyses')
  const { getRunState } = await import('../../src/db/runs')
  const { claimJob, updateJobState } = await import('../../src/db/jobs')
  migrateDatabase()
  const db = getDb()
  try {
    const run = upsertManagedRun({
      runFolder: '260101_NS123_0001_FLOW',
      sourcePath: '/source/260101_NS123_0001_FLOW',
      run_date: '2026-01-01',
      instrument: 'NS123',
      run_number: '0001',
      flowcell: 'FLOW',
    })
    assert.equal(run.status, 'sequencing')
    assert.throws(() => markRunTransferred(run.id), /cannot transition/)
    markRunComplete(run.id)
    markRunBlocked(run.id)
    recoverBlockedRun(run.id)
    markRunTransferred(run.id)
    assert.throws(() => transitionRunStatus(run.id, 'processing'), /cannot transition/)

    const analysis = upsertSourceAnalysis(run.id, 'analysis-1')
    assert.equal(upsertSourceAnalysis(run.id, 'analysis-1').id, analysis.id)
    assert.throws(() => queueAnalysisCopyJob(analysis.id), /eligible analysis/)
    markAnalysisComplete(analysis.id)
    const queued = queueAnalysisCopyJob(analysis.id)
    assert.equal(queued.target_type, 'analysis')
    assert.equal(queueAnalysisCopyJob(analysis.id).id, queued.id)
    assert.equal(getRunState(run.id)?.active_transfer_count, 1)
    assert.equal(listAnalysesByRun(run.id)[0]?.display_status, 'Processing')
    const running = claimJob(['copy-analysis'])!
    updateJobState(running.id, 'error', 'destination conflict')
    markAnalysisBlocked(analysis.id)
    assert.equal(listAnalysesByRun(run.id)[0]?.last_blocking_reason, 'destination conflict')
    assert.equal(getRunState(run.id)?.blocked_analysis_count, 1)
    assert.equal(getRunState(run.id)?.last_blocking_reason, 'destination conflict')

    transitionAnalysisStatus(analysis.id, 'analysis_complete')
    markAnalysisTransferred(analysis.id)
    transitionAnalysisStatus(analysis.id, 'indexed')
    assert.equal(getAnalysisById(analysis.id)?.status, 'indexed')
    assert.equal(getRunState(run.id)?.indexed_analysis_count, 1)
    assert.throws(() => markAnalysisComplete(analysis.id), /cannot transition/)
    markRunSourceDeleted(run.id)
    assert.equal(getRunState(run.id)?.status, 'source_deleted')
    assert.deepEqual(db.pragma('foreign_key_check'), [])
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
