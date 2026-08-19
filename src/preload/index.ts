import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IPC,
  type AppState,
  type BridgePairing,
  type BridgeStatus,
  type CreatePullRequestInput,
  type CreateTerminalOptions,
  type DeviceFlowPoll,
  type DeviceFlowStart,
  type FocusTerminalPayload,
  type FsEntry,
  type GitFileStatusMap,
  type GitInfo,
  type GitHubSettings,
  type NotifyPayload,
  type Project,
  type ProjectId,
  type PullRequestDetail,
  type PullRequestSummary,
  type GitStatusEntry,
  type MediaPayload,
  type RepoRef,
  type ExternalChangePayload,
  type SearchHit,
  type TerminalDataPayload,
  type TerminalExitPayload,
  type SessionActivityPayload,
  type SetFocusedPayload,
  type TerminalId,
  type TerminalRecord,
  type UpdateStatus,
  type WalkResult,
  type WorkflowRunDetail,
  type WorkflowRunSummary,
  type WorkflowSummary,
} from '@shared/types'
import type { NameSource } from '@shared/rename'

const api = {
  projects: {
    snapshot: (): Promise<AppState> => ipcRenderer.invoke(IPC.projects.snapshot),
    add: (folderPath: string): Promise<Project> =>
      ipcRenderer.invoke(IPC.projects.add, folderPath),
    remove: (id: ProjectId): Promise<void> =>
      ipcRenderer.invoke(IPC.projects.remove, id),
    rename: (id: ProjectId, name: string): Promise<void> =>
      ipcRenderer.invoke(IPC.projects.rename, id, name),
    reorder: (orderedIds: ProjectId[]): Promise<void> =>
      ipcRenderer.invoke(IPC.projects.reorder, orderedIds),
    select: (id: ProjectId | null): Promise<void> =>
      ipcRenderer.invoke(IPC.projects.select, id),
    openInITerm: (id: ProjectId): Promise<void> =>
      ipcRenderer.invoke(IPC.projects.openInITerm, id),
    openInFinder: (id: ProjectId): Promise<void> =>
      ipcRenderer.invoke(IPC.projects.openInFinder, id),
  },
  terminals: {
    create: (opts: CreateTerminalOptions): Promise<TerminalRecord | null> =>
      ipcRenderer.invoke(IPC.terminals.create, opts),
    attach: (id: string): Promise<string> =>
      ipcRenderer.invoke(IPC.terminals.attach, id),
    write: (id: string, data: string): Promise<void> =>
      ipcRenderer.invoke(IPC.terminals.write, id, data),
    resize: (id: string, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke(IPC.terminals.resize, id, cols, rows),
    kill: (id: string): Promise<void> =>
      ipcRenderer.invoke(IPC.terminals.kill, id),
    rename: (
      projectId: string,
      id: string,
      name: string,
      source: NameSource = 'user'
    ): Promise<void> => ipcRenderer.invoke(IPC.terminals.rename, projectId, id, name, source),
    removeRecord: (projectId: string, id: string): void => {
      ipcRenderer.send('terminals:remove-record', projectId, id)
    },
    setActive: (projectId: ProjectId, id: TerminalId | null): void => {
      ipcRenderer.send(IPC.terminals.setActive, projectId, id)
    },
    setRunningCommand: (
      id: TerminalId,
      agent: { command: string; cwd: string } | null
    ): void => {
      ipcRenderer.send(IPC.terminals.runningCommand, id, agent)
    },
    onData: (cb: (payload: TerminalDataPayload) => void): (() => void) => {
      const listener = (_: unknown, payload: TerminalDataPayload) => cb(payload)
      ipcRenderer.on(IPC.terminals.data, listener)
      return () => ipcRenderer.off(IPC.terminals.data, listener)
    },
    onExit: (cb: (payload: TerminalExitPayload) => void): (() => void) => {
      const listener = (_: unknown, payload: TerminalExitPayload) => cb(payload)
      ipcRenderer.on(IPC.terminals.exit, listener)
      return () => ipcRenderer.off(IPC.terminals.exit, listener)
    },
    onActivity: (cb: (payload: SessionActivityPayload) => void): (() => void) => {
      const listener = (_: unknown, payload: SessionActivityPayload) => cb(payload)
      ipcRenderer.on(IPC.terminals.activity, listener)
      return () => ipcRenderer.off(IPC.terminals.activity, listener)
    },
    setFocused: (payload: SetFocusedPayload): void => {
      ipcRenderer.send(IPC.terminals.setFocused, payload)
    },
  },
  dialog: {
    pickFolder: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC.dialog.pickFolder),
  },
  state: {
    // Full-state push from main, fired after the mobile bridge mutates state on
    // the phone's behalf. The renderer reconciles its Zustand mirror from this.
    onChanged: (cb: (state: AppState) => void): (() => void) => {
      const listener = (_: unknown, state: AppState) => cb(state)
      ipcRenderer.on(IPC.state.changed, listener)
      return () => ipcRenderer.off(IPC.state.changed, listener)
    },
  },
  bridge: {
    getStatus: (): Promise<BridgeStatus> => ipcRenderer.invoke(IPC.bridge.getStatus),
    getPairing: (): Promise<BridgePairing> => ipcRenderer.invoke(IPC.bridge.getPairing),
    regeneratePairing: (): Promise<BridgePairing> =>
      ipcRenderer.invoke(IPC.bridge.regeneratePairing),
    setKeepAwake: (enabled: boolean): Promise<void> =>
      ipcRenderer.invoke(IPC.bridge.setKeepAwake, enabled),
    onStatus: (cb: (status: BridgeStatus) => void): (() => void) => {
      const listener = (_: unknown, status: BridgeStatus) => cb(status)
      ipcRenderer.on(IPC.bridge.status, listener)
      return () => ipcRenderer.off(IPC.bridge.status, listener)
    },
  },
  system: {
    getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.system.version),
    notify: (payload: NotifyPayload): Promise<void> =>
      ipcRenderer.invoke(IPC.system.notify, payload),
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke(IPC.system.openExternal, url),
    setZoom: (factor: number): Promise<number> =>
      ipcRenderer.invoke(IPC.system.setZoom, factor),
    onFocusTerminal: (cb: (payload: FocusTerminalPayload) => void): (() => void) => {
      const listener = (_: unknown, payload: FocusTerminalPayload) => cb(payload)
      ipcRenderer.on(IPC.system.focusTerminal, listener)
      return () => ipcRenderer.off(IPC.system.focusTerminal, listener)
    },
  },
  updater: {
    getStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.update.getStatus),
    check: (): Promise<void> => ipcRenderer.invoke(IPC.update.check),
    install: (): Promise<void> => ipcRenderer.invoke(IPC.update.install),
    onStatus: (cb: (status: UpdateStatus) => void): (() => void) => {
      const listener = (_: unknown, status: UpdateStatus) => cb(status)
      ipcRenderer.on(IPC.update.status, listener)
      return () => ipcRenderer.off(IPC.update.status, listener)
    },
  },
  fs: {
    list: (projectId: ProjectId, relPath: string): Promise<FsEntry[]> =>
      ipcRenderer.invoke(IPC.fs.list, projectId, relPath),
    readText: (projectId: ProjectId, relPath: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.fs.readText, projectId, relPath),
    readMedia: (projectId: ProjectId, relPath: string): Promise<MediaPayload | null> =>
      ipcRenderer.invoke(IPC.fs.readMedia, projectId, relPath),
    writeText: (projectId: ProjectId, relPath: string, content: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.fs.writeText, projectId, relPath, content),
    createFile: (projectId: ProjectId, relPath: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.fs.createFile, projectId, relPath),
    createFolder: (projectId: ProjectId, relPath: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.fs.createFolder, projectId, relPath),
    rename: (projectId: ProjectId, from: string, to: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.fs.rename, projectId, from, to),
    remove: (projectId: ProjectId, relPath: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.fs.remove, projectId, relPath),
    duplicate: (projectId: ProjectId, relPath: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.fs.duplicate, projectId, relPath),
    copy: (projectId: ProjectId, fromRel: string, toRel: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.fs.copy, projectId, fromRel, toRel),
    walk: (projectId: ProjectId): Promise<WalkResult> =>
      ipcRenderer.invoke(IPC.fs.walk, projectId),
    open: (projectId: ProjectId, relPath: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.fs.open, projectId, relPath),
    reveal: (projectId: ProjectId, relPath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.fs.reveal, projectId, relPath),
    watchOpen: (projectId: ProjectId, relPaths: string[]): Promise<void> =>
      ipcRenderer.invoke(IPC.fs.watchOpen, projectId, relPaths),
    onExternalChange: (cb: (payload: ExternalChangePayload) => void): (() => void) => {
      const handler = (_e: unknown, payload: ExternalChangePayload): void => cb(payload)
      ipcRenderer.on(IPC.fs.externalChange, handler)
      return () => ipcRenderer.removeListener(IPC.fs.externalChange, handler)
    },
    saveTempPaste: (data: Uint8Array, ext: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.fs.saveTempPaste, data, ext),
    pathForFile: (file: File): string => webUtils.getPathForFile(file),
  },
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
    statusEntries: (projectId: ProjectId, repoRel: string): Promise<GitStatusEntry[]> =>
      ipcRenderer.invoke(IPC.git.statusEntries, projectId, repoRel),
    stage: (projectId: ProjectId, repoRel: string, paths: string[]): Promise<boolean> =>
      ipcRenderer.invoke(IPC.git.stage, projectId, repoRel, paths),
    unstage: (projectId: ProjectId, repoRel: string, paths: string[]): Promise<boolean> =>
      ipcRenderer.invoke(IPC.git.unstage, projectId, repoRel, paths),
    discard: (
      projectId: ProjectId,
      repoRel: string,
      tracked: string[],
      untracked: string[]
    ): Promise<boolean> =>
      ipcRenderer.invoke(IPC.git.discard, projectId, repoRel, tracked, untracked),
    commit: (
      projectId: ProjectId,
      repoRel: string,
      message: string
    ): Promise<{ ok: boolean; output: string }> =>
      ipcRenderer.invoke(IPC.git.commit, projectId, repoRel, message),
    search: (
      projectId: ProjectId,
      repoRel: string,
      query: string,
      options: { caseSensitive?: boolean; regex?: boolean; wholeWord?: boolean }
    ): Promise<{ hits: SearchHit[]; truncated: boolean }> =>
      ipcRenderer.invoke(IPC.git.search, projectId, repoRel, query, options),
    replace: (
      projectId: ProjectId,
      repoRel: string,
      relPaths: string[],
      search: string,
      replacement: string,
      options: { regex: boolean; caseSensitive: boolean; wholeWord: boolean }
    ): Promise<{ filesChanged: number; replacements: number }> =>
      ipcRenderer.invoke(IPC.git.replace, projectId, repoRel, relPaths, search, replacement, options),
    fileAtRev: (
      projectId: ProjectId,
      repoRel: string,
      relPath: string,
      rev: 'HEAD' | 'index'
    ): Promise<string | null> =>
      ipcRenderer.invoke(IPC.git.fileAtRev, projectId, repoRel, relPath, rev),
  },
  github: {
    getSettings: (): Promise<GitHubSettings> => ipcRenderer.invoke(IPC.github.getSettings),
    setClientId: (clientId: string | null): Promise<GitHubSettings> =>
      ipcRenderer.invoke(IPC.github.setClientId, clientId),
    setToken: (token: string): Promise<GitHubSettings> =>
      ipcRenderer.invoke(IPC.github.setToken, token),
    signOut: (): Promise<GitHubSettings> => ipcRenderer.invoke(IPC.github.signOut),
    deviceStart: (): Promise<DeviceFlowStart> => ipcRenderer.invoke(IPC.github.deviceStart),
    devicePoll: (deviceCode: string): Promise<DeviceFlowPoll> =>
      ipcRenderer.invoke(IPC.github.devicePoll, deviceCode),
    listPullRequests: (
      projectId: ProjectId,
      state: 'open' | 'closed' | 'all' = 'open',
      repoRel = ''
    ): Promise<PullRequestSummary[]> =>
      ipcRenderer.invoke(IPC.github.listPullRequests, projectId, state, repoRel),
    getPullRequest: (
      projectId: ProjectId,
      number: number,
      repoRel = ''
    ): Promise<PullRequestDetail | null> =>
      ipcRenderer.invoke(IPC.github.getPullRequest, projectId, number, repoRel),
    createPullRequest: (input: CreatePullRequestInput): Promise<PullRequestSummary> =>
      ipcRenderer.invoke(IPC.github.createPullRequest, input),
    mergePullRequest: (
      projectId: ProjectId,
      number: number,
      method: 'merge' | 'squash' | 'rebase' = 'squash',
      repoRel = ''
    ): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.github.mergePullRequest, projectId, number, method, repoRel),
    commentPullRequest: (
      projectId: ProjectId,
      number: number,
      body: string,
      repoRel = ''
    ): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.github.commentPullRequest, projectId, number, body, repoRel),
    listWorkflows: (projectId: ProjectId, repoRel = ''): Promise<WorkflowSummary[]> =>
      ipcRenderer.invoke(IPC.github.listWorkflows, projectId, repoRel),
    listRuns: (
      projectId: ProjectId,
      opts?: { branch?: string },
      repoRel = ''
    ): Promise<WorkflowRunSummary[]> =>
      ipcRenderer.invoke(IPC.github.listRuns, projectId, opts, repoRel),
    getRun: (
      projectId: ProjectId,
      runId: number,
      repoRel = ''
    ): Promise<WorkflowRunDetail | null> =>
      ipcRenderer.invoke(IPC.github.getRun, projectId, runId, repoRel),
    rerunRun: (projectId: ProjectId, runId: number, repoRel = ''): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.github.rerunRun, projectId, runId, repoRel),
    rerunFailed: (projectId: ProjectId, runId: number, repoRel = ''): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.github.rerunFailed, projectId, runId, repoRel),
    cancelRun: (projectId: ProjectId, runId: number, repoRel = ''): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.github.cancelRun, projectId, runId, repoRel),
    dispatchWorkflow: (
      projectId: ProjectId,
      workflowId: number,
      ref: string,
      inputs?: Record<string, string>,
      repoRel = ''
    ): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.github.dispatchWorkflow, projectId, workflowId, ref, inputs, repoRel),
  },
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
