import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readConfig } from '../../src/server/config'
import { readTransferConfig } from '../../src/server/transfer-config'

test('uses the source path to enable managed transfer', () => {
  assert.deepEqual(readTransferConfig({}), {
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
      readTransferConfig({
        HTSM_TRANSFER_SOURCE_PATH: sourcePath,
        HTSM_SCAN_PATH: destinationPath,
      }),
      {
        enabled: true,
        sourcePath,
        destinationPath,
        removeAfterDays: null,
      },
    )
    assert.equal(
      readTransferConfig({
        HTSM_TRANSFER_SOURCE_PATH: sourcePath,
        HTSM_SCAN_PATH: destinationPath,
        HTSM_TRANSFER_REMOVE_AFTER_DAYS: '0',
      }).removeAfterDays,
      0,
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('treats removal retention as optional and accepts zero', () => {
  assert.equal(readConfig({}).transfer.removeAfterDays, undefined)
  assert.equal(
    readConfig({ HTSM_TRANSFER_REMOVE_AFTER_DAYS: '' }).transfer
      .removeAfterDays,
    undefined,
  )
  assert.equal(
    readConfig({ HTSM_TRANSFER_REMOVE_AFTER_DAYS: '0' }).transfer
      .removeAfterDays,
    0,
  )
  assert.equal(
    readConfig({ HTSM_TRANSFER_REMOVE_AFTER_DAYS: '14' }).transfer
      .removeAfterDays,
    14,
  )
})

test('rejects invalid source-removal retention values', () => {
  for (const value of ['-1', '1.5', 'not-a-number']) {
    assert.throws(
      () => readConfig({ HTSM_TRANSFER_REMOVE_AFTER_DAYS: value }),
      /HTSM_TRANSFER_REMOVE_AFTER_DAYS/,
    )
  }
})

test('rejects source-removal retention without a transfer source', () => {
  assert.throws(
    () => readTransferConfig({ HTSM_TRANSFER_REMOVE_AFTER_DAYS: '7' }),
    /HTSM_TRANSFER_REMOVE_AFTER_DAYS requires HTSM_TRANSFER_SOURCE_PATH/,
  )
})
