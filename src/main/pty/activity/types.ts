// Typed events emitted by the streaming OSC parser.
export type OscEvent =
  | { kind: 'commandStart' } // OSC 133;C
  | { kind: 'commandEnd'; exitCode: number | null } // OSC 133;D[;code]
  | { kind: 'progress'; active: boolean } // OSC 9;4;state;pct
  | { kind: 'title'; text: string } // OSC 0/2;text

export type ActivityStatus = 'idle' | 'busy' | 'attention'
export type ActivityMode = 'shell' | 'agent'

export interface SessionActivity {
  status: ActivityStatus
  mode: ActivityMode
  title: string | null
  commandStartedAt: number | null
  lastExitCode: number | null
}

export const IDLE_ACTIVITY: SessionActivity = {
  status: 'idle',
  mode: 'shell',
  title: null,
  commandStartedAt: null,
  lastExitCode: null,
}
