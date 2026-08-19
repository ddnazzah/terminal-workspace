import { describe, expect, test } from 'vitest'
import type { GitFileStatusMap } from '@shared/types'
import { STATUS_BADGE, folderDecoration } from './git-decoration'

describe('STATUS_BADGE', () => {
  test('maps every status to its single-letter badge', () => {
    expect(STATUS_BADGE).toEqual({
      modified: 'M',
      added: 'A',
      deleted: 'D',
      untracked: 'U',
      conflict: 'C',
    })
  })
})

describe('folderDecoration', () => {
  test('returns undefined status and zero count for a clean folder', () => {
    // Arrange
    const map: GitFileStatusMap = { 'other/a.ts': 'modified' }

    // Act
    const decoration = folderDecoration('src', map)

    // Assert
    expect(decoration).toEqual({ status: undefined, count: 0 })
  })

  test('counts every changed descendant at any depth', () => {
    // Arrange
    const map: GitFileStatusMap = {
      'src/a.ts': 'modified',
      'src/deep/nested/b.ts': 'modified',
      'src/c.ts': 'untracked',
    }

    // Act
    const decoration = folderDecoration('src', map)

    // Assert
    expect(decoration.count).toBe(3)
  })

  test('reports the most severe descendant status', () => {
    // Arrange
    const map: GitFileStatusMap = {
      'src/a.ts': 'untracked',
      'src/b.ts': 'added',
      'src/c.ts': 'conflict',
    }

    // Act
    const decoration = folderDecoration('src', map)

    // Assert
    expect(decoration.status).toBe('conflict')
  })

  test('ranks modified above added and untracked', () => {
    // Arrange
    const map: GitFileStatusMap = {
      'src/a.ts': 'untracked',
      'src/b.ts': 'modified',
      'src/c.ts': 'added',
    }

    // Act
    const decoration = folderDecoration('src', map)

    // Assert
    expect(decoration.status).toBe('modified')
  })

  test('stays untracked when every descendant is untracked', () => {
    // Arrange
    const map: GitFileStatusMap = {
      'src/a.ts': 'untracked',
      'src/b.ts': 'untracked',
    }

    // Act
    const decoration = folderDecoration('src', map)

    // Assert
    expect(decoration).toEqual({ status: 'untracked', count: 2 })
  })

  test('does not match a sibling folder sharing the name prefix', () => {
    // Arrange
    const map: GitFileStatusMap = { 'src-legacy/a.ts': 'modified' }

    // Act
    const decoration = folderDecoration('src', map)

    // Assert
    expect(decoration).toEqual({ status: undefined, count: 0 })
  })

  test('does not count the folder path itself as a descendant', () => {
    // Arrange
    const map: GitFileStatusMap = { src: 'deleted' }

    // Act
    const decoration = folderDecoration('src', map)

    // Assert
    expect(decoration).toEqual({ status: undefined, count: 0 })
  })
})
