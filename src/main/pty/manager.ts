import { spawn, type IPty } from 'node-pty'
import { BrowserWindow } from 'electron'
import { IPC } from '@shared/types'
import type {
  SessionActivityPayload,
  TerminalDataPayload,
  TerminalExitPayload,
  TerminalId,
} from '@shared/types'
import { getDefaultShell, prepareShellIntegration } from './shell-integration'
import { OscParser } from './activity/osc-parser'
import { ActivityMachine } from './activity/activity-machine'
import type { SessionActivity } from './activity/types'
import type { AgentHookEvent } from '../agent/hook-event'
import { resolveRelease, resolveResize, type ResizeSource } from './resize-authority'

/** Notified on every session activity transition (for firing notifications). */
export type NotifyHook = (id: TerminalId, prev: SessionActivity, next: SessionActivity) => void

const COALESCE_MS = 16
const MAX_BUFFER_LINES = 10_000
// Startup commands are injected on the shell's first prompt marker (OSC 133;D
// from precmd — the rc has finished loading). Shells without integration never
// emit it, so a timer after first output serves as the fallback.
const INJECT_FALLBACK_MS = 1500

interface PtyEntry {
  id: TerminalId
  pty: IPty
  pendingData: string[]
  flushTimer: NodeJS.Timeout | null
  buffer: string[]
  /** Command to inject once, at the first prompt (or fallback); null once sent. */
  startupCommand: string | null
  /** Fallback injection timer for shells without integration; null once armed off. */
  injectFallback: NodeJS.Timeout | null
  /** Per-session activity detection fed from the raw PTY stream. */
  parser: OscParser
  machine: ActivityMachine
  /**
   * Last size the desktop asked for. While a phone is the active viewer it owns
   * the PTY size (so the running program renders for the phone), and desktop
   * resizes are recorded here but not applied — they're restored when the phone
   * stops viewing.
   */
  desktopSize: { cols: number; rows: number }
  /** True while a connected phone is the size authority for this terminal. */
  bridgeOwned: boolean
  /**
   * Dimensions the PTY currently has, so a resize request that changes nothing
   * is dropped instead of raising a needless SIGWINCH at the running program.
   */
  appliedSize: { cols: number; rows: number } | null
}

/**
 * Additional consumers of PTY lifecycle events beyond the desktop renderer
 * window (which is always fed via `webContents.send`). The mobile bridge
 * registers one sink to receive the same data/exit/create stream and fans it
 * out to connected phone clients. Sinks see every terminal; filtering by who
 * cares about which terminal is the sink's responsibility.
 */
export interface PtySink {
  onData?(p: TerminalDataPayload): void
  onExit?(p: TerminalExitPayload): void
  onCreate?(id: TerminalId): void
  onActivity?(p: SessionActivityPayload): void
}

export class PtyManager {
  private window: BrowserWindow | null = null
  private entries = new Map<TerminalId, PtyEntry>()
  private sinks = new Set<PtySink>()
  private activity = new Map<TerminalId, SessionActivity>()
  private notifyHook: NotifyHook | null = null

  /** Register the callback that fires notifications on activity transitions. */
  setNotifyHook(hook: NotifyHook): void {
    this.notifyHook = hook
  }

  /** Latest detected activity for a session, if any. */
  activityFor(id: TerminalId): SessionActivity | undefined {
    return this.activity.get(id)
  }

  attachWindow(win: BrowserWindow): void {
    this.window = win
    win.on('closed', () => {
      this.window = null
    })
  }

  /** Register an extra consumer of PTY events. Returns an unsubscribe function. */
  addSink(sink: PtySink): () => void {
    this.sinks.add(sink)
    return () => this.sinks.delete(sink)
  }

  /** Ids of all currently-live PTYs (used by the bridge to seed clients). */
  liveIds(): TerminalId[] {
    return [...this.entries.keys()]
  }

  private emitData(payload: TerminalDataPayload): void {
    this.window?.webContents.send(IPC.terminals.data, payload)
    for (const sink of this.sinks) sink.onData?.(payload)
  }

  private emitExit(payload: TerminalExitPayload): void {
    this.window?.webContents.send(IPC.terminals.exit, payload)
    for (const sink of this.sinks) sink.onExit?.(payload)
  }

  create(opts: {
    id: TerminalId
    cwd: string
    shell?: string
    cols?: number
    rows?: number
    startupCommand?: string
  }): void {
    if (this.entries.has(opts.id)) return

    const shell = opts.shell ?? getDefaultShell()
    const cols = opts.cols ?? 80
    const rows = opts.rows ?? 24
    // Advertise a modern terminal profile. Some TUIs gate richer behaviors
    // (OSC 9;4 taskbar progress, escape-sequence desktop notifications) on a
    // recognized TERM_PROGRAM and fall back to a capability-poor mode without
    // one. NB: Claude Code 2.x does NOT use these — it reports through its
    // window title, and (once wTerm's hooks are installed) through the agent
    // hook relay, which is what actually drives the busy/attention indicator.
    // This just keeps us on the capable path for other programs. TERM is
    // xterm-256color — wTerm's xterm.js front
    // end supports 256 colors + truecolor (terminfo for it is universally
    // present), so programs get full color with no multiplexer in between.
    const baseEnv = {
      ...process.env,
      TERM: 'xterm-256color',
      TERM_PROGRAM: 'ghostty',
      TERM_PROGRAM_VERSION: '1.1.0',
      // Identifies this terminal to agent hooks. Claude Code runs its hooks as
      // children of the agent, which is a child of this shell, so the variable
      // arrives intact however the agent was launched — typed by hand, through
      // a shell alias, or dispatched by the board. See main/agent/hook-server.ts.
      WTERM_TERMINAL_ID: opts.id,
    } as Record<string, string>
    const { args: shellArgs, env: preparedEnv } = prepareShellIntegration(shell, baseEnv)

    // Spawn the shell directly. Terminals don't persist across an app restart —
    // they're recreated fresh from saved state (see store/state.ts), which keeps
    // the terminal's behavior native (no TERM override, mouse capture, or
    // alternate-screen quirks that a multiplexer layer would introduce).
    const pty = spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: opts.cwd,
      env: preparedEnv,
    })

    // Normalize the startup script into something a shell will run: newlines
    // become carriage returns (Enter) and a trailing CR makes the last line fire.
    const rawStartup = opts.startupCommand?.trim() ?? ''
    const startupCommand = rawStartup
      ? rawStartup.replace(/\r?\n/g, '\r') + '\r'
      : null

    const entry: PtyEntry = {
      id: opts.id,
      pty,
      pendingData: [],
      flushTimer: null,
      buffer: [],
      startupCommand,
      injectFallback: null,
      parser: new OscParser(),
      machine: new ActivityMachine(),
      desktopSize: { cols, rows },
      bridgeOwned: false,
      // The PTY was spawned at these dimensions, so that is what it already has.
      appliedSize: { cols, rows },
    }
    this.entries.set(opts.id, entry)
    for (const sink of this.sinks) sink.onCreate?.(opts.id)

    pty.onData((data) => {
      entry.pendingData.push(data)
      entry.buffer.push(data)
      if (entry.buffer.length > MAX_BUFFER_LINES) {
        entry.buffer.splice(0, entry.buffer.length - MAX_BUFFER_LINES)
      }
      if (entry.flushTimer === null) {
        entry.flushTimer = setTimeout(() => this.flush(entry), COALESCE_MS)
      }
      // Detect session activity from the raw stream. A parser or machine fault
      // for one session must never break the PTY data path or other sessions.
      try {
        for (const ev of entry.parser.push(data)) {
          // First 133;D = precmd before the first prompt: the rc has loaded and
          // the shell is about to draw its prompt — inject the startup command
          // now, so it can't race a slow rc the way a fixed delay would.
          if (ev.kind === 'commandEnd') this.injectStartup(entry)
          const prev = entry.machine.current
          const next = entry.machine.apply(ev, Date.now())
          if (next !== prev) this.onActivityChange(entry.id, prev, next)
        }
      } catch (err) {
        console.error('[activity] detection error for', entry.id, err)
      }
      // Fallback for shells without integration (no 133;D will ever arrive):
      // inject a while after the first output.
      if (entry.startupCommand !== null && entry.injectFallback === null) {
        entry.injectFallback = setTimeout(() => this.injectStartup(entry), INJECT_FALLBACK_MS)
      }
    })

    pty.onExit(({ exitCode, signal }) => {
      if (entry.injectFallback !== null) {
        clearTimeout(entry.injectFallback)
        entry.injectFallback = null
      }
      this.flush(entry)
      this.entries.delete(opts.id)
      this.activity.delete(opts.id)
      const payload: TerminalExitPayload = { id: opts.id, exitCode, signal }
      this.emitExit(payload)
    })
  }

  /** Send the pending startup command to the shell, exactly once. */
  private injectStartup(entry: PtyEntry): void {
    if (entry.startupCommand === null) return
    const cmd = entry.startupCommand
    entry.startupCommand = null
    if (entry.injectFallback !== null) {
      clearTimeout(entry.injectFallback)
      entry.injectFallback = null
    }
    try {
      entry.pty.write(cmd)
    } catch {
      // pty may have exited already — ignore
    }
  }

  /**
   * Apply a first-party agent hook event to a session. Routed through the same
   * change path as escape-sequence detection, so the indicator, notifications
   * and the board all see it identically.
   */
  applyAgentEvent(id: TerminalId, event: AgentHookEvent): void {
    const entry = this.entries.get(id)
    if (!entry) return
    const prev = entry.machine.current
    const next = entry.machine.applyAgent(event, Date.now())
    if (next !== prev) this.onActivityChange(id, prev, next)
  }

  private onActivityChange(id: TerminalId, prev: SessionActivity, next: SessionActivity): void {
    this.activity.set(id, next)
    const payload: SessionActivityPayload = {
      id,
      status: next.status,
      title: next.title,
      exitCode: next.lastExitCode,
      reason: next.reason,
      detail: next.detail,
      changedAt: next.changedAt,
    }
    this.window?.webContents.send(IPC.terminals.activity, payload)
    for (const sink of this.sinks) sink.onActivity?.(payload)
    this.notifyHook?.(id, prev, next)
  }

  has(id: TerminalId): boolean {
    return this.entries.has(id)
  }

  write(id: TerminalId, data: string): void {
    const entry = this.entries.get(id)
    entry?.pty.write(data)
  }

  /**
   * Resize a PTY. A phone that is actively viewing a terminal becomes the size
   * authority (`source: 'bridge'`) so the running program renders for the phone,
   * not the desktop's wide grid. While a phone owns the size, desktop resizes
   * are remembered (to restore later) but not applied. See {@link releaseBridgeSize}.
   */
  resize(id: TerminalId, cols: number, rows: number, source: ResizeSource = 'desktop'): void {
    const entry = this.entries.get(id)
    if (!entry) return
    const { next, applied } = resolveResize(entry, cols, rows, source)
    entry.desktopSize = next.desktopSize
    entry.bridgeOwned = next.bridgeOwned
    entry.appliedSize = next.appliedSize
    if (applied) this.applyResize(entry, applied.cols, applied.rows)
  }

  /**
   * Hand size authority back to the desktop after the last phone stops viewing
   * a terminal, restoring the desktop's last-known dimensions so its grid stops
   * being pinned to the phone's width. No-op unless a phone currently owns it.
   */
  releaseBridgeSize(id: TerminalId): void {
    const entry = this.entries.get(id)
    if (!entry) return
    const { next, applied } = resolveRelease(entry)
    entry.bridgeOwned = next.bridgeOwned
    entry.appliedSize = next.appliedSize
    if (applied) this.applyResize(entry, applied.cols, applied.rows)
  }

  private applyResize(entry: PtyEntry, cols: number, rows: number): void {
    try {
      entry.pty.resize(cols, rows)
    } catch {
      // ignore — happens if pty is already gone
    }
  }

  kill(id: TerminalId): void {
    const entry = this.entries.get(id)
    if (!entry) return
    try {
      entry.pty.kill()
    } catch {
      // ignore
    }
  }

  /**
   * Returns everything the PTY has emitted so far and cancels any pending flush.
   * Pending chunks are already captured in `buffer`, so dropping the next flush
   * prevents the renderer from receiving them twice once it subscribes.
   */
  attach(id: TerminalId): string {
    const entry = this.entries.get(id)
    if (!entry) return ''
    if (entry.flushTimer !== null) {
      clearTimeout(entry.flushTimer)
      entry.flushTimer = null
    }
    entry.pendingData = []
    return entry.buffer.join('')
  }

  /**
   * Snapshot for a newly-attaching mobile-bridge client. Unlike {@link attach}
   * (which clears pending data to dedup for the sole desktop renderer), this
   * first flushes any pending bytes to all *current* consumers, then returns the
   * full buffer. The caller MUST add the client to its subscription set only
   * after this returns synchronously — that way the flushed bytes reach existing
   * consumers (not the new client) and every byte after the snapshot arrives via
   * the live sink exactly once, with no gap and no duplication.
   */
  snapshotForBridge(id: TerminalId): string {
    const entry = this.entries.get(id)
    if (!entry) return ''
    this.flush(entry)
    return entry.buffer.join('')
  }

  // Called on app quit. Kills every pty (and the shell + child processes running
  // in it); terminals are recreated fresh from persisted state on next launch.
  disposeAll(): void {
    for (const entry of this.entries.values()) {
      try {
        entry.pty.kill()
      } catch {
        // ignore
      }
    }
    this.entries.clear()
  }

  private flush(entry: PtyEntry): void {
    if (entry.flushTimer !== null) {
      clearTimeout(entry.flushTimer)
      entry.flushTimer = null
    }
    if (entry.pendingData.length === 0) return
    const data = entry.pendingData.join('')
    entry.pendingData = []
    const payload: TerminalDataPayload = { id: entry.id, data }
    this.emitData(payload)
  }
}
