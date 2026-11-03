import * as THREE from 'three'
import { DRAG_K, GRAVITY, MAGNUS_K } from './constants'

const _p = new THREE.Vector3()
const _v = new THREE.Vector3()
const _a = new THREE.Vector3()
const _c = new THREE.Vector3()

export type Crossing = { x: number; y: number; t: number }

/**
 * Flies a ball forward until it reaches `planeZ`, ignoring everything it might
 * hit on the way. Returns null if it never gets there.
 */
export function simulateCrossing(
  start: THREE.Vector3,
  velocity: THREE.Vector3,
  spin: THREE.Vector3,
  planeZ: number,
  dt = 1 / 240,
  maxTime = 4,
): Crossing | null {
  _p.copy(start)
  _v.copy(velocity)

  for (let t = 0; t < maxTime; t += dt) {
    const prevZ = _p.z
    const prevX = _p.x
    const prevY = _p.y

    const speed = _v.length()
    _a.set(0, -GRAVITY, 0)
    if (speed > 0.001) {
      _a.addScaledVector(_v, -DRAG_K * speed)
      _a.addScaledVector(_c.copy(spin).cross(_v), MAGNUS_K)
    }
    _v.addScaledVector(_a, dt)
    _p.addScaledVector(_v, dt)

    if (prevZ > planeZ && _p.z <= planeZ) {
      const f = (prevZ - planeZ) / (prevZ - _p.z)
      return {
        x: prevX + (_p.x - prevX) * f,
        y: prevY + (_p.y - prevY) * f,
        t: t + dt * f,
      }
    }
  }
  return null
}

/**
 * Finds the launch velocity that puts the ball on `target` at the given speed,
 * by repeatedly flying the shot and nudging the aim by whatever it missed by.
 * Because the solve includes drag and swerve, the reticle never lies.
 */
export function solveShot(
  start: THREE.Vector3,
  target: THREE.Vector3,
  speed: number,
  spin: THREE.Vector3,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const aim = target.clone()
  const LIMIT = 4

  for (let i = 0; i < 6; i++) {
    out.subVectors(aim, start).normalize().multiplyScalar(speed)
    const hit = simulateCrossing(start, out, spin, target.z)
    if (!hit) break
    const ex = target.x - hit.x
    const ey = target.y - hit.y
    // Stay near the target so a pathological spin cannot send the aim off to infinity.
    aim.x = THREE.MathUtils.clamp(aim.x + ex, target.x - LIMIT, target.x + LIMIT)
    aim.y = THREE.MathUtils.clamp(aim.y + ey, target.y - LIMIT, target.y + LIMIT)
    if (Math.abs(ex) < 0.005 && Math.abs(ey) < 0.005) break
  }

  return out.subVectors(aim, start).normalize().multiplyScalar(speed)
}
