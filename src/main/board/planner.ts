// Pure dispatch planning: board state in, "dispatch this card" decisions out.
// The scheduler driver (scheduler.ts) is the only thing that performs effects,
// so every scheduling rule stays unit-testable without a PTY or a git repo.

import type { BoardSettings, Card, ProjectId } from '@shared/types'

export interface BoardTickInput {
  cards: Card[]
  settingsByProject: Record<ProjectId, BoardSettings>
}

export interface DispatchAction {
  type: 'dispatch'
  cardId: string
  projectId: ProjectId
}

export type BoardAction = DispatchAction

/** Cards occupying a worker slot right now. */
function activeRunCount(cards: Card[], projectId: ProjectId): number {
  return cards.filter((c) => c.projectId === projectId && c.status === 'in-progress').length
}

function readyQueue(cards: Card[], projectId: ProjectId): Card[] {
  return cards
    .filter((c) => c.projectId === projectId && c.status === 'ready')
    .sort((a, b) => a.order - b.order)
}

/**
 * Decide which ready cards should be dispatched right now. Called on every board
 * mutation and every activity transition; returns an empty list when there is
 * nothing to do, which is the common case.
 *
 * A project with no configured board (or `workerCount: 0`) never dispatches —
 * its board is a plain board. Lowering `workerCount` below the number of active
 * runs stops dispatching but never kills a run in flight.
 */
export function planTick(input: BoardTickInput): BoardAction[] {
  const actions: BoardAction[] = []

  for (const [projectId, settings] of Object.entries(input.settingsByProject)) {
    const workerCount = Math.max(0, settings.workerCount)
    if (workerCount === 0) continue

    const freeSlots = workerCount - activeRunCount(input.cards, projectId)
    if (freeSlots <= 0) continue

    for (const card of readyQueue(input.cards, projectId).slice(0, freeSlots)) {
      actions.push({ type: 'dispatch', cardId: card.id, projectId })
    }
  }

  return actions
}
