// Parsing and validation for the JSON Claude Code posts on every hook.
//
// wTerm installs a small relay script as a `command` hook in the user's Claude
// settings; Claude pipes the event payload to it on stdin and it POSTs the body
// verbatim to the local hook server (see hook-server.ts). This module is the
// boundary: everything arriving here is untrusted text off a socket, so nothing
// downstream sees a payload that hasn't been shape-checked.
//
// The event names and payload fields below were measured against Claude Code
// 2.1.235, not read off a spec:
//
//   UserPromptSubmit  { session_id, transcript_path, cwd, permission_mode }
//   Notification      { ..., message: "Claude needs your permission" }
//   Stop              { ..., stop_hook_active: false }
//
// The body arrives verbatim; the relay names its terminal in a header, taken
// from $WTERM_TERMINAL_ID, which wTerm exports into every PTY it spawns. That
// inherits down through the shell to the agent to the hook process, so an event
// identifies its terminal exactly — no matter how the agent was launched (typed
// by hand, via a shell alias, or by the board).

/** A hook event, narrowed to the transitions wTerm actually reacts to. */
export type AgentHookEvent =
  /** The user submitted a turn; the agent is now working. */
  | { kind: 'promptSubmitted' }
  /** The agent is blocked on the user — a permission prompt or an idle nudge. */
  | { kind: 'needsInput'; message: string }
  /** The agent finished its turn and is waiting for whatever comes next. */
  | { kind: 'turnDone' }
  /** The agent session ended; the terminal is back to being a plain shell. */
  | { kind: 'sessionEnd' }

export interface AgentHookMessage {
  /** The wTerm terminal the agent is running in. */
  terminalId: string
  /** Claude's own session id, kept so a caller can find the transcript. */
  sessionId: string | null
  event: AgentHookEvent
}

/**
 * Claude's idle nudge fires when the user has left a prompt unanswered; its
 * message differs from the permission one but both mean "blocked on you".
 */
const NEEDS_INPUT_EVENTS = new Set(['Notification'])

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function toEvent(name: string, body: Record<string, unknown>): AgentHookEvent | null {
  if (name === 'UserPromptSubmit') return { kind: 'promptSubmitted' }
  if (name === 'Stop') return { kind: 'turnDone' }
  if (name === 'SessionEnd') return { kind: 'sessionEnd' }
  if (NEEDS_INPUT_EVENTS.has(name)) {
    return { kind: 'needsInput', message: readString(body, 'message') ?? 'Waiting for you' }
  }
  return null
}

/**
 * Parse a raw hook body into a typed message, or null when it is malformed,
 * unidentifiable, or an event wTerm has no use for. Never throws — a bad body is
 * a dropped event, not a crash in the main process.
 *
 * @param terminalId the relay's header value; falls back to a `terminal_id` in
 * the body so a payload can carry it on its own (which is what the tests do).
 */
export function parseHookMessage(
  raw: string,
  terminalId: string | null = null
): AgentHookMessage | null {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const record = body as Record<string, unknown>

  // Without a terminal id there is nothing to attach the event to.
  const target = terminalId || readString(record, 'terminal_id')
  if (!target) return null

  const name = readString(record, 'hook_event_name')
  if (!name) return null

  const event = toEvent(name, record)
  if (!event) return null

  return { terminalId: target, sessionId: readString(record, 'session_id'), event }
}
