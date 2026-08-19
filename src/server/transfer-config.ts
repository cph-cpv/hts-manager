import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative } from 'node:path'
import { getConfig, readConfig } from './config'

export type TransferConfig = {
  enabled: boolean
  sourcePath: string | null
  destinationPath: string | null
  removeAfterDays: number | null
}

function requireDirectory(name: string, path: string): string {
  let stat
  try {
    stat = statSync(path)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`${name} must exist and be a directory: ${detail}`)
  }

  if (!stat.isDirectory()) throw new Error(`${name} must be a directory`)
  return realpathSync(path)
}

function isNestedPath(parent: string, child: string): boolean {
  const result = relative(parent, child)
  return result !== '' && !result.startsWith('..') && !isAbsolute(result)
}

/**
 * Resolve transfer settings and validate transfer-specific paths only when a
 * source is configured, so normal hts-manager boot remains unchanged.
 */
export function readTransferConfig(env?: NodeJS.ProcessEnv): TransferConfig {
  const config = env ? readConfig(env) : getConfig()
  const { sourcePath: configuredSourcePath, removeAfterDays } = config.transfer

  if (!configuredSourcePath) {
    if (removeAfterDays !== undefined) {
      throw new Error(
        'HTSM_TRANSFER_REMOVE_AFTER_DAYS requires HTSM_TRANSFER_SOURCE_PATH',
      )
    }
    return {
      enabled: false,
      sourcePath: null,
      destinationPath: config.scanPath ?? null,
      removeAfterDays: null,
    }
  }

  if (!isAbsolute(configuredSourcePath)) {
    throw new Error('HTSM_TRANSFER_SOURCE_PATH must be absolute')
  }

  const configuredDestinationPath = config.scanPath
  if (!configuredDestinationPath) {
    throw new Error('HTSM_SCAN_PATH is required when transfer source is set')
  }

  const sourcePath = requireDirectory(
    'HTSM_TRANSFER_SOURCE_PATH',
    configuredSourcePath,
  )
  const destinationPath = requireDirectory(
    'HTSM_SCAN_PATH',
    configuredDestinationPath,
  )

  if (sourcePath === destinationPath) {
    throw new Error('HTSM_TRANSFER_SOURCE_PATH and HTSM_SCAN_PATH must be distinct')
  }
  if (
    isNestedPath(sourcePath, destinationPath) ||
    isNestedPath(destinationPath, sourcePath)
  ) {
    throw new Error(
      'HTSM_TRANSFER_SOURCE_PATH and HTSM_SCAN_PATH must not be nested',
    )
  }

  return {
    enabled: true,
    sourcePath,
    destinationPath,
    removeAfterDays: removeAfterDays ?? null,
  }
}
