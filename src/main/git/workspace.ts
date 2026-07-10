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
  const childRels = new Set(entries.map((e) => e.rel).filter((rel) => rel !== ''))
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
