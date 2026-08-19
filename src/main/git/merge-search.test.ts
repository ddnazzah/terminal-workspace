import { describe, expect, test } from 'vitest'
import { mergeRepoHits } from './merge-search'
import type { SearchHit } from '@shared/types'

const hit = (path: string, line = 1): SearchHit => ({ path, line, column: 1, text: 'x' })

describe('mergeRepoHits', () => {
  test('prefixes hits with the repo path so they are project-relative', () => {
    const merged = mergeRepoHits([{ rel: 'packages/api', hits: [hit('src/a.ts')] }], 100)

    expect(merged.hits[0].path).toBe('packages/api/src/a.ts')
  })

  test('leaves paths alone for a repo at the project root', () => {
    const merged = mergeRepoHits([{ rel: '', hits: [hit('src/a.ts')] }], 100)

    expect(merged.hits[0].path).toBe('src/a.ts')
  })

  test('merges hits from several repos', () => {
    const merged = mergeRepoHits(
      [
        { rel: 'api', hits: [hit('a.ts')] },
        { rel: 'web', hits: [hit('b.ts')] },
      ],
      100
    )

    expect(merged.hits.map((h) => h.path)).toEqual(['api/a.ts', 'web/b.ts'])
  })

  test('preserves line and column while rewriting the path', () => {
    const merged = mergeRepoHits(
      [{ rel: 'api', hits: [{ path: 'a.ts', line: 7, column: 3, text: 'z' }] }],
      100
    )

    expect(merged.hits[0]).toMatchObject({ line: 7, column: 3, text: 'z' })
  })

  test('caps the total across repos, not per repo', () => {
    // Two repos of 3 hits each must respect a global cap of 4.
    const merged = mergeRepoHits(
      [
        { rel: 'a', hits: [hit('1'), hit('2'), hit('3')] },
        { rel: 'b', hits: [hit('4'), hit('5'), hit('6')] },
      ],
      4
    )

    expect(merged.hits).toHaveLength(4)
    expect(merged.truncated).toBe(true)
  })

  test('is not truncated when everything fits', () => {
    const merged = mergeRepoHits([{ rel: 'a', hits: [hit('1')] }], 100)

    expect(merged.truncated).toBe(false)
  })

  test('handles a repo with no hits', () => {
    const merged = mergeRepoHits(
      [
        { rel: 'a', hits: [] },
        { rel: 'b', hits: [hit('x.ts')] },
      ],
      100
    )

    expect(merged.hits.map((h) => h.path)).toEqual(['b/x.ts'])
  })

  test('returns empty for no repos', () => {
    expect(mergeRepoHits([], 100)).toEqual({ hits: [], truncated: false })
  })
})
