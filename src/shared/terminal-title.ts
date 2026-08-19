// How an agent's window title is read and displayed.
//
// Claude Code writes "<glyph> <task>" and the glyph carries the state. Measured
// against 2.1.235 by running it under a pty and reading the OSC 0 sequences:
//
//   ◐ Claude Code   ◑ OK     working  (the glyph changes as it goes)
//   ✳ Claude Code   ✳ OK     idle, waiting on the user
//
// Both the detector (main/pty/activity) and the label shown in the UI need this
// alphabet, and they must never disagree: a glyph the detector knows but the
// stripper doesn't ends up rendered literally in the sidebar, flickering next to
// the terminal name.

/** Frames an agent animates in its title while it is working. */
export const WORKING_GLYPHS = '⠀-⣿◐-◓◴-◷◰-◳◜-◟'
/** The mark an agent rests on once it is idle and waiting on the user. */
export const READY_GLYPH = '✳'
/** Separators an agent may put between its glyph and the task text. */
const SEPARATORS = '·•‣⋅'

const DECORATION = new RegExp(`^[${READY_GLYPH}${WORKING_GLYPHS}${SEPARATORS}\\s]+`)

/**
 * Strip the leading decoration from an agent window title before showing it in
 * the sidebar (desktop) or the mobile tab bar. The glyph changes as the agent
 * works, so left in it reads as something skittering next to the terminal name;
 * the dot already signals state, so the text only needs the task.
 */
export function stripSpinner(title: string): string {
  return title.replace(DECORATION, '')
}

/**
 * Normalize a derived window title for display as a tab label: strip the
 * decoration and collapse a blank result to null so the caller falls back to the
 * terminal's persisted name (e.g. "Terminal 1") instead of an empty label.
 */
export function cleanTitle(title: string | null | undefined): string | null {
  if (!title) return null
  const stripped = stripSpinner(title).trim()
  return stripped.length > 0 ? stripped : null
}
