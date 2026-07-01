# Session Activity & Notifications (Desktop) — Design

**Date:** 2026-07-01
**Status:** Approved, ready for planning
**Scope:** Electron desktop app only. The mobile bridge (PWA) is a deliberate follow-up spec that builds on the main-process state introduced here.

## Problem

Two features are unreliable:

1. **Notifications** — no notification fires for most cases; when they do fire they can be
   wrong or duplicated; the OS permission is never handled.
2. **Working indicators** — the busy/attention dot often never shows, shows on the wrong
   session, and appears to stop for tabs that aren't selected.

### Root causes (verified in code)

- Both busy-detection and notifications hang off a single fragile heuristic that watches the
  xterm **window title** for Claude Code's spinner glyph (`terminal-pane.tsx:69-91`). If the
  title format shifts, the whole chain silently dies. Anything that is not Claude (a plain
  `npm test`, `make`) produces no busy state and no notification.
- The reliable signal already arrives in the PTY stream — **OSC 133 `C`/`D`** shell-integration
  markers (`shell-integration.ts`) — but the renderer only handles `D` and ignores `C`, so the
  robust "command running" signal is discarded.
- Detection is implemented inside the `TerminalPane` React component and stored in renderer
  Zustand, keyed by mount lifecycle. This is the source of the "wrong session" and
  "stops when not selected" fragility.
- No OS notification permission is ever requested or surfaced on desktop; native notifications
  silently no-op if the OS denied them.
- The main-process store does not track busy/attention/title at all, so the mobile bridge has
  nothing to forward — the reason the phone has zero indicators today.

## Requirements

Decided during brainstorming:

- **Surfaces:** Desktop first (this spec). Phone is a separate follow-up.
- **Notify on** (only for a background/unfocused session):
  - agent turn done / needs input,
  - any shell command that ran ≥ 10s and finished,
  - a shell command that exited nonzero (except interrupt/termination codes),
  - **not** the terminal bell (off by default — it is the main false-positive source).
- **Detection:** OSC 133 `C..D` span is the source of truth for shell "busy"; the Claude title
  heuristic is demoted to driving only the "needs attention" edge.
- **Background tabs:** activity must be tracked for **every** session continuously, whether or
  not it is the selected tab.
- **Threshold:** 10s for "long command finished."
- **Config:** sensible hardcoded defaults, no new settings toggles.
- **Permission:** a "check + warn" affordance in Settings (macOS grants packaged apps
  permission automatically; the real failure is manual denial, which has no reliable status API).

## Architecture

Move activity detection out of the renderer and into the **main process**, at the node-pty
`onData` choke point where every session's output already flows. Main becomes the single
authoritative owner of per-session activity; the renderer becomes a pure consumer.

```
node-pty data (per session)
      │
      ▼
 OscActivityParser  ── buffers partial escape sequences across chunks
      │  (emits: commandStart, commandEnd{code}, progress{active}, title{text})
      ▼
 ActivityMachine (per session)  ── shell-vs-agent mode, produces SessionActivity
      │
      ├──▶ main store: activityBySession   ──▶ IPC 'activity' event ──▶ renderer Zustand ──▶ sidebar dots/halos
      │                                                                                 (also positions the phone follow-up)
      └──▶ NotificationPolicy ── decides fire/suppress ──▶ existing system:notify path (native / osascript / web-push)
```

### 1. `OscActivityParser` (`src/main/pty/activity/osc-parser.ts`, pure)

A streaming scanner fed each raw PTY chunk for one session. It **must** buffer an incomplete
escape sequence and resume on the next chunk — OSC sequences routinely split across chunk
boundaries, and this is the highest-risk correctness area.

Recognizes:

- `OSC 133 ; C ST` → `commandStart`
- `OSC 133 ; D [; <exitcode>] ST` → `commandEnd { code: number | null }`
- `OSC 9 ; 4 ; <state> ; <progress> ST` → `progress { active: state === 1 || state === 2 }`
- `OSC 0|2 ; <title> ST` → `title { text }`

`ST` may be `BEL` (`\x07`) or `ESC \\`. Non-matching output is ignored. The parser holds only a
bounded tail buffer (cap the retained partial-sequence length to avoid unbounded growth on
malformed input).

### 2. `ActivityMachine` (`src/main/pty/activity/activity-machine.ts`, pure)

One instance per session; folds parser events into a `SessionActivity`:

```ts
type ActivityStatus = 'idle' | 'busy' | 'attention'

interface SessionActivity {
  status: ActivityStatus
  mode: 'shell' | 'agent'
  title: string | null
  commandStartedAt: number | null
  lastExitCode: number | null
}
```

**Shell vs agent mode (core mechanism).** Running `claude` is a single long OSC 133 span from
the shell's view (claude never exits), so OSC 133 cannot track per-turn state. Resolution:

- When the live title matches Claude/agent branding (existing `titleIndicatesWork` /
  `SPINNER_PREFIX` logic, ported from `terminal-pane.tsx:69-91`), the session is in **agent
  mode**: the title spinner drives `busy`, and the title reverting to idle branding drives the
  `attention` edge.
- Otherwise the session is in **shell mode**: OSC 133 `C..D` and OSC 9;4 drive `busy → idle`.

State rules:

- `busy` when: (shell mode) an OSC 133 span is open or OSC 9;4 is active; (agent mode) the
  title spinner is present.
- `attention` when: (agent mode only) the title reverts from spinner to idle branding — i.e.
  turn done / awaiting input. This is the only source of `attention`.
- `idle` otherwise. Starting a new turn/command clears `attention`.
- The agent-mode "stall" fallback (title stops repainting) keeps the current behavior of not
  raising attention, but must not force a false `idle` mid-run any more aggressively than
  today's `TITLE_IDLE_MS`.

Ported constants: `SPINNER_PREFIX`, `titleIndicatesWork`, `TITLE_IDLE_MS`.

### 3. `NotificationPolicy` (`src/main/pty/activity/notification-policy.ts`, pure)

Given a state transition plus focus context, returns whether to fire and the payload. Fires
only when the session is **backgrounded**: the app window is unfocused, or it is focused but the
session is not the visible/active one (dot only in that case, no OS notification).

Focus context inputs:
- `windowFocused` — from `BrowserWindow` in main.
- `focusedSessionId` — reported by the renderer (extend the existing focus round-trip so main
  always knows the active session id).

Fire table:

| Transition | Fire | Notes |
|---|---|---|
| agent `busy → attention` | yes | "… needs your input" |
| shell `busy → idle`, duration ≥ 10s, code 0 | yes | "Command finished" |
| shell `busy → idle`, code ∉ {0,130,143} | yes | "Command failed (code N)" — 130/143 = Ctrl-C / kill, excluded |
| bell | no | off by default |

`LONG_COMMAND_MS = 10_000`. Dedup is inherent: notifications fire on discrete transition edges,
and `attention` cannot re-fire without an intervening `busy`.

### 4. Main store + IPC

- New store slice `activityBySession: Record<string, SessionActivity>`
  (`src/main/store/…`), updated by the machine. This is what the phone follow-up will forward.
- New IPC event `activity` (main → renderer) carrying
  `{ sessionId, status, title, exitCode }` on change. Add channel to `src/shared/types.ts`,
  expose in `src/preload/index.ts`, emit from the activity wiring.
- Notifications continue through the existing `system:notify` handler
  (`src/main/ipc/system.ts`) — native `Notification` / dev `osascript` / `pushToSubscribers`.
  The change is that main now *originates* the notify call from `NotificationPolicy` instead of
  receiving it from the renderer.

### 5. Renderer becomes a pure consumer

- Remove the detection engine from `terminal-pane.tsx` (title watcher, OSC handlers, busy/turn
  state machine, `bellRef` attention path). Keep xterm setup, data write, fit/focus/resize.
- Subscribe to the `activity` IPC event and write the existing Zustand fields
  (`busyByTerminal`, `attentionByTerminal`, `titleByTerminal`). Bump the unread dot on
  notify-worthy background transitions (today it is bell-only).
- Sidebar/bottom-panel indicator components and CSS halos are unchanged — they already read
  those Zustand fields.
- Keep the renderer→main "focused session" signal so `NotificationPolicy` can suppress
  correctly, and keep click-to-focus.

### 6. Permission handling (Settings)

Add a Notifications row to the Mobile/Settings pane:

- A **"Send test notification"** button that calls `system:notify` with a sample payload.
- Helper text: "Nothing appeared? Enable wTerm in System Settings ▸ Notifications."

No programmatic macOS permission-status check (no reliable API); the test button is the honest
UX and covers the "check + warn" requirement.

## Data flow summary

1. PTY emits bytes → `OscActivityParser` (per session) → typed events.
2. `ActivityMachine` folds events → `SessionActivity`, decides shell/agent mode.
3. On change: update `activityBySession`; emit `activity` IPC to renderer; run
   `NotificationPolicy` and fire `system:notify` when warranted.
4. Renderer writes Zustand → sidebar dots/halos/title update for the correct session,
   regardless of which tab is selected.

## Error handling

- Parser tolerates malformed/partial sequences without throwing; bounded tail buffer prevents
  memory growth on a stream of unterminated OSC.
- A parser or machine error for one session must not affect other sessions or the PTY data
  path — wrap per-session processing in try/catch and log context; never swallow silently.
- Session teardown disposes the parser/machine and removes the `activityBySession` entry
  (mirror existing cleanup in the store).

## Testing

Pure modules make 80%+ coverage straightforward:

- **Parser:** sequences split across chunks; `C`, `D`, `D;<code>`; both `BEL` and `ESC \\`
  terminators; OSC 9;4 active/inactive; title extraction; malformed input; buffer cap.
- **ActivityMachine:** shell↔agent mode switching; `busy`/`idle`/`attention` transitions; the
  attention edge; clearing attention on new turn; stall fallback does not false-idle.
- **NotificationPolicy:** 10s threshold boundary; exit-code filtering (0 / nonzero / 130 / 143);
  focus suppression (unfocused vs focused-and-visible vs focused-not-visible); dedup on edges.
- **Integration:** feeding a scripted PTY byte stream produces the expected `activity` IPC
  events and `system:notify` calls.
- No E2E — Electron OS notifications are impractical to automate; verified manually.

## Out of scope (follow-up specs)

- Mobile bridge: forwarding `activityBySession` (busy/attention/title) over the bridge and
  rendering indicators + push in the PWA. This spec is structured so that becomes additive.
- Notification configurability UI (per-event toggles, custom threshold, sound selection).

## New / touched files

New:
- `src/main/pty/activity/osc-parser.ts`
- `src/main/pty/activity/activity-machine.ts`
- `src/main/pty/activity/notification-policy.ts`
- store slice for `activityBySession`
- test files mirroring each pure module

Touched:
- `src/main/pty/…` (wire parser/machine into the `onData` path)
- `src/main/ipc/system.ts` (originate notify from policy)
- `src/shared/types.ts` (activity IPC + focused-session payload)
- `src/preload/index.ts` (expose `activity` subscription)
- `src/renderer/src/components/workspace/terminal-pane.tsx` (strip detection, subscribe)
- `src/renderer/src/state/store.ts` (unread on background transitions)
- `src/renderer/src/components/settings-modal.tsx` (Notifications test row)
