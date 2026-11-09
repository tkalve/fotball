import {
  type ClientMessage,
  type Outcome,
  type ServerMessage,
} from './protocol'

export interface Env {
  GAME_HUB: DurableObjectNamespace
  ASSETS: Fetcher
}

/** The whole lounge + every live match runs inside one Durable Object. */
const HUB_NAME = 'hub'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/ws') {
      const id = env.GAME_HUB.idFromName(HUB_NAME)
      return env.GAME_HUB.get(id).fetch(request)
    }
    // Everything else is served by the static assets binding (the built SPA).
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>

type Player = {
  id: string
  name: string
  ws: WebSocket
  /** 'lounge' = free to invite, 'offered' = in an invite, 'match' = playing. */
  status: 'lounge' | 'offered' | 'match'
  joinedAt: number
  offerId?: string
  matchId?: string
}

type Offer = {
  id: string
  /** The player who sent the invite (already committed). */
  a: string
  /** The invited player, who must accept. */
  b: string
  aAccepted: boolean
  bAccepted: boolean
  timer: ReturnType<typeof setTimeout>
}

type RoundState = 'await-shoot' | 'await-result' | 'between'

type Match = {
  id: string
  players: [string, string]
  /** Index (0|1) of the player striking the current round. */
  striker: 0 | 1
  scores: [number, number]
  round: number
  state: RoundState
  timer?: ReturnType<typeof setTimeout>
}

const TARGET_GOALS = 5
const OFFER_SECONDS = 30
const RESULT_PAUSE_MS = 2600

export class GameHub implements DurableObject {
  private players = new Map<string, Player>()
  private sockets = new Map<WebSocket, string>()
  private offers = new Map<string, Offer>()
  private matches = new Map<string, Match>()
  private seq = 0

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 })
    }
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    server.accept()
    this.onConnect(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  // --------------------------------------------------------------- connection

  private onConnect(ws: WebSocket) {
    const id = this.uid('p')
    const player: Player = {
      id,
      name: '',
      ws,
      status: 'lounge',
      joinedAt: Date.now(),
    }
    this.players.set(id, player)
    this.sockets.set(ws, id)

    ws.addEventListener('message', (e) => {
      let msg: ClientMessage
      try {
        msg = JSON.parse(typeof e.data === 'string' ? e.data : '')
      } catch {
        return
      }
      this.onMessage(player, msg)
    })
    const bye = () => this.onDisconnect(player)
    ws.addEventListener('close', bye)
    ws.addEventListener('error', bye)

    this.send(player, { type: 'welcome', id })
    this.broadcastLounge()
  }

  private onDisconnect(player: Player) {
    if (!this.players.has(player.id)) return
    this.players.delete(player.id)
    this.sockets.delete(player.ws)

    if (player.offerId) this.cancelOffer(player.offerId, 'Your opponent left.')
    if (player.matchId) this.endMatch(player.matchId, player.id)
    this.broadcastLounge()
  }

  // ------------------------------------------------------------------ messages

  private onMessage(player: Player, msg: ClientMessage) {
    switch (msg.type) {
      case 'hello':
        player.name = sanitizeName(msg.name)
        this.broadcastLounge()
        break
      case 'invite':
        this.invite(player, msg.targetId)
        break
      case 'accept':
        this.acceptOffer(player)
        break
      case 'decline':
        if (player.offerId) this.cancelOffer(player.offerId, 'Invite declined.', player.id)
        break
      case 'leave':
        this.handleLeave(player)
        break
      case 'aim':
        this.relayAim(player, msg)
        break
      case 'shoot':
        this.relayShoot(player, msg)
        break
      case 'dive':
        this.relayDive(player, msg)
        break
      case 'result':
        this.resolveRound(player, msg.outcome)
        break
    }
  }

  private handleLeave(player: Player) {
    if (player.offerId) this.cancelOffer(player.offerId, 'Invite cancelled.', player.id)
    if (player.matchId) this.endMatch(player.matchId, player.id)
    player.status = 'lounge'
    this.broadcastLounge()
  }

  // ------------------------------------------------------------------- invites

  private invite(player: Player, targetId: string) {
    if (player.status !== 'lounge') return
    const target = this.players.get(targetId)
    if (!target || target.id === player.id) {
      this.send(player, { type: 'error', message: 'That player is no longer available.' })
      return
    }
    if (target.status !== 'lounge') {
      this.send(player, { type: 'error', message: 'That player is busy right now.' })
      return
    }
    this.makeOffer(player, target)
  }

  private makeOffer(a: Player, b: Player) {
    const id = this.uid('o')
    a.status = b.status = 'offered'
    a.offerId = b.offerId = id
    const timer = setTimeout(() => this.cancelOffer(id, 'Nobody confirmed in time.'), OFFER_SECONDS * 1000)
    // The inviter (a) has already committed; only the invited player (b) must accept.
    this.offers.set(id, { id, a: a.id, b: b.id, aAccepted: true, bAccepted: false, timer })
    this.send(a, { type: 'offer', opponentName: b.name || 'a new player', seconds: OFFER_SECONDS, incoming: false })
    this.send(b, { type: 'offer', opponentName: a.name || 'a new player', seconds: OFFER_SECONDS, incoming: true })
    this.broadcastLounge()
  }

  private acceptOffer(player: Player) {
    const offer = player.offerId ? this.offers.get(player.offerId) : undefined
    if (!offer) return
    if (offer.a === player.id) offer.aAccepted = true
    if (offer.b === player.id) offer.bAccepted = true
    if (offer.aAccepted && offer.bAccepted) {
      clearTimeout(offer.timer)
      this.offers.delete(offer.id)
      const a = this.players.get(offer.a)
      const b = this.players.get(offer.b)
      if (a && b) this.startMatch(a, b)
    }
  }

  private cancelOffer(offerId: string, reason: string, declinerId?: string) {
    const offer = this.offers.get(offerId)
    if (!offer) return
    clearTimeout(offer.timer)
    this.offers.delete(offerId)
    for (const pid of [offer.a, offer.b]) {
      const p = this.players.get(pid)
      if (!p || p.offerId !== offerId) continue
      p.offerId = undefined
      p.status = 'lounge'
      if (declinerId ? pid !== declinerId : true) this.send(p, { type: 'offerCancelled', reason })
    }
    this.broadcastLounge()
  }

  // --------------------------------------------------------------------- match

  private startMatch(a: Player, b: Player) {
    const id = this.uid('m')
    a.status = b.status = 'match'
    a.matchId = b.matchId = id
    a.offerId = b.offerId = undefined
    const match: Match = {
      id,
      players: [a.id, b.id],
      striker: 0,
      scores: [0, 0],
      round: 0,
      state: 'await-shoot',
    }
    this.matches.set(id, match)
    this.send(a, { type: 'matchStart', role: 'striker', opponentName: b.name || 'Player 2', opponentId: b.id, target: TARGET_GOALS })
    this.send(b, { type: 'matchStart', role: 'keeper', opponentName: a.name || 'Player 1', opponentId: a.id, target: TARGET_GOALS })
    this.broadcastLounge()
  }

  /** Pre-commit lean, relayed to the opponent so they see you positioning. */
  private relayAim(player: Player, msg: Extract<ClientMessage, { type: 'aim' }>) {
    const match = this.matchOf(player)
    if (!match) return
    const other = this.opponentOf(match, player.id)
    if (other) this.send(other, { type: 'aim', x: msg.x })
  }

  private relayShoot(player: Player, msg: Extract<ClientMessage, { type: 'shoot' }>) {    const match = this.matchOf(player)
    if (!match || match.state !== 'await-shoot') return
    if (match.players[match.striker] !== player.id) return
    match.state = 'await-result'
    const keeper = this.opponentOf(match, player.id)
    if (keeper) this.send(keeper, { type: 'shoot', target: msg.target, speed: msg.speed, curve: msg.curve })
  }

  private relayDive(player: Player, msg: Extract<ClientMessage, { type: 'dive' }>) {
    const match = this.matchOf(player)
    if (!match) return
    if (match.players[match.striker] === player.id) return // keeper only
    const striker = this.opponentOf(match, player.id)
    if (striker) this.send(striker, { type: 'dive', x: msg.x, y: msg.y })
  }

  /** The keeper is authoritative for the round outcome. */
  private resolveRound(player: Player, outcome: Outcome) {
    const match = this.matchOf(player)
    if (!match || match.state !== 'await-result') return
    const keeperIndex = (match.striker ^ 1) as 0 | 1
    if (match.players[keeperIndex] !== player.id) return
    match.state = 'between'

    if (outcome === 'goal') match.scores[match.striker]++
    const matchOver = match.scores[match.striker] >= TARGET_GOALS
    const winnerIndex = match.scores[0] >= match.scores[1] ? 0 : 1

    for (let i = 0; i < 2; i++) {
      const p = this.players.get(match.players[i])
      if (!p) continue
      this.send(p, {
        type: 'result',
        outcome,
        scoreYou: match.scores[i],
        scoreThem: match.scores[i ^ 1],
        matchOver,
        youWon: matchOver && winnerIndex === i,
      })
    }

    if (matchOver) {
      this.finishMatch(match)
      return
    }
    match.timer = setTimeout(() => this.nextRound(match.id), RESULT_PAUSE_MS)
  }

  private nextRound(matchId: string) {
    const match = this.matches.get(matchId)
    if (!match) return
    match.striker = (match.striker ^ 1) as 0 | 1
    match.round++
    match.state = 'await-shoot'
    for (let i = 0; i < 2; i++) {
      const p = this.players.get(match.players[i])
      if (!p) continue
      this.send(p, {
        type: 'round',
        index: match.round,
        role: match.striker === i ? 'striker' : 'keeper',
        scoreYou: match.scores[i],
        scoreThem: match.scores[i ^ 1],
      })
    }
  }

  /** Match ran to its natural end: free both players back to the lounge. */
  private finishMatch(match: Match) {
    if (match.timer) clearTimeout(match.timer)
    this.matches.delete(match.id)
    for (const pid of match.players) {
      const p = this.players.get(pid)
      if (!p) continue
      p.status = 'lounge'
      p.matchId = undefined
    }
    this.broadcastLounge()
  }

  /** A player bailed mid-match: tell the other and drop them to the lounge. */
  private endMatch(matchId: string, leaverId: string) {
    const match = this.matches.get(matchId)
    if (!match) return
    if (match.timer) clearTimeout(match.timer)
    this.matches.delete(matchId)
    for (const pid of match.players) {
      const p = this.players.get(pid)
      if (!p) continue
      p.status = 'lounge'
      p.matchId = undefined
      if (pid !== leaverId) this.send(p, { type: 'opponentLeft' })
    }
    this.broadcastLounge()
  }

  // ------------------------------------------------------------------- helpers

  private matchOf(player: Player): Match | undefined {
    return player.matchId ? this.matches.get(player.matchId) : undefined
  }

  private opponentOf(match: Match, playerId: string): Player | undefined {
    const otherId = match.players[0] === playerId ? match.players[1] : match.players[0]
    return this.players.get(otherId)
  }

  private broadcastLounge() {
    for (const p of this.players.values()) {
      if (p.status !== 'match') this.sendLounge(p)
    }
  }

  private sendLounge(player: Player) {
    const players = [...this.players.values()]
      .filter((p) => p.id !== player.id)
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({ id: p.id, name: p.name || 'Player', busy: p.status !== 'lounge' }))
    this.send(player, { type: 'lounge', players })
  }

  private send(player: Player, msg: ServerMessage) {
    try {
      player.ws.send(JSON.stringify(msg))
    } catch {
      /* socket already gone */
    }
  }

  private uid(prefix: string) {
    this.seq++
    return `${prefix}${this.seq}_${Math.random().toString(36).slice(2, 8)}`
  }
}

function sanitizeName(name: string | undefined): string {
  return (name ?? '').trim().slice(0, 20)
}
