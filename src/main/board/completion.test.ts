import { describe, expect, it } from 'vitest'
import type { CardRun } from '@shared/types'
import { decideActivity } from './completion'

function run(over: Partial<CardRun> = {}): CardRun {
  return {
    terminalId: 't1',
    worktreePath: '/tmp/wt',
    branch: 'card/1',
    startedAt: '2026-01-01T00:00:00.000Z',
    started: false,
    ...over,
  }
}

describe('decideActivity', () => {
  it('marks a run started the first time it reports busy', () => {
    expect(decideActivity(run(), 'busy')).toEqual({ kind: 'mark-started' })
  })

  it('ignores idle before the agent has ever been busy', () => {
    expect(decideActivity(run({ started: false }), 'idle')).toEqual({ kind: 'ignore' })
  })

  it('arms completion when a started run goes idle', () => {
    expect(decideActivity(run({ started: true }), 'idle')).toEqual({ kind: 'arm-completion' })
  })

  it('holds the worker on attention instead of completing', () => {
    expect(decideActivity(run({ started: true }), 'attention')).toEqual({ kind: 'hold' })
  })

  it('holds on attention even before the run has started', () => {
    expect(decideActivity(run({ started: false }), 'attention')).toEqual({ kind: 'hold' })
  })

  it('cancels a pending completion when the agent goes busy again', () => {
    expect(decideActivity(run({ started: true }), 'busy')).toEqual({ kind: 'cancel-completion' })
  })

  it('ignores everything once the run has ended', () => {
    const ended = run({ started: true, endedAt: '2026-01-01T00:01:00.000Z' })

    expect(decideActivity(ended, 'idle')).toEqual({ kind: 'ignore' })
    expect(decideActivity(ended, 'busy')).toEqual({ kind: 'ignore' })
    expect(decideActivity(ended, 'attention')).toEqual({ kind: 'ignore' })
  })

  it('ignores activity for a card with no run', () => {
    expect(decideActivity(undefined, 'idle')).toEqual({ kind: 'ignore' })
  })
})
