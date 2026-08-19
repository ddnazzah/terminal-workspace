import { describe, expect, it } from 'vitest'
import { indicatorState, STALE_AFTER_MS, type IndicatorInput } from './terminal-indicator'

const base: IndicatorInput = {
  busy: false,
  attention: false,
  unread: false,
  reason: null,
  changedAt: 0,
  now: 0,
}

describe('indicatorState', () => {
  it('shows nothing for a session with no news', () => {
    expect(indicatorState(base)).toBe('idle')
  })

  it('shows working while a command or turn is running', () => {
    expect(indicatorState({ ...base, busy: true })).toBe('working')
  })

  it('does not ask for the user while work is still running', () => {
    // A stale attention flag left over from the previous turn must not outrank
    // the fact that the agent has started working again.
    expect(indicatorState({ ...base, busy: true, attention: true })).toBe('working')
  })

  it('separates a finished turn from a blocked approval', () => {
    const attention = { ...base, attention: true, changedAt: 1_000, now: 1_000 }
    expect(indicatorState({ ...attention, reason: 'turnDone' })).toBe('needsInput')
    expect(indicatorState({ ...attention, reason: 'permission' })).toBe('blocked')
  })

  it('escalates to stale once a request goes unanswered', () => {
    const attention = { ...base, attention: true, reason: 'permission' as const, changedAt: 1_000 }

    expect(indicatorState({ ...attention, now: 1_000 + STALE_AFTER_MS - 1 })).toBe('blocked')
    expect(indicatorState({ ...attention, now: 1_000 + STALE_AFTER_MS })).toBe('stale')
  })

  it('does not call a session stale when its age is unknown', () => {
    // changedAt 0 means main never reported a transition for this session.
    expect(indicatorState({ ...base, attention: true, changedAt: 0, now: 9_999_999 })).toBe(
      'needsInput'
    )
  })

  it('ranks a request for the user above unseen output', () => {
    expect(indicatorState({ ...base, attention: true, unread: true })).toBe('needsInput')
  })

  it('falls back to unread when nothing is waiting on the user', () => {
    expect(indicatorState({ ...base, unread: true })).toBe('unread')
  })
})
