import { describe, expect, test } from 'vitest'
import { fuzzyMatch, rankFiles } from './fuzzy-match'

describe('fuzzyMatch', () => {
  test('returns empty match for an empty query', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, matchedIndices: [] })
  })

  test('returns null when a query char is absent', () => {
    expect(fuzzyMatch('abc', 'xyz')).toBeNull()
  })

  test('returns null when chars are present but out of order', () => {
    expect(fuzzyMatch('ba', 'abc')).toBeNull()
  })

  test('matches a subsequence and reports indices', () => {
    const result = fuzzyMatch('abc', 'aXbXc')
    expect(result).not.toBeNull()
    expect(result?.matchedIndices).toEqual([0, 2, 4])
  })

  test('is case-insensitive', () => {
    const result = fuzzyMatch('AB', 'ab')
    expect(result?.matchedIndices).toEqual([0, 1])
  })

  test('returns null when the query is longer than the target', () => {
    expect(fuzzyMatch('abcde', 'abc')).toBeNull()
  })

  test('returns null for an empty target', () => {
    expect(fuzzyMatch('a', '')).toBeNull()
  })

  test('reports code-point indices, not UTF-16 offsets, after an astral char', () => {
    // '😀' is one code point (two UTF-16 units); the 'a' after it is index 1,
    // so highlighting (which iterates code points) lines up.
    expect(fuzzyMatch('a', '😀a')?.matchedIndices).toEqual([1])
  })

  test('scores a consecutive run higher than a scattered one', () => {
    const consecutive = fuzzyMatch('app', 'app.tsx')
    const scattered = fuzzyMatch('app', 'a_p_p.tsx')
    expect(consecutive).not.toBeNull()
    expect(scattered).not.toBeNull()
    expect(consecutive!.score).toBeGreaterThan(scattered!.score)
  })
})

describe('rankFiles', () => {
  test('returns the first N paths for an empty query', () => {
    const files = ['a.ts', 'b.ts', 'c.ts']
    const ranked = rankFiles('', files)
    expect(ranked.map((r) => r.path)).toEqual(['a.ts', 'b.ts', 'c.ts'])
    expect(ranked[0]!.matchedIndices).toEqual([])
  })

  test('drops files that do not match', () => {
    const ranked = rankFiles('zzz', ['app.ts', 'main.ts'])
    expect(ranked).toEqual([])
  })

  test('ranks a basename match above a path-only match', () => {
    const files = ['src/quick/other.ts', 'app.ts']
    const ranked = rankFiles('app', files)
    expect(ranked[0]!.path).toBe('app.ts')
  })

  test('reports matched indices relative to the basename', () => {
    const ranked = rankFiles('app', ['src/deep/app.ts'])
    expect(ranked[0]!.matchedIndices).toEqual([0, 1, 2])
  })

  test('caps results at 50', () => {
    const files = Array.from({ length: 100 }, (_, i) => `file${i}app.ts`)
    const ranked = rankFiles('app', files)
    expect(ranked.length).toBe(50)
  })
})
