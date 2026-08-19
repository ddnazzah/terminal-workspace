import type { SearchHit } from '@shared/types'

export interface RepoHits {
  /** Repo path relative to the project root; '' for a repo at the root. */
  rel: string
  hits: SearchHit[]
}

/**
 * Merge per-repo search results into one project-relative list.
 *
 * git grep reports paths relative to the repo it ran in, so in a multi-repo
 * project two different files can come back with the same path. Prefixing with
 * the repo's own path makes them unambiguous and lets the renderer open them
 * against the project root like any other file.
 *
 * The cap applies to the merged total rather than per repo — otherwise a
 * project with ten repos could return ten times the intended limit.
 */
export function mergeRepoHits(
  repos: readonly RepoHits[],
  maxHits: number
): { hits: SearchHit[]; truncated: boolean } {
  const merged: SearchHit[] = []

  for (const repo of repos) {
    for (const hit of repo.hits) {
      merged.push(repo.rel === '' ? hit : { ...hit, path: `${repo.rel}/${hit.path}` })
    }
  }

  return { hits: merged.slice(0, maxHits), truncated: merged.length > maxHits }
}
