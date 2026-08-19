import { useNow } from '@renderer/hooks/use-now'
import type { AttentionMeta } from '@renderer/state/store'
import {
  indicatorColor,
  indicatorLabel,
  indicatorState,
  isPulsing,
  type IndicatorState,
} from '@renderer/lib/terminal-indicator'

/**
 * The one dot that says what a terminal is doing. Every place that shows
 * session state renders this, so the sidebar, the project row and the bottom
 * dock can't drift into disagreeing about the same session.
 */

/** How often the dot re-evaluates its own age. Coarse — staleness is minutes. */
const AGE_TICK_MS = 30_000

interface Props {
  busy: boolean
  attention: boolean
  unread: boolean
  meta?: AttentionMeta
  /** Size classes; defaults to the sidebar's 8px dot. */
  className?: string
}

export function ActivityDot({ busy, attention, unread, meta, className = 'w-2 h-2' }: Props) {
  const now = useNow(AGE_TICK_MS)
  const state = indicatorState({
    busy,
    attention,
    unread,
    reason: meta?.reason ?? null,
    changedAt: meta?.changedAt ?? 0,
    now,
  })
  const label = indicatorLabel(state, meta?.detail ?? null)

  return (
    <span
      className={[
        'activity-dot inline-block rounded-full flex-shrink-0',
        className,
        indicatorColor(state),
        isPulsing(state) ? `activity-dot--${state}` : '',
        // Idle keeps a transparent slot so labels never shift as state changes.
        state === 'stale' ? 'activity-dot--stale' : '',
      ].join(' ')}
      title={label || undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
    />
  )
}

/**
 * The strongest state across a set of terminals, for a collapsed project row.
 * Ordered by how much it wants the user: something blocked outranks something
 * merely finished, which outranks unseen output.
 */
const PRIORITY: IndicatorState[] = ['stale', 'blocked', 'needsInput', 'working', 'unread', 'idle']

export function strongestState(states: IndicatorState[]): IndicatorState {
  for (const candidate of PRIORITY) {
    if (states.includes(candidate)) return candidate
  }
  return 'idle'
}
