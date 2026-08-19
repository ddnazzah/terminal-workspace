/** What to do when a file we have open changes on disk. */
export type ExternalChangeAction = 'ignore' | 'reload' | 'conflict' | 'deleted'

export interface ExternalChangeInput {
  /** Content now on disk, or null when the file no longer exists. */
  onDisk: string | null
  /** Content as of the last save from this editor. */
  saved: string
  /** Content currently in the editor, including unsaved edits. */
  current: string
}

/**
 * Decide how to reconcile an on-disk change with an open tab.
 *
 * The important case is our own writes: saving fires the watcher, and the disk
 * then matches what we saved. Treating that as external would raise a false
 * conflict on every save, so it is ignored — even when the user has typed on
 * since, because the disk change still originated here.
 *
 * With no unsaved edits the tab is safe to reload silently. With unsaved edits
 * both sides have moved, so the user is told rather than having their work
 * replaced.
 */
export function decideExternalChange({
  onDisk,
  saved,
  current,
}: ExternalChangeInput): ExternalChangeAction {
  if (onDisk === null) {
    // A file removed underneath unsaved edits still holds the only copy of
    // that work, so it is a conflict rather than a plain deletion notice.
    return current === saved ? 'deleted' : 'conflict'
  }

  // The disk already holds what we last wrote — this is our own save echoing
  // back, not somebody else's edit.
  if (onDisk === saved) {
    return 'ignore'
  }

  // Someone wrote exactly what the editor already shows; nothing to reconcile.
  if (onDisk === current) {
    return 'ignore'
  }

  return current === saved ? 'reload' : 'conflict'
}
