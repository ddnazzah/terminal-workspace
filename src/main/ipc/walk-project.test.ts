import { describe, expect, test } from 'vitest'
import { parseLsFilesZ, shouldPruneDir } from './walk-project'

describe('parseLsFilesZ', () => {
  test('splits NUL-separated paths', () => {
    expect(parseLsFilesZ('a.ts\0src/b.ts\0')).toEqual(['a.ts', 'src/b.ts'])
  })

  test('returns an empty array for empty output', () => {
    expect(parseLsFilesZ('')).toEqual([])
  })

  test('drops empty segments', () => {
    expect(parseLsFilesZ('a.ts\0\0b.ts')).toEqual(['a.ts', 'b.ts'])
  })
})

describe('shouldPruneDir', () => {
  test('prunes node_modules', () => {
    expect(shouldPruneDir('node_modules')).toBe(true)
  })

  test('prunes dot-directories including .git', () => {
    expect(shouldPruneDir('.git')).toBe(true)
    expect(shouldPruneDir('.next')).toBe(true)
  })

  test('keeps normal directories', () => {
    expect(shouldPruneDir('src')).toBe(false)
    expect(shouldPruneDir('lib')).toBe(false)
  })
})
