import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { listRepos, mergeStatusMaps } from './workspace'

const run = promisify(execFile)

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

  it('drops root repo entries for files inside a child repo', () => {
    // a subfolder carved out into its own repo but still tracked by the
    // parent: the parent lists per-file paths under it — the child wins
    expect(
      mergeStatusMaps([
        { rel: '', map: { 'frontend/app.tsx': 'deleted', 'README.md': 'modified' } },
        { rel: 'frontend', map: { 'app.tsx': 'modified' } },
      ])
    ).toEqual({
      'README.md': 'modified',
      'frontend/app.tsx': 'modified',
    })
  })

  it('drops stale root entries under a child repo even when the child map is empty', () => {
    expect(
      mergeStatusMaps([
        { rel: '', map: { 'frontend/stale.ts': 'modified' } },
        { rel: 'frontend', map: {} },
      ])
    ).toEqual({})
  })
})

describe('listRepos', () => {
  it('falls back to git for a project folder nested inside a repo', async () => {
    const parent = await fs.mkdtemp(join(tmpdir(), 'wterm-nested-'))
    try {
      await run('git', ['init', '-q'], { cwd: parent })
      // getGitInfo needs a resolvable HEAD; a fresh repo has an unborn branch
      await run(
        'git',
        ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init'],
        { cwd: parent }
      )
      const project = join(parent, 'sub')
      await fs.mkdir(project)
      expect(await listRepos(project)).toEqual([{ rel: '', name: 'sub' }])
    } finally {
      await fs.rm(parent, { recursive: true, force: true })
    }
  })

  it('returns [] for a folder with no git anywhere', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'wterm-norepo-'))
    try {
      expect(await listRepos(dir)).toEqual([])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
