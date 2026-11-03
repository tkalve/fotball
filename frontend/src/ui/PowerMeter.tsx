import { useEffect, useRef } from 'react'
import type { Game } from '../game/Game'

/**
 * The meter sweeps at 60 Hz, so it writes straight to the DOM instead of
 * pushing React state every frame.
 */
export function PowerMeter({ game }: { game: Game }) {
  const wrap = useRef<HTMLDivElement>(null)
  const fill = useRef<HTMLDivElement>(null)
  const curve = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const { power, charging, curve: c } = game.readPower()
      if (wrap.current) wrap.current.dataset.charging = String(charging)
      if (fill.current) {
        fill.current.style.transform = `scaleX(${power})`
        fill.current.style.background = `hsl(${(1 - power) * 110} 85% 52%)`
      }
      if (curve.current) curve.current.style.transform = `translateX(${c * 46}px)`
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [game])

  return (
    <div className="power" ref={wrap} data-charging="false">
      <div className="power-track">
        <div className="power-fill" ref={fill} />
      </div>
      <div className="curve-track">
        <span className="curve-label">bend</span>
        <div className="curve-knob" ref={curve} />
      </div>
    </div>
  )
}
