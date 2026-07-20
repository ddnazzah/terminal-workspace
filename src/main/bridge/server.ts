import { powerSaveBlocker } from 'electron'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  type BridgeClientMessage,
  type BridgePairing,
  type BridgeStatus,
} from '@shared/types'
import { cleanTitle } from '@shared/terminal-title'
import { getState, onStateChange } from '../store/state'
import { applyFromBridge } from '../sync'
import {
  createTerminal,
  removeTerminalRecord,
  renameTerminal,
  setActiveTerminal,
} from '../ipc/terminal'
import { selectProject } from '../ipc/project'
import type { PtyManager } from '../pty/manager'
import { timingSafeEqual } from 'node:crypto'
import { ClientRegistry, type BridgeClient } from './clients'
import { getSecrets, regeneratePairing, verifyToken } from './secrets'
import { getVapidPublicKey, registerSubscription } from './push'
import { getTailscaleOrigin } from './tailscale'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_PORT = 8788

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
}

/** Locate the built PWA assets. Overridable in dev via WTERM_PWA_DIR. */
function pwaDir(): string {
  return process.env.WTERM_PWA_DIR || join(__dirname, '../pwa')
}

export class MobileBridge {
  private server: Server | null = null
  private wss: WebSocketServer | null = null
  private readonly registry = new ClientRegistry()
  private port: number | null = null
  private tailscaleOrigin: string | null = null
  // Crude brute-force guard for the 6-digit pairing code. Tailnet access is
  // already restricted to the user's own devices, but a short lockout after a
  // burst of wrong codes raises the bar further.
  private pairFailures = 0
  private pairLockedUntil = 0
  // Keep-the-Mac-awake-while-a-phone-is-connected. The blocker is only held
  // while keepAwake is on AND at least one client is connected, so it never
  // drains the battery when nothing is watching.
  private keepAwake = false
  private powerBlockerId: number | null = null

  constructor(private readonly pty: PtyManager) {}

  async start(port = DEFAULT_PORT): Promise<void> {
    if (this.server) return

    // Mirror every PTY event to connected phones; the registry filters by which
    // terminal each client is watching.
    this.pty.addSink({
      onData: (p) => this.registry.forwardData(p),
      onExit: (p) => this.registry.forwardExit(p),
      onActivity: (p) => this.registry.forwardTitle(p.id, cleanTitle(p.title)),
    })

    // Any state mutation — desktop- or phone-originated — refreshes phones so
    // their project/terminal list stays current.
    onStateChange(() => this.registry.broadcastState(getState()))

    const server = createServer((req, res) => void this.handleHttp(req, res))
    const wss = new WebSocketServer({ noServer: true })

    server.on('upgrade', (req, socket, head) => {
      if (!this.isWsPath(req)) {
        socket.destroy()
        return
      }
      void this.authorizeUpgrade(req).then((ok) => {
        if (!ok) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
          socket.destroy()
          return
        }
        wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws))
      })
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })

    this.server = server
    this.wss = wss
    this.port = port
    // Best-effort; refreshed on demand via getStatus.
    this.tailscaleOrigin = await getTailscaleOrigin()
  }

  async stop(): Promise<void> {
    this.wss?.close()
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve()
      this.server.close(() => resolve())
    })
    this.server = null
    this.wss = null
    this.port = null
  }

  // ---- status / pairing (consumed by IPC handlers) ----

  async getStatus(): Promise<BridgeStatus> {
    // Refresh the origin lazily so the indicator reflects Tailscale coming up
    // after the app launched.
    this.tailscaleOrigin = await getTailscaleOrigin()
    return {
      listening: this.server !== null,
      port: this.port,
      clients: this.registry.size,
      tailscaleOrigin: this.tailscaleOrigin,
    }
  }

  async getPairing(): Promise<BridgePairing> {
    const { token, code } = await getSecrets()
    const origin = this.tailscaleOrigin ?? (await getTailscaleOrigin())
    // The QR encodes the origin + code so scanning both opens the PWA and
    // auto-fills the code; users who type the URL by hand enter the code shown
    // alongside it. The long token is never put in the QR — it's handed back
    // only after the code is verified over the (TLS) pairing endpoint.
    const pairUrl = origin ? `${origin}/#code=${encodeURIComponent(code)}` : null
    return { token, code, pairUrl }
  }

  async regeneratePairing(): Promise<BridgePairing> {
    await regeneratePairing()
    return this.getPairing()
  }

  setKeepAwake(enabled: boolean): void {
    this.keepAwake = enabled
    this.updatePowerBlocker()
  }

  /**
   * Hold or release the power-save blocker based on the current setting + client
   * count. 'prevent-app-suspension' keeps the system awake (network stays up)
   * while still allowing the display to sleep — the macOS `caffeinate -s`
   * equivalent.
   */
  private updatePowerBlocker(): void {
    const shouldBlock = this.keepAwake && this.registry.size > 0
    if (shouldBlock && this.powerBlockerId === null) {
      this.powerBlockerId = powerSaveBlocker.start('prevent-app-suspension')
    } else if (!shouldBlock && this.powerBlockerId !== null) {
      if (powerSaveBlocker.isStarted(this.powerBlockerId)) {
        powerSaveBlocker.stop(this.powerBlockerId)
      }
      this.powerBlockerId = null
    }
  }

  // ---- HTTP ----

  private isWsPath(req: IncomingMessage): boolean {
    return (req.url ?? '').split('?')[0] === '/ws'
  }

  private async authorizeUpgrade(req: IncomingMessage): Promise<boolean> {
    const url = new URL(req.url ?? '', 'http://localhost')
    const token =
      url.searchParams.get('token') ??
      req.headers.authorization?.replace(/^Bearer\s+/i, '') ??
      null
    return verifyToken(token)
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname

    // The VAPID public key is not a secret — the PWA needs it to subscribe.
    if (path === '/api/vapid-public-key') {
      const key = await getVapidPublicKey()
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ key }))
      return
    }

    if (path === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (path === '/api/pair' && req.method === 'POST') {
      await this.handlePair(req, res)
      return
    }

    await this.serveStatic(path, res)
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let data = ''
      req.on('data', (chunk) => {
        data += chunk
        if (data.length > 4096) req.destroy() // pairing body is tiny
      })
      req.on('end', () => resolve(data))
      req.on('error', () => resolve(''))
    })
  }

  /** Exchange a correct 6-digit code for the bearer token. */
  private async handlePair(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const now = Date.now()
    if (now < this.pairLockedUntil) {
      res.writeHead(429, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'locked' }))
      return
    }

    let submitted = ''
    try {
      submitted = String((JSON.parse(await this.readBody(req)) as { code?: string }).code ?? '')
    } catch {
      submitted = ''
    }

    const { token, code } = await getSecrets()
    const a = Buffer.from(submitted)
    const b = Buffer.from(code)
    const ok = a.length === b.length && timingSafeEqual(a, b)

    if (!ok) {
      this.pairFailures += 1
      if (this.pairFailures >= 5) {
        this.pairLockedUntil = now + 30_000
        this.pairFailures = 0
      }
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'bad-code' }))
      return
    }

    this.pairFailures = 0
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ token }))
  }

  private async serveStatic(path: string, res: ServerResponse): Promise<void> {
    const dir = pwaDir()
    if (!existsSync(dir)) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('wTerm mobile bridge: PWA assets not built. Run the PWA build.')
      return
    }

    // Resolve the request to a file inside the PWA dir, guarding against
    // path traversal. Unknown routes fall back to index.html (SPA).
    const rel = normalize(decodeURIComponent(path)).replace(/^(\.\.[/\\])+/, '')
    let filePath = join(dir, rel)
    if (!filePath.startsWith(dir)) filePath = join(dir, 'index.html')
    if (path === '/' || !existsSync(filePath)) filePath = join(dir, 'index.html')

    try {
      const data = await fs.readFile(filePath)
      const type = MIME[extname(filePath)] ?? 'application/octet-stream'
      const headers: Record<string, string> = { 'content-type': type }
      // The service worker must be allowed to control the whole origin.
      if (filePath.endsWith('sw.js')) headers['service-worker-allowed'] = '/'
      res.writeHead(200, headers)
      res.end(data)
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Not found')
    }
  }

  // ---- WebSocket ----

  private onConnection(ws: WebSocket): void {
    const client = this.registry.add(ws)
    this.updatePowerBlocker()
    // Seed the phone with the current project/terminal structure.
    const state = getState()
    this.registry.sendTo(client, { type: 'hello', state })
    // Seed derived window titles so a phone joining a running session shows the
    // agent's task label instead of "Terminal N" until the next title change.
    for (const project of state.projects) {
      for (const terminal of project.terminals) {
        const title = cleanTitle(this.pty.activityFor(terminal.id)?.title ?? null)
        if (title) this.registry.sendTo(client, { type: 'title', id: terminal.id, title })
      }
    }

    const drop = (): void => {
      const wasViewing = [...client.subscribed]
      this.registry.remove(client)
      // Release size authority for any terminal this phone was the last viewer
      // of, so the desktop reclaims its own dimensions.
      for (const id of wasViewing) {
        if (!this.registry.isSubscribed(id)) this.pty.releaseBridgeSize(id)
      }
      this.updatePowerBlocker()
    }
    ws.on('message', (raw) => void this.onMessage(client, raw.toString()))
    ws.on('close', drop)
    ws.on('error', drop)
  }

  private async onMessage(client: BridgeClient, raw: string): Promise<void> {
    let msg: BridgeClientMessage
    try {
      msg = JSON.parse(raw) as BridgeClientMessage
    } catch {
      return
    }

    switch (msg.type) {
      case 'attach': {
        // Snapshot BEFORE subscribing so flushed-pending bytes go to existing
        // consumers and every byte after the snapshot arrives once via the sink.
        const snapshot = this.pty.snapshotForBridge(msg.id)
        client.subscribed.add(msg.id)
        this.registry.sendTo(client, { type: 'attached', id: msg.id, snapshot })
        break
      }
      case 'detach':
        client.subscribed.delete(msg.id)
        // If no phone is watching this terminal anymore, give size authority
        // back to the desktop so its grid isn't stuck at the phone's width.
        if (!this.registry.isSubscribed(msg.id)) this.pty.releaseBridgeSize(msg.id)
        break
      case 'input':
        this.pty.write(msg.id, msg.data)
        break
      case 'resize':
        // A phone that's viewing a terminal owns its PTY size (see
        // PtyManager.resize) so the running program renders for the phone.
        this.pty.resize(msg.id, msg.cols, msg.rows, 'bridge')
        break
      case 'create':
        applyFromBridge(() => createTerminal(this.pty, msg.opts))
        break
      case 'kill':
        applyFromBridge(() => removeTerminalRecord(this.pty, msg.projectId, msg.id))
        break
      case 'rename':
        applyFromBridge(() => renameTerminal(msg.projectId, msg.id, msg.name))
        break
      case 'setActive':
        applyFromBridge(() => setActiveTerminal(msg.projectId, msg.id))
        break
      case 'selectProject':
        applyFromBridge(() => selectProject(msg.projectId))
        break
      case 'subscribePush':
        await registerSubscription(msg.subscription)
        break
    }
  }
}
