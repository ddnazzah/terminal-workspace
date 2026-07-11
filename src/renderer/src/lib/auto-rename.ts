import type { SessionActivityPayload, TerminalRecord } from '@shared/types'
import { AGENT_WORK_PREFIX, stripSpinner } from './terminal-title'

/**
 * Decide whether an activity payload should update the terminal's persistent
 * name. Returns the new name, or null to leave it alone.
 *
 * Only a *busy* agent title carrying the spinner work prefix qualifies: busy
 * titles carry the current task, while idle/attention agent titles revert to
 * product branding ("Claude Code") and plain shell titles (cwd, program name)
 * are not tasks at all. A terminal the user renamed by hand ('user'
 * nameSource) is never touched.
 */
export function resolveAutoRename(
  payload: SessionActivityPayload,
  terminal: TerminalRecord | undefined
): string | null {
  if (!terminal || terminal.nameSource === 'user') return null
  if (!payload.isAgent || payload.status !== 'busy' || !payload.title) return null
  if (!AGENT_WORK_PREFIX.test(payload.title)) return null
  const name = stripSpinner(payload.title).trim()
  if (!name || name === terminal.name) return null
  return name
}
