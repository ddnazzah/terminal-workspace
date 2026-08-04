import type { GitChangeStatus, GitStatusEntry } from '@shared/types'

/** XY code pairs git uses for an unresolved merge. */
const CONFLICT_CODES = new Set(['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD'])

/**
 * Parse `git status --porcelain=v1 -z` while keeping git's two axes separate.
 *
 * Unlike the flat map used to tint the file tree, this preserves the index
 * (staged) and worktree (unstaged) status independently, which is what the
 * Source Control view needs to place a file into the right group — or into two
 * groups at once when it has been staged and then edited again.
 *
 * The -z form is NUL-separated with no trailing newline; rename and copy
 * entries occupy two fields (`XY new\0old\0`).
 */
export function parseStatusEntries(z: string): GitStatusEntry[] {
  const entries: GitStatusEntry[] = []
  const fields = z.split('\0')

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]
    // A well-formed record is at least "XY " plus one path character.
    if (!field || field.length < 4) continue

    const x = field[0]
    const y = field[1]
    const path = field.slice(3)
    if (!path) continue

    const code = `${x}${y}`

    // Ignored entries are not changes and never appear in the view.
    if (code === '!!') continue

    // Renames and copies consume the following field (the previous path).
    const isRenameOrCopy = x === 'R' || x === 'C'
    const oldPath = isRenameOrCopy ? fields[++i] : undefined

    if (CONFLICT_CODES.has(code)) {
      entries.push({ path, index: null, worktree: null, conflict: true })
      continue
    }

    const entry: GitStatusEntry = {
      path,
      index: indexStatus(x),
      worktree: worktreeStatus(y),
      conflict: false,
    }
    if (oldPath) {
      entry.oldPath = oldPath
    }

    entries.push(entry)
  }

  return entries
}

/** Staged side of the pair. ' ' means the index is clean for this file. */
function indexStatus(x: string): GitChangeStatus | null {
  switch (x) {
    case 'M':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
    case 'C':
      return 'renamed'
    default:
      return null
  }
}

/** Unstaged side of the pair. '?' marks an untracked file. */
function worktreeStatus(y: string): GitChangeStatus | null {
  switch (y) {
    case 'M':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case '?':
      return 'untracked'
    default:
      return null
  }
}
