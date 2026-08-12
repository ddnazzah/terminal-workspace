import type { GitFileStatus, GitFileStatusMap } from '@shared/types'

/** Single-letter badge shown beside a changed path, matching VS Code's explorer. */
export const STATUS_BADGE: Record<GitFileStatus, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  untracked: 'U',
  conflict: 'C',
}

/**
 * Severity order for rolling child statuses up to a folder — highest first.
 * A folder holding one conflict reads as conflicted even if the rest is clean;
 * a folder of only-new files stays green.
 */
const SEVERITY: ReadonlyArray<GitFileStatus> = [
  'conflict',
  'modified',
  'deleted',
  'added',
  'untracked',
]

export interface FolderDecoration {
  /** Most severe status among descendants, or undefined when the folder is clean. */
  status: GitFileStatus | undefined
  /** How many changed files sit under this folder, at any depth. */
  count: number
}

const CLEAN: FolderDecoration = { status: undefined, count: 0 }

/** Roll every changed descendant of `path` up into one badge for the folder row. */
export function folderDecoration(path: string, map: GitFileStatusMap): FolderDecoration {
  const prefix = `${path}/`

  let count = 0
  let rank = SEVERITY.length

  for (const [changed, status] of Object.entries(map)) {
    if (!changed.startsWith(prefix)) continue
    count += 1
    rank = Math.min(rank, SEVERITY.indexOf(status))
  }

  if (count === 0) return CLEAN
  return { status: SEVERITY[rank], count }
}
