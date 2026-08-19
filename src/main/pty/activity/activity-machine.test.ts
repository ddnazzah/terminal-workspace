import { describe, expect, it } from 'vitest'
import { ActivityMachine } from './activity-machine'

// Real titles, captured by running Claude Code 2.1.235 under a pty and reading
// the OSC 0 sequences off the raw stream. The glyph carries the state: a
// rotating circle while it works, ✳ once it is idle and waiting on you.
const AGENT_START = '✳ Claude Code'
const AGENT_WORKING = '◐ Claude Code'
const AGENT_WORKING_TASK = '◑ OK'
const AGENT_READY_TASK = '✳ OK'
// Older builds spun with braille frames; both alphabets have to keep working.
const AGENT_WORKING_BRAILLE = '⠹ Exploring the codebase'

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

  it('leaves a plain shell title alone — a path is not an agent', () => {
    const m = new ActivityMachine()
    const s = m.apply({ kind: 'title', text: '~/Workspace/wTerm' }, 0)
    expect(s.mode).toBe('shell')
    expect(s.status).toBe('idle')
    expect(s.title).toBe('~/Workspace/wTerm')
  })

  it('stamps changedAt only when the status actually changes', () => {
    const m = new ActivityMachine()
    m.apply({ kind: 'commandStart' }, 1000)
    expect(m.current.changedAt).toBe(1000)
    m.apply({ kind: 'title', text: 'building' }, 2000)
    expect(m.current.changedAt).toBe(1000)
  })
})

describe('ActivityMachine — agent titles', () => {
  it('reads a spinner glyph as working', () => {
    const m = new ActivityMachine()
    const s = m.apply({ kind: 'title', text: AGENT_WORKING }, 0)
    expect(s.mode).toBe('agent')
    expect(s.status).toBe('busy')
  })

  it('reads a spinner glyph as working when the title is a task, not branding', () => {
    const m = new ActivityMachine()
    // The regression: this title has no "Claude Code" in it and the glyph is a
    // circle, not braille — the old detector scored it as a plain shell title
    // and left the session pinned busy forever.
    const s = m.apply({ kind: 'title', text: AGENT_WORKING_TASK }, 0)
    expect(s.mode).toBe('agent')
    expect(s.status).toBe('busy')
  })

  it('still reads braille spinner frames as working', () => {
    const m = new ActivityMachine()
    expect(m.apply({ kind: 'title', text: AGENT_WORKING_BRAILLE }, 0).status).toBe('busy')
  })

  it('reads the ✳ glyph as idle, not as work', () => {
    const m = new ActivityMachine()
    const s = m.apply({ kind: 'title', text: AGENT_START }, 0)
    expect(s.mode).toBe('agent')
    expect(s.status).toBe('idle')
  })

  it('raises attention when the spinner stops on a task title', () => {
    const m = new ActivityMachine()
    m.apply({ kind: 'title', text: AGENT_WORKING_TASK }, 0)
    const s = m.apply({ kind: 'title', text: AGENT_READY_TASK }, 100)
    expect(s.status).toBe('attention')
    expect(s.reason).toBe('turnDone')
    expect(s.changedAt).toBe(100)
  })

  it('does not raise attention for a session that never started working', () => {
    const m = new ActivityMachine()
    // Launching claude and walking away is not something to be notified about.
    const s = m.apply({ kind: 'title', text: AGENT_START }, 0)
    expect(s.status).toBe('idle')
  })

  it('clears attention when the next turn starts', () => {
    const m = new ActivityMachine()
    m.apply({ kind: 'title', text: AGENT_WORKING_TASK }, 0)
    m.apply({ kind: 'title', text: AGENT_READY_TASK }, 100)
    const s = m.apply({ kind: 'title', text: AGENT_WORKING_TASK }, 200)
    expect(s.status).toBe('busy')
    expect(s.reason).toBeNull()
  })

  it('in agent mode, OSC 133 (the long claude span) does not override title state', () => {
    const m = new ActivityMachine()
    m.apply({ kind: 'title', text: AGENT_WORKING }, 0)
    // The shell wraps `claude` in one long C..D span; a stray C must not matter.
    expect(m.apply({ kind: 'commandStart' }, 10).status).toBe('busy')
  })
})

describe('ActivityMachine — agent hooks', () => {
  it('marks a submitted prompt as work', () => {
    const m = new ActivityMachine()
    const s = m.applyAgent({ kind: 'promptSubmitted' }, 500)
    expect(s.mode).toBe('agent')
    expect(s.status).toBe('busy')
    expect(s.hookDriven).toBe(true)
    expect(s.changedAt).toBe(500)
  })

  it('distinguishes a permission prompt from a finished turn', () => {
    const m = new ActivityMachine()
    m.applyAgent({ kind: 'promptSubmitted' }, 0)
    const blocked = m.applyAgent(
      { kind: 'needsInput', message: 'Claude needs your permission' },
      100
    )
    expect(blocked.status).toBe('attention')
    expect(blocked.reason).toBe('permission')
    expect(blocked.detail).toBe('Claude needs your permission')

    const done = m.applyAgent({ kind: 'turnDone' }, 200)
    expect(done.status).toBe('attention')
    expect(done.reason).toBe('turnDone')
  })

  it('raises attention on a finished turn even without a preceding prompt', () => {
    // A resumed session's first hook can be the Stop of a turn wTerm never saw
    // start; it still needs the user.
    const m = new ActivityMachine()
    expect(m.applyAgent({ kind: 'turnDone' }, 0).status).toBe('attention')
  })

  it('lets titles keep labelling the session but not steer it', () => {
    const m = new ActivityMachine()
    m.applyAgent({ kind: 'needsInput', message: 'Claude needs your permission' }, 0)
    // The spinner may still be animating on screen as the prompt renders.
    const s = m.apply({ kind: 'title', text: AGENT_WORKING_TASK }, 100)
    expect(s.title).toBe(AGENT_WORKING_TASK)
    expect(s.status).toBe('attention')
    expect(s.reason).toBe('permission')
  })

  it('hands the session back to the shell when the agent exits', () => {
    const m = new ActivityMachine()
    m.applyAgent({ kind: 'promptSubmitted' }, 0)
    const s = m.applyAgent({ kind: 'sessionEnd' }, 100)
    expect(s.status).toBe('idle')
    expect(s.mode).toBe('shell')
    expect(s.hookDriven).toBe(false)
    expect(s.reason).toBeNull()
  })

  it('lets the shell drive again after the agent exits', () => {
    const m = new ActivityMachine()
    m.applyAgent({ kind: 'promptSubmitted' }, 0)
    m.applyAgent({ kind: 'sessionEnd' }, 100)
    expect(m.apply({ kind: 'commandStart' }, 200).status).toBe('busy')
  })
})
