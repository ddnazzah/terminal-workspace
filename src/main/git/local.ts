import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { GitFileStatusMap, GitInfo } from '@shared/types'
import { parsePorcelainStatus } from './parse-status'

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

async function run(cmd: string, args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolveP) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('error', () => resolveP({ code: -1, stdout, stderr }))
    child.on('close', (code) => resolveP({ code: code ?? -1, stdout, stderr }))
  })
}

const git = (args: string[], cwd: string): Promise<RunResult> => run('git', args, cwd)

function parseGithubRemote(url: string): { owner: string; repo: string } | null {
  const trimmed = url.trim().replace(/\.git$/, '')
  // SSH: git@github.com:owner/repo
  let m = /^git@github\.com:([^/]+)\/(.+)$/.exec(trimmed)
  if (m) return { owner: m[1]!, repo: m[2]! }
  // ssh://git@github.com/owner/repo
  m = /^ssh:\/\/git@github\.com\/([^/]+)\/(.+)$/.exec(trimmed)
  if (m) return { owner: m[1]!, repo: m[2]! }
  // https://github.com/owner/repo  (with or without auth prefix)
  m = /^https?:\/\/(?:[^@]+@)?github\.com\/([^/]+)\/(.+)$/.exec(trimmed)
  if (m) return { owner: m[1]!, repo: m[2]! }
  return null
}

export async function getGitInfo(cwd: string): Promise<GitInfo> {
  const empty: GitInfo = {
    isRepo: false,
    branch: null,
    githubRepo: null,
    hasUpstream: false,
    ahead: 0,
    behind: 0,
    dirty: false,
    defaultBranch: null,
  }

  try {
    await fs.access(join(cwd, '.git'))
  } catch {
    const top = await git(['rev-parse', '--show-toplevel'], cwd)
    if (top.code !== 0) return empty
  }

  const branchRes = await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  let branch: string | null
  if (branchRes.code === 0) {
    branch = branchRes.stdout.trim() || null
  } else {
    // Unborn branch (fresh repo, no commits yet): HEAD exists as a symref
    // only, so rev-parse fails but symbolic-ref still resolves the name.
    const symRes = await git(['symbolic-ref', '--short', 'HEAD'], cwd)
    if (symRes.code !== 0) return empty
    branch = symRes.stdout.trim() || null
  }

  const remoteRes = await git(['remote', 'get-url', 'origin'], cwd)
  const githubRepo =
    remoteRes.code === 0 ? parseGithubRemote(remoteRes.stdout) : null

  let hasUpstream = false
  let ahead = 0
  let behind = 0
  const upstreamRes = await git(
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
    cwd
  )
  if (upstreamRes.code === 0) {
    hasUpstream = true
    const counts = await git(['rev-list', '--left-right', '--count', '@{u}...HEAD'], cwd)
    if (counts.code === 0) {
      const [b, a] = counts.stdout.trim().split(/\s+/)
      behind = Number.parseInt(b ?? '0', 10) || 0
      ahead = Number.parseInt(a ?? '0', 10) || 0
    }
  }

  const status = await git(['status', '--porcelain'], cwd)
  const dirty = status.code === 0 && status.stdout.trim().length > 0

  let defaultBranch: string | null = null
  const headRef = await git(['symbolic-ref', 'refs/remotes/origin/HEAD'], cwd)
  if (headRef.code === 0) {
    const m = /refs\/remotes\/origin\/(.+)/.exec(headRef.stdout.trim())
    if (m) defaultBranch = m[1] ?? null
  }

  return {
    isRepo: true,
    branch,
    githubRepo,
    hasUpstream,
    ahead,
    behind,
    dirty,
    defaultBranch,
  }
}

export async function pushCurrentBranch(
  cwd: string,
  branch: string
): Promise<{ ok: boolean; output: string }> {
  const res = await git(['push', '-u', 'origin', branch], cwd)
  return {
    ok: res.code === 0,
    output: (res.stdout + (res.stderr ? '\n' + res.stderr : '')).trim(),
  }
}

export async function getFileStatus(cwd: string): Promise<GitFileStatusMap> {
  const res = await git(['status', '--porcelain=v1', '-z'], cwd)
  if (res.code !== 0) return {}
  return parsePorcelainStatus(res.stdout)
}
