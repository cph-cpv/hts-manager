import { lstat, rename } from 'node:fs/promises'

async function doesPathExist(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

/** Publish the verified staging directory without replacing an existing destination. */
export async function publishDirectory(staging: string, destination: string): Promise<void> {
  if (await doesPathExist(destination)) {
    throw Object.assign(new Error(`Cannot publish ${destination}: EEXIST`), { code: 'EEXIST' })
  }
  await rename(staging, destination)
}
