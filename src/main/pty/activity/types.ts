// Typed events emitted by the streaming OSC parser.
export type OscEvent =
  | { kind: 'commandStart' } // OSC 133;C
  | { kind: 'commandEnd'; exitCode: number | null } // OSC 133;D[;code]
  | { kind: 'progress'; active: boolean } // OSC 9;4;state;pct
  | { kind: 'title'; text: string } // OSC 0/2;text

export type ActivityStatus = 'idle' | 'busy' | 'attention'
export type ActivityMode = 'shell' | 'agent'

/**
 * Why a session is asking for the user. Only a first-party agent hook can tell
 * these apart — from the outside, a permission prompt and a finished turn look
 * identical (the spinner stops either way).
 */
export type AttentionReason = 'permission' | 'turnDone'

export interface SessionActivity {
  status: ActivityStatus
  mode: ActivityMode
  title: string | null
  commandStartedAt: number | null
  lastExitCode: number | null
  /** Set alongside `status: 'attention'`; null otherwise. */
  reason: AttentionReason | null
  /** The agent's own words for why it needs the user, when it said so. */
  detail: string | null
  /**
   * True once a first-party agent hook has reported for this session. Window
   * titles are a guess about what an agent is doing; hooks are the agent saying
   * it outright. Once one has spoken, titles stop driving status and only supply
   * the label.
   */
  hookDriven: boolean
  /**
   * When `status` last changed. The renderer derives "stale" from this rather
   * than main running a timer per session.
   */
  changedAt: number
}

export const IDLE_ACTIVITY: SessionActivity = {
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
