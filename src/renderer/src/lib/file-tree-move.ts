/**
 * Pure rules for drag-and-drop moves in the file explorer.
 *
 * Paths are project-relative with forward slashes; the empty string is the
 * project root (matching `FsEntry.path`).
 */

/** Minimal shape needed to resolve a drop target — structurally satisfied by `FsEntry`. */
export interface DropTarget {
  readonly path: string
  readonly isDirectory: boolean
}

export interface MovePlan {
  /** Current project-relative path. */
  readonly from: string
  /** Destination project-relative path. */
  readonly to: string
}

/** Project-relative parent folder of `path` ('' when it sits at the root). */
function parentOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

/** Final path segment of `path`. */
function basenameOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? path : path.slice(slash + 1)
}

/**
 * The folder a drop lands in: the target itself when it is a directory, its
 * parent when it is a file, and the project root when dropped on empty space.
 */
export function dropFolderFor(target: DropTarget | null): string {
  if (!target) {
    return ''
  }

  return target.isDirectory ? target.path : parentOf(target.path)
}

/**
 * Build the move for dragging `source` into `destFolder`, or `null` when the
 * move is invalid or would be a no-op.
 *
 * Rejects moving the project root, moving into the folder a path already lives
 * in, dropping a folder onto itself, and dropping a folder into its own
 * descendant (which would detach the subtree).
 */
export function planMove(source: string, destFolder: string): MovePlan | null {
  if (source === '') {
    return null // the project root cannot be moved
  }

  if (destFolder === source) {
    return null // onto itself
  }

  // Descendant check compares against `source/` so that a sibling sharing a
  // name prefix (e.g. 'src' vs 'src-legacy') is not mistaken for a child.
  if (destFolder.startsWith(`${source}/`)) {
    return null
  }

  if (parentOf(source) === destFolder) {
    return null // already there
  }

  const name = basenameOf(source)

  return {
    from: source,
    to: destFolder === '' ? name : `${destFolder}/${name}`,
  }
}
