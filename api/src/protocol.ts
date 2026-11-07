/**
 * Shared wire protocol between the browser and the GameHub Durable Object.
 * Kept deliberately small — everything is JSON `{ type, ... }`.
 */

export type Vec2 = { x: number; y: number }
export type Outcome = 'goal' | 'save' | 'post' | 'miss'
export type Role = 'striker' | 'keeper'

/** Messages the browser sends to the server. */
export type ClientMessage =
  | { type: 'hello'; name?: string }
  | { type: 'ready' } // (re)join the auto-pair pool
  | { type: 'accept' } // accept a pairing offer
  | { type: 'decline' } // decline a pairing offer
  | { type: 'joinCode'; color: string; object: string }
  | { type: 'leave' } // leave the current match / offer, back to lounge
  | { type: 'aim'; x: number } // lateral lean before committing, relayed to the opponent
  | { type: 'shoot'; target: Vec2; speed: number; curve: number }
  | { type: 'dive'; x: number; y: number }
  | { type: 'result'; outcome: Outcome }

/** Messages the server sends to the browser. */
export type ServerMessage =
  | { type: 'welcome'; id: string; code: { color: string; object: string } }
  | { type: 'lounge'; waiting: number; ready: boolean }
  | { type: 'offer'; opponentName: string; seconds: number }
  | { type: 'offerCancelled'; reason: string }
  | { type: 'matchStart'; role: Role; opponentName: string; target: number }
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

/** Kid-friendly share codes: a colour plus an object, e.g. "blue apple". */
export const CODE_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'brown',
  'black',
  'white',
  'silver',
  'gold',
] as const

export const CODE_OBJECTS = [
  'apple',
  'banana',
  'elephant',
  'tiger',
  'rocket',
  'robot',
  'dragon',
  'pizza',
  'cookie',
  'panda',
  'shark',
  'guitar',
  'balloon',
  'cactus',
  'penguin',
  'dinosaur',
] as const

export const codeKey = (color: string, object: string) =>
  `${color.trim().toLowerCase()} ${object.trim().toLowerCase()}`
