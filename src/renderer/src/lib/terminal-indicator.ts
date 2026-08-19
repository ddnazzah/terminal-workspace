import type { AttentionReason } from '@shared/types'

// What the dot next to a terminal means.
//
// One function, so the sidebar, the project row and the bottom dock can never
// drift into telling the user different things about the same session.

export type IndicatorState =
  /** Nothing to report. */
  | 'idle'
  /** A command or an agent turn is running. */
  | 'working'
  /** Backgrounded output the user hasn't seen, but nothing is waiting on them. */
  | 'unread'
  /** The agent finished its turn and is waiting for the user. */
  | 'needsInput'
  /** Blocked on an approval — the strongest cue, because work is stopped. */
  | 'blocked'
  /** Has been waiting on the user long enough that it is being forgotten. */
  | 'stale'

/**
 * How long a session may sit waiting on the user before the cue escalates.
 * Long enough that glancing away doesn't trip it, short enough to catch a
 * session that got buried behind other work.
 */
export const STALE_AFTER_MS = 5 * 60_000

export interface IndicatorInput {
  busy: boolean
  attention: boolean
  unread: boolean
  reason: AttentionReason | null
  /** When the session entered its current state. */
  changedAt: number
  now: number
}

export function indicatorState(input: IndicatorInput): IndicatorState {
  const { busy, attention, unread, reason, changedAt, now } = input

  // Work in progress outranks everything: nothing is being asked of the user.
  if (busy) return 'working'

  if (attention) {
    // An unanswered request ages into `stale` regardless of why it was raised —
    // a permission prompt nobody answers is exactly what gets lost.
    if (changedAt > 0 && now - changedAt >= STALE_AFTER_MS) return 'stale'
    return reason === 'permission' ? 'blocked' : 'needsInput'
  }

  return unread ? 'unread' : 'idle'
}

/** Whether a state should draw a pulsing halo rather than a flat dot. */
export function isPulsing(state: IndicatorState): boolean {
  return state === 'working' || state === 'needsInput' || state === 'blocked'
}

/**
 * Shape and colour for the dot.
 *
 * Shape carries the meaning, colour only refines it: a **hollow ring** means
 * work is in flight and nothing is being asked of you, a **filled dot** means
 * something wants you. That way the two most common states can't be confused
 * at a glance — reading "yellow vs orange" in an 8px circle is a bad ask, but
 * hollow vs solid is legible from across the screen.
 */
export function indicatorColor(state: IndicatorState): string {
  switch (state) {
    case 'working':
      return 'bg-transparent border-2 border-accent'
    case 'blocked':
      return 'bg-red-500'
    case 'needsInput':
      return 'bg-orange-400'
    case 'stale':
      return 'bg-red-700'
    case 'unread':
      return 'bg-sky-400'
    default:
      return 'bg-transparent'
  }
}

/** Human wording for the tooltip and aria-label. */
export function indicatorLabel(state: IndicatorState, detail: string | null): string {
  switch (state) {
    case 'working':
      return 'Working'
    case 'blocked':
      return detail ?? 'Waiting on your approval'
    case 'needsInput':
      return 'Finished its turn — waiting for you'
    case 'stale':
      return `${detail ?? 'Waiting for you'} — unanswered for a while`
    case 'unread':
      return 'New output'
    default:
      return ''
  }
}
