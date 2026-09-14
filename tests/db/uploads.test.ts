import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('supports per-file re-uploads without losing prior success', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'htsm-uploads-'))
  process.env.HTSM_DB_PATH = join(directory, 'hts-manager.db')

  const { getDb, migrateDatabase } = await import('../../src/db/db')
  const { getAggregateCounts } = await import('../../src/db/files')
  const {
    claimNext,
    markError,
    markUploaded,
    requestUpload,
    requestUploadForRun,
    setUploading,
  } = await import('../../src/db/uploads')

  migrateDatabase()
  const db = getDb()

  try {
    db.prepare(
      `INSERT INTO runs
         (id, run_folder, run_date, instrument, run_number, flowcell,
          first_seen_at, last_scanned_at)
       VALUES (1, '260901_NS123_0001_FLOW', '2026-09-01', 'NS123',
               '0001', 'FLOW', '2026-09-01T00:00:00.000Z',
               '2026-09-01T00:00:00.000Z')`,
    ).run()

    const insertFile = db.prepare(
      `INSERT INTO files
         (id, run_id, path, name, size, upload_requested, uploaded,
          upload_status, upload_error, uploaded_at, first_seen_at,
          last_scanned_at)
       VALUES
         (@id, 1, @path, @name, 100, @upload_requested, @uploaded,
          @upload_status, @upload_error, @uploaded_at, @first_seen_at,
          '2026-09-01T00:00:00.000Z')`,
    )

    insertFile.run({
      id: 1,
      path: '/reads/uploaded.fastq.gz',
      name: 'uploaded.fastq.gz',
      upload_requested: 1,
      uploaded: 1,
      upload_status: 'uploaded',
      upload_error: null,
      uploaded_at: '2026-09-01T00:00:00.000Z',
      first_seen_at: '2026-09-01T00:00:00.000Z',
    })
    insertFile.run({
      id: 2,
      path: '/reads/queued.fastq.gz',
      name: 'queued.fastq.gz',
      upload_requested: 1,
      uploaded: 0,
      upload_status: 'queued',
      upload_error: null,
      uploaded_at: null,
      first_seen_at: '2026-09-02T00:00:00.000Z',
    })
    insertFile.run({
      id: 3,
      path: '/reads/uploading.fastq.gz',
      name: 'uploading.fastq.gz',
      upload_requested: 1,
      uploaded: 0,
      upload_status: 'uploading',
      upload_error: null,
      uploaded_at: null,
      first_seen_at: '2026-09-03T00:00:00.000Z',
    })
    insertFile.run({
      id: 4,
      path: '/reads/idle.fastq.gz',
      name: 'idle.fastq.gz',
      upload_requested: 0,
      uploaded: 0,
      upload_status: 'idle',
      upload_error: null,
      uploaded_at: null,
      first_seen_at: '2026-09-04T00:00:00.000Z',
    })

    assert.equal(requestUpload(1), true)
    assert.deepEqual(
      db
        .prepare(
          `SELECT uploaded, upload_status, upload_error, uploaded_at
             FROM files WHERE id = 1`,
        )
        .get(),
      {
        uploaded: 1,
        upload_status: 'queued',
        upload_error: null,
        uploaded_at: '2026-09-01T00:00:00.000Z',
      },
    )
    assert.deepEqual(getAggregateCounts(), {
      total: 4,
      uploaded: 1,
      queued: 2,
      missing: 0,
      errors: 0,
    })

    assert.equal(requestUpload(1), false)
    assert.equal(requestUpload(2), false)
    assert.equal(requestUpload(3), false)
    assert.equal(requestUpload(999), false)

    markUploaded(2)
    markUploaded(3)
    assert.equal(claimNext()?.id, 1)

    setUploading(1)
    markError(1, 'second attempt failed')
    assert.equal(claimNext()?.id, 1)
    assert.deepEqual(
      db
        .prepare(
          `SELECT uploaded, upload_status, upload_error, uploaded_at
             FROM files WHERE id = 1`,
        )
        .get(),
      {
        uploaded: 1,
        upload_status: 'error',
        upload_error: 'second attempt failed',
        uploaded_at: '2026-09-01T00:00:00.000Z',
      },
    )

    assert.equal(requestUploadForRun(1), 1)
    assert.equal(
      db.prepare('SELECT upload_status FROM files WHERE id = 1').pluck().get(),
      'error',
    )

    markUploaded(1)
    const completed = db
      .prepare(
        `SELECT uploaded, upload_status, upload_error, uploaded_at
           FROM files WHERE id = 1`,
      )
      .get() as {
      uploaded: number
      upload_status: string
      upload_error: string | null
      uploaded_at: string | null
    }
    assert.equal(completed.uploaded, 1)
    assert.equal(completed.upload_status, 'uploaded')
    assert.equal(completed.upload_error, null)
    assert.notEqual(completed.uploaded_at, '2026-09-01T00:00:00.000Z')
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
