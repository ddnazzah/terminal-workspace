import { join, resolve, sep } from 'node:path'
import { ipcMain } from 'electron'
import { promises as fsp } from 'node:fs'
import { replaceInText, type ReplaceOptions } from '@shared/replace-in-text'
import {
  IPC,
  type GitFileStatusMap,
  type GitInfo,
  type GitStatusEntry,
  type ProjectId,
  type RepoRef,
  type SearchHit,
} from '@shared/types'
import { getProject } from '../store/state'
import { discoverRepos, findRepo } from '../git/discover'
import {
  commitStaged,
  fileAtRev,
  searchFiles,
  type SearchOptions,
  discardPaths,
  getGitInfo,
  getStatusEntries,
  pushCurrentBranch,
  stagePaths,
  unstagePaths,
} from '../git/local'
import { getWorkspaceFileStatus, listRepos, searchWorkspace } from '../git/workspace'

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
    IPC.git.statusEntries,
    async (_e, projectId: ProjectId, repoRel: string): Promise<GitStatusEntry[]> => {
      const cwd = repoCwd(projectId, repoRel)
      return cwd ? getStatusEntries(cwd) : []
    }
  )

  ipcMain.handle(
    IPC.git.stage,
    async (_e, projectId: ProjectId, repoRel: string, paths: string[]): Promise<boolean> => {
      const cwd = repoCwd(projectId, repoRel)
      return cwd ? stagePaths(cwd, paths) : false
    }
  )

  ipcMain.handle(
    IPC.git.unstage,
    async (_e, projectId: ProjectId, repoRel: string, paths: string[]): Promise<boolean> => {
      const cwd = repoCwd(projectId, repoRel)
      return cwd ? unstagePaths(cwd, paths) : false
    }
  )

  ipcMain.handle(
    IPC.git.discard,
    async (
      _e,
      projectId: ProjectId,
      repoRel: string,
      tracked: string[],
      untracked: string[]
    ): Promise<boolean> => {
      const cwd = repoCwd(projectId, repoRel)
      return cwd ? discardPaths(cwd, tracked, untracked) : false
    }
  )

  ipcMain.handle(
    IPC.git.fileAtRev,
    async (
      _e,
      projectId: ProjectId,
      repoRel: string,
      relPath: string,
      rev: 'HEAD' | 'index'
    ): Promise<string | null> => {
      const cwd = repoCwd(projectId, repoRel)
      return cwd ? fileAtRev(cwd, relPath, rev) : null
    }
  )

  ipcMain.handle(
    IPC.git.search,
    async (
      _e,
      projectId: ProjectId,
      repoRel: string,
      query: string,
      options: SearchOptions
    ): Promise<{ hits: SearchHit[]; truncated: boolean }> => {
      const project = getProject(projectId)
      if (!project) return { hits: [], truncated: false }

      // repoRel scopes the search to one repo; empty means the whole project,
      // which is the normal case and must cover every repo it contains.
      if (repoRel) {
        const cwd = repoCwd(projectId, repoRel)
        return cwd ? searchFiles(cwd, query, options) : { hits: [], truncated: false }
      }
      return searchWorkspace(project.path, query, options)
    }
  )

  ipcMain.handle(
    IPC.git.replace,
    async (
      _e,
      projectId: ProjectId,
      repoRel: string,
      relPaths: string[],
      search: string,
      replacement: string,
      options: ReplaceOptions
    ): Promise<{ filesChanged: number; replacements: number }> => {
      const project = getProject(projectId)
      if (!project) return { filesChanged: 0, replacements: 0 }
      return replaceAcrossFiles(project.path, repoRel, relPaths, search, replacement, options)
    }
  )

  ipcMain.handle(
    IPC.git.commit,
    async (
      _e,
      projectId: ProjectId,
      repoRel: string,
      message: string
    ): Promise<{ ok: boolean; output: string }> => {
      const cwd = repoCwd(projectId, repoRel)
      if (!cwd) return { ok: false, output: 'Repository not found.' }
      if (!message.trim()) return { ok: false, output: 'Commit message is empty.' }
      return commitStaged(cwd, message)
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

/** Absolute cwd for a repo inside a project, or null when either is unknown. */
function repoCwd(projectId: ProjectId, repoRel: string): string | null {
  const project = getProject(projectId)
  if (!project) return null
  return repoRel ? join(project.path, repoRel) : project.path
}

/**
 * Apply a replacement across the given files.
 *
 * Each file is read, rewritten and written back individually so one failure
 * cannot abort the rest, and files whose content is unchanged are skipped
 * rather than rewritten — an untouched mtime keeps watchers and git quiet.
 */
async function replaceAcrossFiles(
  projectRoot: string,
  repoRel: string,
  relPaths: string[],
  search: string,
  replacement: string,
  options: ReplaceOptions
): Promise<{ filesChanged: number; replacements: number }> {
  let filesChanged = 0
  let replacements = 0

  for (const relPath of relPaths) {
    const abs = resolve(projectRoot, repoRel, relPath)
    // Never write outside the project, whatever the search returned.
    if (abs !== resolve(projectRoot) && !abs.startsWith(resolve(projectRoot) + sep)) continue

    try {
      const before = await fsp.readFile(abs, 'utf-8')
      const result = replaceInText(before, search, replacement, options)
      if (result.error || result.count === 0 || result.text === before) continue

      await fsp.writeFile(abs, result.text, 'utf-8')
      filesChanged += 1
      replacements += result.count
    } catch {
      // Unreadable, binary or vanished since the search — skip it.
      continue
    }
  }

  return { filesChanged, replacements }
}
