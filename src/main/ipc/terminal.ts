import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { resolve, sep } from 'node:path'
import {
  IPC,
  type CreateTerminalOptions,
  type ProjectId,
  type TerminalId,
  type TerminalRecord,
} from '@shared/types'
import { applyRename, type NameSource } from '@shared/rename'
import { getProject, getState, mutate, removeTerminal, upsertTerminal } from '../store/state'
import { getDefaultShell } from '../pty/shell-integration'
import {
  buildResumeCommand,
  extractPinnedSessionId,
  isClaudeLaunch,
  isContinueLaunch,
  withSessionId,
} from '@shared/claude-session'
import { sniffSessionId } from '../pty/claude-session-watch'
import type { PtyManager } from '../pty/manager'

/** Resolve a project-relative cwd, refusing anything that escapes the project root. */
function resolveCwd(root: string, rel: string | undefined): string {
  const normRoot = resolve(root)
  if (!rel) return normRoot
  const abs = resolve(normRoot, rel)
  if (abs !== normRoot && !abs.startsWith(normRoot + sep)) return normRoot
  return abs
}

/**
 * Create a terminal + its PTY. The authoritative `TerminalRecord` (and its id)
 * is born here in main, so both the desktop IPC handler and the mobile bridge
 * call this and receive the same canonical record. Returns null if the target
 * project doesn't exist.
 */
export function createTerminal(
  pty: PtyManager,
  opts: CreateTerminalOptions
): TerminalRecord | null {
  const project = getProject(opts.projectId)
  if (!project) return null

  const shell = opts.shell ?? getDefaultShell()
  const cwd = resolveCwd(project.path, opts.cwd)

  // Restore path: any reused id rebuilds a persisted tab — resumed Claude
  // session, relaunched agent, or plain shell alike — so the recreated PTY
  // always lines up with the existing record, its pane, and active-tab state.
  // The caller (restore planner) supplies the ready-to-run startup command;
  // resumeSessionId additionally marks the session as wTerm-owned.
  if (opts.id) {
    const existing = project.terminals.find((t) => t.id === opts.id)
    const claudeSessionId = opts.resumeSessionId ?? existing?.claudeSessionId
    const record: TerminalRecord = {
      id: opts.id,
      name: existing?.name ?? opts.name ?? `Terminal ${project.terminals.length + 1}`,
      shell: existing?.shell ?? shell,
      ...(claudeSessionId ? { claudeSessionId } : {}),
      ...(existing?.agent ? { agent: existing.agent } : {}),
      ...(existing?.nameSource ? { nameSource: existing.nameSource } : {}),
    }
    upsertTerminal(project.id, record)
    pty.create({
      id: opts.id,
      cwd,
      shell: record.shell,
      startupCommand:
        opts.startupCommand ??
        (opts.resumeSessionId ? buildResumeCommand(undefined, opts.resumeSessionId) : undefined),
    })
    return record
  }

  // New tab. When it launches Claude, generate and pin a session id so the
  // transcript is ours to resume after a restart (see pty/claude-session.ts).
  // We only claim ownership when we actually injected the id — if the user's
  // command already pins a session, withSessionId leaves it untouched and we
  // must not record an id we don't control.
  const id = randomUUID()
  let claudeSessionId: string | undefined
  let startupCommand = opts.startupCommand
  if (isClaudeLaunch(opts.startupCommand) && opts.startupCommand) {
    const candidate = randomUUID()
    const injected = withSessionId(opts.startupCommand, candidate)
    if (injected !== opts.startupCommand) {
      claudeSessionId = candidate
      startupCommand = injected
    }
  }
  const record: TerminalRecord = {
    id,
    name: opts.name ?? `Terminal ${project.terminals.length + 1}`,
    shell,
    ...(claudeSessionId ? { claudeSessionId } : {}),
  }
  upsertTerminal(project.id, record)
  pty.create({ id, cwd, shell, startupCommand })
  return record
}

export function renameTerminal(
  projectId: ProjectId,
  id: TerminalId,
  name: string,
  source: NameSource = 'user'
): void {
  const project = getProject(projectId)
  const t = project?.terminals.find((x) => x.id === id)
  if (!project || !t) return
  const next = applyRename(t, name, source)
  if (next !== t) upsertTerminal(project.id, next)
}

export function removeTerminalRecord(pty: PtyManager, projectId: ProjectId, id: TerminalId): void {
  // Removing the record is permanent (the terminal won't be restored), so kill
  // its pty as well rather than leaving the shell running orphaned.
  pty.kill(id)
  removeTerminal(projectId, id)
}

export function setActiveTerminal(projectId: ProjectId, id: TerminalId | null): void {
  mutate((s) => {
    s.activeTerminalByProject = { ...(s.activeTerminalByProject ?? {}), [projectId]: id }
  })
}

export function registerTerminalIpc(pty: PtyManager): void {
  ipcMain.handle(
    IPC.terminals.create,
    (_e, opts: CreateTerminalOptions): TerminalRecord | null => createTerminal(pty, opts)
  )

  ipcMain.handle(IPC.terminals.attach, (_e, id: string): string => {
    return pty.attach(id)
  })

  ipcMain.handle(IPC.terminals.write, (_e, id: string, data: string): void => {
    pty.write(id, data)
  })

  ipcMain.handle(IPC.terminals.resize, (_e, id: string, cols: number, rows: number): void => {
    pty.resize(id, cols, rows)
  })

  ipcMain.handle(IPC.terminals.kill, (_e, id: string): void => {
    pty.kill(id)
  })

  ipcMain.handle(
    IPC.terminals.rename,
    (_e, projectId: string, id: string, name: unknown, source?: unknown): void => {
      // IPC args arrive untyped; a non-string name would throw inside trim().
      if (typeof name !== 'string') return
      renameTerminal(projectId, id, name, source === 'auto' ? 'auto' : 'user')
    }
  )

  ipcMain.on('terminals:remove-record', (_e, projectId: string, id: string) => {
    removeTerminalRecord(pty, projectId, id)
  })

  ipcMain.on(IPC.terminals.setActive, (_e, projectId: ProjectId, id: TerminalId | null) => {
    setActiveTerminal(projectId, id)
  })

  // Track the agent command running in each tab (from OSC 697 shell integration)
  // so it can be re-launched on the next start. Fires on every command, so only
  // persist when the value actually changes to avoid save churn.
  ipcMain.on(
    IPC.terminals.runningCommand,
    (_e, id: TerminalId, agent: { command: string; cwd: string } | null) => {
      for (const project of getState().projects) {
        const t = project.terminals.find((x) => x.id === id)
        if (!t) continue
        handleRunningCommand(project.id, t, agent)
        return
      }
    }
  )
}

// One sniffer per terminal: a fresh capture (or the agent ending) invalidates
// the previous watch via its token. Claimed session files are global so two
// same-cwd tabs never resolve to the same conversation.
const sessionWatchTokens = new Map<TerminalId, object>()
const claimedSessionFiles = new Set<string>()

/** Apply an OSC 697 capture (or clear) to the record and manage id sniffing. */
function handleRunningCommand(
  projectId: ProjectId,
  t: TerminalRecord,
  agent: { command: string; cwd: string } | null
): void {
  if (!agent) {
    sessionWatchTokens.delete(t.id)
    if (t.agent) upsertTerminal(projectId, { ...t, agent: undefined })
    return
  }

  // An explicit `--resume <id>` / `--session-id <id>` names the session
  // directly; anything else gets sniffed from the cwd's session folder.
  const pinned = isClaudeLaunch(agent.command) ? extractPinnedSessionId(agent.command) : null
  const next = { command: agent.command, cwd: agent.cwd, ...(pinned ? { sessionId: pinned } : {}) }
  if (JSON.stringify(t.agent) !== JSON.stringify(next)) {
    upsertTerminal(projectId, { ...t, agent: next })
  }
  if (isClaudeLaunch(agent.command) && !pinned) {
    startSessionSniffer(projectId, t.id, agent)
  }
}

function startSessionSniffer(
  projectId: ProjectId,
  id: TerminalId,
  agent: { command: string; cwd: string }
): void {
  const token = {}
  sessionWatchTokens.set(id, token)
  const currentAgent = (): TerminalRecord['agent'] =>
    getProject(projectId)?.terminals.find((x) => x.id === id)?.agent
  const isActive = (): boolean => {
    if (sessionWatchTokens.get(id) !== token) return false
    const a = currentAgent()
    return !!a && a.command === agent.command && a.cwd === agent.cwd
  }
  sniffSessionId(agent.cwd, {
    sinceMs: Date.now(),
    mode: isContinueLaunch(agent.command) ? 'modified' : 'created',
    isActive,
    claimed: claimedSessionFiles,
  })
    .then((sessionId) => {
      if (!sessionId || !isActive()) return
      const t = getProject(projectId)?.terminals.find((x) => x.id === id)
      if (!t?.agent) return
      upsertTerminal(projectId, { ...t, agent: { ...t.agent, sessionId } })
    })
    .catch((err: unknown) => {
      console.error('[claude-session-watch] sniffer failed for', id, err)
    })
}
