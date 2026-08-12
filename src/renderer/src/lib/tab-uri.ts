// Board and note tabs ride the existing file-tab machinery under a reserved
// URI scheme, the way an editor models non-file documents. `openFiles` stays a
// list of `{ projectId, path }`, so tab ordering, ⌘1–9, drag reorder, close,
// and per-project active-tab tracking all work unchanged.
//
// The scheme is `wterm://`, which no real file path can collide with (a real
// path is either absolute or project-relative, never scheme-prefixed).

export const TAB_SCHEME = 'wterm://'
export const BOARD_TAB_PATH = `${TAB_SCHEME}board`
/** The notes tab with nothing selected yet — the list view. */
export const NOTES_TAB_PATH = `${TAB_SCHEME}notes`

const NOTE_PREFIX = `${TAB_SCHEME}note/`

export type TabTarget =
  | { kind: 'file'; path: string }
  | { kind: 'board' }
  | { kind: 'note'; noteId: string | null }

export function noteTabPath(noteId: string): string {
  return `${NOTE_PREFIX}${noteId}`
}

/** Classify an open tab's path. Anything unrecognised is a plain file. */
export function parseTabPath(path: string): TabTarget {
  if (path === BOARD_TAB_PATH) return { kind: 'board' }
  if (path === NOTES_TAB_PATH) return { kind: 'note', noteId: null }
  if (path.startsWith(NOTE_PREFIX)) {
    const noteId = path.slice(NOTE_PREFIX.length)
    if (noteId) return { kind: 'note', noteId }
  }
  return { kind: 'file', path }
}

/** True for tabs with no file behind them (no dirty state, no save, no icon). */
export function isVirtualTab(path: string): boolean {
  return parseTabPath(path).kind !== 'file'
}
