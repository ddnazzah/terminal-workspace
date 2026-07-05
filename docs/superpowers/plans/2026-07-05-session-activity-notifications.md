# Session Activity & Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make busy/attention indicators and notifications reliable by detecting session activity in the main process from the raw PTY stream, instead of the fragile renderer-side window-title heuristic.

**Architecture:** A streaming OSC parser + per-session state machine run inside `PtyManager` where all PTY output already flows. They produce one authoritative `SessionActivity` per session, emitted to the renderer over a new `terminals:activity` IPC event and fed to a pure notification policy that fires `system:notify`. The renderer becomes a consumer that writes existing Zustand fields. Detection has a shell mode (OSC 133 `C..D` span) and an agent mode (Claude title spinner).

**Tech Stack:** TypeScript, Electron main/preload/renderer, node-pty, Zustand, Vitest.

Spec: `docs/superpowers/specs/2026-07-01-session-activity-notifications-design.md`

---

## File Structure

**New (pure, unit-tested):**
- `src/main/pty/activity/osc-parser.ts` — streaming OSC scanner → typed events
- `src/main/pty/activity/osc-parser.test.ts`
- `src/main/pty/activity/activity-machine.ts` — folds events → `SessionActivity`
- `src/main/pty/activity/activity-machine.test.ts`
- `src/main/pty/activity/notification-policy.ts` — transition + focus → notify decision
- `src/main/pty/activity/notification-policy.test.ts`
- `src/main/pty/activity/types.ts` — shared activity types used by all three

**Modified:**
- `src/shared/types.ts` — `ActivityStatus`, `SessionActivityPayload`, IPC channels `terminals:activity` + `terminals:set-focused`
- `src/main/pty/manager.ts` — instantiate parser+machine per entry; emit activity; hold `activityBySession`
- `src/main/ipc/terminal.ts` — nothing structural (create already wires pty)
- `src/main/ipc/system.ts` — track window focus + focused session; expose `notifyForActivity`
- `src/main/index.ts` — pass focus state
- `src/preload/index.ts` — expose `terminals.onActivity`, `terminals.setFocused`
- `src/renderer/src/components/workspace/terminal-pane.tsx` — remove title/OSC detection; subscribe to activity
- `src/renderer/src/state/store.ts` — apply activity to `busyByTerminal`/`attentionByTerminal`/`titleByTerminal`; unread on background
- `src/renderer/src/app.tsx` — report focused session to main
- `src/renderer/src/components/settings-modal.tsx` — "Send test notification" row

---

## Phase A — Pure detection modules

### Task 1: Activity types

**Files:**
- Create: `src/main/pty/activity/types.ts`

- [ ] **Step 1: Write the types**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add src/main/pty/activity/types.ts
git commit -m "feat(activity): add shared activity types"
```

---

### Task 2: Streaming OSC parser

The parser is fed raw PTY chunks and must buffer an incomplete escape sequence across chunk boundaries. It recognizes OSC introduced by `\x1b]` and terminated by `BEL` (`\x07`) or `ESC \` (`\x1b\\`). It caps the retained tail so malformed unterminated OSC can't grow memory.

**Files:**
- Create: `src/main/pty/activity/osc-parser.ts`
- Test: `src/main/pty/activity/osc-parser.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { OscParser } from './osc-parser'
import type { OscEvent } from './types'

function feedAll(chunks: string[]): OscEvent[] {
  const p = new OscParser()
  const out: OscEvent[] = []
  for (const c of chunks) out.push(...p.push(c))
  return out
}

const BEL = '\x07'
const OSC = '\x1b]'

describe('OscParser', () => {
  it('parses command start / end with exit code (BEL-terminated)', () => {
    expect(feedAll([`${OSC}133;C${BEL}`])).toEqual([{ kind: 'commandStart' }])
    expect(feedAll([`${OSC}133;D;0${BEL}`])).toEqual([{ kind: 'commandEnd', exitCode: 0 }])
    expect(feedAll([`${OSC}133;D;130${BEL}`])).toEqual([{ kind: 'commandEnd', exitCode: 130 }])
  })

  it('parses command end with no code as null', () => {
    expect(feedAll([`${OSC}133;D${BEL}`])).toEqual([{ kind: 'commandEnd', exitCode: null }])
  })

  it('accepts ESC-backslash (ST) terminator', () => {
    expect(feedAll([`${OSC}133;C\x1b\\`])).toEqual([{ kind: 'commandStart' }])
  })

  it('parses titles from OSC 0 and OSC 2', () => {
    expect(feedAll([`${OSC}0;hello${BEL}`])).toEqual([{ kind: 'title', text: 'hello' }])
    expect(feedAll([`${OSC}2;✳ Claude Code${BEL}`])).toEqual([
      { kind: 'title', text: '✳ Claude Code' },
    ])
  })

  it('parses OSC 9;4 progress active vs inactive', () => {
    expect(feedAll([`${OSC}9;4;1;40${BEL}`])).toEqual([{ kind: 'progress', active: true }])
    expect(feedAll([`${OSC}9;4;0;0${BEL}`])).toEqual([{ kind: 'progress', active: false }])
  })

  it('reassembles a sequence split across chunks', () => {
    expect(feedAll([`${OSC}13`, `3;D;`, `0${BEL}`])).toEqual([
      { kind: 'commandEnd', exitCode: 0 },
    ])
  })

  it('ignores plain text and unrelated OSC', () => {
    expect(feedAll(['just some output\n', `${OSC}7;file:///x${BEL}`, 'more'])).toEqual([])
  })

  it('does not grow unbounded on an unterminated OSC', () => {
    const p = new OscParser()
    for (let i = 0; i < 1000; i++) p.push(`${OSC}133;C`.repeat(50)) // never terminated
    // Internal buffer must stay capped; a well-formed seq still parses afterward.
    expect(p.push(`\x07${OSC}133;D;0${BEL}`)).toContainEqual({ kind: 'commandEnd', exitCode: 0 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/main/pty/activity/osc-parser.test.ts`
Expected: FAIL — `OscParser` not found.

- [ ] **Step 3: Implement the parser**

```ts
import type { OscEvent } from './types'

const OSC_START = '\x1b]'
const BEL = '\x07'
// Cap the retained tail: longest thing we ever need to hold is a partial OSC.
// A real title can be long, but we don't need giant ones — 4 KiB is plenty and
// bounds memory if a stream never terminates a sequence.
const MAX_PENDING = 4096

/** Parse one OSC body (the text between `\x1b]` and the terminator). */
function parseBody(body: string): OscEvent | null {
  // 133;C | 133;D[;code]
  if (body === '133;C') return { kind: 'commandStart' }
  if (body === '133;D') return { kind: 'commandEnd', exitCode: null }
  if (body.startsWith('133;D;')) {
    const n = Number.parseInt(body.slice('133;D;'.length), 10)
    return { kind: 'commandEnd', exitCode: Number.isFinite(n) ? n : null }
  }
  // 9;4;state;pct  → busy while state is 1 (normal) or 2 (error/indeterminate)
  if (body.startsWith('9;4;')) {
    const state = body.split(';')[2]
    return { kind: 'progress', active: state === '1' || state === '2' }
  }
  // 0;title | 2;title
  if (body.startsWith('0;') || body.startsWith('2;')) {
    return { kind: 'title', text: body.slice(2) }
  }
  return null
}

export class OscParser {
  private pending = ''

  push(chunk: string): OscEvent[] {
    const events: OscEvent[] = []
    let buf = this.pending + chunk
    this.pending = ''

    for (;;) {
      const start = buf.indexOf(OSC_START)
      if (start === -1) {
        // No OSC opener. Keep only a short tail in case '\x1b' arrives split.
        this.pending = buf.slice(-1) === '\x1b' ? '\x1b' : ''
        break
      }
      const bodyStart = start + OSC_START.length
      // Find the terminator: BEL or ESC-backslash.
      const bel = buf.indexOf(BEL, bodyStart)
      const st = buf.indexOf('\x1b\\', bodyStart)
      let end = -1
      let termLen = 0
      if (bel !== -1 && (st === -1 || bel < st)) {
        end = bel
        termLen = 1
      } else if (st !== -1) {
        end = st
        termLen = 2
      }
      if (end === -1) {
        // Incomplete OSC — retain from the opener, capped.
        buf = buf.slice(start)
        this.pending = buf.length > MAX_PENDING ? buf.slice(-MAX_PENDING) : buf
        break
      }
      const body = buf.slice(bodyStart, end)
      const event = parseBody(body)
      if (event) events.push(event)
      buf = buf.slice(end + termLen)
    }
    return events
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/main/pty/activity/osc-parser.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/pty/activity/osc-parser.ts src/main/pty/activity/osc-parser.test.ts
git commit -m "feat(activity): streaming OSC parser with split-sequence handling"
```

---

### Task 3: Activity state machine

Ports the existing title heuristics from `terminal-pane.tsx:69-91` (`SPINNER_PREFIX`, `titleIndicatesWork`, `TITLE_IDLE_MS`). Shell mode is driven by OSC 133/9;4; agent mode (Claude-branded title) is driven by the title spinner. It exposes `apply(event, now)` returning the new `SessionActivity` (or the same reference if unchanged) and `onTitleIdleTimeout(now)` for the stall fallback.

**Files:**
- Create: `src/main/pty/activity/activity-machine.ts`
- Test: `src/main/pty/activity/activity-machine.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/main/pty/activity/activity-machine.test.ts`
Expected: FAIL — `ActivityMachine` not found.

- [ ] **Step 3: Implement the machine**

```ts
import { IDLE_ACTIVITY, type OscEvent, type SessionActivity } from './types'

// Ported from terminal-pane.tsx:69-91.
const SPINNER_PREFIX = /^[✳⠀-⣿]/
// A title that looks like Claude Code branding but NOT actively working.
const AGENT_IDLE_BRANDING = /claude code/i

function titleIndicatesWork(title: string): boolean {
  if (SPINNER_PREFIX.test(title) && !AGENT_IDLE_BRANDING.test(title)) return true
  return false
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
          const working = titleIndicatesWork(text)
          if (working) return this.set({ mode: 'agent', title: text, status: 'busy' })
          // Reverted to idle branding = turn done → attention (only from busy).
          const status = this.current.status === 'busy' ? 'attention' : this.current.status
          return this.set({ mode: 'agent', title: text, status })
        }
        // Non-agent title: keep whatever shell-mode status we have, just record it.
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/main/pty/activity/activity-machine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/pty/activity/activity-machine.ts src/main/pty/activity/activity-machine.test.ts
git commit -m "feat(activity): shell/agent-mode activity state machine"
```

---

### Task 4: Notification policy

Given the previous status, the new `SessionActivity`, the command duration, and focus context, decide whether to fire and with what payload.

**Files:**
- Create: `src/main/pty/activity/notification-policy.ts`
- Test: `src/main/pty/activity/notification-policy.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { decideNotification } from './notification-policy'
import type { SessionActivity } from './types'

const base: SessionActivity = {
  status: 'idle',
  mode: 'shell',
  title: null,
  commandStartedAt: null,
  lastExitCode: null,
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
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/main/pty/activity/notification-policy.test.ts`
Expected: FAIL — `decideNotification` not found.

- [ ] **Step 3: Implement the policy**

```ts
import type { SessionActivity } from './types'

export const LONG_COMMAND_MS = 10_000
// Interrupt / kill: not real failures worth a notification.
const NON_FAILURE_CODES = new Set([130, 143])

export type NotifyReason = 'attention' | 'done' | 'failed'

export interface NotifyDecision {
  reason: NotifyReason
  title: string
  body: string
}

export interface FocusContext {
  windowFocused: boolean
  sessionVisible: boolean
}

export interface DecideInput {
  prev: SessionActivity
  next: SessionActivity
  now: number
  focus: FocusContext
}

function isBackgrounded(focus: FocusContext): boolean {
  // Dot-only (no OS notification) when the app is focused AND this session is
  // the one on screen. Everything else is "backgrounded" for notify purposes.
  return !(focus.windowFocused && focus.sessionVisible)
}

export function decideNotification(input: DecideInput): NotifyDecision | null {
  const { prev, next, now, focus } = input
  if (!isBackgrounded(focus)) return null

  // Agent turn done → attention edge.
  if (next.mode === 'agent' && prev.status !== 'attention' && next.status === 'attention') {
    return { reason: 'attention', title: 'Agent needs you', body: next.title ?? 'Waiting for input' }
  }

  // Shell command finished (busy → idle).
  if (prev.status === 'busy' && next.status === 'idle') {
    const code = next.lastExitCode
    if (code !== null && code !== 0 && !NON_FAILURE_CODES.has(code)) {
      return { reason: 'failed', title: 'Command failed', body: `Exited with code ${code}` }
    }
    const started = next.commandStartedAt ?? prev.commandStartedAt
    if (started !== null && now - started >= LONG_COMMAND_MS) {
      return { reason: 'done', title: 'Command finished', body: next.title ?? 'Done' }
    }
  }
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/main/pty/activity/notification-policy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/pty/activity/notification-policy.ts src/main/pty/activity/notification-policy.test.ts
git commit -m "feat(activity): notification policy (thresholds, exit-code filter, focus)"
```

---

## Phase B — Main-process integration

### Task 5: Shared activity types + IPC channels

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add the payload + channels**

Add near the other payload types:

```ts
export type ActivityStatus = 'idle' | 'busy' | 'attention'
export type SessionActivityPayload = {
  id: TerminalId
  status: ActivityStatus
  title: string | null
  exitCode: number | null
}
export type SetFocusedPayload = { id: TerminalId | null; windowFocused: boolean }
```

In `IPC.terminals`, add:

```ts
    activity: 'terminals:activity',
    setFocused: 'terminals:set-focused',
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm typecheck:node && pnpm typecheck:web`

```bash
git add src/shared/types.ts
git commit -m "feat(activity): activity IPC channels + payloads"
```

---

### Task 6: Wire parser + machine + activity emission into PtyManager

**Files:**
- Modify: `src/main/pty/manager.ts`

- [ ] **Step 1: Extend `PtyEntry` and `create`**

Add to `PtyEntry`: `parser: OscParser`, `machine: ActivityMachine`. Import them and the policy. In `create`, construct `parser`/`machine`. In the `pty.onData` handler, after buffering, run:

```ts
const events = entry.parser.push(data)
for (const ev of events) {
  const prev = entry.machine.current
  const next = entry.machine.apply(ev, Date.now())
  if (next !== prev) this.onActivityChange(entry, prev, next)
}
```

- [ ] **Step 2: Add `onActivityChange` + `activityBySession`**

```ts
private activity = new Map<TerminalId, SessionActivity>()

activityFor(id: TerminalId): SessionActivity | undefined {
  return this.activity.get(id)
}

private onActivityChange(entry: PtyEntry, prev: SessionActivity, next: SessionActivity): void {
  this.activity.set(entry.id, next)
  const payload: SessionActivityPayload = {
    id: entry.id,
    status: next.status,
    title: next.title,
    exitCode: next.lastExitCode,
  }
  this.window?.webContents.send(IPC.terminals.activity, payload)
  this.notifyHook?.(entry.id, prev, next)
}
```

Add a `notifyHook` setter `setNotifyHook(fn)` so `system.ts` can own notification firing (keeps `manager.ts` free of Notification code). Clean up `this.activity.delete(id)` in `onExit`.

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm typecheck:node`

```bash
git add src/main/pty/manager.ts
git commit -m "feat(activity): detect activity in PtyManager and emit over IPC"
```

---

### Task 7: Notification firing + focus tracking

**Files:**
- Modify: `src/main/ipc/system.ts`, `src/main/index.ts`, `src/main/ipc/terminal.ts`

- [ ] **Step 1: Track focus**

In `system.ts`, keep module state `focusedSessionId: TerminalId | null` and `windowFocused: boolean`. Add IPC handler for `IPC.terminals.setFocused` updating both. Subscribe to the `BrowserWindow` `focus`/`blur` events (via `setMainWindow`) to keep `windowFocused` current.

- [ ] **Step 2: Register the notify hook**

Where `PtyManager` is constructed (or in `registerTerminalIpc`), call `pty.setNotifyHook((id, prev, next) => runNotify(id, prev, next))`. `runNotify` calls `decideNotification({ prev, next, now: Date.now(), focus: { windowFocused, sessionVisible: focusedSessionId === id } })`; if non-null, reuse the existing `system:notify` delivery path (native `Notification` / dev `osascript` / `pushToSubscribers`) with `{ title, body, terminalId: id }`.

- [ ] **Step 3: Typecheck + commit**

```bash
git add src/main/ipc/system.ts src/main/index.ts src/main/ipc/terminal.ts
git commit -m "feat(activity): fire notifications from policy with focus suppression"
```

---

## Phase C — Renderer becomes a consumer

### Task 8: Preload — expose activity + focus

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add methods**

```ts
onActivity: (cb: (p: SessionActivityPayload) => void) => {
  const listener = (_e: unknown, p: SessionActivityPayload) => cb(p)
  ipcRenderer.on(IPC.terminals.activity, listener)
  return () => ipcRenderer.removeListener(IPC.terminals.activity, listener)
},
setFocused: (p: SetFocusedPayload) => ipcRenderer.send(IPC.terminals.setFocused, p),
```

Update the `Api` type accordingly. Commit.

---

### Task 9: Strip renderer detection; subscribe to activity

**Files:**
- Modify: `src/renderer/src/components/workspace/terminal-pane.tsx` (remove detection at `:243-361` — the `onBell`/title/OSC handling), `src/renderer/src/state/store.ts`, `src/renderer/src/app.tsx`

- [ ] **Step 1: Apply activity in the store**

Add `applyActivity(p: SessionActivityPayload)` that sets `busyByTerminal[id] = p.status === 'busy'`, `attentionByTerminal[id] = p.status === 'attention'`, `titleByTerminal[id] = p.title ?? existing`, and bumps unread when `p.status !== 'busy'` for a non-visible session.

- [ ] **Step 2: Subscribe once**

In `app.tsx`, `useEffect` → `window.api.terminals.onActivity(applyActivity)`; return the unsubscribe. Report focus: on active-terminal change and window focus/blur, call `window.api.terminals.setFocused({ id: activeTerminalId, windowFocused: document.hasFocus() })`.

- [ ] **Step 3: Remove the old detection** from `terminal-pane.tsx` (title watcher, OSC handlers, `bellRef` attention path, `handleBell` attention notify in `app.tsx:199-206`). Keep xterm write/fit/focus. Keep `term.onBell` only if you still want a bell→unread cue (optional).

- [ ] **Step 4: Typecheck + manual check + commit**

Run: `pnpm typecheck:web`

```bash
git add src/renderer/src/components/workspace/terminal-pane.tsx src/renderer/src/state/store.ts src/renderer/src/app.tsx
git commit -m "feat(activity): renderer consumes activity events; remove title heuristic"
```

---

## Phase D — Settings

### Task 10: "Send test notification" row

**Files:**
- Modify: `src/renderer/src/components/settings-modal.tsx`

- [ ] **Step 1:** Add a Notifications row in the Mobile/Settings pane with a button calling `window.api.system.notify({ title: 'wTerm', body: 'Notifications are working', terminalId: null })` and helper text: "Nothing appeared? Enable wTerm in System Settings ▸ Notifications." Typecheck + commit.

---

## Final verification

- [ ] `pnpm exec vitest run` — all activity tests green (Tasks 2–4).
- [ ] `pnpm typecheck` — clean.
- [ ] Manual: run a `sleep 12` in a backgrounded tab → "Command finished" notification + busy halo while running; run `false` → no notification (quick), run `sh -c 'sleep 3; exit 2'` in background → "Command failed"; a Claude turn ending while the tab is unfocused → attention notification + red dot.
