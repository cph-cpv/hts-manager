import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('discovery records analyses early and only accepts exact regular markers', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'htsm-discovery-'))
  const source = join(directory, 'source')
  const name = '260101_NS123_0001_FLOW'
  const runPath = join(source, name)
  mkdirSync(runPath, { recursive: true })
  process.env.HTSM_DB_PATH = join(directory, 'db.sqlite')
  process.env.HTSM_PIN = 'test'
  process.env.HTSM_SESSION_SECRET = 'secret'
  const { getDb, migrateDatabase } = await import('../../src/db/db')
  const { discoverSourceRuns } = await import('../../src/server/jobs/discovery')
  const { getRunByFolder } = await import('../../src/db/runs')
  const { listAnalysesByRun } = await import('../../src/db/analyses')
  migrateDatabase()
  const db = getDb()
  try {
    mkdirSync(join(runPath, 'Analysis', 'ready'), { recursive: true })
    writeFileSync(join(runPath, 'Analysis', 'ready', 'report.html'), 'done')
    mkdirSync(join(runPath, 'Analysis', 'unfinished'), { recursive: true })
    mkdirSync(join(runPath, 'Analysis', 'nested', 'nested'), { recursive: true })
    writeFileSync(join(runPath, 'Analysis', 'nested', 'nested', 'report.html'), 'no')
    mkdirSync(join(runPath, 'Analysis', 'directory', 'report.html'), { recursive: true })
    mkdirSync(join(runPath, 'Analysis', 'symlink'), { recursive: true })
    writeFileSync(join(runPath, 'target'), 'no')
    symlinkSync(join(runPath, 'target'), join(runPath, 'Analysis', 'symlink', 'report.html'))
    mkdirSync(join(runPath, 'Analysis', '.hidden'), { recursive: true })

    assert.deepEqual(await discoverSourceRuns(source), {
      added: 1, known: 0, manual: 0, skipped: 0,
    })
    const run = getRunByFolder(name)!
    assert.equal(run.status, 'running')
    assert.deepEqual(
      listAnalysesByRun(run.id).map(({ analysis_folder, status }) => ({ analysis_folder, status })),
      [
        { analysis_folder: 'directory', status: 'running' },
        { analysis_folder: 'nested', status: 'running' },
        { analysis_folder: 'ready', status: 'analysis_complete' },
        { analysis_folder: 'symlink', status: 'running' },
        { analysis_folder: 'unfinished', status: 'running' },
      ],
    )

    writeFileSync(join(runPath, 'CopyComplete.txt'), 'done')
    writeFileSync(join(runPath, 'Analysis', 'unfinished', 'report.html'), 'done')
    await discoverSourceRuns(source)
    assert.equal(getRunByFolder(name)?.status, 'run_complete')
    assert.equal(
      listAnalysesByRun(run.id).find((a) => a.analysis_folder === 'unfinished')?.status,
      'analysis_complete',
    )
    rmSync(join(runPath, 'Analysis', 'unfinished', 'report.html'))
    await discoverSourceRuns(source)
    assert.equal(
      listAnalysesByRun(run.id).find((a) => a.analysis_folder === 'unfinished')?.status,
      'analysis_complete',
    )
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
