// Helpers for making Claude Code sessions survive an app restart.
//
// wTerm resumes a tab two ways: with a session id it generated itself
// (`--session-id` injected into the startup command, persisted as
// `claudeSessionId`), or with the agent command captured by shell integration
// (alias-expanded, persisted as `agent` — optionally with a sniffed
// `agent.sessionId`). Both paths rebuild the resume command from the command
// the tab actually ran, so launch flags like `--dangerously-skip-permissions`
// survive the restart. Shared between main (injection, sniffing) and the
// renderer (restore planning).

/** Does this startup command launch the Claude Code CLI as its program? */
export function isClaudeLaunch(command: string | undefined): boolean {
  if (!command) return false
  return command.trim().split(/\s+/)[0] === 'claude'
}

/**
 * True when the command already pins a session itself (`--session-id`,
 * `--resume`/`-r`, `--continue`/`-c`). In that case the user is explicitly
 * driving session selection and we leave the command untouched.
 */
function pinsSessionExplicitly(command: string): boolean {
  return /(^|\s)(--session-id|--resume|-r|--continue|-c)(=|\s|$)/.test(command)
}

/** True when the command asks to continue the folder's latest session. */
export function isContinueLaunch(command: string): boolean {
  return /(^|\s)(--continue|-c)(\s|$)/.test(command.trim())
}

/**
 * Append a `--session-id <id>` to a Claude launch command so wTerm owns the
 * resulting transcript. Returns the command unchanged if it already pins a
 * session, or if it isn't a Claude launch.
 */
export function withSessionId(command: string, sessionId: string): string {
  if (!isClaudeLaunch(command) || pinsSessionExplicitly(command)) return command
  return `${command.trim()} --session-id ${sessionId}`
}

/**
 * Remove every session-pinning flag (`--session-id`/`--resume`/`-r` with their
 * values, `--continue`/`-c`) so a resume flag can be re-applied cleanly.
 */
export function stripSessionPinning(command: string): string {
  const tokens = command.trim().split(/\s+/)
  const out: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (tok === '--session-id' || tok === '--resume' || tok === '-r') {
      // Drop the flag and its value (when the next token is the value, not a flag).
      if (tokens[i + 1] && !tokens[i + 1].startsWith('-')) i++
      continue
    }
    if (tok.startsWith('--session-id=') || tok.startsWith('--resume=')) continue
    if (tok === '--continue' || tok === '-c') continue
    out.push(tok)
  }
  return out.join(' ')
}

/**
 * The session id a command pins explicitly (`--resume <id>`, `-r <id>`,
 * `--session-id <id>`, or their `=` forms), or null — including the bare
 * `--resume` picker form, which selects interactively and pins nothing.
 */
export function extractPinnedSessionId(command: string): string | null {
  const tokens = command.trim().split(/\s+/)
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (tok === '--session-id' || tok === '--resume' || tok === '-r') {
      const value = tokens[i + 1]
      if (value && !value.startsWith('-')) return value
      continue
    }
    if (tok.startsWith('--session-id=')) return tok.slice('--session-id='.length) || null
    if (tok.startsWith('--resume=')) return tok.slice('--resume='.length) || null
  }
  return null
}

/**
 * Build the command that resumes a wTerm-owned session on restart. Preserves
 * the command's other flags (e.g. `--dangerously-skip-permissions`) but strips
 * any session-pinning flags first, then appends `--resume <id>`. Falls back to
 * a bare `claude --resume <id>` when the command doesn't launch Claude.
 */
export function buildResumeCommand(command: string | undefined, sessionId: string): string {
  const base = command?.trim()
  if (!base || !isClaudeLaunch(base)) return `claude --resume ${sessionId}`
  return `${stripSessionPinning(base)} --resume ${sessionId}`
}

/**
 * Build the relaunch command for a captured agent tab. The captured
 * (alias-expanded) command keeps its flags; session-pinning flags are stripped,
 * then either `--resume <sessionId>` (exact session known) or the restore
 * rule's flags (everything after the rule's program token) are appended.
 */
export function buildAgentResumeCommand(
  captured: string,
  ruleResume: string,
  sessionId?: string
): string {
  const base = stripSessionPinning(captured)
  if (sessionId) return `${base} --resume ${sessionId}`
  const ruleFlags = ruleResume.trim().split(/\s+/).slice(1).join(' ')
  return ruleFlags ? `${base} ${ruleFlags}` : base
}
