# Session Restore Reliability — Design

**Date:** 2026-07-10
**Status:** Approved (root cause diagnosed in-session; user approved fixing A+B)

## Problem

After a full app close/reopen, restored tabs render with the correct count but are
blank and dead to input. Root cause chain (verified against the live `state.json`,
where every tab is `agent: { command: "cc" }` and none has a `claudeSessionId`):

1. The user launches Claude via a shell alias (`alias cc='claude
   --dangerously-skip-permissions'`). `isClaudeLaunch` only matches a literal
   `claude` first token, so wTerm never injects/owns a session id.
2. Shell integration captures the **typed** command (`cc`), not its alias
   expansion. On relaunch, `resumeCommandFor("cc", rules)` matches no rule, so the
   restore loop skips the tab: **no PTY is ever created**. The tab record still
   renders → blank pane, dropped keystrokes.
3. Latent: even when a rule matches, `createTerminal` ignores the reused `opts.id`
   whenever `resumeSessionId` is absent (generates a fresh UUID), so the rendered
   tab would stay dead and a duplicate record would appear.

Secondary defects in the same flow:

- Startup/resume commands are injected on a fixed 150 ms timer after the first
  PTY output — races slow rc files.
- Resume rebuilds the command from the *current* settings startup command,
  dropping the flags the tab was actually launched with
  (e.g. `--dangerously-skip-permissions`).
- Plain-shell tabs are dropped from persistence entirely, so the restored
  workspace shape doesn't match what was closed.

## Design

### 1. Capture the alias-expanded command (zsh)

`preexec` receives the expanded command as `$2` (single-line, size-capped by
zsh). Emit `${2:-$1}` in OSC 697 so `cc` is recorded as
`claude --dangerously-skip-permissions`. Bash's `BASH_COMMAND` is already
post-expansion; fish stays as-is.

### 2. Inject startup commands on prompt-ready, not a timer

The zsh/bash/fish integrations emit `OSC 133;D` from precmd right before every
prompt — including the first one, i.e. exactly when the rc has finished loading.
`PtyManager` injects the pending startup command when the first `commandEnd`
OSC event is parsed, with a fallback timer (1500 ms after first output) for
shells without integration.

### 3. Honor the reused tab id for every restore create

`createTerminal` treats any `opts.id` as a restore: reuse the persisted record
(name/shell/agent preserved), spawn the PTY under that id. `resumeSessionId`
only selects the startup command, not whether the id is honored.

### 4. Build resume commands from the captured command

New helpers in `claude-session.ts`:

- `stripSessionPinning(command)` — remove `--session-id/--resume/-r/--continue/-c`
  (and their values).
- `extractPinnedSessionId(command)` — the explicit session id when the user typed
  `--resume <uuid>` / `--session-id <uuid>` themselves.
- `buildAgentResumeCommand(captured, ruleResume, sessionId?)` — the captured
  command stripped of pinning flags, then `--resume <id>` when an exact id is
  known, else the rule's flags (tokens after the program in `rule.resume`).

This preserves the tab's real launch flags — which is also what skips the
permission/trust prompt on resume. Rule shape `{ match, resume }` is unchanged
(no settings migration); `resume`'s first token is superseded by the captured
program.

### 5. Exact per-tab session ids for hand-typed launches (sniffing)

When OSC 697 reports an agent whose expanded command launches `claude`, main
resolves the session id:

- Explicit `--resume <id>` / `--session-id <id>` in the command → use it directly.
- Otherwise poll `~/.claude/projects/<slug(cwd)>/` (slug = cwd with every
  non-alphanumeric byte replaced by `-`) for a new `*.jsonl` created after the
  launch, for up to 20 s. First unclaimed new file wins; a claim registry
  prevents two same-cwd tabs from grabbing the same id.

The sniffed id is stored as `agent.sessionId` on the record (new optional
field) — it lives and dies with the agent capture, so exiting Claude clears it,
unlike the injection-owned `claudeSessionId` which pins the tab for life.

### 6. Restore planning + never-a-dead-tab fallback

Extract the renderer restore loop into a pure, unit-tested planner
(`lib/restore-plan.ts`): for each persisted tab produce one create call, chosen
by precedence:

1. `claudeSessionId` (wTerm-owned) → resume by exact id, command built from the
   captured agent command when present, else the configured startup command.
2. `agent.sessionId` (sniffed) → captured command + `--resume <id>`.
3. `agent` matching a restore rule → captured command + rule flags.
4. Anything else → **plain shell in the tab's cwd, reusing the id** — a tab must
   never render without a live PTY behind it.

`store/state.ts` stops filtering persistence to "restorable" tabs: all tabs
persist, so the workspace shape (tab count per project) survives restarts —
plain shells come back as plain shells.

### 7. Migration note

Existing persisted tabs captured as `cc` still match no rule → they restore as
plain shells once (workspace shape kept, conversation resumable by typing
`cc -c`). From then on captures are alias-expanded and restore exactly.

## Out of scope (follow-ups)

- Persisting tab reorder (renderer-only today).
- Surfacing PTY exit in the pane UI (dead-process indicator / restart affordance).
- Multi-tab recency mapping for legacy id-less tabs (superseded by sniffing).

## Testing

- Unit: claude-session helpers (strip/build/extract), restore planner
  precedence + fallback, slug encoding, session-file watcher against temp dirs,
  zsh integration script emits `${2:-$1}`, state persistence keeps plain tabs.
- Manual E2E: sandboxed dev instance (seeded userData) — relaunch and confirm
  every tab has a live shell; agent tabs re-run their captured command.
