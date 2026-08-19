import { describe, expect, it } from 'vitest'
import { decideNotification } from './notification-policy'
import type { SessionActivity } from './types'

const base: SessionActivity = {
  status: 'idle',
  mode: 'shell',
  title: null,
  commandStartedAt: null,
  lastExitCode: null,
  reason: null,
  detail: null,
  hookDriven: false,
  changedAt: 0,
}
const bg = { windowFocused: false, sessionVisible: false }

describe('decideNotification', () => {
  it('fires on agent attention edge when backgrounded', () => {
    const d = decideNotification({
      prev: { ...base, mode: 'agent', status: 'busy' },
      next: { ...base, mode: 'agent', status: 'attention' },
      now: 0,
      focus: bg,
    })
    expect(d?.reason).toBe('attention')
  })

  it('fires when a long shell command finishes', () => {
    const d = decideNotification({
      prev: { ...base, status: 'busy', commandStartedAt: 0 },
      next: { ...base, status: 'idle', lastExitCode: 0, commandStartedAt: 0 },
      now: 10_000,
      focus: bg,
    })
    expect(d?.reason).toBe('done')
  })

  it('does not fire for a quick successful command', () => {
    const d = decideNotification({
      prev: { ...base, status: 'busy', commandStartedAt: 0 },
      next: { ...base, status: 'idle', lastExitCode: 0, commandStartedAt: 0 },
      now: 3_000,
      focus: bg,
    })
    expect(d).toBeNull()
  })

  it('fires on a nonzero exit, but not for 130/143', () => {
    const mk = (code: number) =>
      decideNotification({
        prev: { ...base, status: 'busy', commandStartedAt: 0 },
        next: { ...base, status: 'idle', lastExitCode: code, commandStartedAt: 0 },
        now: 1_000,
        focus: bg,
      })
    expect(mk(1)?.reason).toBe('failed')
    expect(mk(130)).toBeNull()
    expect(mk(143)).toBeNull()
  })

  it('suppresses when the window is focused and the session is visible', () => {
    const d = decideNotification({
      prev: { ...base, mode: 'agent', status: 'busy' },
      next: { ...base, mode: 'agent', status: 'attention' },
      now: 0,
      focus: { windowFocused: true, sessionVisible: true },
    })
    expect(d).toBeNull()
  })

  it('still fires when focused but the session is NOT the visible one', () => {
    const d = decideNotification({
      prev: { ...base, mode: 'agent', status: 'busy' },
      next: { ...base, mode: 'agent', status: 'attention' },
      now: 0,
      focus: { windowFocused: true, sessionVisible: false },
    })
    expect(d?.reason).toBe('attention')
  })

  it('names the agent\'s own reason when it is blocked on permission', () => {
    // Arrange
    const prev: SessionActivity = { ...base, mode: 'agent', status: 'busy', hookDriven: true }
    const next: SessionActivity = {
      ...prev,
      status: 'attention',
      reason: 'permission',
      detail: 'Claude needs your permission',
    }

    // Act
    const d = decideNotification({ prev, next, now: 0, focus: bg })

    // Assert
    expect(d?.reason).toBe('permission')
    expect(d?.title).toBe('Agent needs permission')
    expect(d?.body).toBe('Claude needs your permission')
  })

  it('distinguishes a finished turn from a permission prompt', () => {
    const prev: SessionActivity = { ...base, mode: 'agent', status: 'busy', hookDriven: true }
    const next: SessionActivity = { ...prev, status: 'attention', reason: 'turnDone' }

    const d = decideNotification({ prev, next, now: 0, focus: bg })

    expect(d?.reason).toBe('attention')
    expect(d?.title).toBe('Agent finished its turn')
  })

  it('fires again when an agent that finished its turn then asks permission', () => {
    // Without this, a Stop immediately followed by a permission prompt would be
    // swallowed — both are `attention`, so only the reason distinguishes them.
    const prev: SessionActivity = {
      ...base,
      mode: 'agent',
      status: 'attention',
      reason: 'turnDone',
      hookDriven: true,
    }
    const next: SessionActivity = { ...prev, reason: 'permission', detail: 'Approve edit?' }

    const d = decideNotification({ prev, next, now: 0, focus: bg })

    expect(d?.reason).toBe('permission')
  })

  it('does not re-fire while an agent sits in the same attention state', () => {
    const prev: SessionActivity = {
      ...base,
      mode: 'agent',
      status: 'attention',
      reason: 'turnDone',
    }

    const d = decideNotification({ prev, next: { ...prev }, now: 5_000, focus: bg })

    expect(d).toBeNull()
  })
})