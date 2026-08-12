// Pure activity → card-lifecycle mapping.
//
// The subtle rules live here, both learned from how wTerm's activity detector
// actually behaves:
//
//  1. A freshly created PTY reports `idle` before the agent has started, so a
//     run is only completable after it has first reported `busy`.
//  2. `attention` is the BEL — the agent asking for permission or clarification
//     mid-task, NOT finishing. It must hold the worker slot, never complete the
//     card. Treating it as completion would file half-done work into Review and
//     hand the worker to the next card.

import type { ActivityStatus, CardRun } from '@shared/types'

/** Milliseconds an agent must stay idle before its card moves to Review. */
export const COMPLETION_DEBOUNCE_MS = 5_000

export type ActivityDecision =
  /** nothing to do */
  | { kind: 'ignore' }
  /** the agent has begun working; the run becomes completable */
  | { kind: 'mark-started' }
  /** BEL: flag the card as needing input, keep the slot held */
  | { kind: 'hold' }
  /** idle on a started run: start the debounce timer toward Review */
  | { kind: 'arm-completion' }
  /** working again: drop any pending completion */
  | { kind: 'cancel-completion' }

export function decideActivity(
  run: CardRun | undefined,
  status: ActivityStatus
): ActivityDecision {
  if (!run || run.endedAt) return { kind: 'ignore' }

  if (status === 'attention') return { kind: 'hold' }

  if (status === 'busy') {
    return run.started ? { kind: 'cancel-completion' } : { kind: 'mark-started' }
  }

  // idle
  return run.started ? { kind: 'arm-completion' } : { kind: 'ignore' }
}
