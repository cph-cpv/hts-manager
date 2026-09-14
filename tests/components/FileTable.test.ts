import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FileTable } from '../../src/components/FileTable'
import type { FileWithRun, UploadStatus } from '../../src/db/files'

const columnVisibility = {
  instrument: false,
  flowcell: false,
  lane: false,
}

function fileForStatus(status: UploadStatus, uploaded = 0): FileWithRun {
  return {
    id: 1,
    run_id: 1,
    path: '/reads/sample.fastq.gz',
    name: 'sample.fastq.gz',
    size: 100,
    lane: 'L001',
    missing: 0,
    upload_requested: status === 'idle' ? 0 : 1,
    uploaded,
    upload_status: status,
    upload_error: status === 'error' ? 'Upload failed' : null,
    uploaded_at: uploaded ? '2026-09-01T00:00:00.000Z' : null,
    first_seen_at: '2026-09-01T00:00:00.000Z',
    last_scanned_at: '2026-09-01T00:00:00.000Z',
    run_date: '2026-09-01',
    run_folder: '260901_NS123_0001_FLOW',
    instrument: 'NS123',
    run_number: '0001',
    flowcell: 'FLOW',
  }
}

function renderFile(status: UploadStatus, uploaded = 0): string {
  return renderToStaticMarkup(
    createElement(FileTable, {
      files: [fileForStatus(status, uploaded)],
      onUpload: () => {},
      pendingId: null,
      columnVisibility,
    }),
  )
}

test('renders a fixed-width upload control for every upload state', () => {
  const cases: Array<{
    status: UploadStatus
    uploaded?: number
    label: string
    disabled: boolean
  }> = [
    { status: 'idle', label: 'Upload', disabled: false },
    { status: 'queued', label: 'Queued', disabled: true },
    { status: 'uploading', label: 'Uploading', disabled: true },
    { status: 'uploaded', uploaded: 1, label: 'Re-upload', disabled: false },
    { status: 'error', uploaded: 1, label: 'Retry', disabled: false },
  ]

  for (const { status, uploaded = 0, label, disabled } of cases) {
    const markup = renderFile(status, uploaded)
    assert.match(markup, new RegExp(`>${label}</button>`))
    assert.equal((markup.match(/\bw-28\b/g) ?? []).length, 1)
    assert.equal(markup.includes('disabled=""'), disabled)
  }
})

test('uses the outlined treatment for re-upload and retry actions', () => {
  const reupload = renderFile('uploaded', 1)
  assert.match(reupload, /border bg-background shadow-xs/)

  const retry = renderFile('error', 1)
  assert.match(retry, /border bg-background shadow-xs/)
  assert.match(retry, /title="Upload failed"/)
})
