import type { GitChangeStatus, GitStatusEntry } from '@shared/types'

/** One row in a Source Control group, flattened to the axis it belongs to. */
export interface GitChangeRow {
  path: string
  oldPath?: string
  /** Status on this row's own axis — staged rows show the index status, unstaged the worktree one. */
  status: GitChangeStatus
  /**
   * True when the file has no index entry. Discard has to `git clean` these
   * rather than `git restore`, because there is nothing to restore them from.
   */
  isUntracked: boolean
}

export interface GitGroups {
  /** Unresolved merge conflicts. Deliberately excluded from the other groups. */
  merge: GitChangeRow[]
  staged: GitChangeRow[]
  changes: GitChangeRow[]
}

/**
 * Split status entries into VS Code's Source Control groups.
 *
 * A file that was staged and then edited again appears in **both** Staged
 * Changes and Changes, each showing the status for that side — that is the
 * whole reason the two axes are tracked separately upstream.
 */
export function groupChanges(entries: readonly GitStatusEntry[]): GitGroups {
  const groups: GitGroups = { merge: [], staged: [], changes: [] }

  for (const entry of entries) {
    if (entry.conflict) {
      groups.merge.push({
        path: entry.path,
        status: 'modified',
        isUntracked: false,
        ...(entry.oldPath ? { oldPath: entry.oldPath } : {}),
      })
      continue
    }

    if (entry.index !== null) {
      groups.staged.push({
        path: entry.path,
        status: entry.index,
        isUntracked: false,
        ...(entry.oldPath ? { oldPath: entry.oldPath } : {}),
      })
    }

    if (entry.worktree !== null) {
      groups.changes.push({
        path: entry.path,
        status: entry.worktree,
        isUntracked: entry.worktree === 'untracked',
        ...(entry.oldPath ? { oldPath: entry.oldPath } : {}),
      })
    }
  }

  return groups
}

/** Single-letter badge git uses for a status. */
export function statusLetter(status: GitChangeStatus): string {
  switch (status) {
    case 'modified':
      return 'M'
    case 'added':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'untracked':
      return 'U'
  }
}
