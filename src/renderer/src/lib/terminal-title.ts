import type { SessionActivityPayload } from '@shared/types'

// These mirror the classification in the main-process ActivityMachine
// (main/pty/activity/activity-machine.ts): a title is an active agent *task*
// only when it starts with the ✳ marker or a braille spinner frame AND is not
// the idle product branding. Mirrored here because agent mode is sticky in the
// machine — after an agent exits (or dies mid-task) plain shell titles still
// arrive flagged isAgent and must not be treated as tasks.
export const AGENT_WORK_PREFIX = /^[✳⠀-⣿]/
const AGENT_IDLE_BRANDING = /claude code/i

// Strip the leading decoration from an agent window title before showing it in
// the sidebar: the animated spinner glyph (braille frames U+2800–U+28FF or the
// ✳ marker) and any bullet/middle-dot separator (·•‣⋅) that follows it, plus
// surrounding whitespace. The braille glyph cycles every frame, so left in it
// reads as a dot skittering next to the terminal name; the pulsing halo already
// signals work, so the text only needs the task.
export function stripSpinner(title: string): string {
  return title.replace(/^[✳⠀-⣿·•‣⋅\s]+/, '')
}

/**
 * The live title to display for an activity payload — '' clears it so the
 * display falls back to the persistent terminal name.
 *
 * Agent-mode titles only count while they are an active task: idle branding
 * ("Claude Code" between turns) and post-exit shell titles would otherwise
 * cover the persisted task name, which is exactly what should show when the
 * agent isn't working. Plain shell tabs keep their shell titles as before.
 */
export function resolveDisplayTitle(
  payload: Pick<SessionActivityPayload, 'title' | 'isAgent'>
): string {
  if (!payload.title) return ''
  if (
    payload.isAgent &&
    (!AGENT_WORK_PREFIX.test(payload.title) || AGENT_IDLE_BRANDING.test(payload.title))
  ) {
    return ''
  }
  return stripSpinner(payload.title)
}
