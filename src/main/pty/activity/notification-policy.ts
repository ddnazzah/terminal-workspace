import type { SessionActivity } from './types'

export const LONG_COMMAND_MS = 10_000
// Interrupt / kill: not real failures worth a notification.
const NON_FAILURE_CODES = new Set([130, 143])

export type NotifyReason = 'permission' | 'attention' | 'done' | 'failed'

export interface NotifyDecision {
  reason: NotifyReason
  title: string
  body: string
}

export interface FocusContext {
  windowFocused: boolean
  sessionVisible: boolean
}

export interface DecideInput {
  prev: SessionActivity
  next: SessionActivity
  now: number
  focus: FocusContext
}

function isBackgrounded(focus: FocusContext): boolean {
  // Dot-only (no OS notification) when the app is focused AND this session is
  // the one on screen. Everything else is "backgrounded" for notify purposes.
  return !(focus.windowFocused && focus.sessionVisible)
}

/**
 * The agent asked for the user. A permission prompt is worth saying out loud —
 * it is blocking real work — so it gets its own wording and carries the agent's
 * own message. A finished turn is the softer "come look at this".
 */
function agentDecision(next: SessionActivity): NotifyDecision {
  if (next.reason === 'permission') {
    return {
      reason: 'permission',
      title: 'Agent needs permission',
      body: next.detail ?? next.title ?? 'Waiting on your approval',
    }
  }
  return {
    reason: 'attention',
    title: 'Agent finished its turn',
    body: next.detail ?? next.title ?? 'Waiting for input',
  }
}

export function decideNotification(input: DecideInput): NotifyDecision | null {
  const { prev, next, now, focus } = input
  if (!isBackgrounded(focus)) return null

  // Agent turn done / blocked → attention edge. A re-entry into attention with a
  // different reason (finished a turn, then asked permission) is its own event.
  const enteredAttention = next.status === 'attention' && prev.status !== 'attention'
  const reasonChanged = next.status === 'attention' && next.reason !== prev.reason
  if (next.mode === 'agent' && (enteredAttention || reasonChanged)) {
    return agentDecision(next)
  }

  // Shell command finished (busy → idle).
  if (prev.status === 'busy' && next.status === 'idle') {
    const code = next.lastExitCode
    if (code !== null && code !== 0 && !NON_FAILURE_CODES.has(code)) {
      return { reason: 'failed', title: 'Command failed', body: `Exited with code ${code}` }
    }
    const started = next.commandStartedAt ?? prev.commandStartedAt
    if (started !== null && now - started >= LONG_COMMAND_MS) {
      return { reason: 'done', title: 'Command finished', body: next.title ?? 'Done' }
    }
  }
  return null
}
