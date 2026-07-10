import type { RepoRef } from '@shared/types'
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
})
