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
  // an empty path would resolve '.git' against the process cwd — never scan it
  if (projectPath === '') return []

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
    names.map(async (name) => ((await hasGitEntry(join(projectPath, name))) ? name : null))
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
