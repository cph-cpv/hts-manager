import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { publishDirectory } from '../../src/server/publish-directory'

test('directory publication refuses every existing destination without changing either tree', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'htsm-publication-'))
  try {
    for (const kind of ['empty directory', 'populated directory', 'file', 'dangling symlink']) {
      await t.test(kind, async () => {
        const stage = join(root, `stage ${kind}`)
        const destination = join(root, kind)
        mkdirSync(stage)
        writeFileSync(join(stage, 'data'), 'complete transfer')
        if (kind.includes('directory')) mkdirSync(destination)
        if (kind === 'populated directory') writeFileSync(join(destination, 'external'), 'keep')
        if (kind === 'file') writeFileSync(destination, 'keep')
        if (kind === 'dangling symlink') symlinkSync('missing', destination)
        const inode = lstatSync(destination).ino
        await assert.rejects(publishDirectory(stage, destination), { code: 'EEXIST' })
        assert.equal(lstatSync(destination).ino, inode)
        assert.equal(readFileSync(join(stage, 'data'), 'utf8'), 'complete transfer')
        if (kind === 'populated directory') assert.equal(readFileSync(join(destination, 'external'), 'utf8'), 'keep')
        if (kind === 'file') assert.equal(readFileSync(destination, 'utf8'), 'keep')
      })
    }
    await t.test('successful publication renames the complete directory', async () => {
      const stage = join(root, 'stage')
      const destination = join(root, 'published')
      mkdirSync(stage)
      writeFileSync(join(stage, 'data'), 'complete')
      const inode = lstatSync(stage).ino
      await publishDirectory(stage, destination)
      assert.equal(existsSync(stage), false)
      assert.equal(lstatSync(destination).ino, inode)
      assert.equal(readFileSync(join(destination, 'data'), 'utf8'), 'complete')
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
