import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import './styles.css'
import { setupTouchScroll } from './touch-scroll'
import type {
  AppState,
  BridgeClientMessage,
  BridgeServerMessage,
  Project,
  TerminalId,
} from '@shared/types'

const TOKEN_KEY = 'wterm.token'

// ---- token / pairing ----

function readHashParam(name: string): string | null {
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash
  return new URLSearchParams(hash).get(name)
}

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

async function pairWithCode(code: string): Promise<string> {
  const res = await fetch('/api/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!res.ok) {
    if (res.status === 429) throw new Error('Too many attempts — wait a moment and try again.')
    throw new Error('That code didn’t match. Check the desktop and retry.')
  }
  const { token } = (await res.json()) as { token: string }
  return token
}

// ---- app ----

const root = document.getElementById('app')!

interface UiState {
  app: AppState | null
  selectedProjectId: string | null
  /** terminal the xterm view is currently bound to */
  currentTermId: TerminalId | null
  online: boolean
  /** terminal ids that have unseen output while not in the foreground */
  unread: Set<TerminalId>
  /** derived window titles (agent task labels) keyed by terminal id; these
   *  override the persisted "Terminal N" name on the tab, mirroring desktop */
  titleByTerminal: Record<TerminalId, string>
  /** set after the user taps ＋ so we auto-focus the newly created terminal */
  selectNewestInProject: string | null
}

const ui: UiState = {
  app: null,
  selectedProjectId: null,
  currentTermId: null,
  online: false,
  unread: new Set(),
  titleByTerminal: {},
  selectNewestInProject: null,
}

let ws: WebSocket | null = null
let term: Terminal | null = null
let fit: FitAddon | null = null
let ctrlSticky = false
let reconnectTimer: number | null = null

function send(msg: BridgeClientMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

function currentProject(): Project | null {
  return ui.app?.projects.find((p) => p.id === ui.selectedProjectId) ?? null
}

// ---- websocket ----

function connect(): void {
  const token = getToken()
  if (!token) return renderPairing()

  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`)

  ws.onopen = () => {
    ui.online = true
    renderStatus()
  }

  ws.onclose = (ev) => {
    ui.online = false
    renderStatus()
    // 1008 / clean 401 path closes mean the token was rejected — re-pair.
    if (ev.code === 1008 || ev.code === 1006) {
      // 1006 can also be a transient drop; only force re-pair if we never opened.
    }
    scheduleReconnect()
  }

  ws.onerror = () => {
    ui.online = false
    renderStatus()
  }

  ws.onmessage = (ev) => {
    let msg: BridgeServerMessage
    try {
      msg = JSON.parse(ev.data as string) as BridgeServerMessage
    } catch {
      return
    }
    handleServerMessage(msg)
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) return
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null
    if (getToken()) connect()
  }, 1500)
}

function handleServerMessage(msg: BridgeServerMessage): void {
  switch (msg.type) {
    case 'hello':
    case 'state': {
      const prevProjectIds = ui.app?.projects.flatMap((p) => p.terminals.map((t) => t.id)) ?? []
      ui.app = msg.state
      if (!ui.selectedProjectId || !msg.state.projects.some((p) => p.id === ui.selectedProjectId)) {
        ui.selectedProjectId = msg.state.selectedProjectId ?? msg.state.projects[0]?.id ?? null
      }
      // Auto-focus a terminal we just asked to create.
      if (ui.selectNewestInProject) {
        const proj = msg.state.projects.find((p) => p.id === ui.selectNewestInProject)
        const fresh = proj?.terminals.find((t) => !prevProjectIds.includes(t.id))
        if (fresh) {
          ui.selectedProjectId = proj!.id
          attachTerminal(fresh.id)
          ui.selectNewestInProject = null
        }
      }
      if (msg.type === 'hello') {
        // Build the DOM + xterm first, then bind a terminal so the snapshot
        // write and resize have a live terminal to target.
        renderApp()
        ensureValidSelection()
      } else {
        ensureValidSelection()
        renderChrome()
      }
      break
    }
    case 'attached':
      if (msg.id === ui.currentTermId && term && fit) {
        term.reset()
        // Fit to the phone's real width BEFORE replaying the snapshot, so the
        // buffered bytes are interpreted once at the final column count instead
        // of at xterm's 80-col default and then reflowed — the double pass is
        // what shreds wide desktop-authored output into 1–2 chars per line.
        try {
          fit.fit()
        } catch {
          // element not laid out yet; a later resize event will refit
        }
        term.write(msg.snapshot)
        // Push our dimensions so the shared PTY resizes and the running program
        // repaints its live UI at the phone's width.
        send({ type: 'resize', id: msg.id, cols: term.cols, rows: term.rows })
      }
      break
    case 'data':
      if (msg.id === ui.currentTermId && term) {
        term.write(msg.data)
      } else {
        ui.unread.add(msg.id)
        renderTabs()
      }
      break
    case 'title': {
      if (msg.title) ui.titleByTerminal[msg.id] = msg.title
      else delete ui.titleByTerminal[msg.id]
      renderTabs()
      break
    }
    case 'exit':
      if (msg.id === ui.currentTermId && term) {
        term.write(`\r\n\x1b[2m[process exited${msg.exitCode ? ` (${msg.exitCode})` : ''}]\x1b[0m\r\n`)
      }
      break
    case 'error':
      console.error('[bridge]', msg.message)
      break
  }
}

/** Ensure currentTermId points at a live terminal in the selected project. */
function ensureValidSelection(): void {
  const proj = currentProject()
  if (!proj) {
    ui.currentTermId = null
    return
  }
  const active = ui.app?.activeTerminalByProject?.[proj.id]
  const exists = (id: TerminalId | null | undefined): boolean =>
    !!id && proj.terminals.some((t) => t.id === id)

  if (exists(ui.currentTermId)) return
  if (exists(active)) attachTerminal(active!)
  else if (proj.terminals[0]) attachTerminal(proj.terminals[0].id)
  else ui.currentTermId = null
}

// ---- terminal binding ----

function attachTerminal(id: TerminalId): void {
  if (ui.currentTermId === id) return
  if (ui.currentTermId) send({ type: 'detach', id: ui.currentTermId })
  ui.currentTermId = id
  ui.unread.delete(id)
  term?.reset()
  send({ type: 'attach', id })
  const proj = currentProject()
  if (proj) send({ type: 'setActive', projectId: proj.id, id })
  renderTabs()
  syncSize()
}

function syncSize(): void {
  if (!fit || !term || !ui.currentTermId) return
  try {
    fit.fit()
    send({ type: 'resize', id: ui.currentTermId, cols: term.cols, rows: term.rows })
  } catch {
    // element not laid out yet
  }
}

/**
 * iOS soft-keyboard handling. The layout viewport (and `100dvh`) does NOT shrink
 * when the on-screen keyboard opens, so the keyboard overlays the bottom of the
 * terminal and hides what you're typing. `visualViewport.height` is the region
 * *above* the keyboard — drive the app height from it and refit xterm so the
 * cursor line and key toolbar stay visible.
 */
function setupViewport(): void {
  const vv = window.visualViewport
  if (!vv) return
  const apply = (): void => {
    document.documentElement.style.setProperty('--app-h', `${Math.round(vv.height)}px`)
    syncSize()
  }
  vv.addEventListener('resize', apply)
  vv.addEventListener('scroll', apply)
  apply()
}

// ---- rendering ----

function renderPairing(): void {
  const prefill = readHashParam('code') ?? ''
  root.innerHTML = `
    <div class="center">
      <h1>Pair with wTerm</h1>
      <p>Open <b>Settings → Mobile</b> in wTerm on your computer and enter the 6-digit code shown there.</p>
      <input class="code-input" id="code" inputmode="numeric" maxlength="6" placeholder="······" value="${prefill}" />
      <div class="err" id="err"></div>
      <button class="btn" id="pair">Pair</button>
    </div>`
  const input = document.getElementById('code') as HTMLInputElement
  const btn = document.getElementById('pair') as HTMLButtonElement
  const err = document.getElementById('err')!
  input.focus()
  const submit = async (): Promise<void> => {
    const code = input.value.trim()
    if (code.length !== 6) {
      err.textContent = 'Enter the 6 digits.'
      return
    }
    btn.disabled = true
    err.textContent = ''
    try {
      const token = await pairWithCode(code)
      setToken(token)
      history.replaceState(null, '', location.pathname)
      connect()
    } catch (e) {
      err.textContent = (e as Error).message
      btn.disabled = false
    }
  }
  btn.onclick = () => void submit()
  input.onkeydown = (e) => {
    if (e.key === 'Enter') void submit()
  }
  if (prefill.length === 6) void submit()
}

function renderApp(): void {
  root.innerHTML = `
    <div class="topbar">
      <span class="dot" id="dot"></span>
      <select id="project"></select>
      <button class="iconbtn" id="menu">⋯</button>
    </div>
    <div class="tabs" id="tabs"></div>
    <div class="term-wrap" id="termwrap"></div>
    <div class="keys" id="keys"></div>`

  setupTerminal()
  setupKeys()
  renderChrome()
  renderStatus()

  document.getElementById('project')!.addEventListener('change', (e) => {
    const id = (e.target as HTMLSelectElement).value
    ui.selectedProjectId = id
    send({ type: 'selectProject', projectId: id })
    ui.currentTermId = null
    ensureValidSelection()
    renderChrome()
  })
  document.getElementById('menu')!.addEventListener('click', openMenu)
  window.addEventListener('resize', syncSize)
}

function renderChrome(): void {
  renderProjectSelect()
  renderTabs()
}

function renderProjectSelect(): void {
  const sel = document.getElementById('project') as HTMLSelectElement | null
  if (!sel || !ui.app) return
  sel.innerHTML = ui.app.projects
    .map(
      (p) =>
        `<option value="${p.id}"${p.id === ui.selectedProjectId ? ' selected' : ''}>${escapeHtml(p.name)}</option>`
    )
    .join('')
}

function renderTabs(): void {
  const el = document.getElementById('tabs')
  if (!el) return
  const proj = currentProject()
  const tabs = (proj?.terminals ?? [])
    .map((t) => {
      const active = t.id === ui.currentTermId ? ' active' : ''
      const unread = ui.unread.has(t.id) && t.id !== ui.currentTermId ? '<span class="unread"></span>' : ''
      const label = ui.titleByTerminal[t.id] || t.name
      return `<button class="tab${active}" data-id="${t.id}">${unread}${escapeHtml(label)}</button>`
    })
    .join('')
  el.innerHTML = tabs + `<button class="tab add" id="addterm">＋</button>`

  el.querySelectorAll('.tab[data-id]').forEach((node) => {
    node.addEventListener('click', () => attachTerminal((node as HTMLElement).dataset.id!))
  })
  document.getElementById('addterm')!.addEventListener('click', () => {
    if (!proj) return
    ui.selectNewestInProject = proj.id
    send({ type: 'create', opts: { projectId: proj.id } })
  })
  if (!proj || proj.terminals.length === 0) {
    showEmpty('No terminals here yet. Tap ＋ to start one.')
  } else {
    hideEmpty()
  }
}

function renderStatus(): void {
  const dot = document.getElementById('dot')
  if (dot) dot.className = `dot ${ui.online ? 'online' : 'offline'}`
}

function showEmpty(text: string): void {
  const wrap = document.getElementById('termwrap')
  if (wrap) wrap.innerHTML = `<div class="empty">${escapeHtml(text)}</div>`
}

function hideEmpty(): void {
  const wrap = document.getElementById('termwrap')
  if (wrap && wrap.querySelector('.empty')) {
    wrap.innerHTML = ''
    setupTerminal()
    if (ui.currentTermId) {
      const id = ui.currentTermId
      ui.currentTermId = null
      attachTerminal(id)
    }
  }
}

// ---- xterm ----

/**
 * A vibrant, high-contrast palette. xterm's default ANSI colors are muddy on a
 * dark background (the normal blue all but disappears), so we ship a tuned 16
 * colors plus a brighter foreground. A near-black (not pure #000) background is
 * easier on the eyes and lifts color saturation perceptually.
 */
const TERM_THEME = {
  background: '#0b0d12',
  foreground: '#f6f8fc',
  cursor: '#5ccfe6',
  cursorAccent: '#0b0d12',
  selectionBackground: '#2d4f67',
  // normal
  black: '#6b758c',
  red: '#ff7782',
  green: '#7af3a4',
  yellow: '#ffd75e',
  blue: '#7fb0ff',
  magenta: '#d4a6ff',
  cyan: '#69d8ee',
  white: '#e3e8f1',
  // bright
  brightBlack: '#7c8696',
  brightRed: '#ff97a0',
  brightGreen: '#a3ffc4',
  brightYellow: '#ffe79e',
  brightBlue: '#a3c6ff',
  brightMagenta: '#e5c6ff',
  brightCyan: '#9cf0fd',
  brightWhite: '#ffffff',
}

function setupTerminal(): void {
  const wrap = document.getElementById('termwrap')
  if (!wrap) return
  term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
    theme: TERM_THEME,
    scrollback: 5000,
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.open(wrap)
  syncSize()
  setupTouchScroll(term, (data) => {
    if (ui.currentTermId) send({ type: 'input', id: ui.currentTermId, data })
  })

  term.onData((data) => {
    let out = data
    if (ctrlSticky && data.length === 1 && /[a-zA-Z@[\]\\^_]/.test(data)) {
      out = String.fromCharCode(data.toUpperCase().charCodeAt(0) & 0x1f)
      setCtrl(false)
    }
    if (ui.currentTermId) send({ type: 'input', id: ui.currentTermId, data: out })
  })
}

// ---- mobile key toolbar ----

interface KeyDef {
  label: string
  seq?: string
  ctrl?: boolean
  /** A cursor key (A/B/C/D) sent in a way that respects application cursor mode. */
  cursor?: 'A' | 'B' | 'C' | 'D'
  /** Just focus the terminal to open the device keyboard. */
  focus?: boolean
}
const KEYS: KeyDef[] = [
  { label: '⌨', focus: true },
  { label: 'esc', seq: '\x1b' },
  { label: 'tab', seq: '\t' },
  { label: 'ctrl', ctrl: true },
  { label: '↑', cursor: 'A' },
  { label: '↓', cursor: 'B' },
  { label: '←', cursor: 'D' },
  { label: '→', cursor: 'C' },
  { label: '^C', seq: '\x03' },
  { label: '^D', seq: '\x04' },
  { label: '^Z', seq: '\x1a' },
  { label: '^L', seq: '\x0c' },
  { label: '|', seq: '|' },
  { label: '~', seq: '~' },
  { label: '/', seq: '/' },
]

function setupKeys(): void {
  const el = document.getElementById('keys')
  if (!el) return
  el.innerHTML = KEYS.map(
    (k, i) => `<button class="key" data-i="${i}">${escapeHtml(k.label)}</button>`
  ).join('')
  el.querySelectorAll('.key').forEach((node) => {
    node.addEventListener('click', () => {
      const def = KEYS[Number((node as HTMLElement).dataset.i)]
      if (def.focus) {
        term?.focus()
        return
      }
      if (def.ctrl) {
        setCtrl(!ctrlSticky)
        return
      }
      let seq = def.seq
      if (def.cursor) {
        // Apps that enable DECCKM (vim, many TUIs, readline) expect the SS3 form
        // (\x1bO_) rather than CSI (\x1b[_); honour the terminal's current mode.
        const prefix = term?.modes.applicationCursorKeysMode ? '\x1bO' : '\x1b['
        seq = prefix + def.cursor
      }
      if (seq && ui.currentTermId) send({ type: 'input', id: ui.currentTermId, data: seq })
      term?.focus()
    })
  })
}

function setCtrl(on: boolean): void {
  ctrlSticky = on
  const ctrlBtn = Array.from(document.querySelectorAll('.key')).find(
    (n) => KEYS[Number((n as HTMLElement).dataset.i)]?.ctrl
  )
  ctrlBtn?.classList.toggle('sticky-on', on)
}

// ---- ⋯ menu (manage current terminal / notifications / unpair) ----

function openMenu(): void {
  const proj = currentProject()
  const term = proj?.terminals.find((t) => t.id === ui.currentTermId)
  const actions: Array<[string, () => void]> = []
  if (term) {
    actions.push([
      `Rename “${term.name}”`,
      () => {
        const name = prompt('Rename terminal', term.name)
        if (name && proj) send({ type: 'rename', projectId: proj.id, id: term.id, name })
      },
    ])
    actions.push([
      `Close “${term.name}”`,
      () => {
        if (proj && confirm(`Close ${term.name}?`)) send({ type: 'kill', projectId: proj.id, id: term.id })
      },
    ])
  }
  actions.push(['Enable notifications', () => void enablePush()])
  actions.push(['Unpair this phone', () => {
    if (confirm('Forget the pairing token on this device?')) {
      clearToken()
      ws?.close()
      renderPairing()
    }
  }])

  const choice = pickAction(actions.map(([label]) => label))
  void choice.then((idx) => {
    if (idx >= 0) actions[idx][1]()
  })
}

/** Minimal native-feeling action picker via sequential confirm fallbacks. */
function pickAction(labels: string[]): Promise<number> {
  // A lightweight bottom-sheet built from a transient overlay.
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;flex-direction:column;justify-content:flex-end;z-index:50;'
    const sheet = document.createElement('div')
    sheet.style.cssText =
      'background:#14141b;border-top:1px solid #2a2a38;border-radius:16px 16px 0 0;padding:8px;padding-bottom:max(env(safe-area-inset-bottom),12px);'
    labels.forEach((label, i) => {
      const b = document.createElement('button')
      b.textContent = label
      b.style.cssText =
        'display:block;width:100%;text-align:left;background:none;border:none;color:#e5e7eb;font-size:16px;padding:14px 12px;border-radius:10px;'
      b.onclick = () => {
        document.body.removeChild(overlay)
        resolve(i)
      }
      sheet.appendChild(b)
    })
    overlay.appendChild(sheet)
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        document.body.removeChild(overlay)
        resolve(-1)
      }
    }
    document.body.appendChild(overlay)
  })
}

// ---- web push ----

async function enablePush(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      alert('Push not supported on this browser. On iOS, add wTerm to your Home Screen first.')
      return
    }
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') return
    const reg = await navigator.serviceWorker.register('/sw.js')
    const { key } = await (await fetch('/api/vapid-public-key')).json()
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    })
    send({ type: 'subscribePush', subscription: sub.toJSON() })
    alert('Notifications enabled.')
  } catch (e) {
    console.error(e)
    alert('Could not enable notifications.')
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

// ---- util ----

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  )
}

// ---- boot ----

const hashToken = readHashParam('token')
if (hashToken) {
  setToken(hashToken)
  history.replaceState(null, '', location.pathname)
}

setupViewport()

if (getToken()) connect()
else renderPairing()
