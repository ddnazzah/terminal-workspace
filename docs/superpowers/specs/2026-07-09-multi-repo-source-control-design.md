# Multi-Repo Source Control (VS Code-style workspaces)

**Date:** 2026-07-09
**Status:** Approved

## Problem

Many wTerm projects are folders containing several independent git repos (e.g. `backend/` and `frontend/` clones side by side). Today git detection runs only at the project root (`src/main/git/local.ts`): if the root isn't a repo, the Source Control tab shows "not a git repository" and the Files tree gets no git coloring. There is also no changed-files list anywhere in the Source Control tab.

## Goal

Detect git repos **one level deep** inside the project folder (plus the root itself), and render a per-repo section in the Source Control tab — like VS Code multi-root workspaces. Add a read-only changed-files list per repo.

Out of scope: deeper-than-one-level scanning, staging/unstaging/discard/commit actions, per-repo PRs/Runs for non-active repos.

## Design

### Repo discovery — new `src/main/git/discover.ts`

```ts
interface RepoRef {
  /** path relative to project root; '' means the project root itself */
  rel: string
  /** display name: folder name, or project folder name for root */
  name: string
}

async function discoverRepos(projectPath: string): Promise<RepoRef[]>
```

Rules:
- If `projectPath` contains `.git` (dir or file) → include `{ rel: '', name: basename(projectPath) }`.
- List immediate children of `projectPath`; for each **directory** that is not hidden (`.`-prefixed) and not a symlink, include it if it contains `.git` (dir or file).
- One level deep only. Submodules of the root repo that sit one level deep naturally appear as their own sections — no special handling.
- Unreadable entries are skipped silently (per-entry try/catch); a totally unreadable project dir returns `[]`.
- Root repo first, then children sorted by name.

### IPC changes — `src/shared/types.ts`, `src/main/ipc/git.ts`, `src/preload/index.ts`

- New channel `git.repos` → `git:repos`: `(projectId) => RepoRef[]`.
- `git.info`: `(projectId, repoRel?: string) => GitInfo` — resolves `join(project.path, repoRel)`. `repoRel` defaults to `''`.
- `git.push`: `(projectId, branch, repoRel?: string)` — same resolution.
- **Validation:** `repoRel` must exactly match a `rel` from a fresh `discoverRepos()` result; otherwise return the empty/error result. This prevents path traversal via IPC.
- `git.fileStatus(projectId)` becomes an **aggregate**: run `git status --porcelain=v1 -z` in every discovered repo, prefix each child repo's paths with `<rel>/`, and merge into a single project-root-relative `GitFileStatusMap`. Entries in the root repo's status whose path equals a child repo's `rel` (git reports nested repos as a single untracked dir entry) are dropped. The Files tree consumes this unchanged and now colors files inside child repos too.

### UI — `src/renderer/src/components/right-sidebar/`

- `git-panel.tsx` loads `git.repos` on mount / project change.
  - 0 repos → existing "not a git repository" empty state.
  - 1 repo → current layout (status bar, PRs, Runs) plus the new changes list.
  - 2+ repos → one collapsible `RepoSection` per repo.
- New `repo-section.tsx`: header row with repo name, branch, dirty dot, ahead/behind counts, push button, refresh — reusing the existing `GitStatusBar` presentation. Body: the changes list.
- New `changes-list.tsx`: read-only list of changed files from that repo's slice of the status map — filename, dimmed parent directory, and an M/A/D/U/C badge using the same colors as the Files tree (`statusColor`).
- **Active repo:** first repo by default; clicking a section header activates it (and expands it). `PrSection` and `RunsSection` render once, below the sections, bound to the active repo's `GitInfo`. The "no GitHub remote" notice keys off the active repo.

### Error handling

- A repo whose git commands fail renders its section with an inline error line instead of breaking the panel.
- IPC handlers keep the existing pattern of returning empty/`ok:false` results rather than throwing across the bridge.

### Testing (vitest, following `parse-status.test.ts` pattern)

- `discover.test.ts`: root-only repo, children-only, root + children, no repos, hidden dir skipped, symlink skipped, `.git` file (worktree/submodule) counts as repo — using temp dirs.
- Status aggregation: child paths prefixed, root's nested-repo dir entries dropped, merge of multiple repos.
- `repoRel` validation: unknown rel rejected, `..` traversal rejected.
- Component behavior is covered indirectly; no snapshot/E2E tests added for this feature.

## Decisions log

- Repo section content: branch + changed files (read-only) — chosen over status-only and over full stage/commit parity.
- PRs/Runs: active-repo-only — chosen over per-repo-everywhere and over skipping.
- Approach: repo-scoped IPC with discovery (Approach A) — over virtual sub-projects (invasive) and one aggregate call (coarse refresh).
