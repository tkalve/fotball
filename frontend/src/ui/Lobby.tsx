import type { LoungePlayer } from '../net/protocol'

export type OfferView = { opponentName: string; secondsLeft: number; accepted: boolean }

export function Lobby({
  connected,
  players,
  offer,
  error,
  name,
  onName,
  onInvite,
  onAccept,
  onDecline,
}: {
  connected: boolean
  players: LoungePlayer[]
  offer: OfferView | null
  error: string | null
  name: string
  onName: (name: string) => void
  onInvite: (id: string) => void
  onAccept: () => void
  onDecline: () => void
}) {
  if (offer) {
    return (
      <div className="lobby">
        <div className="pair-card">
          <p className="eyebrow">{offer.accepted ? 'Invite sent' : 'You’re invited'}</p>
          <h1>
            Play against <span>{offer.opponentName}</span>?
          </h1>
          {offer.accepted ? (
            <p className="waiting-note">Waiting for them to say yes…</p>
          ) : (
            <p className="waiting-note">Say yes to kick off.</p>
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

        {error && <p className="error-line">{error}</p>}

        <div className="players-block">
          <p className="eyebrow">Players online</p>
          {!connected ? (
            <p className="status-line">Connecting to the lounge…</p>
          ) : players.length === 0 ? (
            <p className="status-line">No one else is here yet. Keep this open and wait for a friend.</p>
          ) : (
            <ul className="player-list">
              {players.map((p) => (
                <li key={p.id} className={p.busy ? 'player-row busy' : 'player-row'}>
                  <span className="player-name">{p.name}</span>
                  {p.busy ? (
                    <span className="player-tag">In a game</span>
                  ) : (
                    <button type="button" className="primary" onClick={() => onInvite(p.id)}>
                      Invite
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
