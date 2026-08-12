# Project board + notes design

Date: 2026-08-12
Status: approved

## Goal

A per-project kanban board inside wTerm whose `Ready` column is a real work
queue: wTerm keeps N Claude workers running per project and, whenever one goes
idle, dispatches the next card to it in its own git worktree. Plus a per-project
markdown notes surface that acts as the inbox — any note can be promoted into a
card.

The point is to fill the queue and walk away.

## Decisions

| Question | Decision |
|---|---|
| Source of truth for cards | wTerm-local, in `state.json` (main-owned) |
| Dispatch model | Auto-queue → idle workers, worker count per project |
| Worker isolation | One git worktree + branch per card |
| Completion signal | `busy → idle` moves the card to `Review`; a human moves it to `Done` |
| Notes | Per-project markdown scratchpad, promote-to-card |
| Placement | Center-pane tabs, alongside terminal and file tabs |
| Scheduler location | Electron main process |

### Why main, not the renderer

Board state lives in `state.json`, which main already owns and already pushes to
the renderer (`state:changed`) and to the phone (the bridge's `state` message).
The activity events that drive completion already flow through
`src/main/pty/activity`. Worktree creation needs `git` and Node. Putting the
scheduler in main means dispatch keeps working when the board tab is closed,
survives a renderer reload, and gives the mobile bridge board visibility nearly
free. A renderer-side scheduler would stall the queue on any reload and split
ownership of a single lifecycle across two processes.

## Data model

Three new persisted collections on `AppState`, which goes to `version: 2`.

```ts
export type CardStatus = 'backlog' | 'ready' | 'in-progress' | 'review' | 'done'

export interface CardRun {
  terminalId: TerminalId
  worktreePath: string
  branch: string
  startedAt: string
  endedAt?: string
  /**
   * False until the worker's activity first goes `busy`. A freshly created PTY
   * reads as idle before the agent starts, so a run is only completable after
   * it has actually begun working.
   */
  started: boolean
}

export interface Card {
  id: string
  projectId: ProjectId
  /** per-project, monotonic, human-facing ("#42") */
  number: number
  title: string
  /** markdown; becomes the dispatched prompt */
  body: string
  status: CardStatus
  /** sort key within a column */
  order: number
  createdAt: string
  /** set on dispatch, cleared when the card returns to backlog/ready */
  run?: CardRun
  /** append-only history: dispatched, idle, moved, errors. Capped. */
  log: CardLogEntry[]
}

export interface CardLogEntry {
  at: string
  text: string
}

export interface Note {
  id: string
  projectId: ProjectId
  title: string
  body: string
  updatedAt: string
}

export interface BoardSettings {
  /** 0 disables automation — the board becomes a plain board */
  workerCount: number
  agentCommand: string
  /** supports {{number}}, {{title}}, {{cardFile}}, {{branch}} */
  promptTemplate: string
  /** absolute; defaults to the project path's parent */
  worktreeRoot: string
}

export interface AppState {
  version: 2
  selectedProjectId: ProjectId | null
  projects: Project[]
  activeTerminalByProject?: Record<ProjectId, TerminalId | null>
  cards?: Card[]
  notes?: Note[]
  boardByProject?: Record<ProjectId, BoardSettings>
}
```

Cards and notes are scoped by `projectId`, matching how terminals and the file
tree already scope. They are stored as flat arrays rather than nested under
`Project` so that the Home workspace stripping in `ensureHome` /
`writeFile` doesn't have to grow a second concern.

### Constraints this imposes

- **`log` is capped at the most recent 50 entries per card.** `state.json` is a
  single debounced whole-file write; an unbounded append-only log inside it
  would grow every save.
- **`version: 2` is a one-way door.** The current loader
  (`src/main/store/state.ts`, the `parsed?.version === 1` guard) silently
  discards state whose version it doesn't recognise and falls back to an empty
  workspace — which would lose *projects*, not just cards. Before shipping the
  bump, the loader must accept any `version >= 1` and migrate forward, so that a
  downgrade degrades to "board missing" rather than "workspace wiped".
  Migration `1 → 2` seeds `cards: []`, `notes: []`, `boardByProject: {}`.

## Scheduler

New module `src/main/board/scheduler.ts`, with the decision logic extracted as a
pure function in `src/main/board/planner.ts` (following the existing
`restore-plan.ts` / `resize-authority.ts` / `viewport-sync.ts` pattern: pure
core, thin effectful driver, unit-tested core).

```ts
// pure
export function planTick(state: BoardTickInput): BoardAction[]
```

The driver calls `planTick` on every board mutation and every activity event,
and executes the returned actions. Ticks are serialized behind a single promise
chain so two concurrent ticks cannot fill one worker slot twice.

### Dispatch

For each project: `freeSlots = workerCount − (cards in-progress for that project)`.
While `freeSlots > 0` and `ready` is non-empty, dispatch the lowest-`order` card:

1. `git worktree add <worktreeRoot>/<project>-card-<n> -b card/<n>` off the
   project's root repo.
   - If the project is not a git repo, run in the project root instead and log
     that isolation was skipped. A non-git project must not block the board.
   - If the target worktree path already exists, the dispatch fails (see below)
     rather than reusing or clobbering it.
2. Write the card body to `<worktree>/.wterm/card-<n>.md`.
3. `createTerminal(pty, { projectId, cwd: <worktree>, name: '#42 <title>',
   startupCommand: renderTemplate(...) })`. The default template is
   `claude "Read .wterm/card-42.md and implement the task described there."`
   Passing a *file path* rather than the markdown body avoids shell-quoting
   arbitrary user text. Because the command matches `isClaudeLaunch`, the
   existing path in `src/main/ipc/terminal.ts` pins a `--session-id`, so a
   dispatched worker is a restorable Claude tab for free.
4. Card → `in-progress` with `run` populated and `started: false`.

Any step failing returns the card to `ready` and appends the error to its log.
Cards never disappear on failure.

### Completion

Driven by the activity status already emitted per terminal
(`idle | busy | attention` from `src/main/pty/activity`):

- `→ busy` on a run's terminal sets `run.started = true`.
- `busy → idle`, held for 5s, on a run with `started: true` → card moves to
  `review`, `run.endedAt` is set, and the worker slot frees. The debounce exists
  because Claude flickers idle between tool calls.
- `→ attention` **does not complete the card.** In wTerm `attention` is the BEL —
  Claude ringing for a permission prompt or a clarifying question, mid-task.
  The card stays `in-progress`, is badged "needs you", and the worker slot stays
  held. This reuses the signal that already drives notifications.
- Nothing ever moves to `done` automatically. Agents declare success
  unreliably; `Done` is a human action.

### Worker tab lifecycle

Completing a card frees the slot but leaves the worker's tab alive — you will
want to read it, and often keep talking to it. The next card gets a **fresh**
tab; reusing a session would pour card #41's context into #42.

Tabs therefore accumulate. Moving a card to `done` is what closes the loop: it
kills the tab and prunes the worktree (`git worktree remove`), behind a
confirmation dialog that names the branch and warns if the worktree is dirty.

### Failure paths

Every one of these lands the card in `Review` with a log entry, never in limbo:

- The PTY exits while the card is `in-progress` (user typed `exit`, or the agent
  crashed) — logged with the exit code.
- The app restarts with a card `in-progress` whose terminal is gone — logged as
  "interrupted". Never auto-re-dispatched: the worktree may hold partial work
  that a re-run would fight with.
- `workerCount` is lowered below the number of active runs — running cards are
  left alone; the queue simply stops dispatching until runs drain.

## Notes

Per-project markdown notes stored in `state.json` alongside cards. Create,
rename, edit, delete. The editor is the existing Monaco setup, and preview is
the existing `markdown-preview.tsx` (react-markdown + remark-gfm), so notes
inherit source/preview toggling from the current markdown file behaviour.

**Promote to card:** from a note, "New card from note" (or from the current
selection) creates a `backlog` card whose title is the first heading or first
line and whose body is the note text. Notes are the inbox; the board is the
queue. Promotion copies, it does not move — the note stays.

Autosave on a 500ms debounce through the same IPC as any other board mutation;
notes have no dirty-tab concept.

## UI

The center pane is per-project, with one tab strip driven by `openFiles` in
`src/renderer/src/state/store.ts`. There is currently no tab-kind abstraction —
every tab is a file path.

**Change:** give the open-tab entry a discriminator.

```ts
type OpenedTab =
  | { kind: 'file'; projectId: ProjectId; path: string }
  | { kind: 'board'; projectId: ProjectId }
  | { kind: 'note'; projectId: ProjectId; noteId: string }
```

`tabKey()` grows a case per kind. The tab strip, active-tab tracking, ⌘1–9
switching, drag reorder, and close all keep working unchanged. Dirty-close
confirmation stays file-only.

This touches `store.ts` (779 lines — already the largest file in the renderer)
and `file-tabs.tsx`. The tab-collection logic and the file-specific dirty/save
logic come out of `store.ts` into `src/renderer/src/state/tabs.ts` as part of
this work, because adding a third tab kind to it as-is would push it past the
800-line ceiling.

New components under `src/renderer/src/components/board/`:

- `board-tab.tsx` — five columns, drag between them, card count per column.
- `card-item.tsx` — number, title, status badge, "needs you" badge, worker link.
- `card-detail.tsx` — title, markdown body, run info (branch, worktree, tab),
  log.
- `board-settings.tsx` — worker count, agent command, prompt template, worktree
  root.
- `notes-tab.tsx` — note list plus editor/preview.

Board opens from the left sidebar's project row and from a command in the top
bar. A project with a card needing attention shows a badge on its sidebar row,
reusing the existing unread-dot aggregation.

## IPC

New channels on the `IPC` const in `src/shared/types.ts`, handled in
`src/main/ipc/board.ts`:

```
board:list            → { cards, notes, settings } for a project
board:create-card     board:update-card     board:move-card    board:delete-card
board:create-note     board:update-note     board:delete-note
board:promote-note    → creates a backlog card from a note
board:set-settings    → worker count, agent command, template, worktree root
board:dispatch-now    → force-dispatch one card, ignoring free slots
board:changed         → main → renderer push after any scheduler mutation
```

Mutations go through main and come back as a push, matching how the bridge
already keeps desktop and phone in sync. The renderer holds no authoritative
board state.

The mobile bridge is **out of scope** for this spec: `BridgeServerMessage`
carries `AppState`, so the phone will receive card data automatically, but no
phone UI is being built here.

## Testing

Vitest, `src/**/*.test.ts`, colocated with the module under test — matching the
existing convention.

Unit (pure modules, the bulk of the coverage):

- `src/main/board/planner.test.ts` — free-slot arithmetic; dispatch order by
  `order`; no dispatch at `workerCount: 0`; no dispatch when `ready` is empty;
  lowering `workerCount` below active runs does not kill runs; two ticks in
  flight cannot double-fill a slot.
- `src/main/board/completion.test.ts` — `busy → idle` completes only after the
  debounce; `idle` before first `busy` does not complete; `attention` holds the
  slot and badges the card; PTY exit routes to `review` with the exit code.
- `src/main/board/worktree.test.ts` — path and branch naming; refusal on an
  existing path; non-git project falls back to project root and logs it.
- `src/main/board/prompt.test.ts` — template rendering and placeholder
  substitution.
- `src/main/store/migrate.test.ts` — `1 → 2` seeds empty collections and
  preserves projects; an unknown future version preserves projects rather than
  resetting the workspace.
- `src/renderer/src/state/tabs.test.ts` — `tabKey` per kind; close/reorder/active
  tracking across mixed tab kinds.

Integration:

- `src/main/ipc/board.test.ts` — each channel's happy path and its rejection of
  an unknown `projectId`, mirroring how `resolveRepoPath` guards traversal.

E2E (Playwright, against the sandboxed dev instance — never the live
`state.json`):

- Create card → move to Ready → a worker tab appears in a worktree → card lands
  in Review when the agent goes idle.
- Move to Done → tab closes and the worktree is pruned.

## Out of scope

- GitHub Issues sync in either direction.
- Phone UI for the board.
- Cross-project boards, labels, assignees, due dates, swimlanes.
- Automatic PR creation on Done.
- Re-dispatching interrupted cards.
