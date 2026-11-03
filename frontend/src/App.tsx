import { useEffect, useRef, useState } from 'react'
import { MatchClient } from './net/MatchClient'
import type { Role, ServerMessage } from './net/protocol'
import { Lobby, type OfferView } from './ui/Lobby'
import { MatchStage } from './ui/MatchStage'
import './index.css'

type MatchInfo = { role: Role; opponentName: string; target: number }

const NAME_KEY = 'fotball.name'

export default function App() {
  const clientRef = useRef<MatchClient | null>(null)
  const offerTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const [connected, setConnected] = useState(false)
  const [code, setCode] = useState<{ color: string; object: string } | null>(null)
  const [waiting, setWaiting] = useState(1)
  const [ready, setReady] = useState(false)
  const [offer, setOffer] = useState<OfferView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [match, setMatch] = useState<MatchInfo | null>(null)
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '')

  useEffect(() => {
    const client = new MatchClient(localStorage.getItem(NAME_KEY) ?? '')
    clientRef.current = client

    const offStatus = client.onStatus((s) => setConnected(s === 'open'))
    const off = client.on((msg: ServerMessage) => {
      switch (msg.type) {
        case 'welcome':
          setCode(msg.code)
          break
        case 'lounge':
          setWaiting(msg.waiting)
          setReady(msg.ready)
          break
        case 'offer':
          stopOfferTimer()
          setError(null)
          setOffer({ opponentName: msg.opponentName, secondsLeft: msg.seconds, accepted: false })
          offerTimer.current = setInterval(() => {
            setOffer((o) => (o ? { ...o, secondsLeft: Math.max(0, o.secondsLeft - 1) } : o))
          }, 1000)
          break
        case 'offerCancelled':
          stopOfferTimer()
          setOffer(null)
          setError(msg.reason)
          break
        case 'matchStart':
          stopOfferTimer()
          setOffer(null)
          setError(null)
          setMatch({ role: msg.role, opponentName: msg.opponentName, target: msg.target })
          break
        case 'error':
          setError(msg.message)
          break
      }
    })

    client.connect()
    return () => {
      offStatus()
      off()
      stopOfferTimer()
      client.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stopOfferTimer() {
    if (offerTimer.current) {
      clearInterval(offerTimer.current)
      offerTimer.current = null
    }
  }

  const changeName = (next: string) => {
    setName(next)
    localStorage.setItem(NAME_KEY, next)
    clientRef.current?.setName(next)
    clientRef.current?.send({ type: 'hello', name: next })
  }

  const exitMatch = (playAgain: boolean) => {
    setMatch(null)
    if (playAgain) clientRef.current?.send({ type: 'ready' })
  }

  if (match && clientRef.current) {
    return (
      <MatchStage
        client={clientRef.current}
        initialRole={match.role}
        opponentName={match.opponentName}
        target={match.target}
        onExit={exitMatch}
      />
    )
  }

  return (
    <Lobby
      connected={connected}
      code={code}
      waiting={waiting}
      ready={ready}
      offer={offer}
      error={error}
      name={name}
      onName={changeName}
      onReady={() => clientRef.current?.send({ type: 'ready' })}
      onAccept={() => {
        clientRef.current?.send({ type: 'accept' })
        setOffer((o) => (o ? { ...o, accepted: true } : o))
      }}
      onDecline={() => {
        clientRef.current?.send({ type: 'decline' })
        stopOfferTimer()
        setOffer(null)
      }}
      onJoinCode={(color, object) => clientRef.current?.send({ type: 'joinCode', color, object })}
    />
  )
}
