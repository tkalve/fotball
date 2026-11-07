/** Wire protocol shared with the Cloudflare Worker (api/src/protocol.ts). */

export type Vec2 = { x: number; y: number }
export type Outcome = 'goal' | 'save' | 'post' | 'miss'
export type Role = 'striker' | 'keeper'

export type ClientMessage =
  | { type: 'hello'; name?: string }
  | { type: 'ready' }
  | { type: 'accept' }
  | { type: 'decline' }
  | { type: 'joinCode'; color: string; object: string }
  | { type: 'leave' }
  | { type: 'aim'; x: number }
  | { type: 'shoot'; target: Vec2; speed: number; curve: number }
  | { type: 'dive'; x: number; y: number }
  | { type: 'result'; outcome: Outcome }

export type ServerMessage =
  | { type: 'welcome'; id: string; code: { color: string; object: string } }
  | { type: 'lounge'; waiting: number; ready: boolean }
  | { type: 'offer'; opponentName: string; seconds: number }
  | { type: 'offerCancelled'; reason: string }
  | { type: 'matchStart'; role: Role; opponentName: string; target: number }
  | { type: 'round'; index: number; role: Role; scoreYou: number; scoreThem: number }
  | { type: 'aim'; x: number }
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
]

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
]
