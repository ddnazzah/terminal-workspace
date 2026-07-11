import { ipcMain, shell } from 'electron'
import {
  IPC,
  type CreatePullRequestInput,
  type DeviceFlowPoll,
  type DeviceFlowStart,
  type GitHubSettings,
  type ProjectId,
  type PullRequestDetail,
  type PullRequestSummary,
  type WorkflowJob,
  type WorkflowRunDetail,
  type WorkflowRunSummary,
  type WorkflowSummary,
} from '@shared/types'
import { getProject } from '../store/state'
import { getGitInfo } from '../git/local'
import { resolveRepoPath } from './git'
import {
  deviceCodeRequest,
  devicePollOnce,
  fetchAuthenticatedUser,
  getAuth,
  getClientId,
  setAuth,
  setClientId,
} from '../github/auth'
import { gh, GitHubApiError } from '../github/client'

// ---- Device flow state (per session) ----
interface PendingDevice {
  clientId: string
  deviceCode: string
}
const pendingDevice = new Map<string, PendingDevice>()

async function settings(): Promise<GitHubSettings> {
  const [clientId, auth] = await Promise.all([getClientId(), getAuth()])
  return {
    clientId,
    hasToken: !!auth,
    login: auth?.login ?? null,
    source: auth?.source ?? null,
    avatarUrl: auth?.avatarUrl ?? null,
  }
}

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

// ---- Mappers (octokit-shaped JSON → renderer-friendly types) ----

type GhUser = { login?: string; avatar_url?: string | null }
type GhPr = {
  number: number
  title: string
  state: 'open' | 'closed'
  draft?: boolean
  merged?: boolean
  merged_at?: string | null
  html_url: string
  user?: GhUser | null
  head: { ref: string }
  base: { ref: string }
  created_at: string
  updated_at: string
  body?: string | null
  mergeable?: boolean | null
  mergeable_state?: string | null
  additions?: number
  deletions?: number
  changed_files?: number
}

function mapPrSummary(p: GhPr): PullRequestSummary {
  return {
    number: p.number,
    title: p.title,
    state: p.state,
    draft: !!p.draft,
    merged: !!p.merged || !!p.merged_at,
    url: p.html_url,
    author: p.user?.login ?? 'unknown',
    authorAvatar: p.user?.avatar_url ?? null,
    headRef: p.head.ref,
    baseRef: p.base.ref,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  }
}

type GhRun = {
  id: number
  name: string | null
  workflow_id: number
  head_branch: string | null
  event: string
  status: string
  conclusion: string | null
  html_url: string
  run_number: number
  actor?: GhUser | null
  triggering_actor?: GhUser | null
  created_at: string
  updated_at: string
}

function mapRun(r: GhRun): WorkflowRunSummary {
  return {
    id: r.id,
    name: r.name,
    workflowId: r.workflow_id,
    branch: r.head_branch,
    event: r.event,
    status: r.status,
    conclusion: r.conclusion,
    url: r.html_url,
    runNumber: r.run_number,
    actor: r.actor?.login ?? r.triggering_actor?.login ?? 'unknown',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

type GhJob = {
  id: number
  name: string
  status: string
  conclusion: string | null
  started_at: string | null
  completed_at: string | null
  html_url: string
  steps?: Array<{ name: string; status: string; conclusion: string | null; number: number }>
}

function mapJob(j: GhJob): WorkflowJob {
  return {
    id: j.id,
    name: j.name,
    status: j.status,
    conclusion: j.conclusion,
    startedAt: j.started_at,
    completedAt: j.completed_at,
    url: j.html_url,
    steps: (j.steps ?? []).map((s) => ({
      name: s.name,
      status: s.status,
      conclusion: s.conclusion,
      number: s.number,
    })),
  }
}

export function registerGitHubIpc(): void {
  ipcMain.handle(IPC.github.getSettings, () => settings())

  ipcMain.handle(IPC.github.setClientId, async (_e, clientId: string | null) => {
    await setClientId(clientId)
    return settings()
  })

  ipcMain.handle(IPC.github.setToken, async (_e, token: string) => {
    const trimmed = token.trim()
    if (!trimmed) throw new Error('empty token')
    const user = await fetchAuthenticatedUser(trimmed)
    if (!user) throw new Error('token rejected by github')
    await setAuth({ token: trimmed, login: user.login, source: 'pat', avatarUrl: user.avatarUrl })
    return settings()
  })

  ipcMain.handle(IPC.github.signOut, async () => {
    await setAuth(null)
    pendingDevice.clear()
    return settings()
  })

  // ---- device flow ----

  ipcMain.handle(IPC.github.deviceStart, async (): Promise<DeviceFlowStart> => {
    const clientId = await getClientId()
    if (!clientId) throw new Error('no OAuth client id configured')
    const res = await deviceCodeRequest(clientId)
    pendingDevice.set(res.device_code, { clientId, deviceCode: res.device_code })
    const verificationUriComplete =
      res.verification_uri_complete ??
      `${res.verification_uri}?user_code=${encodeURIComponent(res.user_code)}`
    // Open the pre-filled URL so the user just has to click "Authorize".
    shell.openExternal(verificationUriComplete).catch(() => {})
    return {
      deviceCode: res.device_code,
      userCode: res.user_code,
      verificationUri: res.verification_uri,
      verificationUriComplete,
      expiresIn: res.expires_in,
      interval: res.interval,
    }
  })

  ipcMain.handle(
    IPC.github.devicePoll,
    async (_e, deviceCode: string): Promise<DeviceFlowPoll> => {
      const pending = pendingDevice.get(deviceCode)
      if (!pending) return { status: 'error', error: 'unknown_device_code' }
      const result = await devicePollOnce(pending.clientId, deviceCode)
      if (result.status === 'authorized') {
        const user = await fetchAuthenticatedUser(result.token)
        await setAuth({
          token: result.token,
          login: user?.login ?? null,
          source: 'device',
          avatarUrl: user?.avatarUrl ?? null,
        })
        pendingDevice.delete(deviceCode)
        return { status: 'authorized', login: user?.login ?? 'github' }
      }
      if (result.status === 'error') {
        pendingDevice.delete(deviceCode)
      }
      return result as DeviceFlowPoll
    }
  )

  // ---- Pull requests ----

  ipcMain.handle(
    IPC.github.listPullRequests,
    async (
      _e,
      projectId: ProjectId,
      state: 'open' | 'closed' | 'all' = 'open',
      repoRel = ''
    ) => {
      const repo = await repoFor(projectId, repoRel)
      if (!repo) return []
      const list = await gh.get<GhPr[]>(
        `/repos/${repo.owner}/${repo.repo}/pulls?state=${state}&per_page=30&sort=updated&direction=desc`
      )
      return list.map(mapPrSummary)
    }
  )

  ipcMain.handle(
    IPC.github.getPullRequest,
    async (
      _e,
      projectId: ProjectId,
      number: number,
      repoRel = ''
    ): Promise<PullRequestDetail | null> => {
      const repo = await repoFor(projectId, repoRel)
      if (!repo) return null
      const [pr, comments] = await Promise.all([
        gh.get<GhPr>(`/repos/${repo.owner}/${repo.repo}/pulls/${number}`),
        gh.get<
          Array<{
            id: number
            user?: GhUser | null
            body: string | null
            created_at: string
          }>
        >(`/repos/${repo.owner}/${repo.repo}/issues/${number}/comments?per_page=50`),
      ])
      let checks: PullRequestDetail['checks'] = []
      try {
        const cr = await gh.get<{
          check_runs: Array<{
            name: string
            status: string
            conclusion: string | null
            html_url: string | null
          }>
        }>(`/repos/${repo.owner}/${repo.repo}/commits/${pr.head.ref}/check-runs`)
        checks = cr.check_runs.map((c) => ({
          name: c.name,
          status: c.status,
          conclusion: c.conclusion,
          url: c.html_url,
        }))
      } catch {
        checks = []
      }
      return {
        ...mapPrSummary(pr),
        body: pr.body ?? '',
        mergeable: pr.mergeable ?? null,
        mergeableState: pr.mergeable_state ?? null,
        additions: pr.additions ?? 0,
        deletions: pr.deletions ?? 0,
        changedFiles: pr.changed_files ?? 0,
        comments: comments.map((c) => ({
          id: c.id,
          author: c.user?.login ?? 'unknown',
          avatar: c.user?.avatar_url ?? null,
          body: c.body ?? '',
          createdAt: c.created_at,
        })),
        checks,
      }
    }
  )

  ipcMain.handle(
    IPC.github.createPullRequest,
    async (_e, input: CreatePullRequestInput): Promise<PullRequestSummary> => {
      const repo = await repoFor(input.projectId, input.repoRel ?? '')
      if (!repo) throw new Error('not a github repo')
      const pr = await gh.post<GhPr>(`/repos/${repo.owner}/${repo.repo}/pulls`, {
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
        draft: input.draft,
      })
      return mapPrSummary(pr)
    }
  )

  ipcMain.handle(
    IPC.github.mergePullRequest,
    async (
      _e,
      projectId: ProjectId,
      number: number,
      method: 'merge' | 'squash' | 'rebase' = 'squash',
      repoRel = ''
    ) => {
      const repo = await repoFor(projectId, repoRel)
      if (!repo) throw new Error('not a github repo')
      await gh.put(`/repos/${repo.owner}/${repo.repo}/pulls/${number}/merge`, {
        merge_method: method,
      })
      return { ok: true }
    }
  )

  ipcMain.handle(
    IPC.github.commentPullRequest,
    async (_e, projectId: ProjectId, number: number, body: string, repoRel = '') => {
      const repo = await repoFor(projectId, repoRel)
      if (!repo) throw new Error('not a github repo')
      await gh.post(`/repos/${repo.owner}/${repo.repo}/issues/${number}/comments`, { body })
      return { ok: true }
    }
  )

  // ---- Workflows / runs ----

  ipcMain.handle(
    IPC.github.listWorkflows,
    async (_e, projectId: ProjectId, repoRel = ''): Promise<WorkflowSummary[]> => {
      const repo = await repoFor(projectId, repoRel)
      if (!repo) return []
      const res = await gh.get<{
        workflows: Array<{ id: number; name: string; path: string; state: string }>
      }>(`/repos/${repo.owner}/${repo.repo}/actions/workflows?per_page=50`)
      return res.workflows.map((w) => ({
        id: w.id,
        name: w.name,
        path: w.path,
        state: w.state,
      }))
    }
  )

  ipcMain.handle(
    IPC.github.listRuns,
    async (_e, projectId: ProjectId, opts?: { branch?: string }, repoRel = '') => {
      const repo = await repoFor(projectId, repoRel)
      if (!repo) return []
      const params = new URLSearchParams({ per_page: '20' })
      if (opts?.branch) params.set('branch', opts.branch)
      const res = await gh.get<{ workflow_runs: GhRun[] }>(
        `/repos/${repo.owner}/${repo.repo}/actions/runs?${params.toString()}`
      )
      return res.workflow_runs.map(mapRun)
    }
  )

  ipcMain.handle(
    IPC.github.getRun,
    async (
      _e,
      projectId: ProjectId,
      runId: number,
      repoRel = ''
    ): Promise<WorkflowRunDetail | null> => {
      const repo = await repoFor(projectId, repoRel)
      if (!repo) return null
      const [run, jobs] = await Promise.all([
        gh.get<GhRun>(`/repos/${repo.owner}/${repo.repo}/actions/runs/${runId}`),
        gh.get<{ jobs: GhJob[] }>(
          `/repos/${repo.owner}/${repo.repo}/actions/runs/${runId}/jobs?per_page=50`
        ),
      ])
      return { ...mapRun(run), jobs: jobs.jobs.map(mapJob) }
    }
  )

  ipcMain.handle(
    IPC.github.rerunRun,
    async (_e, projectId: ProjectId, runId: number, repoRel = '') => {
      const repo = await repoFor(projectId, repoRel)
      if (!repo) throw new Error('not a github repo')
      await gh.post(`/repos/${repo.owner}/${repo.repo}/actions/runs/${runId}/rerun`)
      return { ok: true }
    }
  )

  ipcMain.handle(
    IPC.github.rerunFailed,
    async (_e, projectId: ProjectId, runId: number, repoRel = '') => {
      const repo = await repoFor(projectId, repoRel)
      if (!repo) throw new Error('not a github repo')
      await gh.post(`/repos/${repo.owner}/${repo.repo}/actions/runs/${runId}/rerun-failed-jobs`)
      return { ok: true }
    }
  )

  ipcMain.handle(
    IPC.github.cancelRun,
    async (_e, projectId: ProjectId, runId: number, repoRel = '') => {
      const repo = await repoFor(projectId, repoRel)
      if (!repo) throw new Error('not a github repo')
      await gh.post(`/repos/${repo.owner}/${repo.repo}/actions/runs/${runId}/cancel`)
      return { ok: true }
    }
  )

  ipcMain.handle(
    IPC.github.dispatchWorkflow,
    async (
      _e,
      projectId: ProjectId,
      workflowId: number,
      ref: string,
      inputs?: Record<string, string>,
      repoRel = ''
    ) => {
      const repo = await repoFor(projectId, repoRel)
      if (!repo) throw new Error('not a github repo')
      await gh.post(
        `/repos/${repo.owner}/${repo.repo}/actions/workflows/${workflowId}/dispatches`,
        { ref, inputs: inputs ?? {} }
      )
      return { ok: true }
    }
  )

  // Surface non-GitHubApiError exceptions consistently — ipcMain.handle catches them already.
  void GitHubApiError
}
