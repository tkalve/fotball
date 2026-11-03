import { useState } from 'react'
import { CODE_COLORS, CODE_OBJECTS } from '../net/protocol'

export type OfferView = { opponentName: string; secondsLeft: number; accepted: boolean }

export function Lobby({
  connected,
  code,
  waiting,
  ready,
  offer,
  error,
  name,
  onName,
  onReady,
  onAccept,
  onDecline,
  onJoinCode,
}: {
  connected: boolean
  code: { color: string; object: string } | null
  waiting: number
  ready: boolean
  offer: OfferView | null
  error: string | null
  name: string
  onName: (name: string) => void
  onReady: () => void
  onAccept: () => void
  onDecline: () => void
  onJoinCode: (color: string, object: string) => void
}) {
  const [joinColor, setJoinColor] = useState('')
  const [joinObject, setJoinObject] = useState('')

  if (offer) {
    return (
      <div className="lobby">
        <div className="pair-card">
          <p className="eyebrow">Opponent found</p>
          <h1>
            Play against <span>{offer.opponentName}</span>?
          </h1>
          {offer.accepted ? (
            <p className="waiting-note">Waiting for them to say yes…</p>
          ) : (
            <p className="waiting-note">Both of you have to say yes to start.</p>
          )}
          <div className="countdown" role="timer">
            <div className="ring" style={{ '--p': offer.secondsLeft / 30 } as React.CSSProperties}>
              <b>{offer.secondsLeft}</b>
            </div>
          </div>
          {offer.accepted ? (
            <button type="button" className="ghost" onClick={onDecline}>
              Cancel
            </button>
          ) : (
            <div className="card-actions">
              <button type="button" className="primary big" onClick={onAccept}>
                Yes, let&rsquo;s play!
              </button>
              <button type="button" className="ghost" onClick={onDecline}>
                No thanks
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="lobby">
      <div className="lobby-card">
        <div className="brand big">
          fot<span>ball</span>
        </div>
        <p className="tagline">Two players, one penalty shootout.</p>

        <label className="name-field">
          <span>Your name</span>
          <input
            type="text"
            value={name}
            maxLength={20}
            placeholder="Player"
            onChange={(e) => onName(e.target.value)}
          />
        </label>

        {!connected ? (
          <p className="status-line">Connecting to the lounge…</p>
        ) : ready ? (
          <p className="status-line pulse">
            Looking for an opponent… {waiting > 1 ? `${waiting} players here` : 'you’re the only one here'}
          </p>
        ) : (
          <button type="button" className="primary big" onClick={onReady}>
            Find a match
          </button>
        )}

        {error && <p className="error-line">{error}</p>}

        {code && (
          <div className="code-block">
            <p className="eyebrow">Your secret code — share it with a friend</p>
            <div className="code-chip">
              <span className={`swatch ${code.color}`} />
              {code.color} {code.object}
            </div>
          </div>
        )}

        <div className="join-block">
          <p className="eyebrow">Got a friend’s code? Pick their colour and thing</p>
          <div className="join-row">
            <select value={joinColor} onChange={(e) => setJoinColor(e.target.value)}>
              <option value="">colour…</option>
              {CODE_COLORS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select value={joinObject} onChange={(e) => setJoinObject(e.target.value)}>
              <option value="">thing…</option>
              {CODE_OBJECTS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="primary"
              disabled={!joinColor || !joinObject}
              onClick={() => onJoinCode(joinColor, joinObject)}
            >
              Join
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
