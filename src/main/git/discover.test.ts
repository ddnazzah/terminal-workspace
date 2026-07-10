import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverRepos, findRepo } from './discover'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'wterm-discover-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const mkRepo = async (...segments: string[]): Promise<void> => {
  await fs.mkdir(join(root, ...segments, '.git'), { recursive: true })
}

describe('discoverRepos', () => {
  it('returns empty array for a folder with no repos', async () => {
    await fs.mkdir(join(root, 'src'))
    expect(await discoverRepos(root)).toEqual([])
  })

  it('detects the project root itself as a repo', async () => {
    await mkRepo()
    const repos = await discoverRepos(root)
    expect(repos).toHaveLength(1)
    expect(repos[0]).toMatchObject({ rel: '' })
    expect(repos[0]!.name.length).toBeGreaterThan(0)
  })

  it('detects child repos one level deep, sorted by name', async () => {
    await mkRepo('frontend')
    await mkRepo('backend')
    expect(await discoverRepos(root)).toEqual([
      { rel: 'backend', name: 'backend' },
      { rel: 'frontend', name: 'frontend' },
    ])
  })

  it('lists the root repo first, then children', async () => {
    await mkRepo()
    await mkRepo('api')
    const repos = await discoverRepos(root)
    expect(repos.map((r) => r.rel)).toEqual(['', 'api'])
  })

  it('does not scan deeper than one level', async () => {
    await mkRepo('packages', 'app') // two levels down
    expect(await discoverRepos(root)).toEqual([])
  })

  it('treats a .git *file* as a repo (worktrees, submodules)', async () => {
    await fs.mkdir(join(root, 'wt'))
    await fs.writeFile(join(root, 'wt', '.git'), 'gitdir: /elsewhere\n')
    expect(await discoverRepos(root)).toEqual([{ rel: 'wt', name: 'wt' }])
  })

  it('skips hidden directories', async () => {
    await mkRepo('.cache')
    expect(await discoverRepos(root)).toEqual([])
  })

  it('skips symlinked directories', async () => {
    const outside = await fs.mkdtemp(join(tmpdir(), 'wterm-outside-'))
    await fs.mkdir(join(outside, '.git'))
    await fs.symlink(outside, join(root, 'linked'))
    expect(await discoverRepos(root)).toEqual([])
    await fs.rm(outside, { recursive: true, force: true })
  })

  it('returns [] for an unreadable project path', async () => {
    expect(await discoverRepos(join(root, 'does-not-exist'))).toEqual([])
  })
})

describe('findRepo', () => {
  const repos = [
    { rel: '', name: 'proj' },
    { rel: 'backend', name: 'backend' },
  ]

  it('finds a repo by exact rel', () => {
    expect(findRepo(repos, 'backend')).toEqual({ rel: 'backend', name: 'backend' })
    expect(findRepo(repos, '')).toEqual({ rel: '', name: 'proj' })
  })

  it('rejects unknown rels and traversal attempts', () => {
    expect(findRepo(repos, 'frontend')).toBeNull()
    expect(findRepo(repos, '../outside')).toBeNull()
    expect(findRepo(repos, 'backend/../..')).toBeNull()
  })
})
