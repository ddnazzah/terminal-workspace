import { describe, expect, it } from 'vitest'
import { mergeStatusMaps } from './workspace'

describe('mergeStatusMaps', () => {
  it('returns empty map for no repos', () => {
    expect(mergeStatusMaps([])).toEqual({})
  })

  it('passes root repo paths through unchanged', () => {
    expect(
      mergeStatusMaps([{ rel: '', map: { 'src/a.ts': 'modified' } }])
    ).toEqual({ 'src/a.ts': 'modified' })
  })

  it('prefixes child repo paths with the repo rel', () => {
    expect(
      mergeStatusMaps([
        { rel: 'backend', map: { 'src/api.ts': 'added' } },
        { rel: 'frontend', map: { 'app.tsx': 'untracked' } },
      ])
    ).toEqual({
      'backend/src/api.ts': 'added',
      'frontend/app.tsx': 'untracked',
    })
  })

  it("drops the root repo's entries for nested child repos", () => {
    // git reports a nested repo as a single untracked dir entry "frontend/"
    expect(
      mergeStatusMaps([
        { rel: '', map: { 'frontend/': 'untracked', 'README.md': 'modified' } },
        { rel: 'frontend', map: { 'app.tsx': 'modified' } },
      ])
    ).toEqual({
      'README.md': 'modified',
      'frontend/app.tsx': 'modified',
    })
  })

  it('drops nested repo dir entries without trailing slash too', () => {
    expect(
      mergeStatusMaps([
        { rel: '', map: { frontend: 'untracked' } },
        { rel: 'frontend', map: {} },
      ])
    ).toEqual({})
  })
})
