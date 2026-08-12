// Per-card git worktrees: create one on dispatch, prune it when the card is
// done. A non-git project is not an error — the card simply runs in the project
// root and says so in its log.

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { branchForCard, worktreeDirName, worktreeRootFor } from './worktree-path'

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

function git(args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolveP) => {
    const child = spawn('git', args, { cwd, env: { ...process.env, LANG: 'C', LC_ALL: 'C' } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('error', (err) => resolveP({ code: -1, stdout, stderr: String(err) }))
    child.on('close', (code) => resolveP({ code: code ?? -1, stdout, stderr }))
  })
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

export interface WorktreeAllocation {
  /** cwd the worker terminal should run in */
  cwd: string
  /** null when the project isn't a git repo and the card runs in the project root */
  worktreePath: string | null
  branch: string | null
  /** human-readable note for the card log */
  note: string
}

export type AllocateResult =
  | { ok: true; allocation: WorktreeAllocation }
  | { ok: false; error: string }

/**
 * Create `<root>/<project>-card-<n>` on a new `card/<n>` branch.
 *
 * Refuses rather than reuses when the target path already exists: an existing
 * directory may hold a previous run's uncommitted work, and silently handing it
 * to a fresh agent is how work gets lost.
 */
export async function allocateWorktree(
  projectPath: string,
  projectName: string,
  cardNumber: number,
  configuredRoot: string
): Promise<AllocateResult> {
  if (!(await exists(join(projectPath, '.git')))) {
    return {
      ok: true,
      allocation: {
        cwd: projectPath,
        worktreePath: null,
        branch: null,
        note: 'project is not a git repo — running in the project root without isolation',
      },
    }
  }

  const root = worktreeRootFor(configuredRoot, projectPath)
  const path = join(root, worktreeDirName(projectName, cardNumber))
  const branch = branchForCard(cardNumber)

  if (await exists(path)) {
    return { ok: false, error: `worktree path already exists: ${path}` }
  }

  await fs.mkdir(root, { recursive: true }).catch(() => {})

  const created = await git(['worktree', 'add', path, '-b', branch], projectPath)
  if (created.code !== 0) {
    // A leftover branch from a deleted worktree is the common cause; retry onto
    // the existing branch rather than failing the dispatch outright.
    const retry = await git(['worktree', 'add', path, branch], projectPath)
    if (retry.code !== 0) {
      return { ok: false, error: (created.stderr || retry.stderr || 'git worktree add failed').trim() }
    }
  }

  return {
    ok: true,
    allocation: { cwd: path, worktreePath: path, branch, note: `worktree ${path} on ${branch}` },
  }
}

/**
 * Keep wTerm's dispatch artefact out of `git status` via local excludes, never
 * the tracked .gitignore.
 *
 * The exclude file must go in the repo's *common* dir: a linked worktree's own
 * gitdir has an `info/` that git does not consult, so writing there looks right
 * and silently does nothing. `--git-common-dir` resolves to the shared `.git`
 * for a worktree and to the plain `.git` for an ordinary checkout.
 */
export async function excludeFromGitStatus(cwd: string, pattern: string): Promise<void> {
  const res = await git(['rev-parse', '--git-common-dir'], cwd)
  if (res.code !== 0) return

  const raw = res.stdout.trim()
  if (!raw) return
  const commonDir = isAbsolute(raw) ? raw : join(cwd, raw)
  const infoDir = join(commonDir, 'info')
  const excludePath = join(infoDir, 'exclude')

  try {
    const current = await fs.readFile(excludePath, 'utf-8').catch(() => '')
    if (current.split('\n').some((line) => line.trim() === pattern)) return
    await fs.mkdir(infoDir, { recursive: true })
    await fs.writeFile(excludePath, `${current.replace(/\n*$/, '\n')}${pattern}\n`, 'utf-8')
  } catch {
    // Never fatal — without it the card file merely shows as untracked.
  }
}

/** True when the worktree has uncommitted changes — used to warn before pruning. */
export async function isWorktreeDirty(worktreePath: string): Promise<boolean> {
  const res = await git(['status', '--porcelain'], worktreePath)
  return res.code === 0 && res.stdout.trim().length > 0
}

/**
 * Remove a card's worktree. Never forced: a dirty worktree fails here so the
 * caller can surface it rather than deleting work the user hasn't reviewed.
 */
export async function pruneWorktree(
  projectPath: string,
  worktreePath: string
): Promise<{ ok: boolean; error?: string }> {
  const res = await git(['worktree', 'remove', worktreePath], projectPath)
  if (res.code !== 0) return { ok: false, error: res.stderr.trim() || 'git worktree remove failed' }
  return { ok: true }
}
