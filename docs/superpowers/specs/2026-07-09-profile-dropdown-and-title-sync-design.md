# Profile Dropdown & Terminal Title Sync — Design

**Date:** 2026-07-09
**Status:** Approved, ready for planning
**Scope:** Electron desktop renderer + small main-process additions. Two independent features shipped together: (1) a GitHub profile dropdown in the top bar, (2) terminal names that follow the agent's current task.

## Problem

1. **Profile / account UX.** The top-right avatar button (`top-bar.tsx:108-128`) shows the
   GitHub avatar but clicking it just opens the Settings modal — identical to the Settings
   button in the right activity bar. Account information (login, OAuth/PAT source, sign out)
   and the entire sign-in flow live in the source-control panel (`github-auth.tsx`), which is
   not where users look for account controls. There is no profile dropdown.
2. **Stale terminal names.** While an agent (e.g. Claude Code) runs, wTerm shows its live
   OSC title (the current task) with display priority over the stored terminal name. But the
   persistent `terminal.name` is only ever set manually; when the agent goes idle or exits,
   the display falls back to a name that no longer reflects what the terminal was doing.

### Current state (verified in code)

- `TopBar` fetches GitHub settings itself over IPC (`top-bar.tsx:30-37`); `GitPanel` holds its
  own copy in local `useState` (`git-panel.tsx:68`). No shared store — consumers cannot react
  to each other's auth changes.
- The avatar is synthesized as `https://github.com/{login}.png?size=44` (`top-bar.tsx:117`).
  `fetchAuthenticatedLogin` (`main/github/auth.ts:186-197`) calls `GET /user` but discards
  `avatar_url`; `GitHubSettings` (`shared/types.ts:308-317`) has no avatar field.
- `GitHubAuth` (`right-sidebar/github-auth.tsx`) hosts the signed-in row (login + source tag +
  sign out) and the full sign-in flow: device flow with code/polling UI, PAT entry, OAuth
  client-id configuration.
- Terminal titles: OSC 0/2 titles are parsed in main (`OscParser` → `ActivityMachine`,
  `main/pty/activity/`), pushed to the renderer as `SessionActivityPayload { id, status,
  title, exitCode }`, stored in `titleByTerminal` (Zustand), and displayed with priority over
  `terminal.name` (`terminal-sidebar-item.tsx:39`). The renderer strips the spinner glyph
  (`lib/terminal-title.ts`).
- Manual rename exists (double-click inline edit → `useTerminals.rename` → `terminals.rename`
  IPC, persisted). Nothing ever writes the live title into the persistent name.
- `ActivityMachine.apply` already distinguishes agent titles (`looksLikeAgent`) from plain
  shell titles (`activity-machine.ts:27-39`), but that distinction is not part of the
  activity payload.

## Requirements

Decided during brainstorming:

- **Profile dropdown** replaces the top-right avatar button's open-settings behavior. It owns
  the full auth lifecycle ("dropdown handles it"): signed-out sign-in (device flow, PAT,
  client-id config) and signed-in account info + sign out.
- **GitHubAuth is removed from the git panel.** Signed out, the panel shows a one-line hint
  pointing at the profile menu; everything else in the panel is unchanged.
- **Real avatar**: capture `avatar_url` from `GET /user`, persist it, fall back to the
  `github.com/{login}.png` trick when absent (sessions signed in before this change).
- **Title sync — auto-snapshot latest task**: each time the agent emits a new meaningful task
  title, also save it as the terminal's persistent name. Live-title display priority is
  unchanged; the win is a fresh fallback name once the agent is idle/exited.
- **Manual renames win**: a user rename permanently opts the terminal out of auto-naming.
  Renaming to an empty string resets it back to auto.
- **Agent titles only**: plain shell titles (e.g. `zsh — ~/Workspace`) must never overwrite
  the terminal name.

## Design

### Feature 1 — Profile dropdown

**Shared GitHub state.** New `github` slice in the existing renderer Zustand store
(`state/store.ts`): `{ githubSettings: GitHubSettings | null, refreshGithub(): Promise<void> }`.
`refreshGithub` wraps `window.api.github.getSettings()`. All auth mutations (device poll
success, PAT save, client-id save, sign out) call it. `TopBar`/`ProfileMenu` and `GitPanel`
consume the slice; `GitPanel` drops its local `settings` state and `TopBar` drops its private
fetch.

**`ProfileMenu` component** (`src/renderer/src/components/profile-menu.tsx`) replaces the
avatar button in `TopBar`. Clicking toggles a right-aligned popover anchored under the button;
it closes on outside click and Escape (no dropdown library — small hand-rolled popover
matching existing styling).

- **Signed in:**
  - Header row: avatar, `login`, source tag (OAuth / PAT).
  - **Open GitHub profile** → `window.api.system.openExternal('https://github.com/' + login)`.
  - **Settings** (⌘,) → existing `onOpenSettings` handler.
  - **Sign out** → `window.api.github.signOut()` + `refreshGithub()`.
- **Signed out:** person icon on the button; the dropdown hosts the sign-in flow relocated
  from `github-auth.tsx` — "Sign in with GitHub" (device flow incl. user-code display and
  polling status), "Use Personal Access Token", and OAuth client-id configuration. The flow
  logic (polling loop, PAT/client-id submit) is moved, not rewritten; only the container and
  the auth-changed callback (`refreshGithub`) change. `github-auth.tsx` is deleted once the
  flow lives in the dropdown.

**Avatar URL plumbing.** `GitHubSettings` gains `avatarUrl: string | null`.
`fetchAuthenticatedLogin` returns `{ login, avatarUrl }` from `GET /user`; persistence in
`main/github/auth.ts` stores it next to `login`; the IPC `settings()` mapper
(`main/ipc/github.ts:36-44`) exposes it. Renderer avatar rendering prefers `avatarUrl` and
falls back to `https://github.com/{login}.png?size=44`.

**Git panel.** `git-panel.tsx` renders a one-line signed-out hint — "Sign in from the profile
menu (top right) to see PRs and CI runs." — in place of the removed `GitHubAuth` block.

### Feature 2 — Terminal titles follow the current task

**Persistent model.** `TerminalRecord` gains `nameSource: 'auto' | 'user'`; missing values
(existing terminals) are treated as `'auto'`. The manual rename path (`terminals.rename` IPC)
sets `'user'` when given a non-empty name; renaming to an empty string resets `nameSource` to
`'auto'` while keeping the previous name displayed until the next agent title replaces it
(an empty display name is never persisted).

**Agent flag on activity payloads.** `SessionActivityPayload` gains `isAgent: boolean`,
derived in main from the `ActivityMachine`'s existing agent detection (`mode === 'agent'` /
`looksLikeAgent`). Plain shell titles arrive with `isAgent: false`.

**Snapshot logic (renderer-side).** In the existing activity subscription (`app.tsx:96-101`),
after `setTerminalTitle`, the renderer calls a pure decision function:

```ts
resolveAutoRename(payload: SessionActivityPayload, terminal: TerminalRecord): string | null
```

Returns the new name, or `null` for "don't rename". It returns a name only when all hold:
`payload.isAgent`, the spinner-stripped title is non-empty, `terminal.nameSource !== 'user'`,
and the stripped title differs from the current `terminal.name` (this dedupe keeps
persistence writes to actual task changes, not per spinner frame). A non-null result flows
through the existing rename path (store update + `terminals.rename` IPC) with `nameSource`
kept `'auto'`.

**Display precedence unchanged.** `autoTitle || terminal.name` stays as-is; while the agent
runs, the live title still wins. The feature only changes what the fallback name is.

## Error handling

- Avatar image failures fall back to the login-based URL, then to the person icon (`onError`
  chain on the `<img>`).
- `refreshGithub` failures leave the previous settings in place and surface nothing fatal —
  same tolerance the current `catch(() => setLogin(null))` has, but without wiping known
  state.
- Auto-rename IPC failures are logged and skipped; the next differing title retries
  naturally. Auto-rename must never throw into the activity subscription.

## Testing

Vitest is already set up (`pnpm test`).

- **Unit:** `resolveAutoRename` (agent vs shell title, user-renamed terminal, unchanged title,
  empty title, spinner stripping); `nameSource` transitions in the rename path (user rename →
  `'user'`, empty rename → `'auto'`); the main-side `isAgent` derivation on
  `SessionActivityPayload`; the `settings()` IPC mapper including `avatarUrl`.
- **Component (if renderer component testing exists in the repo):** ProfileMenu open/close,
  signed-in vs signed-out contents, sign-out triggering `refreshGithub`. If no component test
  infra exists, the popover logic (open/close/outside-click) is extracted into a testable
  hook and covered by unit tests instead.

## Out of scope

- Mobile bridge (PWA) profile surface.
- Any change to PR/CI fetching in the git panel beyond consuming the shared slice.
- Multi-account support.
- Renaming terminals from the agent side via custom OSC sequences.
