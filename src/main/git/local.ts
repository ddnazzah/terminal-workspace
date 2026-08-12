import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { GitFileStatusMap, GitInfo, GitStatusEntry } from '@shared/types'
import { parsePorcelainStatus } from './parse-status'
import { parseStatusEntries } from './parse-status-entries'
import { parseGrepOutput, type SearchHit } from './parse-grep'

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

/** Status entries for one repo, keeping git's index/worktree axes separate. */
export async function getStatusEntries(cwd: string): Promise<GitStatusEntry[]> {
  const res = await git(['status', '--porcelain=v1', '-z'], cwd)
  if (res.code !== 0) return []
  return parseStatusEntries(res.stdout)
}

/** Stage paths (`git add`). Works for new, modified and deleted files alike. */
export async function stagePaths(cwd: string, paths: string[]): Promise<boolean> {
  if (paths.length === 0) return true
  const res = await git(['add', '--', ...paths], cwd)
  return res.code === 0
}

/** Unstage paths, leaving working-tree contents untouched. */
export async function unstagePaths(cwd: string, paths: string[]): Promise<boolean> {
  if (paths.length === 0) return true
  const res = await git(['restore', '--staged', '--', ...paths], cwd)
  return res.code === 0
}

/**
 * Discard working-tree changes.
 *
 * Tracked paths are restored from the index; untracked paths have no index
 * entry to restore from, so they are removed outright. Callers must confirm
 * first — this is not recoverable through git.
 */
export async function discardPaths(
  cwd: string,
  tracked: string[],
  untracked: string[]
): Promise<boolean> {
  let ok = true
  if (tracked.length > 0) {
    const res = await git(['restore', '--worktree', '--', ...tracked], cwd)
    ok &&= res.code === 0
  }
  if (untracked.length > 0) {
    const res = await git(['clean', '-fd', '--', ...untracked], cwd)
    ok &&= res.code === 0
  }
  return ok
}

/** Commit whatever is staged. Returns git's output so the UI can surface failures. */
export async function commitStaged(
  cwd: string,
  message: string
): Promise<{ ok: boolean; output: string }> {
  const res = await git(['commit', '-m', message], cwd)
  return { ok: res.code === 0, output: `${res.stdout}${res.stderr}`.trim() }
}

/**
 * File contents at a given revision, or null when the file does not exist
 * there (an added file has no HEAD blob, an untracked file has no index entry).
 *
 * `rev` is 'HEAD' for the last commit or 'index' for what is staged; the
 * working-tree side is read through the normal fs IPC, not here.
 */
export async function fileAtRev(
  cwd: string,
  relPath: string,
  rev: 'HEAD' | 'index'
): Promise<string | null> {
  // `git show :path` reads the index; `git show HEAD:path` reads the commit.
  const spec = rev === 'index' ? `:${relPath}` : `HEAD:${relPath}`
  const res = await git(['show', spec], cwd)
  return res.code === 0 ? res.stdout : null
}

/** Cap on returned hits — a broad query in a big repo can match tens of thousands. */
const MAX_SEARCH_HITS = 2000

export interface SearchOptions {
  caseSensitive?: boolean
  /** Treat the query as a regular expression rather than a literal string. */
  regex?: boolean
  wholeWord?: boolean
}

/**
 * Search tracked files for `query` using `git grep`.
 *
 * git grep is used rather than a hand-rolled walk because it already honours
 * .gitignore, skips binaries (-I), and is dramatically faster on large repos.
 * Untracked-but-not-ignored files are included via --untracked so a brand-new
 * file is still searchable.
 */
export async function searchFiles(
  cwd: string,
  query: string,
  options: SearchOptions = {}
): Promise<{ hits: SearchHit[]; truncated: boolean }> {
  if (query.trim() === '') return { hits: [], truncated: false }

  const args = ['grep', '--no-color', '-n', '--column', '-I', '-z', '--untracked']
  if (!options.caseSensitive) args.push('-i')
  if (!options.regex) args.push('-F') // fixed string
  if (options.wholeWord) args.push('-w')
  args.push('-e', query)

  const res = await git(args, cwd)
  // git grep exits 1 when there are simply no matches.
  if (res.code !== 0 && res.stdout === '') return { hits: [], truncated: false }

  const all = parseGrepOutput(res.stdout)
  return { hits: all.slice(0, MAX_SEARCH_HITS), truncated: all.length > MAX_SEARCH_HITS }
}
