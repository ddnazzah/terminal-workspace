import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { getGitInfo } from './local'

const run = promisify(execFile)

describe('getGitInfo', () => {
  it('reports a fresh zero-commit repo as a repo with its unborn branch', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'wterm-unborn-'))
    try {
      await run('git', ['init', '-q'], { cwd: dir })
      const info = await getGitInfo(dir)
      expect(info.isRepo).toBe(true)
      expect(info.branch).toBeTruthy()
      expect(info.hasUpstream).toBe(false)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('still returns empty info for a non-repo directory', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'wterm-plain-'))
    try {
      expect((await getGitInfo(dir)).isRepo).toBe(false)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
