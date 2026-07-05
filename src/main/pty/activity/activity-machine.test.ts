import { describe, expect, it } from 'vitest'
import { ActivityMachine } from './activity-machine'

const AGENT_BUSY = '✳ Working…'
const AGENT_IDLE = '✳ Claude Code'

describe('ActivityMachine — shell mode', () => {
  it('goes busy on commandStart and idle on commandEnd', () => {
    const m = new ActivityMachine()
    expect(m.apply({ kind: 'commandStart' }, 1000).status).toBe('busy')
    expect(m.current.commandStartedAt).toBe(1000)
    const s = m.apply({ kind: 'commandEnd', exitCode: 0 }, 5000)
    expect(s.status).toBe('idle')
    expect(s.lastExitCode).toBe(0)
  })

  it('tracks OSC 9;4 progress as busy/idle', () => {
    const m = new ActivityMachine()
    expect(m.apply({ kind: 'progress', active: true }, 0).status).toBe('busy')
    expect(m.apply({ kind: 'progress', active: false }, 0).status).toBe('idle')
  })
})

describe('ActivityMachine — agent mode', () => {
  it('switches to agent mode on a Claude-branded title and goes busy on spinner', () => {
    const m = new ActivityMachine()
    const s = m.apply({ kind: 'title', text: AGENT_BUSY }, 0)
    expect(s.mode).toBe('agent')
    expect(s.status).toBe('busy')
  })

  it('raises attention when the agent title reverts to idle branding', () => {
    const m = new ActivityMachine()
    m.apply({ kind: 'title', text: AGENT_BUSY }, 0)
    const s = m.apply({ kind: 'title', text: AGENT_IDLE }, 100)
    expect(s.status).toBe('attention')
  })

  it('clears attention when a new agent turn starts', () => {
    const m = new ActivityMachine()
    m.apply({ kind: 'title', text: AGENT_BUSY }, 0)
    m.apply({ kind: 'title', text: AGENT_IDLE }, 100)
    expect(m.apply({ kind: 'title', text: AGENT_BUSY }, 200).status).toBe('busy')
  })

  it('in agent mode, OSC 133 (the long claude span) does not override title state', () => {
    const m = new ActivityMachine()
    m.apply({ kind: 'title', text: AGENT_BUSY }, 0)
    // The shell wraps `claude` in one long C..D span; a stray C must not matter.
    expect(m.apply({ kind: 'commandStart' }, 10).status).toBe('busy')
  })
})
