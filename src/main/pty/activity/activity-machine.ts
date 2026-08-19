import { IDLE_ACTIVITY, type OscEvent, type SessionActivity } from './types'
import type { AgentHookEvent } from '../../agent/hook-event'
import { READY_GLYPH, WORKING_GLYPHS } from '@shared/terminal-title'

// How wTerm reads an agent's window title.
//
// The glyph alphabet lives in @shared/terminal-title, shared with the stripper
// that turns a title into a tab label — the two must never disagree. ✳ is the
// *resting* mark, not a working frame; reading it as work is what left every
// agent session pinned "busy" and made the attention cue fire meaninglessly.
//
// The working set is an explicit allow-list rather than "any leading symbol",
// because plenty of shells title their window `~/some/path` and a `~` must not
// read as an agent at work.
const WORKING_PREFIX = new RegExp(`^[${WORKING_GLYPHS}]`)
const READY_PREFIX = new RegExp(`^${READY_GLYPH}`)
// A title that names the agent but carries no glyph at all — still an agent.
const AGENT_BRANDING = /claude code/i

type TitleReading = 'working' | 'ready' | null

function readTitle(title: string): TitleReading {
  if (READY_PREFIX.test(title)) return 'ready'
  if (WORKING_PREFIX.test(title)) return 'working'
  if (AGENT_BRANDING.test(title)) return 'ready'
  return null
}

export class ActivityMachine {
  current: SessionActivity = { ...IDLE_ACTIVITY }
  private oscSpanOpen = false

  /**
   * Merge a partial update. `changedAt` advances only when `status` does, so it
   * measures how long a session has held its current state — which is what the
   * renderer needs to call an agent stale.
   */
  private set(next: Partial<SessionActivity>, now: number): SessionActivity {
    const merged = { ...this.current, ...next }
    this.current =
      merged.status === this.current.status ? merged : { ...merged, changedAt: now }
    return this.current
  }

  /** Apply a terminal escape-sequence event. */
  apply(event: OscEvent, now: number): SessionActivity {
    switch (event.kind) {
      case 'title':
        return this.applyTitle(event.text, now)
      case 'commandStart':
        if (this.current.mode === 'agent') return this.current // the agent drives
        this.oscSpanOpen = true
        return this.set(
          { status: 'busy', commandStartedAt: now, lastExitCode: null, reason: null },
          now
        )
      case 'commandEnd':
        if (this.current.mode === 'agent') return this.current
        this.oscSpanOpen = false
        return this.set({ status: 'idle', lastExitCode: event.exitCode, reason: null }, now)
      case 'progress':
        if (this.current.mode === 'agent') return this.current
        if (event.active) return this.set({ status: 'busy', commandStartedAt: now }, now)
        if (this.oscSpanOpen) return this.current // 133 span still authoritative
        return this.set({ status: 'idle' }, now)
      default:
        return this.current
    }
  }

  private applyTitle(text: string, now: number): SessionActivity {
    const reading = readTitle(text)
    if (reading === null) return this.set({ title: text }, now)

    // A hook has spoken for this session, so the title is only a label now.
    if (this.current.hookDriven) return this.set({ mode: 'agent', title: text }, now)

    if (reading === 'working') {
      return this.set({ mode: 'agent', title: text, status: 'busy', reason: null }, now)
    }
    // Resting glyph. Coming off work, that means the turn ended and the user is
    // needed; from any other state it is just an agent sitting at its prompt.
    if (this.current.status !== 'busy') return this.set({ mode: 'agent', title: text }, now)
    return this.set({ mode: 'agent', title: text, status: 'attention', reason: 'turnDone' }, now)
  }

  /**
   * Apply a first-party hook event. These outrank titles: the agent is stating
   * what it is doing rather than us inferring it from a spinner, and only a hook
   * can tell a permission prompt apart from a finished turn.
   */
  applyAgent(event: AgentHookEvent, now: number): SessionActivity {
    switch (event.kind) {
      case 'promptSubmitted':
        return this.set(
          { mode: 'agent', hookDriven: true, status: 'busy', reason: null, detail: null },
          now
        )
      case 'needsInput':
        return this.set(
          {
            mode: 'agent',
            hookDriven: true,
            status: 'attention',
            reason: 'permission',
            detail: event.message,
          },
          now
        )
      case 'turnDone':
        return this.set(
          {
            mode: 'agent',
            hookDriven: true,
            status: 'attention',
            reason: 'turnDone',
            detail: null,
          },
          now
        )
      case 'sessionEnd':
        return this.set(
          {
            mode: 'shell',
            hookDriven: false,
            status: 'idle',
            reason: null,
            detail: null,
            title: null,
          },
          now
        )
      default:
        return this.current
    }
  }
}
