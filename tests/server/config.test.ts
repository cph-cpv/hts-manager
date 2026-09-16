import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ZodError } from 'zod'
import { readConfig } from '../../src/server/config'

const auth = {
  HTSM_PIN: 'test',
  HTSM_SESSION_SECRET: 'test-session-secret',
}

function readTestConfig(env: NodeJS.ProcessEnv = {}) {
  return readConfig({ ...auth, ...env })
}

test('requires the PIN and session secret', () => {
  for (const name of ['HTSM_PIN', 'HTSM_SESSION_SECRET'] as const) {
    for (const value of [undefined, '', '   ']) {
      assert.throws(
        () => readConfig({ ...auth, [name]: value }),
        (error) =>
          error instanceof ZodError &&
          error.issues.some(
            (issue) =>
              issue.path.join('.') === name &&
              issue.message === `${name} is required`,
          ),
      )
    }
  }
})

test('uses the direct Virtool upload endpoint and supported upload types', () => {
  assert.equal(
    readTestConfig().upload.url,
    'https://preview.virtool.ca/api/v1/uploads',
  )
  for (const type of ['reference', 'reads', 'subtraction']) {
    assert.equal(readTestConfig({ VT_UPLOAD_FILE_TYPE: type }).upload.type, type)
  }
  assert.throws(
    () => readTestConfig({ VT_UPLOAD_FILE_TYPE: 'unknown' }),
    /VT_UPLOAD_FILE_TYPE/,
  )
})

test('uses the source path to enable managed transfer', () => {
  assert.deepEqual(readTestConfig().transfer, {
    enabled: false,
    sourcePath: null,
    destinationPath: null,
    removeAfterDays: null,
  })

  const directory = mkdtempSync(join(tmpdir(), 'htsm-transfer-config-'))
  const sourcePath = join(directory, 'source')
  const destinationPath = join(directory, 'destination')
  mkdirSync(sourcePath)
  mkdirSync(destinationPath)

  try {
    assert.deepEqual(
      readTestConfig({
        HTSM_TRANSFER_SOURCE_PATH: sourcePath,
        HTSM_SCAN_PATH: destinationPath,
      }).transfer,
      {
        enabled: true,
        sourcePath,
        destinationPath,
        removeAfterDays: null,
      },
    )
    assert.equal(
      readTestConfig({
        HTSM_TRANSFER_SOURCE_PATH: sourcePath,
        HTSM_SCAN_PATH: destinationPath,
        HTSM_TRANSFER_REMOVE_AFTER_DAYS: '0',
      }).transfer.removeAfterDays,
      0,
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('normalizes omitted removal retention to null', () => {
  assert.equal(readTestConfig().transfer.removeAfterDays, null)
})

test('enables FASTQ symlink reconciliation with an absolute destination', () => {
  assert.deepEqual(readTestConfig().fastqLinks, {
    enabled: false,
    sourcePath: null,
    destinationPath: null,
  })

  const directory = mkdtempSync(join(tmpdir(), 'htsm-fastq-link-config-'))
  const sourcePath = join(directory, 'illumina')
  const destinationPath = join(directory, 'fastq')
  mkdirSync(sourcePath)

  try {
    assert.deepEqual(
      readTestConfig({
        HTSM_SCAN_PATH: sourcePath,
        HTSM_FASTQ_SYMLINK_PATH: destinationPath,
      }).fastqLinks,
      {
        enabled: true,
        sourcePath,
        destinationPath,
      },
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('rejects invalid FASTQ symlink source and destination combinations', () => {
  const directory = mkdtempSync(join(tmpdir(), 'htsm-fastq-link-config-'))
  const sourcePath = join(directory, 'illumina')
  mkdirSync(sourcePath)

  try {
    assert.throws(
      () => readTestConfig({ HTSM_FASTQ_SYMLINK_PATH: '/mnt/raw/fastq' }),
      /HTSM_SCAN_PATH is required when HTSM_FASTQ_SYMLINK_PATH is set/,
    )
    assert.throws(
      () =>
        readTestConfig({
          HTSM_SCAN_PATH: sourcePath,
          HTSM_FASTQ_SYMLINK_PATH: 'relative/fastq',
        }),
      /HTSM_FASTQ_SYMLINK_PATH must be absolute/,
    )
    assert.throws(
      () =>
        readTestConfig({
          HTSM_SCAN_PATH: sourcePath,
          HTSM_FASTQ_SYMLINK_PATH: join(sourcePath, 'fastq'),
        }),
      /must be distinct and not nested/,
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('rejects invalid source-removal retention values', () => {
  for (const value of ['-1', '1.5', 'not-a-number']) {
    assert.throws(
      () => readTestConfig({ HTSM_TRANSFER_REMOVE_AFTER_DAYS: value }),
      /HTSM_TRANSFER_REMOVE_AFTER_DAYS/,
    )
  }
})

test('reports cross-field transfer errors through Zod', () => {
  assert.throws(
    () => readTestConfig({ HTSM_TRANSFER_REMOVE_AFTER_DAYS: '7' }),
    (error) =>
      error instanceof ZodError &&
      error.issues.some(
        (issue) =>
          issue.path.join('.') === 'HTSM_TRANSFER_REMOVE_AFTER_DAYS' &&
          issue.message ===
            'HTSM_TRANSFER_REMOVE_AFTER_DAYS requires HTSM_TRANSFER_SOURCE_PATH',
      ),
  )
})
