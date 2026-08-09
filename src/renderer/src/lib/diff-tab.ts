import type { GitGroupKind } from './git-diff-sides'
import type { GitChangeRow } from './git-groups'

/**
 * A Source Control diff opened as an editor tab.
 *
 * The workspace store keys tabs by `${projectId}::${path}`, so a diff needs a
 * path of its own rather than the file's real one — otherwise opening a diff
 * would collide with the file already being open, and the staged and unstaged
 * diffs of one file would collide with each other.
 */
export interface DiffTabDescriptor {
  /** Repo path relative to the project root; '' for the project root. */
  repoRel: string
  group: GitGroupKind
  /** File path relative to the repo. */
  path: string
  /**
   * Status on the row's own axis, and whether the file is untracked.
   *
   * Carried through because `diffSidesFor` needs both to pick the revisions:
   * an added file has no HEAD side, an untracked one has no index side, and a
   * deleted one has no working copy. Reconstructing the row with a default
   * 'modified' would diff the wrong pair and show a misleading result.
   */
  status: GitChangeRow['status']
  isUntracked: boolean
}

const SCHEME = 'git-diff://'

/**
 * Pack a descriptor into a synthetic path.
 *
 * The payload is URI-encoded JSON rather than delimiter-joined: file paths can
 * legitimately contain the separators (`:` especially), and a naive split would
 * silently truncate them.
 */
export function encodeDiffTab(descriptor: DiffTabDescriptor): string {
  return SCHEME + encodeURIComponent(JSON.stringify(descriptor))
}

/** True when a tab path refers to a diff rather than a real file. */
export function isDiffTab(path: string): boolean {
  return path.startsWith(SCHEME)
}

/** Unpack a synthetic path, or null when it isn't one / is malformed. */
export function decodeDiffTab(path: string): DiffTabDescriptor | null {
  if (!isDiffTab(path)) {
    return null
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(path.slice(SCHEME.length)))
    if (
      typeof parsed?.repoRel !== 'string' ||
      typeof parsed?.path !== 'string' ||
      typeof parsed?.group !== 'string' ||
      typeof parsed?.status !== 'string' ||
      typeof parsed?.isUntracked !== 'boolean'
    ) {
      return null
    }
    return parsed as DiffTabDescriptor
  } catch {
    // Malformed percent-encoding or JSON — treat as "not a diff tab" rather
    // than letting it throw inside a render.
    return null
  }
}

/** Short label for the tab strip, e.g. "a.ts (Staged)". */
export function diffTabLabel(descriptor: DiffTabDescriptor): string {
  const name = descriptor.path.split('/').pop() ?? descriptor.path
  const suffix =
    descriptor.group === 'staged' ? 'Staged' : descriptor.group === 'merge' ? 'Merge' : 'Changes'
  return `${name} (${suffix})`
}
