// Integration test against real `git` — the worktree call is the part most
// likely to be wrong in a way unit tests can't see.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { allocateWorktree, isWorktreeDirty, pruneWorktree } from './worktree'

let root: string
let repo: string

function git(args: string[], cwd: string): void {
  const res = spawnSync('git', args, { cwd, encoding: 'utf-8' })
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wterm-board-'))
  repo = join(root, 'proj')
  spawnSync('mkdir', ['-p', repo])
  git(['init', '-b', 'main'], repo)
  git(['config', 'user.email', 'test@example.com'], repo)
  git(['config', 'user.name', 'Test'], repo)
  writeFileSync(join(repo, 'README.md'), '# proj\n')
  git(['add', '.'], repo)
  git(['commit', '-m', 'init'], repo)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('allocateWorktree', () => {
  it('creates a worktree on a new card branch', async () => {
    const result = await allocateWorktree(repo, 'proj', 42, '')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.allocation.branch).toBe('card/42')
    expect(result.allocation.worktreePath).toBe(join(root, 'proj-card-42'))
    expect(existsSync(join(root, 'proj-card-42', 'README.md'))).toBe(true)
  })

  it('honours a configured worktree root', async () => {
    const custom = join(root, 'trees')

    const result = await allocateWorktree(repo, 'proj', 7, custom)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.allocation.worktreePath).toBe(join(custom, 'proj-card-7'))
    expect(existsSync(join(custom, 'proj-card-7', 'README.md'))).toBe(true)
  })

  it('refuses rather than reusing an existing worktree path', async () => {
    await allocateWorktree(repo, 'proj', 42, '')

    const second = await allocateWorktree(repo, 'proj', 42, '')

    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.error).toContain('already exists')
  })

  it('reuses a leftover branch when its worktree was deleted', async () => {
    const first = await allocateWorktree(repo, 'proj', 5, '')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    // Delete the directory but leave the branch behind, as a manual `rm -rf` would.
    rmSync(first.allocation.worktreePath!, { recursive: true, force: true })
    git(['worktree', 'prune'], repo)

    const second = await allocateWorktree(repo, 'proj', 5, '')

    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.allocation.branch).toBe('card/5')
  })

  it('falls back to the project root for a non-git project', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'wterm-plain-'))

    const result = await allocateWorktree(plain, 'plain', 1, '')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.allocation.cwd).toBe(plain)
    expect(result.allocation.worktreePath).toBeNull()
    expect(result.allocation.note).toContain('not a git repo')
    rmSync(plain, { recursive: true, force: true })
  })
})

describe('isWorktreeDirty / pruneWorktree', () => {
  it('reports a clean worktree and removes it', async () => {
    const result = await allocateWorktree(repo, 'proj', 3, '')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const path = result.allocation.worktreePath as string

    expect(await isWorktreeDirty(path)).toBe(false)

    const pruned = await pruneWorktree(repo, path)

    expect(pruned.ok).toBe(true)
    expect(existsSync(path)).toBe(false)
  })

  it('reports a dirty worktree and refuses to remove it', async () => {
    const result = await allocateWorktree(repo, 'proj', 4, '')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const path = result.allocation.worktreePath as string
    writeFileSync(join(path, 'scratch.txt'), 'uncommitted work')

    expect(await isWorktreeDirty(path)).toBe(true)

    const pruned = await pruneWorktree(repo, path)

    expect(pruned.ok).toBe(false)
    expect(existsSync(path)).toBe(true)
  })
})
