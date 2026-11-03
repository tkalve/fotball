import type { ClientMessage, ServerMessage } from './protocol'

type Handler = (msg: ServerMessage) => void
type StatusHandler = (status: ConnectionStatus) => void

export type ConnectionStatus = 'connecting' | 'open' | 'closed'

/**
 * Owns the single WebSocket to the GameHub and fans out typed messages.
 * Deliberately framework-free so both React (lobby UI) and the Game engine
 * can subscribe without fighting over re-renders.
 */
export class MatchClient {
  private ws: WebSocket | null = null
  private handlers = new Set<Handler>()
  private statusHandlers = new Set<StatusHandler>()
  private queue: ClientMessage[] = []
  private closedByUs = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private name: string

  constructor(name = '') {
    this.name = name
  }

  connect() {
    this.closedByUs = false
    this.open()
  }

  private open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    this.ws = ws
    this.emitStatus('connecting')

    ws.addEventListener('open', () => {
      this.send({ type: 'hello', name: this.name })
      for (const m of this.queue) this.rawSend(m)
      this.queue = []
      this.emitStatus('open')
    })
    ws.addEventListener('message', (e) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(typeof e.data === 'string' ? e.data : '')
      } catch {
        return
      }
      for (const h of this.handlers) h(msg)
    })
    ws.addEventListener('close', () => {
      this.emitStatus('closed')
      if (!this.closedByUs) this.scheduleReconnect()
    })
    ws.addEventListener('error', () => ws.close())
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.closedByUs) this.open()
    }, 1500)
  }

  setName(name: string) {
    this.name = name
  }

  send(msg: ClientMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.rawSend(msg)
    } else if (msg.type !== 'hello') {
      this.queue.push(msg)
    }
  }

  private rawSend(msg: ClientMessage) {
    this.ws?.send(JSON.stringify(msg))
  }

  on(handler: Handler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler)
    return () => this.statusHandlers.delete(handler)
  }

  private emitStatus(status: ConnectionStatus) {
    for (const h of this.statusHandlers) h(status)
  }

  close() {
    this.closedByUs = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
  }
}
