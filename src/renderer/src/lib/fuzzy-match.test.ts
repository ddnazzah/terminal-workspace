import { describe, expect, test } from 'vitest'
import { fuzzyMatch } from './fuzzy-match'

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

  test('scores a consecutive run higher than a scattered one', () => {
    const consecutive = fuzzyMatch('app', 'app.tsx')
    const scattered = fuzzyMatch('app', 'a_p_p.tsx')
    expect(consecutive).not.toBeNull()
    expect(scattered).not.toBeNull()
    expect(consecutive!.score).toBeGreaterThan(scattered!.score)
  })
})
