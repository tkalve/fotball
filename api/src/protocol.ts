/**
 * Shared wire protocol between the browser and the GameHub Durable Object.
 * Kept deliberately small — everything is JSON `{ type, ... }`.
 */

export type Vec2 = { x: number; y: number }
export type Outcome = 'goal' | 'save' | 'post' | 'miss'
export type Role = 'striker' | 'keeper'

/** A player visible in the lounge list. `busy` means they can't be invited. */
export type LoungePlayer = { id: string; name: string; busy: boolean }

/** Messages the browser sends to the server. */
export type ClientMessage =
  | { type: 'hello'; name?: string } // announce / update our display name
  | { type: 'invite'; targetId: string } // invite another lounge player to play
  | { type: 'accept' } // accept an incoming invite
  | { type: 'decline' } // decline an incoming invite / cancel one we sent
  | { type: 'leave' } // leave the current match / offer, back to lounge
  | { type: 'aim'; x: number } // lateral lean before committing, relayed to the opponent
  | { type: 'shoot'; target: Vec2; speed: number; curve: number }
  | { type: 'dive'; x: number; y: number }
  | { type: 'result'; outcome: Outcome }

/** Messages the server sends to the browser. */
export type ServerMessage =
  | { type: 'welcome'; id: string }
  | { type: 'lounge'; players: LoungePlayer[] }
  | { type: 'offer'; opponentName: string; seconds: number; incoming: boolean }
  | { type: 'offerCancelled'; reason: string }
  | { type: 'matchStart'; role: Role; opponentName: string; opponentId: string; target: number }
  | { type: 'round'; index: number; role: Role; scoreYou: number; scoreThem: number }
  | { type: 'aim'; x: number } // the opponent's lateral lean before committing
  | { type: 'shoot'; target: Vec2; speed: number; curve: number }
  | { type: 'dive'; x: number; y: number }
  | {
      type: 'result'
      outcome: Outcome
      scoreYou: number
      scoreThem: number
      matchOver: boolean
      youWon: boolean
    }
  | { type: 'opponentLeft' }
  | { type: 'error'; message: string }
