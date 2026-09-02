import { describe, expect, test } from 'vitest'
import type { GitStatusEntry } from '@shared/types'
import { fileChangeFor, repoRelForPath } from './file-change-view'

function entry(partial: Partial<GitStatusEntry> & { path: string }): GitStatusEntry {
  return { index: null, worktree: null, conflict: false, ...partial }
}

describe('repoRelForPath', () => {
  test('returns the root repo when it is the only one', () => {
    // Arrange
    const repos = [{ rel: '' }]

    // Act
    const rel = repoRelForPath('src/a.ts', repos)

    // Assert
    expect(rel).toBe('')
  })

  test('prefers the deepest nested repo containing the file', () => {
    const repos = [{ rel: '' }, { rel: 'pkgs/web' }]

    expect(repoRelForPath('pkgs/web/src/a.ts', repos)).toBe('pkgs/web')
  })

  test('matches on path segments, not string prefix', () => {
    const repos = [{ rel: '' }, { rel: 'pkgs/web' }]

    // "pkgs/webby" must not be swallowed by the "pkgs/web" repo.
    expect(repoRelForPath('pkgs/webby/src/a.ts', repos)).toBe('')
  })

  test('returns null when no repo contains the file', () => {
    expect(repoRelForPath('src/a.ts', [{ rel: 'pkgs/web' }])).toBeNull()
  })

  test('returns null when the project has no repos', () => {
    expect(repoRelForPath('src/a.ts', [])).toBeNull()
  })
})

describe('fileChangeFor', () => {
  test('returns null for a file with no status entry', () => {
    expect(fileChangeFor([entry({ path: 'b.ts', worktree: 'modified' })], 'a.ts')).toBeNull()
  })

  test('reports an unstaged edit as modified', () => {
    const row = fileChangeFor([entry({ path: 'a.ts', worktree: 'modified' })], 'a.ts')

    expect(row).toEqual({ path: 'a.ts', status: 'modified', isUntracked: false })
  })

  test('collapses a staged-then-edited file to a single modified row', () => {
    // Both axes are set; against HEAD the file is simply modified.
    const row = fileChangeFor(
      [entry({ path: 'a.ts', index: 'modified', worktree: 'modified' })],
      'a.ts'
    )

    expect(row).toEqual({ path: 'a.ts', status: 'modified', isUntracked: false })
  })

  test('reports a conflicted file as modified', () => {
    const row = fileChangeFor([entry({ path: 'a.ts', conflict: true })], 'a.ts')

    expect(row).toEqual({ path: 'a.ts', status: 'modified', isUntracked: false })
  })

  test('flags an untracked file', () => {
    const row = fileChangeFor([entry({ path: 'a.ts', worktree: 'untracked' })], 'a.ts')

    expect(row).toEqual({ path: 'a.ts', status: 'untracked', isUntracked: true })
  })

  test('reports a staged new file as added', () => {
    const row = fileChangeFor([entry({ path: 'a.ts', index: 'added' })], 'a.ts')

    expect(row).toEqual({ path: 'a.ts', status: 'added', isUntracked: false })
  })

  test('a worktree delete outranks a staged add', () => {
    // Staged as new, then removed from disk — there is nothing on either side.
    const row = fileChangeFor([entry({ path: 'a.ts', index: 'added', worktree: 'deleted' })], 'a.ts')

    expect(row?.status).toBe('deleted')
  })

  test('carries oldPath through for a rename', () => {
    const row = fileChangeFor(
      [entry({ path: 'b.ts', oldPath: 'a.ts', index: 'renamed' })],
      'b.ts'
    )

    expect(row).toEqual({ path: 'b.ts', oldPath: 'a.ts', status: 'renamed', isUntracked: false })
  })
})
