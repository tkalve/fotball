import { useEffect, useRef, useState } from 'react'
import { Game, type GameState } from '../game/Game'
import { MatchClient } from '../net/MatchClient'
import type { Role, ServerMessage } from '../net/protocol'
import { PowerMeter } from './PowerMeter'

const OUTCOME_TEXT: Record<string, { title: string; tone: string }> = {
  goal: { title: 'GOAL!', tone: 'good' },
  save: { title: 'SAVED!', tone: 'stop' },
  post: { title: 'OFF THE WOODWORK', tone: 'warn' },
  miss: { title: 'MISSED', tone: 'warn' },
}

type Ending = { kind: 'won' | 'lost' | 'left' }

export function MatchStage({
  client,
  initialRole,
  opponentName,
  target,
  onExit,
}: {
  client: MatchClient
  initialRole: Role
  opponentName: string
  target: number
  onExit: (playAgain: boolean) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<Game | null>(null)
  const [game, setGame] = useState<Game | null>(null)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [role, setRole] = useState<Role>(initialRole)
  const [score, setScore] = useState({ you: 0, them: 0 })
  const [ending, setEnding] = useState<Ending | null>(null)

  // Spin up the engine once, wired to the socket.
  useEffect(() => {
    if (!canvasRef.current) return
    const game = new Game(canvasRef.current)
    gameRef.current = game
    setGame(game)
    game.enableOnline({
      shoot: (s) => client.send({ type: 'shoot', ...s }),
      dive: (d) => client.send({ type: 'dive', ...d }),
      result: (outcome) => client.send({ type: 'result', outcome }),
    })
    const off = game.subscribe(setGameState)
    game.init().then(() => game.beginRound(initialRole))
    return () => {
      off()
      game.dispose()
      gameRef.current = null
      setGame(null)
    }
  }, [client, initialRole])

  // Route inbound match messages into the engine and the HUD.
  useEffect(() => {
    const off = client.on((msg: ServerMessage) => {
      const game = gameRef.current
      switch (msg.type) {
        case 'shoot':
          game?.applyRemoteShoot(msg)
          break
        case 'dive':
          game?.applyRemoteDive(msg)
          break
        case 'round':
          setRole(msg.role)
          setScore({ you: msg.scoreYou, them: msg.scoreThem })
          game?.beginRound(msg.role)
          break
        case 'result':
          game?.applyRemoteResult(msg.outcome)
          setScore({ you: msg.scoreYou, them: msg.scoreThem })
          if (msg.matchOver) setEnding({ kind: msg.youWon ? 'won' : 'lost' })
          break
        case 'opponentLeft':
          setEnding({ kind: 'left' })
          break
      }
    })
    return off
  }, [client])

  const result = gameState?.outcome ? OUTCOME_TEXT[gameState.outcome] : null

  return (
    <div className="app">
      <canvas ref={canvasRef} className="stage" />

      <header className="hud top">
        <div className="brand">
          fot<span>ball</span>
        </div>

        <div className="scoreboard" aria-label="Match score">
          <div className="side you">
            <span className="who">You</span>
            <b>{score.you}</b>
          </div>
          <span className="vs">–</span>
          <div className="side them">
            <b>{score.them}</b>
            <span className="who">{opponentName}</span>
          </div>
        </div>

        <div className={`role-badge ${role}`}>
          {role === 'striker' ? '⚽ Striker' : '🧤 Keeper'}
        </div>
      </header>

      {result && !ending && (
        <div className={`banner ${result.tone}`} key={`${score.you}-${score.them}-${gameState?.outcome}`}>
          {result.title}
        </div>
      )}

      {gameState?.loading && <div className="banner">Loading…</div>}

      <footer className="hud bottom">
        <p className="hint">{roleHint(role, gameState?.phase)}</p>
        {role === 'striker' && game && <PowerMeter game={game} />}
      </footer>

      <p className="target-note">First to {target} goals wins</p>

      {ending && (
        <div className="overlay">
          <div className="card">
            <h2 className={ending.kind === 'won' ? 'win' : 'lose'}>
              {ending.kind === 'won' && 'You won! 🏆'}
              {ending.kind === 'lost' && 'You lost'}
              {ending.kind === 'left' && 'Opponent left'}
            </h2>
            {ending.kind !== 'left' && (
              <p className="final-score">
                {score.you} – {score.them}
              </p>
            )}
            <div className="card-actions">
              <button type="button" className="primary" onClick={() => onExit(true)}>
                Play again
              </button>
              <button type="button" className="ghost" onClick={() => onExit(false)}>
                Back to lounge
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function roleHint(role: Role, phase: string | undefined): string {
  if (role === 'striker') {
    if (phase === 'charging') return 'Release to shoot — slide sideways to bend it'
    if (phase === 'ready') return 'Your kick: aim with the mouse, hold to build power'
    if (phase === 'winding' || phase === 'flight') return 'Watch the keeper try to save it…'
    return ''
  }
  if (phase === 'ready') return 'Get ready — watch for the shot and dive to save it'
  if (phase === 'winding') return 'Read the run-up — dive to save it'
  if (phase === 'flight') return 'Dive! Click a spot or use Q W E / A S D'
  return ''
}
