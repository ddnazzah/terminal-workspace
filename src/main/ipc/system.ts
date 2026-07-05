import { app, BrowserWindow, ipcMain, Notification, shell } from 'electron'
import { spawn } from 'node:child_process'
import {
  IPC,
  type FocusTerminalPayload,
  type NotifyPayload,
  type ProjectId,
  type SetFocusedPayload,
  type TerminalId,
} from '@shared/types'
import { getProject, getProjectIdForTerminal } from '../store/state'
import { pushToSubscribers } from '../bridge/push'
import { decideNotification } from '../pty/activity/notification-policy'
import type { SessionActivity } from '../pty/activity/types'

let mainWindowRef: BrowserWindow | null = null
// Focus context for suppressing notifications the user is already looking at.
let focusedSessionId: TerminalId | null = null
let windowFocused = true

export function setMainWindow(win: BrowserWindow): void {
  mainWindowRef = win
  windowFocused = win.isFocused()
  win.on('focus', () => (windowFocused = true))
  win.on('blur', () => (windowFocused = false))
}

/** Deliver a notification to the OS and paired phones. */
function deliverNotification(payload: NotifyPayload): void {
  // Mirror to paired phones over Web Push. This path only runs when the user
  // isn't actively viewing the session, so a push means they genuinely need it.
  void pushToSubscribers(payload)

  if (process.platform === 'darwin' && !app.isPackaged) {
    notifyViaOsascript(payload.title, payload.body)
    return
  }
  if (!Notification.isSupported()) {
    console.warn('[notify] Notification.isSupported() returned false')
    return
  }
  const n = new Notification({ title: payload.title, body: payload.body, silent: false })
  n.on('click', () => {
    const win = mainWindowRef
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    const focusPayload: FocusTerminalPayload = {
      projectId: payload.projectId,
      terminalId: payload.terminalId,
    }
    win.webContents.send(IPC.system.focusTerminal, focusPayload)
  })
  n.show()
}

/**
 * Decide-and-fire for a session activity transition. Wired as the PtyManager
 * notify hook. Suppresses when the app is focused and this session is on screen.
 */
export function notifyForActivity(
  id: TerminalId,
  prev: SessionActivity,
  next: SessionActivity
): void {
  const decision = decideNotification({
    prev,
    next,
    now: Date.now(),
    focus: { windowFocused, sessionVisible: focusedSessionId === id },
  })
  if (!decision) return
  deliverNotification({
    title: decision.title,
    body: decision.body,
    projectId: getProjectIdForTerminal(id) ?? '',
    terminalId: id,
  })
}

function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function notifyViaOsascript(title: string, body: string): void {
  const script = `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}" sound name "Glass"`
  spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref()
}

/**
 * Open a standalone OS terminal window rooted at `dir`. Each platform gets its
 * native default: iTerm on macOS, Windows Terminal (falling back to a PowerShell
 * window) on Windows, and a best-effort sweep of the common emulators on Linux.
 */
function openExternalTerminal(dir: string): void {
  if (process.platform === 'darwin') {
    spawn('open', ['-a', 'iTerm', dir], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  if (process.platform === 'win32') {
    // Prefer Windows Terminal; if it isn't installed, `wt.exe` fails to spawn and
    // we fall back to launching a standalone PowerShell window via cmd's `start`.
    const wt = spawn('wt.exe', ['-d', dir], { detached: true, stdio: 'ignore' })
    wt.on('error', () => {
      const psDir = dir.replace(/'/g, "''") // escape single quotes for PowerShell
      spawn(
        'cmd.exe',
        ['/c', 'start', '', 'powershell.exe', '-NoExit', '-Command', `Set-Location -LiteralPath '${psDir}'`],
        { detached: true, stdio: 'ignore' }
      ).unref()
    })
    wt.unref()
    return
  }
  // Linux: try the common terminal emulators in order until one launches.
  const candidates = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm']
  const tryNext = (i: number): void => {
    if (i >= candidates.length) return
    const child = spawn(candidates[i]!, { cwd: dir, detached: true, stdio: 'ignore' })
    child.on('error', () => tryNext(i + 1))
    child.unref()
  }
  tryNext(0)
}

export function registerSystemIpc(): void {
  ipcMain.handle(IPC.projects.openInITerm, (_e, id: ProjectId): void => {
    const project = getProject(id)
    if (!project) return
    openExternalTerminal(project.path)
  })

  ipcMain.handle(IPC.projects.openInFinder, (_e, id: ProjectId): void => {
    const project = getProject(id)
    if (!project) return
    shell.openPath(project.path)
  })

  ipcMain.handle(IPC.system.version, (): string => app.getVersion())

  // Whole-window zoom. The renderer owns the persisted factor (localStorage) and
  // sends the desired value; we clamp it and apply it to the calling window's
  // webContents, returning the value actually applied.
  ipcMain.handle(IPC.system.setZoom, (e, factor: number): number => {
    const clamped = Math.min(2.5, Math.max(0.5, Number.isFinite(factor) ? factor : 1))
    e.sender.setZoomFactor(clamped)
    return clamped
  })

  ipcMain.handle(IPC.system.openExternal, (_e, url: string): void => {
    if (typeof url !== 'string') return
    if (!/^https?:\/\//i.test(url)) return
    shell.openExternal(url).catch(() => {})
  })

  // The renderer can still request a notification directly (e.g. the Settings
  // "send test notification" button). Activity-driven notifications go through
  // notifyForActivity instead.
  ipcMain.handle(IPC.system.notify, (_e, payload: NotifyPayload): void => {
    deliverNotification(payload)
  })

  // The renderer reports which session is on screen so we can suppress
  // notifications the user is already looking at.
  ipcMain.on(IPC.terminals.setFocused, (_e, p: SetFocusedPayload): void => {
    focusedSessionId = p.id
    windowFocused = p.windowFocused
  })
}
