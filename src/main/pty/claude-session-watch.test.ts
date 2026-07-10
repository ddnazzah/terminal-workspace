import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeProjectSlug, sniffSessionId } from './claude-session-watch'

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'

function makeProjectDir(cwd: string): { baseDir: string; dir: string } {
  const baseDir = mkdtempSync(join(tmpdir(), 'tw-watch-'))
  const dir = join(baseDir, claudeProjectSlug(cwd))
  mkdirSync(dir, { recursive: true })
  return { baseDir, dir }
}

describe('claudeProjectSlug', () => {
  it('replaces every non-alphanumeric byte with a dash', () => {
    expect(claudeProjectSlug('/Users/me/Workspace/my.app_x')).toBe(
      '-Users-me-Workspace-my-app-x'
    )
  })
})

describe('sniffSessionId', () => {
  it('finds a session file created after launch', async () => {
    const cwd = '/tmp/proj'
    const { baseDir, dir } = makeProjectDir(cwd)
    const sinceMs = Date.now() - 50
    writeFileSync(join(dir, `${UUID_A}.jsonl`), '{}')
    const id = await sniffSessionId(cwd, {
      baseDir,
      sinceMs,
      mode: 'created',
      intervalMs: 10,
      maxWaitMs: 500,
      isActive: () => true,
      claimed: new Set(),
    })
    expect(id).toBe(UUID_A)
  })

  it('ignores files already claimed by another tab', async () => {
    const cwd = '/tmp/proj'
    const { baseDir, dir } = makeProjectDir(cwd)
    const sinceMs = Date.now() - 50
    writeFileSync(join(dir, `${UUID_A}.jsonl`), '{}')
    writeFileSync(join(dir, `${UUID_B}.jsonl`), '{}')
    const claimed = new Set([join(dir, `${UUID_A}.jsonl`)])
    const id = await sniffSessionId(cwd, {
      baseDir,
      sinceMs,
      mode: 'created',
      intervalMs: 10,
      maxWaitMs: 500,
      isActive: () => true,
      claimed,
    })
    expect(id).toBe(UUID_B)
    expect(claimed.has(join(dir, `${UUID_B}.jsonl`))).toBe(true)
  })

  it('ignores pre-existing session files in created mode', async () => {
    const cwd = '/tmp/proj'
    const { baseDir, dir } = makeProjectDir(cwd)
    writeFileSync(join(dir, `${UUID_A}.jsonl`), '{}')
    // Launch "happens" well after the file existed.
    const sinceMs = Date.now() + 60_000
    const id = await sniffSessionId(cwd, {
      baseDir,
      sinceMs,
      mode: 'created',
      intervalMs: 10,
      maxWaitMs: 100,
      isActive: () => true,
      claimed: new Set(),
    })
    expect(id).toBeNull()
  })

  it('picks the most recently modified file in modified mode', async () => {
    const cwd = '/tmp/proj'
    const { baseDir, dir } = makeProjectDir(cwd)
    const sinceMs = Date.now() - 50
    writeFileSync(join(dir, `${UUID_A}.jsonl`), '{}')
    await new Promise((r) => setTimeout(r, 20))
    writeFileSync(join(dir, `${UUID_B}.jsonl`), '{}')
    const id = await sniffSessionId(cwd, {
      baseDir,
      sinceMs,
      mode: 'modified',
      intervalMs: 10,
      maxWaitMs: 500,
      isActive: () => true,
      claimed: new Set(),
    })
    expect(id).toBe(UUID_B)
  })

  it('stops when the watch is no longer active', async () => {
    const cwd = '/tmp/proj'
    const { baseDir } = makeProjectDir(cwd)
    const id = await sniffSessionId(cwd, {
      baseDir,
      sinceMs: Date.now(),
      mode: 'created',
      intervalMs: 10,
      maxWaitMs: 10_000,
      isActive: () => false,
      claimed: new Set(),
    })
    expect(id).toBeNull()
  })

  it('skips non-session files', async () => {
    const cwd = '/tmp/proj'
    const { baseDir, dir } = makeProjectDir(cwd)
    const sinceMs = Date.now() - 50
    writeFileSync(join(dir, 'notes.txt'), 'x')
    writeFileSync(join(dir, 'not-a-uuid.jsonl'), '{}')
    const id = await sniffSessionId(cwd, {
      baseDir,
      sinceMs,
      mode: 'created',
      intervalMs: 10,
      maxWaitMs: 100,
      isActive: () => true,
      claimed: new Set(),
    })
    expect(id).toBeNull()
  })
})
