import { describe, expect, test } from 'vitest'
import type { GitChangeRow } from './git-groups'
import { diffSidesFor } from './git-diff-sides'

function row(over: Partial<GitChangeRow> & { path: string }): GitChangeRow {
  return { status: 'modified', isUntracked: false, ...over }
}

describe('diffSidesFor — staged group', () => {
  test('compares HEAD against the index', () => {
    // Staging answers "what will this commit change?", so the base is HEAD.
    const sides = diffSidesFor(row({ path: 'a.ts' }), 'staged')

    expect(sides).toEqual({ left: 'HEAD', right: 'index', leftLabel: 'HEAD', rightLabel: 'Index' })
  })

  test('a staged add has no HEAD side', () => {
    // The file does not exist in HEAD, so the left pane must be empty rather
    // than falling back to the working copy and showing a no-op diff.
    expect(diffSidesFor(row({ path: 'new.ts', status: 'added' }), 'staged').left).toBeNull()
  })

  test('a staged delete still has a HEAD side to show what is going away', () => {
    expect(diffSidesFor(row({ path: 'gone.ts', status: 'deleted' }), 'staged')).toMatchObject({
      left: 'HEAD',
      right: 'index',
    })
  })
})

describe('diffSidesFor — changes group', () => {
  test('compares the index against the working tree', () => {
    expect(diffSidesFor(row({ path: 'a.ts' }), 'changes')).toEqual({
      left: 'index',
      right: 'worktree',
      leftLabel: 'Index',
      rightLabel: 'Working Tree',
    })
  })

  test('an untracked file has no left side', () => {
    // Nothing to compare against — the whole file is new.
    const sides = diffSidesFor(row({ path: 'new.ts', status: 'untracked', isUntracked: true }), 'changes')

    expect(sides.left).toBeNull()
    expect(sides.right).toBe('worktree')
  })

  test('an unstaged delete has an empty right side', () => {
    // The file is gone from disk, so the right pane is empty rather than
    // erroring on a missing read.
    expect(diffSidesFor(row({ path: 'gone.ts', status: 'deleted' }), 'changes')).toMatchObject({
      left: 'index',
      right: null,
    })
  })
})

describe('diffSidesFor — merge group', () => {
  test('compares HEAD against the working tree for a conflict', () => {
    expect(diffSidesFor(row({ path: 'clash.ts' }), 'merge')).toMatchObject({
      left: 'HEAD',
      right: 'worktree',
    })
  })
})
