import { basename, join } from 'node:path'
import { searchFiles, type SearchOptions } from './local'
import { mergeRepoHits } from './merge-search'
import type { SearchHit } from '@shared/types'
import type { GitFileStatusMap, RepoRef } from '@shared/types'
import { discoverRepos } from './discover'
import { getFileStatus, getGitInfo } from './local'

/**
 * Merge per-repo status maps into one project-root-relative map.
 * Child repo paths get prefixed with their rel. A child repo owns its
 * subtree — root-repo entries at or under a child rel are dropped, whether
 * git lists the nested repo as one dir entry ("frontend/") or as individual
 * file paths still tracked by the parent ("frontend/app.tsx").
 */
export function mergeStatusMaps(
  entries: ReadonlyArray<{ rel: string; map: GitFileStatusMap }>
): GitFileStatusMap {
  const childRels = new Set(entries.map((e) => e.rel).filter((rel) => rel !== ''))
  const childPrefixes = [...childRels].map((rel) => `${rel}/`)
  const isOwnedByChild = (path: string): boolean =>
    childRels.has(path.replace(/\/$/, '')) ||
    childPrefixes.some((prefix) => path.startsWith(prefix))
  const out: GitFileStatusMap = {}
  for (const { rel, map } of entries) {
    for (const [path, status] of Object.entries(map)) {
      if (rel === '') {
        if (isOwnedByChild(path)) continue
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
export async function getWorkspaceFileStatus(projectPath: string): Promise<GitFileStatusMap> {
  const repos = await listRepos(projectPath)
  const maps = await Promise.all(
    repos.map(async (r) => ({
      rel: r.rel,
      map: await getFileStatus(join(projectPath, r.rel)),
    }))
  )
  return mergeStatusMaps(maps)
}

/** Cap on merged hits across every repo in the project. */
const MAX_WORKSPACE_HITS = 2000

/**
 * Search every git repo in the project, not just one.
 *
 * A project can hold several repos (see {@link listRepos}); searching only the
 * project root finds nothing when the root itself is not a repo, which is the
 * normal multi-repo layout. Results come back with project-relative paths so
 * the renderer can open them without knowing which repo they came from.
 */
export async function searchWorkspace(
  projectPath: string,
  query: string,
  options: SearchOptions
): Promise<{ hits: SearchHit[]; truncated: boolean }> {
  const repos = await listRepos(projectPath)
  if (repos.length === 0) return { hits: [], truncated: false }

  const perRepo = await Promise.all(
    repos.map(async (repo) => ({
      rel: repo.rel,
      hits: (await searchFiles(join(projectPath, repo.rel), query, options)).hits,
    }))
  )

  return mergeRepoHits(perRepo, MAX_WORKSPACE_HITS)
}
