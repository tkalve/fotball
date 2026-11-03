import { useEffect, useRef, useState } from 'react'
import { Game, type GameState, type Mode } from './game/Game'
import { PowerMeter } from './ui/PowerMeter'
import './index.css'

const OUTCOME_TEXT: Record<string, { title: string; tone: string }> = {
  goal: { title: 'GOAL!', tone: 'good' },
  save: { title: 'SAVED', tone: 'stop' },
  post: { title: 'OFF THE WOODWORK', tone: 'warn' },
  miss: { title: 'MISSED', tone: 'warn' },
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [game, setGame] = useState<Game | null>(null)
  const [state, setState] = useState<GameState | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    const g = new Game(canvasRef.current)
    const off = g.subscribe(setState)
    g.init()
    setGame(g)
    return () => {
      off()
      g.dispose()
    }
  }, [])

  const mode = state?.mode ?? 'striker'
  const attempts =
    mode === 'striker' ? state?.stats.striker.shots : state?.stats.keeper.faced
  const result = state?.outcome ? OUTCOME_TEXT[state.outcome] : null

  const pick = (m: Mode) => game?.setMode(m)

  return (
    <div className="app">
      <canvas ref={canvasRef} className="stage" />

      <header className="hud top">
        <div className="brand">
          Go<span>all</span>
        </div>

        <div className="switch" role="tablist" aria-label="Player role">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'striker'}
            className={mode === 'striker' ? 'on' : ''}
            onClick={() => pick('striker')}
          >
            Striker
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'keeper'}
            className={mode === 'keeper' ? 'on' : ''}
            onClick={() => pick('keeper')}
          >
            Keeper
          </button>
        </div>

        <button
          type="button"
          className="score"
          title="Reset the tally"
          onClick={() => game?.resetStats()}
        >
          {mode === 'striker' ? (
            <>
              <b>{state?.stats.striker.goals ?? 0}</b>
              <span>
                scored of {state?.stats.striker.shots ?? 0}
              </span>
            </>
          ) : (
            <>
              <b>{state?.stats.keeper.saves ?? 0}</b>
              <span>saved of {state?.stats.keeper.faced ?? 0}</span>
            </>
          )}
        </button>
      </header>

      {result && (
        <div className={`banner ${result.tone}`} key={`${attempts}-${state?.outcome}`}>
          {result.title}
        </div>
      )}

      {state?.loading && <div className="banner">Loading…</div>}

      <footer className="hud bottom">
        <p className="hint">{state?.hint}</p>
        {mode === 'striker' && game && <PowerMeter game={game} />}
        {mode === 'keeper' && (
          <p className="hint small">Watch the run-up. Commit too early and you are beaten.</p>
        )}
      </footer>

      <p className="offline">Local practice — online matches come later.</p>
    </div>
  )
}
