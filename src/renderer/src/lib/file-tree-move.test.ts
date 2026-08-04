import { describe, expect, test } from 'vitest'
import { dropFolderFor, planMove } from './file-tree-move'

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
