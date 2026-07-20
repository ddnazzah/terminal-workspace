import type { WebSocket } from 'ws'
import type {
  AppState,
  BridgeServerMessage,
  TerminalDataPayload,
  TerminalExitPayload,
  TerminalId,
} from '@shared/types'

/** One connected phone, with the set of terminals it is currently watching. */
export interface BridgeClient {
  ws: WebSocket
  subscribed: Set<TerminalId>
}

/**
 * Tracks connected phone clients and fans PTY/state events out to them. The
 * PtyManager sink hands us *every* terminal's data; we route each payload only
 * to clients that have attached to that terminal. State changes go to everyone.
 */
export class ClientRegistry {
  private clients = new Set<BridgeClient>()

  add(ws: WebSocket): BridgeClient {
    const client: BridgeClient = { ws, subscribed: new Set() }
    this.clients.add(client)
    return client
  }

  remove(client: BridgeClient): void {
    this.clients.delete(client)
  }

  get size(): number {
    return this.clients.size
  }

  /** True if any connected client is currently viewing (attached to) a terminal. */
  isSubscribed(id: TerminalId): boolean {
    for (const client of this.clients) {
      if (client.subscribed.has(id)) return true
    }
    return false
  }

  private send(client: BridgeClient, msg: BridgeServerMessage): void {
    // ws.OPEN === 1; avoid importing the enum to keep this dependency-light.
    if (client.ws.readyState === 1) {
      try {
        client.ws.send(JSON.stringify(msg))
      } catch (err) {
        console.error('[bridge] client send failed:', err)
      }
    }
  }

  sendTo(client: BridgeClient, msg: BridgeServerMessage): void {
    this.send(client, msg)
  }

  forwardData(payload: TerminalDataPayload): void {
    for (const client of this.clients) {
      if (client.subscribed.has(payload.id)) {
        this.send(client, { type: 'data', id: payload.id, data: payload.data })
      }
    }
  }

  forwardExit(payload: TerminalExitPayload): void {
    for (const client of this.clients) {
      if (client.subscribed.has(payload.id)) {
        this.send(client, {
          type: 'exit',
          id: payload.id,
          exitCode: payload.exitCode,
          signal: payload.signal,
        })
        client.subscribed.delete(payload.id)
      }
    }
  }

  broadcastState(state: AppState): void {
    for (const client of this.clients) {
      this.send(client, { type: 'state', state })
    }
  }

  /**
   * The derived window title (e.g. an agent's task) for a terminal. Sent to
   * every client — the tab bar shows all terminals in a project, not just the
   * attached one — so a phone's labels track the desktop's auto-titles.
   */
  forwardTitle(id: TerminalId, title: string | null): void {
    for (const client of this.clients) {
      this.send(client, { type: 'title', id, title })
    }
  }
}
