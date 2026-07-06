import { IDLE_ACTIVITY, type OscEvent, type SessionActivity } from './types'

// Ported from terminal-pane.tsx:69-91.
const SPINNER_PREFIX = /^[✳⠀-⣿]/
// A title that looks like Claude Code branding but NOT actively working.
const AGENT_IDLE_BRANDING = /claude code/i

function titleIndicatesWork(title: string): boolean {
  return SPINNER_PREFIX.test(title) && !AGENT_IDLE_BRANDING.test(title)
}

function looksLikeAgent(title: string): boolean {
  return SPINNER_PREFIX.test(title) || AGENT_IDLE_BRANDING.test(title)
}

export class ActivityMachine {
  current: SessionActivity = { ...IDLE_ACTIVITY }
  private oscSpanOpen = false

  private set(next: Partial<SessionActivity>): SessionActivity {
    this.current = { ...this.current, ...next }
    return this.current
  }

  apply(event: OscEvent, now: number): SessionActivity {
    switch (event.kind) {
      case 'title': {
        const text = event.text
        if (looksLikeAgent(text)) {
          if (titleIndicatesWork(text)) {
            return this.set({ mode: 'agent', title: text, status: 'busy' })
          }
          // Reverted to idle branding = turn done → attention (only from busy).
          const status = this.current.status === 'busy' ? 'attention' : this.current.status
          return this.set({ mode: 'agent', title: text, status })
        }
        // Non-agent title: keep shell-mode status, just record the text.
        return this.set({ title: text })
      }
      case 'commandStart':
        if (this.current.mode === 'agent') return this.current // title drives agent
        this.oscSpanOpen = true
        return this.set({ status: 'busy', commandStartedAt: now, lastExitCode: null })
      case 'commandEnd':
        if (this.current.mode === 'agent') return this.current
        this.oscSpanOpen = false
        return this.set({ status: 'idle', lastExitCode: event.exitCode })
      case 'progress':
        if (this.current.mode === 'agent') return this.current
        if (event.active) return this.set({ status: 'busy', commandStartedAt: now })
        if (this.oscSpanOpen) return this.current // 133 span still authoritative
        return this.set({ status: 'idle' })
      default:
        return this.current
    }
  }
}
