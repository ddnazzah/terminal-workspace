import type { GitStatusEntry } from '@shared/types'
import type { GitChangeRow } from './git-groups'

/** Just the field of `RepoRef` this module needs, so tests need no fixtures. */
interface RepoLike {
  /** Repo path relative to the project root; '' for the project root itself. */
  rel: string
}

/**
 * Which repo owns a project-relative path, or null when none does.
 *
 * The deepest match wins: in a project holding both a root repo and a nested
 * one, a file under the nested repo belongs to that repo, and its status has to
 * be read there. Comparison is on whole path segments — a plain `startsWith`
 * would place `pkgs/webby/a.ts` inside the `pkgs/web` repo.
 */
export function repoRelForPath(
  projectPath: string,
  repos: ReadonlyArray<RepoLike>
): string | null {
  let best: string | null = null
  for (const { rel } of repos) {
    if (rel !== '' && !projectPath.startsWith(`${rel}/`)) continue
    if (best === null || rel.length > best.length) best = rel
  }
  return best
}

/**
 * The file's single overall change against HEAD, or null when it is unmodified.
 *
 * Source Control keeps git's two axes apart because it stages and discards them
 * separately. A file tab has no such need, so the axes are collapsed into one
 * row: the strongest claim about how the file differs from the last commit.
 *
 * Precedence matters. A worktree delete outranks a staged add — a file staged
 * as new and then removed from disk is, on both sides, absent — and untracked
 * outranks everything else because there is no index entry to compare with.
 */
export function fileChangeFor(
  entries: readonly GitStatusEntry[],
  repoPath: string
): GitChangeRow | null {
  const entry = entries.find((e) => e.path === repoPath)
  if (!entry) return null

  const oldPath = entry.oldPath ? { oldPath: entry.oldPath } : {}
  const base = { path: entry.path, ...oldPath }

  // A conflict leaves both axes null, so it has to be read off the flag.
  if (entry.conflict) {
    return { ...base, status: 'modified', isUntracked: false }
  }
  if (entry.worktree === 'untracked') {
    return { ...base, status: 'untracked', isUntracked: true }
  }
  if (entry.worktree === 'deleted' || entry.index === 'deleted') {
    return { ...base, status: 'deleted', isUntracked: false }
  }
  if (entry.index === 'added') {
    return { ...base, status: 'added', isUntracked: false }
  }
  if (entry.index === 'renamed') {
    return { ...base, status: 'renamed', isUntracked: false }
  }
  return { ...base, status: 'modified', isUntracked: false }
}
