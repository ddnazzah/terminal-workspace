import { describe, expect, test } from 'vitest'
import type { GitStatusEntry } from '@shared/types'
import { groupChanges, statusLetter } from './git-groups'

function entry(over: Partial<GitStatusEntry> & { path: string }): GitStatusEntry {
  return { index: null, worktree: null, conflict: false, ...over }
}

describe('groupChanges', () => {
  test('splits staged and unstaged into their own groups', () => {
    // Arrange
    const entries = [
      entry({ path: 'staged.ts', index: 'modified' }),
      entry({ path: 'dirty.ts', worktree: 'modified' }),
    ]

    // Act
    const groups = groupChanges(entries)

    // Assert
    expect(groups.staged.map((c) => c.path)).toEqual(['staged.ts'])
    expect(groups.changes.map((c) => c.path)).toEqual(['dirty.ts'])
    expect(groups.merge).toEqual([])
  })

  test('lists a staged-then-edited file in BOTH groups', () => {
    const groups = groupChanges([
      entry({ path: 'both.ts', index: 'modified', worktree: 'modified' }),
    ])

    expect(groups.staged.map((c) => c.path)).toEqual(['both.ts'])
    expect(groups.changes.map((c) => c.path)).toEqual(['both.ts'])
  })

  test('each group carries the status for its own axis', () => {
    const groups = groupChanges([
      entry({ path: 'a.ts', index: 'added', worktree: 'deleted' }),
    ])

    expect(groups.staged[0].status).toBe('added')
    expect(groups.changes[0].status).toBe('deleted')
  })

  test('conflicts go to merge only, never to staged or changes', () => {
    const groups = groupChanges([entry({ path: 'clash.ts', conflict: true })])

    expect(groups.merge.map((c) => c.path)).toEqual(['clash.ts'])
    expect(groups.staged).toEqual([])
    expect(groups.changes).toEqual([])
  })

  test('marks untracked entries so discard can delete rather than restore', () => {
    const groups = groupChanges([entry({ path: 'new.ts', worktree: 'untracked' })])

    expect(groups.changes[0].isUntracked).toBe(true)
  })

  test('tracked changes are not marked untracked', () => {
    const groups = groupChanges([entry({ path: 'a.ts', worktree: 'modified' })])

    expect(groups.changes[0].isUntracked).toBe(false)
  })

  test('carries the previous path through for renames', () => {
    const groups = groupChanges([
      entry({ path: 'new.ts', oldPath: 'old.ts', index: 'renamed' }),
    ])

    expect(groups.staged[0].oldPath).toBe('old.ts')
  })

  test('returns empty groups for a clean tree', () => {
    expect(groupChanges([])).toEqual({ merge: [], staged: [], changes: [] })
  })
})

describe('statusLetter', () => {
  test('uses git’s single-letter codes', () => {
    expect(statusLetter('modified')).toBe('M')
    expect(statusLetter('added')).toBe('A')
    expect(statusLetter('deleted')).toBe('D')
    expect(statusLetter('renamed')).toBe('R')
    expect(statusLetter('untracked')).toBe('U')
  })
})
