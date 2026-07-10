# Multi-Repo Source Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect git repos one level deep inside a project folder (VS Code multi-root style) and render a per-repo section — branch status + read-only changed-files list — in the Source Control tab, with PRs/Runs bound to the active repo.

**Architecture:** A new `discoverRepos()` in the Electron main process finds the root repo and child repos one level deep. Existing git IPC (`info`, `push`) gains a validated `repoRel` parameter; `fileStatus` becomes an aggregate that merges all repos into one project-root-relative map (so the Files tree colors child-repo files for free). GitHub IPC's `repoFor()` resolver gains the same `repoRel`. The renderer's `GitPanel` loads the repo list and renders one collapsible `RepoSection` per repo; PRs/Runs render once for the active repo.

**Tech Stack:** Electron (main/preload/renderer), TypeScript, React, vitest. Spec: `docs/superpowers/specs/2026-07-09-multi-repo-source-control-design.md`.

**Commands:**
- Tests: `pnpm test` (vitest run; includes `src/**/*.test.ts`)
- Single test file: `pnpm vitest run src/main/git/discover.test.ts`
- Typecheck: `pnpm typecheck`
- Use **pnpm**, never npm.

**Conventions:** conventional commits (`feat:`, `test:`, `refactor:`), no AI attribution lines. Immutable patterns (no in-place mutation of state/objects). Kebab-case filenames.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/shared/types.ts` | Modify | Add `RepoRef`, `IPC.git.repos` channel, `CreatePullRequestInput.repoRel` |
| `src/main/git/discover.ts` | Create | Find repos: root + one level deep; `findRepo` lookup |
| `src/main/git/discover.test.ts` | Create | Discovery tests (temp dirs, no git binary needed) |
| `src/main/git/workspace.ts` | Create | `mergeStatusMaps` (pure), `getWorkspaceFileStatus`, `listRepos` |
| `src/main/git/workspace.test.ts` | Create | Merge/prefix/drop-nested tests |
| `src/main/ipc/git.ts` | Modify | `git:repos` handler; `repoRel` on info/push; aggregate fileStatus |
| `src/main/ipc/github.ts` | Modify | `repoFor(projectId, repoRel)`; thread `repoRel` through all handlers |
| `src/preload/index.ts` | Modify | Expose `git.repos`; `repoRel` params on git + github APIs |
| `src/renderer/src/lib/git-status-color.ts` | Create | `statusColor()` extracted from file-tree (shared with changes list) |
| `src/renderer/src/lib/repo-status.ts` | Create | `sliceStatusForRepo()` — per-repo slice of the aggregate map |
| `src/renderer/src/lib/repo-status.test.ts` | Create | Slice tests |
| `src/renderer/src/components/right-sidebar/file-tree.tsx` | Modify | Import `statusColor` from lib (remove local copy) |
| `src/renderer/src/components/right-sidebar/changes-list.tsx` | Create | Read-only changed-files list |
| `src/renderer/src/components/right-sidebar/repo-section.tsx` | Create | Collapsible per-repo section (header + status row + changes) |
| `src/renderer/src/components/right-sidebar/git-panel.tsx` | Modify | Multi-repo orchestration; active-repo PRs/Runs |
| `src/renderer/src/components/right-sidebar/pr-section.tsx` | Modify | Accept + thread `repoRel` |
| `src/renderer/src/components/right-sidebar/runs-section.tsx` | Modify | Accept + thread `repoRel` |

---

### Task 1: Shared types and IPC channel names

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add the `git:repos` channel**

In `src/shared/types.ts`, the `IPC` const has a `git` block (~line 167):

```ts
  git: {
    info: 'git:info',
    push: 'git:push',
    fileStatus: 'git:file-status',
  },
```

Change to:

```ts
  git: {
    repos: 'git:repos',
    info: 'git:info',
    push: 'git:push',
    fileStatus: 'git:file-status',
  },
```

- [ ] **Step 2: Add `RepoRef` next to the `// ---- Local git ----` section (~line 287)**

Insert immediately after the `// ---- Local git ----` comment, before `GitInfo`:

```ts
/** A git repository discovered inside a project folder. */
export interface RepoRef {
  /** path relative to the project root, forward slashes; '' = the project root itself */
  rel: string
  /** display name (folder name; project folder name for the root repo) */
  name: string
}
```

- [ ] **Step 3: Add `repoRel` to `CreatePullRequestInput` (~line 372)**

Find `export interface CreatePullRequestInput {` and add one optional field at the end of the interface:

```ts
  /** repo within the project ('' or omitted = project root) */
  repoRel?: string
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck:node && pnpm typecheck:web`
Expected: PASS (types are additive).

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(git): add RepoRef type and git:repos IPC channel"
```

---

### Task 2: Repo discovery (`discoverRepos`, `findRepo`)

**Files:**
- Create: `src/main/git/discover.ts`
- Test: `src/main/git/discover.test.ts`

Discovery only checks for the *existence* of `.git` (dir or file — a file covers worktrees/submodules), so tests need no git binary. `readdir(..., { withFileTypes: true })` reports symlinks as symlinks (not directories), so symlinked dirs are skipped by the `isDirectory()` filter automatically.

- [ ] **Step 1: Write the failing tests**

Create `src/main/git/discover.test.ts`:

```ts
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverRepos, findRepo } from './discover'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'wterm-discover-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const mkRepo = async (...segments: string[]): Promise<void> => {
  await fs.mkdir(join(root, ...segments, '.git'), { recursive: true })
}

describe('discoverRepos', () => {
  it('returns empty array for a folder with no repos', async () => {
    await fs.mkdir(join(root, 'src'))
    expect(await discoverRepos(root)).toEqual([])
  })

  it('detects the project root itself as a repo', async () => {
    await mkRepo()
    const repos = await discoverRepos(root)
    expect(repos).toHaveLength(1)
    expect(repos[0]).toMatchObject({ rel: '' })
    expect(repos[0]!.name.length).toBeGreaterThan(0)
  })

  it('detects child repos one level deep, sorted by name', async () => {
    await mkRepo('frontend')
    await mkRepo('backend')
    expect(await discoverRepos(root)).toEqual([
      { rel: 'backend', name: 'backend' },
      { rel: 'frontend', name: 'frontend' },
    ])
  })

  it('lists the root repo first, then children', async () => {
    await mkRepo()
    await mkRepo('api')
    const repos = await discoverRepos(root)
    expect(repos.map((r) => r.rel)).toEqual(['', 'api'])
  })

  it('does not scan deeper than one level', async () => {
    await mkRepo('packages', 'app') // two levels down
    expect(await discoverRepos(root)).toEqual([])
  })

  it('treats a .git *file* as a repo (worktrees, submodules)', async () => {
    await fs.mkdir(join(root, 'wt'))
    await fs.writeFile(join(root, 'wt', '.git'), 'gitdir: /elsewhere\n')
    expect(await discoverRepos(root)).toEqual([{ rel: 'wt', name: 'wt' }])
  })

  it('skips hidden directories', async () => {
    await mkRepo('.cache')
    expect(await discoverRepos(root)).toEqual([])
  })

  it('skips symlinked directories', async () => {
    const outside = await fs.mkdtemp(join(tmpdir(), 'wterm-outside-'))
    await fs.mkdir(join(outside, '.git'))
    await fs.symlink(outside, join(root, 'linked'))
    expect(await discoverRepos(root)).toEqual([])
    await fs.rm(outside, { recursive: true, force: true })
  })

  it('returns [] for an unreadable project path', async () => {
    expect(await discoverRepos(join(root, 'does-not-exist'))).toEqual([])
  })
})

describe('findRepo', () => {
  const repos = [
    { rel: '', name: 'proj' },
    { rel: 'backend', name: 'backend' },
  ]

  it('finds a repo by exact rel', () => {
    expect(findRepo(repos, 'backend')).toEqual({ rel: 'backend', name: 'backend' })
    expect(findRepo(repos, '')).toEqual({ rel: '', name: 'proj' })
  })

  it('rejects unknown rels and traversal attempts', () => {
    expect(findRepo(repos, 'frontend')).toBeNull()
    expect(findRepo(repos, '../outside')).toBeNull()
    expect(findRepo(repos, 'backend/../..')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/main/git/discover.test.ts`
Expected: FAIL — cannot resolve `./discover`.

- [ ] **Step 3: Implement `src/main/git/discover.ts`**

```ts
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import type { RepoRef } from '@shared/types'

async function hasGitEntry(dir: string): Promise<boolean> {
  try {
    await fs.access(join(dir, '.git'))
    return true
  } catch {
    return false
  }
}

/**
 * Find git repos in a project folder: the root itself plus immediate child
 * directories containing `.git` (dir or file). One level deep only.
 * Hidden dirs and symlinks are skipped; unreadable entries are ignored.
 */
export async function discoverRepos(projectPath: string): Promise<RepoRef[]> {
  const rootRepo: RepoRef[] = (await hasGitEntry(projectPath))
    ? [{ rel: '', name: basename(projectPath) }]
    : []

  let names: string[] = []
  try {
    const entries = await fs.readdir(projectPath, { withFileTypes: true })
    names = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort()
  } catch {
    return rootRepo
  }

  const checks = await Promise.all(
    names.map(async (name) =>
      (await hasGitEntry(join(projectPath, name))) ? name : null
    )
  )
  const children = checks
    .filter((name): name is string => name !== null)
    .map((name) => ({ rel: name, name }))

  return [...rootRepo, ...children]
}

/** Validate a renderer-supplied rel against discovered repos (exact match only). */
export function findRepo(repos: RepoRef[], rel: string): RepoRef | null {
  return repos.find((r) => r.rel === rel) ?? null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/main/git/discover.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/main/git/discover.ts src/main/git/discover.test.ts
git commit -m "feat(git): discover repos one level deep in a project folder"
```

---

### Task 3: Workspace status aggregation (`mergeStatusMaps`, `getWorkspaceFileStatus`, `listRepos`)

**Files:**
- Create: `src/main/git/workspace.ts`
- Test: `src/main/git/workspace.test.ts`

`mergeStatusMaps` is pure (fully unit-tested). `getWorkspaceFileStatus` and `listRepos` are thin async composition over tested parts. `listRepos` preserves today's behavior for a project folder that is *nested inside* a repo (no `.git` at root, but `git rev-parse --show-toplevel` succeeds — `getGitInfo` handles that): discovery finds nothing, so we fall back to asking git about the root.

- [ ] **Step 1: Write the failing tests**

Create `src/main/git/workspace.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mergeStatusMaps } from './workspace'

describe('mergeStatusMaps', () => {
  it('returns empty map for no repos', () => {
    expect(mergeStatusMaps([])).toEqual({})
  })

  it('passes root repo paths through unchanged', () => {
    expect(
      mergeStatusMaps([{ rel: '', map: { 'src/a.ts': 'modified' } }])
    ).toEqual({ 'src/a.ts': 'modified' })
  })

  it('prefixes child repo paths with the repo rel', () => {
    expect(
      mergeStatusMaps([
        { rel: 'backend', map: { 'src/api.ts': 'added' } },
        { rel: 'frontend', map: { 'app.tsx': 'untracked' } },
      ])
    ).toEqual({
      'backend/src/api.ts': 'added',
      'frontend/app.tsx': 'untracked',
    })
  })

  it("drops the root repo's entries for nested child repos", () => {
    // git reports a nested repo as a single untracked dir entry "frontend/"
    expect(
      mergeStatusMaps([
        { rel: '', map: { 'frontend/': 'untracked', 'README.md': 'modified' } },
        { rel: 'frontend', map: { 'app.tsx': 'modified' } },
      ])
    ).toEqual({
      'README.md': 'modified',
      'frontend/app.tsx': 'modified',
    })
  })

  it('drops nested repo dir entries without trailing slash too', () => {
    expect(
      mergeStatusMaps([
        { rel: '', map: { frontend: 'untracked' } },
        { rel: 'frontend', map: {} },
      ])
    ).toEqual({})
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/main/git/workspace.test.ts`
Expected: FAIL — cannot resolve `./workspace`.

- [ ] **Step 3: Implement `src/main/git/workspace.ts`**

```ts
import { basename, join } from 'node:path'
import type { GitFileStatusMap, RepoRef } from '@shared/types'
import { discoverRepos } from './discover'
import { getFileStatus, getGitInfo } from './local'

/**
 * Merge per-repo status maps into one project-root-relative map.
 * Child repo paths get prefixed with their rel; the root repo's entries for
 * nested repo directories (git lists a nested repo as one dir entry) are dropped.
 */
export function mergeStatusMaps(
  entries: ReadonlyArray<{ rel: string; map: GitFileStatusMap }>
): GitFileStatusMap {
  const childRels = new Set(
    entries.map((e) => e.rel).filter((rel) => rel !== '')
  )
  const out: GitFileStatusMap = {}
  for (const { rel, map } of entries) {
    for (const [path, status] of Object.entries(map)) {
      if (rel === '') {
        if (childRels.has(path.replace(/\/$/, ''))) continue
        out[path] = status
      } else {
        out[`${rel}/${path}`] = status
      }
    }
  }
  return out
}

/**
 * Repos for a project: discovery first; if nothing found, fall back to git
 * itself so a project folder nested inside a larger repo keeps working.
 */
export async function listRepos(projectPath: string): Promise<RepoRef[]> {
  const repos = await discoverRepos(projectPath)
  if (repos.length > 0) return repos
  const info = await getGitInfo(projectPath)
  return info.isRepo ? [{ rel: '', name: basename(projectPath) }] : []
}

/** Aggregate `git status` across every repo in the project folder. */
export async function getWorkspaceFileStatus(
  projectPath: string
): Promise<GitFileStatusMap> {
  const repos = await listRepos(projectPath)
  const maps = await Promise.all(
    repos.map(async (r) => ({
      rel: r.rel,
      map: await getFileStatus(join(projectPath, r.rel)),
    }))
  )
  return mergeStatusMaps(maps)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/main/git/workspace.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/git/workspace.ts src/main/git/workspace.test.ts
git commit -m "feat(git): aggregate file status across all repos in a project"
```

---

### Task 4: Renderer status slicing + shared status color

**Files:**
- Create: `src/renderer/src/lib/repo-status.ts`
- Create: `src/renderer/src/lib/git-status-color.ts`
- Test: `src/renderer/src/lib/repo-status.test.ts`
- Modify: `src/renderer/src/components/right-sidebar/file-tree.tsx` (~line 758)

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/lib/repo-status.test.ts`:

```ts
import type { RepoRef } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { sliceStatusForRepo } from './repo-status'

const repos: RepoRef[] = [
  { rel: '', name: 'proj' },
  { rel: 'backend', name: 'backend' },
  { rel: 'frontend', name: 'frontend' },
]

const map = {
  'README.md': 'modified',
  'backend/src/api.ts': 'added',
  'backend/src/db.ts': 'modified',
  'frontend/app.tsx': 'untracked',
} as const

describe('sliceStatusForRepo', () => {
  it("root repo slice excludes child repos' paths", () => {
    expect(sliceStatusForRepo(map, repos, '')).toEqual([
      { path: 'README.md', projectPath: 'README.md', status: 'modified' },
    ])
  })

  it('child repo slice strips the repo prefix and sorts by path', () => {
    expect(sliceStatusForRepo(map, repos, 'backend')).toEqual([
      { path: 'src/api.ts', projectPath: 'backend/src/api.ts', status: 'added' },
      { path: 'src/db.ts', projectPath: 'backend/src/db.ts', status: 'modified' },
    ])
  })

  it('returns empty array for a clean repo', () => {
    expect(sliceStatusForRepo({}, repos, 'frontend')).toEqual([])
  })

  it('without child repos the root slice includes everything', () => {
    const only: RepoRef[] = [{ rel: '', name: 'proj' }]
    expect(sliceStatusForRepo(map, only, '')).toHaveLength(4)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/renderer/src/lib/repo-status.test.ts`
Expected: FAIL — cannot resolve `./repo-status`.

- [ ] **Step 3: Implement `src/renderer/src/lib/repo-status.ts`**

```ts
import type { GitFileStatus, GitFileStatusMap, RepoRef } from '@shared/types'

export interface RepoChange {
  /** path relative to the repo root */
  path: string
  /** path relative to the project root */
  projectPath: string
  status: GitFileStatus
}

/**
 * Slice the aggregate project status map down to one repo's changes.
 * For the root repo (''), paths under any child repo are excluded.
 */
export function sliceStatusForRepo(
  map: GitFileStatusMap,
  repos: ReadonlyArray<RepoRef>,
  rel: string
): RepoChange[] {
  const childPrefixes = repos
    .filter((r) => r.rel !== '')
    .map((r) => `${r.rel}/`)

  const changes: RepoChange[] = []
  for (const [projectPath, status] of Object.entries(map)) {
    if (rel === '') {
      if (childPrefixes.some((p) => projectPath.startsWith(p))) continue
      changes.push({ path: projectPath, projectPath, status })
    } else {
      const prefix = `${rel}/`
      if (!projectPath.startsWith(prefix)) continue
      changes.push({ path: projectPath.slice(prefix.length), projectPath, status })
    }
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/renderer/src/lib/repo-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Extract `statusColor` into `src/renderer/src/lib/git-status-color.ts`**

Create the file (content moved verbatim from `file-tree.tsx:758-772`):

```ts
import type { GitFileStatus } from '@shared/types'

export function statusColor(s?: GitFileStatus): string | undefined {
  switch (s) {
    case 'modified':
      return 'var(--git-modified)'
    case 'added':
    case 'untracked':
      return 'var(--git-added)'
    case 'deleted':
      return 'var(--git-deleted)'
    case 'conflict':
      return 'var(--git-conflict)'
    default:
      return undefined
  }
}
```

In `src/renderer/src/components/right-sidebar/file-tree.tsx`:
1. Delete the local `function statusColor(...)` (lines ~758-772).
2. Add to the imports at the top: `import { statusColor } from '../../lib/git-status-color'`

- [ ] **Step 6: Typecheck + full tests**

Run: `pnpm typecheck:web && pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/lib/repo-status.ts src/renderer/src/lib/repo-status.test.ts src/renderer/src/lib/git-status-color.ts src/renderer/src/components/right-sidebar/file-tree.tsx
git commit -m "feat(git): per-repo status slicing and shared status color helper"
```

---

### Task 5: Git IPC + preload (`repos`, `repoRel`, aggregate fileStatus)

**Files:**
- Modify: `src/main/ipc/git.ts` (whole file — small)
- Modify: `src/preload/index.ts` (git block, ~lines 170-177; imports at top)

Security note: `repoRel` comes from the renderer, so a non-empty value is only accepted when it exactly matches a discovered repo's rel (no `join()` on unvalidated input → no path traversal). An empty rel means the project root and needs no validation — that is exactly today's behavior.

- [ ] **Step 1: Replace `src/main/ipc/git.ts` with**

```ts
import { join } from 'node:path'
import { ipcMain } from 'electron'
import {
  IPC,
  type GitFileStatusMap,
  type GitInfo,
  type ProjectId,
  type RepoRef,
} from '@shared/types'
import { getProject } from '../store/state'
import { discoverRepos, findRepo } from '../git/discover'
import { getGitInfo, pushCurrentBranch } from '../git/local'
import { getWorkspaceFileStatus, listRepos } from '../git/workspace'

const EMPTY_GIT_INFO: GitInfo = {
  isRepo: false,
  branch: null,
  githubRepo: null,
  hasUpstream: false,
  ahead: 0,
  behind: 0,
  dirty: false,
  defaultBranch: null,
}

/**
 * Resolve a repo path inside a project. '' = the project root (always allowed);
 * anything else must exactly match a discovered repo rel — rejects traversal.
 */
export async function resolveRepoPath(
  projectPath: string,
  repoRel: string
): Promise<string | null> {
  if (repoRel === '') return projectPath
  const repos = await discoverRepos(projectPath)
  const repo = findRepo(repos, repoRel)
  return repo ? join(projectPath, repo.rel) : null
}

export function registerGitIpc(): void {
  ipcMain.handle(IPC.git.repos, async (_e, projectId: ProjectId): Promise<RepoRef[]> => {
    const project = getProject(projectId)
    if (!project) return []
    return listRepos(project.path)
  })

  ipcMain.handle(
    IPC.git.info,
    async (_e, projectId: ProjectId, repoRel = ''): Promise<GitInfo> => {
      const project = getProject(projectId)
      if (!project) return EMPTY_GIT_INFO
      const path = await resolveRepoPath(project.path, repoRel)
      if (!path) return EMPTY_GIT_INFO
      return getGitInfo(path)
    }
  )

  ipcMain.handle(
    IPC.git.push,
    async (_e, projectId: ProjectId, branch: string, repoRel = '') => {
      const project = getProject(projectId)
      if (!project) return { ok: false, output: 'project not found' }
      const path = await resolveRepoPath(project.path, repoRel)
      if (!path) return { ok: false, output: 'unknown repo' }
      return pushCurrentBranch(path, branch)
    }
  )

  ipcMain.handle(
    IPC.git.fileStatus,
    async (_e, projectId: ProjectId): Promise<GitFileStatusMap> => {
      const project = getProject(projectId)
      if (!project) return {}
      return getWorkspaceFileStatus(project.path)
    }
  )
}
```

- [ ] **Step 2: Update the preload git block**

In `src/preload/index.ts`, add `RepoRef` to the `@shared/types` type import at the top of the file, then replace the `git:` block (~lines 170-177) with:

```ts
  git: {
    repos: (projectId: ProjectId): Promise<RepoRef[]> =>
      ipcRenderer.invoke(IPC.git.repos, projectId),
    info: (projectId: ProjectId, repoRel = ''): Promise<GitInfo> =>
      ipcRenderer.invoke(IPC.git.info, projectId, repoRel),
    push: (
      projectId: ProjectId,
      branch: string,
      repoRel = ''
    ): Promise<{ ok: boolean; output: string }> =>
      ipcRenderer.invoke(IPC.git.push, projectId, branch, repoRel),
    fileStatus: (projectId: ProjectId): Promise<GitFileStatusMap> =>
      ipcRenderer.invoke(IPC.git.fileStatus, projectId),
  },
```

- [ ] **Step 3: Typecheck + tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS. (Existing renderer callers pass no `repoRel` — defaults keep them working.)

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/git.ts src/preload/index.ts
git commit -m "feat(git): repo-scoped git IPC with validated repoRel and aggregate status"
```

---

### Task 6: GitHub IPC — repo-scoped `repoFor`

**Files:**
- Modify: `src/main/ipc/github.ts`
- Modify: `src/preload/index.ts` (github block)

Mechanical threading: every handler that calls `repoFor(projectId)` gains a trailing `repoRel?: string` IPC arg. `resolveRepoPath` is imported from `./git` (same validation, no duplication).

- [ ] **Step 1: Update `repoFor` in `src/main/ipc/github.ts` (~line 46)**

Replace:

```ts
async function repoFor(projectId: ProjectId): Promise<{ owner: string; repo: string } | null> {
  const project = getProject(projectId)
  if (!project) return null
  const info = await getGitInfo(project.path)
  return info.githubRepo
}
```

with:

```ts
async function repoFor(
  projectId: ProjectId,
  repoRel = ''
): Promise<{ owner: string; repo: string } | null> {
  const project = getProject(projectId)
  if (!project) return null
  const path = await resolveRepoPath(project.path, repoRel)
  if (!path) return null
  const info = await getGitInfo(path)
  return info.githubRepo
}
```

and add the import: `import { resolveRepoPath } from './git'`

- [ ] **Step 2: Thread `repoRel` through every handler**

Each change is the same shape — add a trailing parameter and pass it to `repoFor`. Exact list (line numbers are pre-edit anchors):

| Handler (line) | Signature change | `repoFor` call |
|---|---|---|
| `listPullRequests` (222) | `(_e, projectId, state = 'open', repoRel = '')` | `repoFor(projectId, repoRel)` |
| `getPullRequest` (234) | `(_e, projectId, number, repoRel = '')` | `repoFor(projectId, repoRel)` |
| `createPullRequest` (289) | unchanged (input object) | `repoFor(input.projectId, input.repoRel ?? '')` |
| `mergePullRequest` (305) | `(_e, projectId, number, method = 'squash', repoRel = '')` | `repoFor(projectId, repoRel)` |
| `commentPullRequest` (322) | `(_e, projectId, number, body, repoRel = '')` | `repoFor(projectId, repoRel)` |
| `listWorkflows` (334) | `(_e, projectId, repoRel = '')` | `repoFor(projectId, repoRel)` |
| `listRuns` (351) | `(_e, projectId, opts?, repoRel = '')` | `repoFor(projectId, repoRel)` |
| `getRun` (365) | `(_e, projectId, runId, repoRel = '')` | `repoFor(projectId, repoRel)` |
| `rerunRun` (380) | `(_e, projectId, runId, repoRel = '')` | `repoFor(projectId, repoRel)` |
| `rerunFailed` (390) | `(_e, projectId, runId, repoRel = '')` | `repoFor(projectId, repoRel)` |
| `cancelRun` (400) | `(_e, projectId, runId, repoRel = '')` | `repoFor(projectId, repoRel)` |
| `dispatchWorkflow` (410) | `(_e, projectId, workflowId, ref, inputs?, repoRel = '')` | `repoFor(projectId, repoRel)` |

- [ ] **Step 3: Update the preload github block**

In `src/preload/index.ts`, for each function below add a trailing `repoRel = ''` parameter and append it as the final `ipcRenderer.invoke` argument (matching the handler positions above): `listPullRequests`, `getPullRequest`, `mergePullRequest`, `commentPullRequest`, `listWorkflows`, `listRuns`, `getRun`, `rerunRun`, `rerunFailed`, `cancelRun`, `dispatchWorkflow`. Example for `listRuns`:

```ts
    listRuns: (
      projectId: ProjectId,
      opts?: { branch?: string },
      repoRel = ''
    ): Promise<WorkflowRunSummary[]> =>
      ipcRenderer.invoke(IPC.github.listRuns, projectId, opts, repoRel),
```

`createPullRequest` needs no signature change (repoRel travels inside the input object).

IMPORTANT: where a handler has an optional arg before `repoRel` (`state` in listPullRequests, `method` in mergePullRequest, `opts` in listRuns, `inputs` in dispatchWorkflow), the preload MUST keep passing that arg in position (even when undefined) so `repoRel` lands in the right slot — the existing preload already does this.

- [ ] **Step 4: Typecheck + tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/github.ts src/preload/index.ts
git commit -m "feat(github): scope PR and workflow IPC to a repo within the project"
```

---

### Task 7: Changes list + repo section components

**Files:**
- Create: `src/renderer/src/components/right-sidebar/changes-list.tsx`
- Create: `src/renderer/src/components/right-sidebar/repo-section.tsx`

These are presentational; `RepoSection` also absorbs the status row currently living in `git-panel.tsx`'s private `GitStatusBar` (deleted in Task 8).

- [ ] **Step 1: Create `changes-list.tsx`**

```tsx
import type { GitFileStatus } from '@shared/types'
import { statusColor } from '../../lib/git-status-color'
import type { RepoChange } from '../../lib/repo-status'

const STATUS_BADGE: Record<GitFileStatus, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  untracked: 'U',
  conflict: 'C',
}

export function ChangesList({ changes }: { changes: RepoChange[] }) {
  if (changes.length === 0) {
    return <div className="px-3 py-2 text-[11px] text-foreground/40">No changes.</div>
  }
  return (
    <ul className="pb-1">
      {changes.map((c) => {
        const slash = c.path.lastIndexOf('/')
        const name = slash === -1 ? c.path : c.path.slice(slash + 1)
        const dir = slash === -1 ? null : c.path.slice(0, slash)
        return (
          <li
            key={c.projectPath}
            title={c.projectPath}
            className="flex items-center gap-2 px-3 py-1 text-[12px] hover:bg-foreground/5"
          >
            <span
              className="truncate text-foreground/85"
              style={{ color: statusColor(c.status) }}
            >
              {name}
            </span>
            <span className="truncate text-[11px] text-foreground/40 flex-1">
              {dir ?? ''}
            </span>
            <span
              className="text-[11px] font-mono shrink-0"
              style={{ color: statusColor(c.status) }}
            >
              {STATUS_BADGE[c.status]}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
```

- [ ] **Step 2: Create `repo-section.tsx`**

```tsx
import type { GitInfo, RepoRef } from '@shared/types'
import { ChangesList } from './changes-list'
import type { RepoChange } from '../../lib/repo-status'

interface RepoSectionProps {
  repo: RepoRef
  info: GitInfo | undefined
  changes: RepoChange[]
  /** more than one repo in the project — show name header + activation */
  isMulti: boolean
  isActive: boolean
  isCollapsed: boolean
  pushing: boolean
  pushResult: string | null
  onHeaderClick: () => void
  onPush: () => void
  onRefresh: () => void
}

export function RepoSection({
  repo,
  info,
  changes,
  isMulti,
  isActive,
  isCollapsed,
  pushing,
  pushResult,
  onHeaderClick,
  onPush,
  onRefresh,
}: RepoSectionProps) {
  return (
    <section
      className={`border-b border-accent/7 ${isMulti && isActive ? 'bg-foreground/[0.03]' : ''}`}
    >
      {isMulti && (
        <button
          type="button"
          onClick={onHeaderClick}
          title={isActive ? repo.name : `${repo.name} — click to activate`}
          className="flex items-center gap-1.5 w-full px-3 py-1.5 text-left hover:bg-foreground/5"
        >
          <span aria-hidden className="text-[10px] text-foreground/40">
            {isCollapsed ? '▸' : '▾'}
          </span>
          <span
            className={`text-[11px] uppercase tracking-wider font-medium truncate ${
              isActive ? 'text-foreground/80' : 'text-foreground/45'
            }`}
          >
            {repo.name}
          </span>
          {info?.dirty && (
            <span aria-hidden className="text-amber-300" title="Uncommitted changes">
              ●
            </span>
          )}
          <span className="flex-1" />
          <span className="text-[11px] text-foreground/40 tabular-nums">
            {changes.length > 0 ? changes.length : ''}
          </span>
        </button>
      )}
      {!isCollapsed && (
        <>
          {info ? (
            info.isRepo ? (
              <RepoStatusRow
                info={info}
                pushing={pushing}
                pushResult={pushResult}
                onPush={onPush}
                onRefresh={onRefresh}
              />
            ) : (
              <div className="px-3 py-2 text-[11px] text-red-400/80">
                git is unavailable for this repo.
              </div>
            )
          ) : (
            <div className="px-3 py-2 text-[11px] text-foreground/40">Loading…</div>
          )}
          <ChangesList changes={changes} />
        </>
      )}
    </section>
  )
}

function RepoStatusRow({
  info,
  pushing,
  pushResult,
  onPush,
  onRefresh,
}: {
  info: GitInfo
  pushing: boolean
  pushResult: string | null
  onPush: () => void
  onRefresh: () => void
}) {
  return (
    <div className="px-3 py-2 text-[11px] text-foreground/65 space-y-1">
      <div className="flex items-center gap-2">
        <span aria-hidden>⎇</span>
        <span className="font-mono text-foreground/85 truncate">
          {info.branch ?? '(detached)'}
        </span>
        {info.dirty && (
          <span className="text-amber-300" title="Uncommitted changes">●</span>
        )}
        {info.hasUpstream && (info.ahead > 0 || info.behind > 0) && (
          <span className="text-foreground/50">
            {info.ahead > 0 && `↑${info.ahead}`}
            {info.behind > 0 && `↓${info.behind}`}
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onRefresh}
          title="Refresh git status"
          className="text-foreground/50 hover:text-foreground"
        >
          ↻
        </button>
        {info.branch && (!info.hasUpstream || info.ahead > 0) && (
          <button
            type="button"
            onClick={onPush}
            disabled={pushing}
            className="text-[11px] px-2 py-0.5 rounded bg-foreground/10 hover:bg-foreground/20 disabled:opacity-40"
          >
            {pushing ? 'Pushing…' : info.hasUpstream ? 'Push' : 'Push -u'}
          </button>
        )}
      </div>
      {info.githubRepo && (
        <div className="text-foreground/45 truncate">
          {info.githubRepo.owner}/{info.githubRepo.repo}
        </div>
      )}
      {pushResult && (
        <div className="text-[10px] text-foreground/50 truncate" title={pushResult}>
          {pushResult}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck:web`
Expected: PASS (components not yet wired in — that's Task 8).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/right-sidebar/changes-list.tsx src/renderer/src/components/right-sidebar/repo-section.tsx
git commit -m "feat(ui): changes list and per-repo section components"
```

---

### Task 8: GitPanel multi-repo orchestration + PR/Runs threading

**Files:**
- Modify: `src/renderer/src/components/right-sidebar/git-panel.tsx` (full rewrite below)
- Modify: `src/renderer/src/components/right-sidebar/pr-section.tsx`
- Modify: `src/renderer/src/components/right-sidebar/runs-section.tsx`

- [ ] **Step 1: Replace `git-panel.tsx` with**

```tsx
import { useCallback, useEffect, useState } from 'react'
import type {
  GitFileStatusMap,
  GitHubSettings,
  GitInfo,
  Project,
  RepoRef,
} from '@shared/types'
import { sliceStatusForRepo } from '../../lib/repo-status'
import { GitHubAuth } from './github-auth'
import { PrSection } from './pr-section'
import { RepoSection } from './repo-section'
import { RunsSection } from './runs-section'

interface Props {
  project: Project
}

export function GitPanel({ project }: Props) {
  const [settings, setSettings] = useState<GitHubSettings | null>(null)
  const [repos, setRepos] = useState<RepoRef[] | null>(null)
  const [infos, setInfos] = useState<Record<string, GitInfo>>({})
  const [statusMap, setStatusMap] = useState<GitFileStatusMap>({})
  const [activeRel, setActiveRel] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [pushingRel, setPushingRel] = useState<string | null>(null)
  const [pushResult, setPushResult] = useState<{ rel: string; msg: string } | null>(null)

  const reloadAll = useCallback(async () => {
    const list = await window.api.git.repos(project.id)
    const [infoList, status] = await Promise.all([
      Promise.all(list.map((r) => window.api.git.info(project.id, r.rel))),
      window.api.git.fileStatus(project.id),
    ])
    setRepos(list)
    setInfos(Object.fromEntries(list.map((r, i) => [r.rel, infoList[i]!])))
    setStatusMap(status)
    setActiveRel((cur) =>
      list.some((r) => r.rel === cur) ? cur : (list[0]?.rel ?? '')
    )
  }, [project.id])

  useEffect(() => {
    let cancelled = false
    setRepos(null)
    setInfos({})
    setStatusMap({})
    setCollapsed({})
    setPushResult(null)
    window.api.github.getSettings().then((s) => {
      if (!cancelled) setSettings(s)
    })
    void reloadAll()
    return () => {
      cancelled = true
    }
  }, [project.id, reloadAll])

  const push = useCallback(
    async (rel: string) => {
      const info = infos[rel]
      if (!info?.branch) return
      setPushingRel(rel)
      setPushResult(null)
      try {
        const res = await window.api.git.push(project.id, info.branch, rel)
        setPushResult({ rel, msg: res.output.split('\n').slice(-2).join(' ') })
        await reloadAll()
      } finally {
        setPushingRel(null)
      }
    },
    [project.id, infos, reloadAll]
  )

  const handleHeaderClick = useCallback((rel: string) => {
    setActiveRel((prevActive) => {
      setCollapsed((c) => ({
        ...c,
        [rel]: rel === prevActive ? !c[rel] : false,
      }))
      return rel
    })
  }, [])

  if (!settings || repos === null) {
    return (
      <div className="px-3 py-4 text-[11px] text-foreground/40">Loading…</div>
    )
  }

  if (repos.length === 0) {
    return (
      <div className="px-3 py-4 text-[12px] text-foreground/60 space-y-2">
        <div>This folder isn’t a git repository.</div>
        <div className="text-[11px] text-foreground/40">
          Run <code className="text-foreground/70">git init</code> in a terminal, then refresh.
        </div>
      </div>
    )
  }

  const isMulti = repos.length > 1
  const activeInfo: GitInfo | null = infos[activeRel] ?? null
  const activePush = useCallbackForActive(push, activeRel)

  return (
    <div className="h-full overflow-y-auto">
      <GitHubAuth settings={settings} onAuthChanged={setSettings} />
      {repos.map((repo) => (
        <RepoSection
          key={repo.rel}
          repo={repo}
          info={infos[repo.rel]}
          changes={sliceStatusForRepo(statusMap, repos, repo.rel)}
          isMulti={isMulti}
          isActive={repo.rel === activeRel}
          isCollapsed={!!collapsed[repo.rel]}
          pushing={pushingRel === repo.rel}
          pushResult={pushResult?.rel === repo.rel ? pushResult.msg : null}
          onHeaderClick={() => handleHeaderClick(repo.rel)}
          onPush={() => void push(repo.rel)}
          onRefresh={() => void reloadAll()}
        />
      ))}
      {settings.hasToken && activeInfo?.githubRepo ? (
        <>
          <PrSection
            project={project}
            repoRel={activeRel}
            gitInfo={activeInfo}
            pushing={pushingRel === activeRel}
            onRequestPush={activePush}
          />
          <RunsSection project={project} repoRel={activeRel} gitInfo={activeInfo} />
        </>
      ) : settings.hasToken && activeInfo && !activeInfo.githubRepo ? (
        <div className="px-3 py-4 text-[12px] text-foreground/55">
          {isMulti ? (
            <>
              <span className="font-medium">{repos.find((r) => r.rel === activeRel)?.name}</span>{' '}
              has no GitHub remote on <code>origin</code>, so PRs and runs aren’t available.
            </>
          ) : (
            <>This repo has no GitHub remote on <code>origin</code>, so PRs and runs aren’t available.</>
          )}
        </div>
      ) : null}
    </div>
  )
}

/** Stable zero-arg push callback for the active repo (PrSection expects `() => Promise<void>`). */
function useCallbackForActive(
  push: (rel: string) => Promise<void>,
  activeRel: string
): () => Promise<void> {
  return useCallback(() => push(activeRel), [push, activeRel])
}
```

NOTE — hooks rule: `useCallbackForActive` is called after two early returns in the sketch above. That violates rules-of-hooks. Move the call **above** the `if (!settings || repos === null)` return when writing the file, i.e. place `const activePush = useCallbackForActive(push, activeRel)` directly after `handleHeaderClick` is defined. (The reviewer must verify no hook sits below an early return.)

- [ ] **Step 2: Thread `repoRel` through `pr-section.tsx`**

All edits are mechanical (grep anchors given for the pre-edit file):

1. `Props` (line 5): add `repoRel: string`.
2. `export function PrSection({ project, gitInfo, onRequestPush, pushing }: Props)` (line 14) → add `repoRel` to the destructuring.
3. `reload` (line 26): `listPullRequests(project.id, filter, repoRel)`; add `repoRel` to the `useCallback` deps (line 33).
4. `<CreatePrForm project={project} ...>` (line 42): add `repoRel={repoRel}`.
5. `<PrDetailView project={project} ...>` (line 59): add `repoRel={repoRel}`.
6. `CreatePrForm` (line 156): add `repoRel: string` to its props type and destructuring; in `submit` (line 185) add `repoRel` to the `createPullRequest` input object:
   ```ts
   const pr = await window.api.github.createPullRequest({
     projectId: project.id,
     repoRel,
     title: title.trim(),
     body,
     head,
     base,
     draft,
   })
   ```
7. `PrDetailView` (line 286): add `repoRel: string` prop; update calls —
   - `getPullRequest(project.id, number, repoRel)` (line 306), deps (line 313) gain `repoRel`
   - `commentPullRequest(project.id, number, comment.trim(), repoRel)` (line 323)
   - `mergePullRequest(project.id, number, method, repoRel)` (line 336)

- [ ] **Step 3: Thread `repoRel` through `runs-section.tsx`**

1. `Props` (line 11): add `repoRel: string`; destructure in `RunsSection` (line 16).
2. `reload` (line 28): `listRuns(project.id, filterMine && gitInfo?.branch ? { branch: gitInfo.branch } : undefined, repoRel)`; add `repoRel` to the deps.
3. Pass `repoRel={repoRel}` where `RunDetailView` and `DispatchWorkflowForm` are rendered (search for `<RunDetailView` and `<DispatchWorkflowForm`).
4. `RunDetailView` (line 151): add `repoRel: string` prop; update —
   - `getRun(project.id, runId, repoRel)` (line 169), deps gain `repoRel`
   - `cancelRun(project.id, run.id, repoRel)` (line 246)
   - `rerunRun(project.id, run.id, repoRel)` (line 258)
   - `rerunFailed(project.id, run.id, repoRel)` (line 268)
5. `DispatchWorkflowForm` (line 321): add `repoRel: string` prop; update —
   - `listWorkflows(project.id, repoRel)` (line 343), effect deps (line 357) gain `repoRel`
   - `dispatchWorkflow(project.id, selected, ref, undefined, repoRel)` (line 364) — note `inputs` must be passed as `undefined` to keep `repoRel` in the right positional slot.

- [ ] **Step 4: Typecheck + full tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS. Common failures: missed `repoRel` prop at a call site (typecheck catches), hook below early return (check manually).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/right-sidebar/git-panel.tsx src/renderer/src/components/right-sidebar/pr-section.tsx src/renderer/src/components/right-sidebar/runs-section.tsx
git commit -m "feat(ui): multi-repo source control panel with active-repo PRs and runs"
```

---

### Task 9: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full automated pass**

Run: `pnpm test && pnpm typecheck`
Expected: all tests pass, all three typecheck projects pass.

- [ ] **Step 2: Build a multi-repo fixture**

```bash
FIX=$(mktemp -d)/multi-ws && mkdir -p "$FIX" && cd "$FIX"
git init -q backend && git init -q frontend
echo x > backend/api.ts && echo y > frontend/app.tsx
echo z > loose-file.txt
```

- [ ] **Step 3: Manual verification in the app**

Run: `pnpm dev`, add `$FIX` as a project, open the Source Control tab. Verify:
1. Two collapsible sections, `backend` and `frontend`, sorted by name; no root section (the fixture root is not a repo).
2. Each section shows its branch and one untracked file (`api.ts` / `app.tsx`) with a `U` badge.
3. Clicking the `frontend` header activates it (highlight moves); clicking the active header again collapses it.
4. Files tab: `backend/api.ts` and `frontend/app.tsx` are colored as untracked.
5. A single-repo project (e.g. wTerm itself) renders as before — status row, changes list, PRs and Runs work, no repo-name header.
6. Push a change in a single-repo project still works (or at minimum the Push button appears on an ahead branch).

- [ ] **Step 4: Code review**

Per the development workflow, run the code-reviewer pass on the full diff (`git diff main...HEAD` if on a branch, else the task commits) before finishing. Address CRITICAL/HIGH findings.
```

---

## Self-Review Notes (already applied)

- **Spec coverage:** discovery (Task 2), aggregate status + nested-repo drop (Task 3), repoRel validation (Tasks 2/5), preload/IPC (Tasks 5/6), UI sections + changes list + active repo (Tasks 7/8), Files-tree coloring for child repos (Task 3 via aggregate map — no file-tree logic change needed), fallback for project-nested-inside-a-repo (Task 3 `listRepos`), tests (Tasks 2/3/4).
- **Type consistency:** `RepoRef { rel, name }` (Task 1) used in Tasks 2, 3, 4, 5, 7, 8. `RepoChange { path, projectPath, status }` (Task 4) used in Tasks 7, 8. `resolveRepoPath` defined in Task 5, imported in Task 6.
- **Known hazard called out inline:** hook ordering in `git-panel.tsx` (Task 8 Step 1 NOTE).
