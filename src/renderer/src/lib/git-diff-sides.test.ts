import { describe, expect, test } from 'vitest'
import type { GitChangeRow } from './git-groups'
import { diffSidesFor, fileDiffSides } from './git-diff-sides'

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

describe('fileDiffSides — the whole-file view behind an editor tab', () => {
  test('compares HEAD against the working tree', () => {
    // The file tab asks "what has changed in this file since the last commit?",
    // which is one answer regardless of what happens to be staged.
    const sides = fileDiffSides(row({ path: 'a.ts' }))

    expect(sides).toEqual({
      left: 'HEAD',
      right: 'worktree',
      leftLabel: 'HEAD',
      rightLabel: 'Working Tree',
    })
  })

  test('an untracked file has no HEAD side', () => {
    const sides = fileDiffSides(row({ path: 'a.ts', status: 'untracked', isUntracked: true }))

    expect(sides.left).toBeNull()
    expect(sides.right).toBe('worktree')
  })

  test('a file added since HEAD has no HEAD side', () => {
    const sides = fileDiffSides(row({ path: 'a.ts', status: 'added' }))

    expect(sides.left).toBeNull()
    expect(sides.right).toBe('worktree')
  })

  test('a deleted file has no working-tree side', () => {
    const sides = fileDiffSides(row({ path: 'a.ts', status: 'deleted' }))

    expect(sides.left).toBe('HEAD')
    expect(sides.right).toBeNull()
  })

  test('a rename still compares HEAD against the working tree', () => {
    const sides = fileDiffSides(row({ path: 'b.ts', oldPath: 'a.ts', status: 'renamed' }))

    expect(sides.left).toBe('HEAD')
    expect(sides.right).toBe('worktree')
  })
})
