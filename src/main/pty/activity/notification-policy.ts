import type { SessionActivity } from './types'

export const LONG_COMMAND_MS = 10_000
// Interrupt / kill: not real failures worth a notification.
const NON_FAILURE_CODES = new Set([130, 143])

export type NotifyReason = 'attention' | 'done' | 'failed'

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

export function decideNotification(input: DecideInput): NotifyDecision | null {
  const { prev, next, now, focus } = input
  if (!isBackgrounded(focus)) return null

  // Agent turn done → attention edge.
  if (next.mode === 'agent' && prev.status !== 'attention' && next.status === 'attention') {
    return {
      reason: 'attention',
      title: 'Agent needs you',
      body: next.title ?? 'Waiting for input',
    }
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
