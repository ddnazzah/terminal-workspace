import { ipcMain } from 'electron'
import { IPC, type AgentHooksStatus } from '@shared/types'
import { AgentHookServer } from '../agent/hook-server'
import { hookStatus, installAgentHooks, removeAgentHooks } from '../agent/hook-install'
import type { PtyManager } from '../pty/manager'

// Agent signals: the loopback listener plus the settings toggle behind it.
//
// The listener always runs — it costs one loopback socket and it has to be up
// before any agent fires a hook. What the user opts into is the *installation*:
// wTerm writing relay entries into ~/.claude/settings.json. Without that, the
// listener simply never hears anything and wTerm falls back to reading window
// titles, which is a guess rather than the agent's own word.

let server: AgentHookServer | null = null

export async function startAgentHooks(pty: PtyManager): Promise<void> {
  const hookServer = new AgentHookServer()
  hookServer.onMessage((message) => pty.applyAgentEvent(message.terminalId, message.event))
  await hookServer.start()
  server = hookServer

  // The relay path changes when wTerm is reinstalled elsewhere, so refresh an
  // existing installation to point at the current script.
  const status = await hookStatus(hookServer.relayPath())
  if (status.installed) await installAgentHooks(hookServer.relayPath())
}

export async function stopAgentHooks(): Promise<void> {
  await server?.stop()
  server = null
}

async function currentStatus(): Promise<AgentHooksStatus> {
  if (!server) {
    return { installed: false, listening: false, settingsPath: '', error: null }
  }
  const status = await hookStatus(server.relayPath())
  return { ...status, listening: true }
}

export function registerAgentIpc(): void {
  ipcMain.handle(IPC.agent.status, (): Promise<AgentHooksStatus> => currentStatus())

  ipcMain.handle(IPC.agent.install, async (): Promise<AgentHooksStatus> => {
    if (!server) throw new Error('agent hook listener is not running')
    await installAgentHooks(server.relayPath())
    return currentStatus()
  })

  ipcMain.handle(IPC.agent.uninstall, async (): Promise<AgentHooksStatus> => {
    await removeAgentHooks()
    return currentStatus()
  })
}
