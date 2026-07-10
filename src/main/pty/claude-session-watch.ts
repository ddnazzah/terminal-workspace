// Discovers the session id of a Claude Code conversation wTerm did NOT launch
// with an injected `--session-id` (hand-typed or aliased launches). Claude
// writes each conversation to ~/.claude/projects/<slug(cwd)>/<uuid>.jsonl, so
// watching that folder after a launch reveals the id — which then makes the
// tab exactly resumable (`--resume <id>`) instead of fuzzily (`--continue`).

import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SESSION_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i
/** Tolerance for fs-timestamp vs Date.now() skew when comparing to launch time. */
const TIMESTAMP_SLACK_MS = 2_000
const DEFAULT_INTERVAL_MS = 3_000
/** Claude writes the file on the first exchange, which can be long after launch. */
const DEFAULT_MAX_WAIT_MS = 30 * 60_000

/** Claude Code's per-project folder name for a cwd. */
export function claudeProjectSlug(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

export interface SniffOptions {
  /** Root holding the per-project session folders (default ~/.claude/projects). */
  baseDir?: string
  /** Launch time; only files created/modified after this qualify. */
  sinceMs: number
  /**
   * 'created' for fresh launches (a new file will appear); 'modified' for
   * `--continue` launches (the latest existing file gets new writes).
   */
  mode: 'created' | 'modified'
  intervalMs?: number
  maxWaitMs?: number
  /** Polled each tick; returning false cancels the watch. */
  isActive: () => boolean
  /** File paths already claimed by other tabs, so two tabs never share an id. */
  claimed: Set<string>
}

interface Candidate {
  path: string
  timeMs: number
}

async function scanOnce(dir: string, opts: SniffOptions): Promise<Candidate | null> {
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const candidates: Candidate[] = []
  for (const name of names) {
    if (!SESSION_FILE.test(name)) continue
    const path = join(dir, name)
    if (opts.claimed.has(path)) continue
    const st = await fs.stat(path).catch(() => null)
    if (!st) continue
    const timeMs = opts.mode === 'created' ? st.birthtimeMs : st.mtimeMs
    if (timeMs >= opts.sinceMs - TIMESTAMP_SLACK_MS) candidates.push({ path, timeMs })
  }
  if (candidates.length === 0) return null
  // Fresh launches claim the earliest new file (closest to this launch, so a
  // same-cwd tab launched later claims the later file); continues claim the
  // most recently touched one.
  candidates.sort((a, b) => (opts.mode === 'created' ? a.timeMs - b.timeMs : b.timeMs - a.timeMs))
  return candidates[0]
}

/**
 * Poll the cwd's Claude project folder until a qualifying session file
 * appears, the watch is cancelled, or the deadline passes. Returns the session
 * id (file basename) or null. The winning file is added to `claimed`.
 */
export async function sniffSessionId(cwd: string, opts: SniffOptions): Promise<string | null> {
  const baseDir = opts.baseDir ?? join(homedir(), '.claude', 'projects')
  const dir = join(baseDir, claudeProjectSlug(cwd))
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  const deadline = Date.now() + (opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS)

  while (Date.now() < deadline) {
    if (!opts.isActive()) return null
    const found = await scanOnce(dir, opts)
    if (found) {
      opts.claimed.add(found.path)
      return found.path.slice(dir.length + 1, -'.jsonl'.length)
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return null
}
