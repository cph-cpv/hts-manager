import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ZodError } from 'zod'
import { readConfig } from '../../src/server/config'

test('uses the source path to enable managed transfer', () => {
  assert.deepEqual(readConfig({}).transfer, {
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
      readConfig({
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
      readConfig({
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
  assert.equal(readConfig({}).transfer.removeAfterDays, null)
})

test('rejects invalid source-removal retention values', () => {
  for (const value of ['-1', '1.5', 'not-a-number']) {
    assert.throws(
      () => readConfig({ HTSM_TRANSFER_REMOVE_AFTER_DAYS: value }),
      /HTSM_TRANSFER_REMOVE_AFTER_DAYS/,
    )
  }
})

test('reports cross-field transfer errors through Zod', () => {
  assert.throws(
    () => readConfig({ HTSM_TRANSFER_REMOVE_AFTER_DAYS: '7' }),
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
