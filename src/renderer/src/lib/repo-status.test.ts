import type { GitFileStatusMap, RepoRef } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { sliceStatusForRepo } from './repo-status'

const repos: RepoRef[] = [
  { rel: '', name: 'proj' },
  { rel: 'backend', name: 'backend' },
  { rel: 'frontend', name: 'frontend' },
]

const map = {
  'README.md': 'modified',
  'backend/src/api.ts': 'added',
  'backend/src/db.ts': 'modified',
  'frontend/app.tsx': 'untracked',
} as const

describe('sliceStatusForRepo', () => {
  it("root repo slice excludes child repos' paths", () => {
    expect(sliceStatusForRepo(map, repos, '')).toEqual([
      { path: 'README.md', projectPath: 'README.md', status: 'modified' },
    ])
  })

  it('child repo slice strips the repo prefix and sorts by path', () => {
    expect(sliceStatusForRepo(map, repos, 'backend')).toEqual([
      { path: 'src/api.ts', projectPath: 'backend/src/api.ts', status: 'added' },
      { path: 'src/db.ts', projectPath: 'backend/src/db.ts', status: 'modified' },
    ])
  })

  it('returns empty array for a clean repo', () => {
    expect(sliceStatusForRepo({}, repos, 'frontend')).toEqual([])
  })

  it('without child repos the root slice includes everything', () => {
    const only: RepoRef[] = [{ rel: '', name: 'proj' }]
    expect(sliceStatusForRepo(map, only, '')).toHaveLength(4)
  })

  it('does not swallow sibling paths whose name starts with a child repo name', () => {
    const withPrefixSibling: RepoRef[] = [
      { rel: '', name: 'proj' },
      { rel: 'front', name: 'front' },
    ]
    const m: GitFileStatusMap = {
      'frontend/x.ts': 'modified',
      'front/y.ts': 'added',
    }
    expect(sliceStatusForRepo(m, withPrefixSibling, '')).toEqual([
      { path: 'frontend/x.ts', projectPath: 'frontend/x.ts', status: 'modified' },
    ])
    expect(sliceStatusForRepo(m, withPrefixSibling, 'front')).toEqual([
      { path: 'y.ts', projectPath: 'front/y.ts', status: 'added' },
    ])
  })
})
