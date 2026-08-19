import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative } from 'node:path'
import { getConfig, readConfig } from './config'

export type TransferConfig = {
  enabled: boolean
  sourcePath: string | null
  destinationPath: string | null
  quietMinutes: number
  pollSeconds: number
  removeSourceEnabled: boolean
  removeAfterDays: number
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
 * Resolve transfer settings and validate transfer-specific paths only when
 * transfer is enabled, so normal hts-manager boot remains unchanged.
 */
export function readTransferConfig(env?: NodeJS.ProcessEnv): TransferConfig {
  const config = env ? readConfig(env) : getConfig()
  const {
    enabled,
    sourcePath: configuredSourcePath,
    quietMinutes,
    pollSeconds,
    removeSourceEnabled,
    removeAfterDays,
  } = config.transfer

  if (!enabled) {
    return {
      enabled,
      sourcePath: null,
      destinationPath: config.scanPath ?? null,
      quietMinutes,
      pollSeconds,
      removeSourceEnabled,
      removeAfterDays,
    }
  }

  if (!configuredSourcePath) {
    throw new Error(
      'HTSM_TRANSFER_SOURCE_PATH is required when HTSM_TRANSFER_ENABLED is true',
    )
  }
  if (!isAbsolute(configuredSourcePath)) {
    throw new Error('HTSM_TRANSFER_SOURCE_PATH must be absolute')
  }

  const configuredDestinationPath = config.scanPath
  if (!configuredDestinationPath) {
    throw new Error('HTSM_SCAN_PATH is required when transfer is enabled')
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
    enabled,
    sourcePath,
    destinationPath,
    quietMinutes,
    pollSeconds,
    removeSourceEnabled,
    removeAfterDays,
  }
}
