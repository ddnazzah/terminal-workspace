import { describe, expect, it } from 'vitest'
import { DEFAULT_BOARD_SETTINGS, type BoardSettings, type Card, type CardStatus } from '@shared/types'
import { planTick } from './planner'

function card(over: Partial<Card> & { id: string }): Card {
  return {
    projectId: 'p1',
    number: 1,
    title: 'card',
    body: '',
    status: 'ready' as CardStatus,
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    log: [],
    ...over,
  }
}

function settings(over: Partial<BoardSettings> = {}): Record<string, BoardSettings> {
  return { p1: { ...DEFAULT_BOARD_SETTINGS, workerCount: 2, ...over } }
}

describe('planTick', () => {
  it('dispatches ready cards up to the worker count', () => {
    const cards = [
      card({ id: 'a', order: 0 }),
      card({ id: 'b', order: 1 }),
      card({ id: 'c', order: 2 }),
    ]

    const actions = planTick({ cards, settingsByProject: settings() })

    expect(actions.map((a) => a.cardId)).toEqual(['a', 'b'])
  })

  it('dispatches in ascending order, not array order', () => {
    const cards = [card({ id: 'late', order: 9 }), card({ id: 'early', order: 1 })]

    const actions = planTick({ cards, settingsByProject: settings({ workerCount: 1 }) })

    expect(actions.map((a) => a.cardId)).toEqual(['early'])
  })

  it('counts in-progress cards against the worker count', () => {
    const cards = [
      card({ id: 'running', status: 'in-progress' }),
      card({ id: 'queued', order: 1 }),
      card({ id: 'queued2', order: 2 }),
    ]

    const actions = planTick({ cards, settingsByProject: settings({ workerCount: 2 }) })

    expect(actions.map((a) => a.cardId)).toEqual(['queued'])
  })

  it('dispatches nothing when workerCount is 0', () => {
    const cards = [card({ id: 'a' })]

    expect(planTick({ cards, settingsByProject: settings({ workerCount: 0 }) })).toEqual([])
  })

  it('dispatches nothing when a project has no settings at all', () => {
    const cards = [card({ id: 'a' })]

    expect(planTick({ cards, settingsByProject: {} })).toEqual([])
  })

  it('ignores cards that are not ready', () => {
    const cards = [
      card({ id: 'backlog', status: 'backlog' }),
      card({ id: 'review', status: 'review' }),
      card({ id: 'done', status: 'done' }),
    ]

    expect(planTick({ cards, settingsByProject: settings() })).toEqual([])
  })

  it('does not dispatch when active runs already exceed a lowered worker count', () => {
    const cards = [
      card({ id: 'r1', status: 'in-progress' }),
      card({ id: 'r2', status: 'in-progress' }),
      card({ id: 'r3', status: 'in-progress' }),
      card({ id: 'queued', order: 5 }),
    ]

    expect(planTick({ cards, settingsByProject: settings({ workerCount: 1 }) })).toEqual([])
  })

  it('budgets each project independently', () => {
    const cards = [
      card({ id: 'p1a', projectId: 'p1' }),
      card({ id: 'p2a', projectId: 'p2' }),
    ]
    const settingsByProject = {
      p1: { ...DEFAULT_BOARD_SETTINGS, workerCount: 1 },
      p2: { ...DEFAULT_BOARD_SETTINGS, workerCount: 1 },
    }

    const actions = planTick({ cards, settingsByProject })

    expect(actions.map((a) => a.cardId).sort()).toEqual(['p1a', 'p2a'])
  })
})
