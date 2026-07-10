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
