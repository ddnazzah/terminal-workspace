import { describe, expect, test } from 'vitest'
import { dropFolderFor, planMove, planMoves, topMostPaths } from './file-tree-move'

describe('dropFolderFor', () => {
  test('returns the folder itself when dropping onto a directory', () => {
    // Arrange
    const target = { name: 'src', path: 'src', isDirectory: true }

    // Act
    const folder = dropFolderFor(target)

    // Assert
    expect(folder).toBe('src')
  })

  test('returns the parent folder when dropping onto a file', () => {
    const target = { name: 'app.tsx', path: 'src/app.tsx', isDirectory: false }

    expect(dropFolderFor(target)).toBe('src')
  })

  test('returns the project root when dropping onto a top-level file', () => {
    const target = { name: 'README.md', path: 'README.md', isDirectory: false }

    expect(dropFolderFor(target)).toBe('')
  })

  test('returns the project root when dropping onto empty space', () => {
    expect(dropFolderFor(null)).toBe('')
  })
})

describe('planMove', () => {
  test('moves a file into a sibling folder', () => {
    // Arrange
    const source = 'src/app.tsx'

    // Act
    const plan = planMove(source, 'src/components')

    // Assert
    expect(plan).toEqual({ from: 'src/app.tsx', to: 'src/components/app.tsx' })
  })

  test('moves a file to the project root', () => {
    expect(planMove('src/app.tsx', '')).toEqual({
      from: 'src/app.tsx',
      to: 'app.tsx',
    })
  })

  test('moves a whole folder', () => {
    expect(planMove('src/lib', 'src/shared')).toEqual({
      from: 'src/lib',
      to: 'src/shared/lib',
    })
  })

  test('returns null when the file is already in the destination folder', () => {
    expect(planMove('src/app.tsx', 'src')).toBeNull()
  })

  test('returns null when dropping a folder onto itself', () => {
    expect(planMove('src/lib', 'src/lib')).toBeNull()
  })

  test('returns null when dropping a folder into its own descendant', () => {
    expect(planMove('src', 'src/components/nested')).toBeNull()
  })

  test('does not treat a sibling with a shared name prefix as a descendant', () => {
    // 'src-legacy' merely starts with 'src' — it is not inside it.
    expect(planMove('src', 'src-legacy')).toEqual({
      from: 'src',
      to: 'src-legacy/src',
    })
  })

  test('returns null for an empty source path (the project root)', () => {
    expect(planMove('', 'src')).toBeNull()
  })
})

describe('planMoves', () => {
  test('moves every selected entry into the destination', () => {
    // Arrange
    const sources = ['src/a.ts', 'src/b.ts']

    // Act
    const plans = planMoves(sources, 'src/lib')

    // Assert
    expect(plans).toEqual([
      { from: 'src/a.ts', to: 'src/lib/a.ts' },
      { from: 'src/b.ts', to: 'src/lib/b.ts' },
    ])
  })

  test('drops entries already inside the destination', () => {
    // 'src/lib/keep.ts' is already there, so only the outsider moves.
    expect(planMoves(['src/lib/keep.ts', 'src/move.ts'], 'src/lib')).toEqual([
      { from: 'src/move.ts', to: 'src/lib/move.ts' },
    ])
  })

  test('skips descendants when their ancestor is also selected', () => {
    // Dragging a folder and a file inside it should move the folder only —
    // the child travels with it, and moving it separately would be wrong.
    expect(planMoves(['src/lib', 'src/lib/util.ts'], 'dest')).toEqual([
      { from: 'src/lib', to: 'dest/lib' },
    ])
  })

  test('keeps a sibling that merely shares a name prefix', () => {
    expect(planMoves(['src', 'src-legacy'], 'dest')).toEqual([
      { from: 'src', to: 'dest/src' },
      { from: 'src-legacy', to: 'dest/src-legacy' },
    ])
  })

  test('returns an empty list when every move is invalid', () => {
    expect(planMoves(['src/lib'], 'src/lib/nested')).toEqual([])
  })

  test('returns an empty list for an empty selection', () => {
    expect(planMoves([], 'dest')).toEqual([])
  })
})

describe('topMostPaths', () => {
  test('keeps unrelated paths', () => {
    expect(topMostPaths(['src/a.ts', 'lib/b.ts'])).toEqual(['src/a.ts', 'lib/b.ts'])
  })

  test('drops a descendant when its ancestor is present', () => {
    expect(topMostPaths(['src', 'src/lib/util.ts'])).toEqual(['src'])
  })

  test('keeps a sibling sharing a name prefix', () => {
    expect(topMostPaths(['src', 'src-legacy'])).toEqual(['src', 'src-legacy'])
  })

  test('collapses a deep chain to its root', () => {
    expect(topMostPaths(['a', 'a/b', 'a/b/c'])).toEqual(['a'])
  })

  test('returns an empty list unchanged', () => {
    expect(topMostPaths([])).toEqual([])
  })
})
