import type { GitChangeRow } from './git-groups'

/** Where one side of a diff is read from. */
export type GitRev = 'HEAD' | 'index' | 'worktree'

/** Which Source Control group a row was clicked in. */
export type GitGroupKind = 'merge' | 'staged' | 'changes'

export interface DiffSides {
  /** Left (original) side, or null when the file does not exist there. */
  left: GitRev | null
  /** Right (modified) side, or null when the file does not exist there. */
  right: GitRev | null
  leftLabel: string
  rightLabel: string
}

const LABELS: Record<GitRev, string> = {
  HEAD: 'HEAD',
  index: 'Index',
  worktree: 'Working Tree',
}

/**
 * The two revisions a row should be compared across, matching VS Code.
 *
 * Staged rows answer "what will this commit change?" — HEAD vs the index.
 * Unstaged rows answer "what have I changed since staging?" — index vs the
 * working tree. Conflicts show HEAD vs what is on disk.
 *
 * A side is null when the file genuinely does not exist there: an added file
 * has no HEAD, an untracked file has no index, a deleted file has no working
 * copy. Returning null lets the viewer render an empty pane instead of reading
 * a path that isn't there and showing a misleading no-op diff.
 */
export function diffSidesFor(row: GitChangeRow, group: GitGroupKind): DiffSides {
  if (group === 'merge') {
    return sides('HEAD', 'worktree')
  }

  if (group === 'staged') {
    // An add has nothing in HEAD to compare against.
    const left: GitRev | null = row.status === 'added' ? null : 'HEAD'
    return sides(left, 'index')
  }

  // Unstaged changes.
  const left: GitRev | null = row.isUntracked ? null : 'index'
  // A worktree delete means the file is gone from disk.
  const right: GitRev | null = row.status === 'deleted' ? null : 'worktree'
  return sides(left, right)
}

function sides(left: GitRev | null, right: GitRev | null): DiffSides {
  return {
    left,
    right,
    leftLabel: left ? LABELS[left] : '',
    rightLabel: right ? LABELS[right] : '',
  }
}

/**
 * The two revisions behind a file tab's Changes pane: HEAD against what is on
 * disk.
 *
 * Source Control splits a file across Staged and Changes because it acts on
 * each axis separately. An editor tab does not — it asks the simpler question
 * "what has changed in this file since the last commit?", and staging state
 * must not change that answer. So a file staged, then edited again shows both
 * halves here, where `diffSidesFor('changes')` would show only the unstaged
 * part.
 */
export function fileDiffSides(row: GitChangeRow): DiffSides {
  // Nothing in HEAD to compare against for a file that did not exist there.
  if (row.status === 'untracked' || row.status === 'added') {
    return sides(null, 'worktree')
  }
  // Gone from disk, so there is no right-hand side to read.
  if (row.status === 'deleted') {
    return sides('HEAD', null)
  }
  return sides('HEAD', 'worktree')
}
