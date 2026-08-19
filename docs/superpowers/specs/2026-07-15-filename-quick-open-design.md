# Filename Quick-Open (⌘P) — Design

**Date:** 2026-07-15
**Status:** Approved (pending implementation plan)

## Summary

Add a VS Code-style filename quick-open palette to wTerm. Pressing ⌘P (Ctrl+P on
Windows/Linux) opens a top-centered overlay with a fuzzy-search input over every
file in the current project. Selecting a result opens it in the existing editor
surface.

This is the first cut of "global file search." Content/grep search is explicitly
out of scope for this iteration.

## Goals

- ⌘P opens a quick-open palette scoped to the selected project's root.
- Fuzzy subsequence matching (VS Code-style), ranked, matched characters
  highlighted.
- Keyboard-first: type to filter, ↑/↓ to move, Enter to open, Esc to close.
- Respect `.gitignore`; never enumerate `node_modules` or `.git`.
- Reuse the existing editor-open path — no new file-presentation code.

## Non-Goals (YAGNI)

- Content / grep search (deferred to a later iteration).
- A cached or fs-watched file index — we walk fresh on each open.
- Recent-files / history-weighted ranking.
- Per-repo scoping within a multi-repo project — search covers the whole
  project root.

## Context (existing architecture)

- **`fs:list`** (`src/main/ipc/fs.ts`) is shallow — one directory per call, used
  by the file tree for lazy expansion. There is **no** recursive walk in the main
  process today, so quick-open needs a new IPC handler.
- **Ignore handling** currently shells out to `git check-ignore` per directory.
  For a full-project listing we instead use a single `git ls-files` invocation
  (see below), which respects `.gitignore` in one process.
- **Opening a file** is `openFile({ projectId, path })` on the Zustand store
  (`src/renderer/src/state/store.ts`); it adds the file, marks it active, and
  reveals the editor. Quick-open reuses this verbatim.
- **Global shortcuts** live in one central keydown effect in
  `src/renderer/src/app.tsx` (⌘B, ⌘T, ⌘J, …). ⌘P is added there.
- **Overlays** use `fixed inset-0 z-50` directly (no React portals);
  `src/renderer/src/components/settings-modal.tsx` is the closest template.
- **Project model:** a project has a single absolute root `path`
  (`src/shared/types.ts`). The selected project is `selectedProjectId` in the
  store. Quick-open searches `selectedProject.path`.

## Design

### 1. Main process — new `fs:walk` IPC

New channel `IPC.fs.walk` (`'fs:walk'`) in `src/shared/types.ts`, handler in
`src/main/ipc/fs.ts`, preload binding in `src/preload/index.ts`.

**Signature**

```ts
walk(projectId: ProjectId): Promise<WalkResult>

interface WalkResult {
  files: string[]      // project-root-relative, forward slashes, files only
  truncated: boolean   // true when the MAX_FILES cap was hit
}
```

**Behavior**

- Resolve `projectId` → project. Unknown project → `{ files: [], truncated: false }`.
- **Primary (git repo):** run
  `git ls-files --cached --others --exclude-standard -z` at `project.path`.
  This lists tracked + untracked-but-not-ignored files, honoring `.gitignore`,
  in a single process. Parse the NUL-separated output.
- **Fallback (non-git, or git command fails):** recursive `readdir` walk from
  `project.path` that hard-prunes directories by name (`.git`, `node_modules`,
  and dot-directories) and skips `.DS_Store`. Per-directory errors (e.g.
  permissions) are caught and skipped, not fatal.
- **Cap:** stop collecting past `MAX_FILES` (constant, initial value 20,000) and
  set `truncated: true`.
- **Boundary:** paths stay within `project.path` (the git command runs with cwd
  at the root; the fallback never ascends).

**Pure, unit-tested helpers** (mirroring the existing `parse-numstat.ts` pattern):

- `parseLsFilesZ(output: string): string[]` — split NUL-separated output, drop
  empties.
- `shouldPruneDir(name: string): boolean` — the prune predicate for the fallback
  walk.

### 2. Renderer — fuzzy matching (pure lib)

New `src/renderer/src/lib/fuzzy-match.ts`:

```ts
interface FuzzyResult { score: number; matchedIndices: number[] }
function fuzzyMatch(query: string, target: string): FuzzyResult | null

interface RankedFile { path: string; matchedIndices: number[]; score: number }
function rankFiles(query: string, files: string[]): RankedFile[]
```

- `fuzzyMatch` — case-insensitive subsequence match: every query char must appear
  in `target` in order, else `null`. Score rewards consecutive runs, matches at
  path-separator / camelCase boundaries, and earlier positions.
- `rankFiles` — matches primarily against the **basename** (full path as
  tiebreak), sorts by score descending, caps to the top `MAX_RESULTS` (~50).
  `matchedIndices` are returned relative to the basename for highlighting. Empty
  query returns the first `MAX_RESULTS` paths unranked.

Written test-first (TDD).

### 3. Renderer — `QuickOpen` component

New `src/renderer/src/components/quick-open/quick-open.tsx`, modeled on
`settings-modal.tsx`.

**Props**

```ts
interface QuickOpenProps {
  open: boolean
  projectId: ProjectId
  onClose: () => void
}
```

**Behavior**

- Returns `null` when `!open`.
- On open (effect keyed on `open`): call `window.api.fs.walk(projectId)` **once**,
  store `{ files, truncated }` in local state. Show a loading state while the
  walk is in flight; reset query/selection each open.
- Layout: `fixed inset-0 z-50` scrim + top-centered (`pt-20`) `role="dialog"`
  panel, matching wTerm's overlay convention and the VS Code Workbench design
  language (dark surface, 1px dividers, single accent for match highlight /
  selected row).
- Controlled text input on top; results list below. Each row: `FileIcon` +
  basename with `matchedIndices` highlighted in the accent color + dimmed parent
  directory. When `truncated`, show a subtle "showing first N of many" note.
- Filtering runs `rankFiles(query, files)` in the renderer on each keystroke —
  no IPC per keystroke.

**Keyboard**

- Type → filter.
- ↑/↓ → move selection (wraps at ends).
- Enter → `openFile({ projectId, path })` then `onClose()`.
- Esc → `onClose()`.
- Mouse hover sets selection; click opens.

### 4. Wiring (`app.tsx`)

- Add a ⌘P / Ctrl+P branch to the central keydown effect. Gate on a selected
  project (no-op if none). `preventDefault()`; add any new handler identity to
  the effect's dependency array.
- Open/close state is a local `useState` in `app.tsx` (matching the existing
  `settingsOpen` pattern).
- Render `<QuickOpen open={quickOpenOpen} projectId={selectedProject.id}
  onClose={…} />` when a project is selected.

## Data Flow

```
⌘P
 → setQuickOpenOpen(true)
 → QuickOpen mounts → window.api.fs.walk(projectId)
     → main: git ls-files -co --exclude-standard -z  (or fallback walk)
     → WalkResult { files, truncated }
 → user types → rankFiles(query, files)  [pure, in-renderer, per keystroke]
 → ranked top-N rendered with highlights
 → Enter → openFile({ projectId, path }) → editor surface opens file
 → onClose()
```

## Error Handling

| Condition | Behavior |
|---|---|
| Unknown / no project | `walk` returns empty; ⌘P is a no-op when no project selected |
| `git ls-files` fails or non-git dir | Automatic fallback to manual recursive walk |
| Per-directory read error in fallback | Caught and skipped; walk continues |
| File count over `MAX_FILES` | Collection stops; `truncated: true` surfaced in UI |
| Empty result / no match | Friendly empty state in the palette |
| Walk in flight | Loading indicator in the palette |

## Testing

- **`fuzzy-match.test.ts`** — subsequence acceptance/rejection, case-insensitivity,
  ranking order, basename priority over path, result cap, empty-query behavior.
- **Main-process parsers** — `parseLsFilesZ` (NUL parsing, trailing separator,
  empty output) and `shouldPruneDir` (prunes `.git`/`node_modules`/dot-dirs,
  keeps normal dirs). The `git ls-files` call itself is thin glue over the tested
  parser.
- Manual verification: ⌘P on a git project and a non-git folder; confirm
  `node_modules`/`.git` never appear, Enter opens in the editor, Esc closes.

## Files Touched

**New**

- `src/renderer/src/lib/fuzzy-match.ts` + `fuzzy-match.test.ts`
- `src/renderer/src/components/quick-open/quick-open.tsx`
- Pure walk helpers + tests in `src/main/git/` or `src/main/ipc/` (e.g.
  `parse-ls-files.ts` + test) following the `parse-numstat.ts` precedent.

**Modified**

- `src/shared/types.ts` — `IPC.fs.walk`, `WalkResult`.
- `src/main/ipc/fs.ts` — `fs:walk` handler + fallback walk.
- `src/preload/index.ts` — `fs.walk` binding.
- `src/renderer/src/app.tsx` — ⌘P handler, `QuickOpen` render, open/close state.
