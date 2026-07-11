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
  const childPrefixes = repos.filter((r) => r.rel !== '').map((r) => `${r.rel}/`)

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
