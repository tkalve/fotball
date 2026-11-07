import * as THREE from 'three'
import { KEEPER_Z, KIT_KEEPER } from './constants'
import {
  ARM_LENGTH,
  aimLimb,
  createFigure,
  swingLimb,
  type Figure,
  type HitSphere,
} from './Figure'

const DIVE_TIME = 0.42
/** How far the keeper may throw the whole body after the lean runs out. */
const MAX_LUNGE = 0.55

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

export class Keeper {
  readonly figure: Figure
  readonly object: THREE.Group

  /** Where the gloves are being thrown, on the goal plane. */
  /** Half the clear width of the goal, so the lean scales with the mouth. */
  halfWidth = 1.8

  private target = new THREE.Vector3()
  private diving = false
  private elapsed = 0
  private clock = 0
  private readyX = 0

  private _lead = new THREE.Vector3()
  private _trail = new THREE.Vector3()
  private _shoulder = new THREE.Vector3()
  private _lunge = new THREE.Vector3()

  constructor() {
    this.figure = createFigure(KIT_KEEPER, 0x0d3b2a, 0xffd24a)
    this.object = this.figure.root
    this.object.position.set(0, 0, KEEPER_Z)
    this.reset()
  }

  get hitSpheres(): HitSphere[] {
    return this.figure.hitSpheres
  }

  get hasCommitted() {
    return this.diving
  }

  get diveTarget() {
    return this.target
  }

  reset() {
    this.diving = false
    this.elapsed = 0
    this.readyX = 0
    this.target.set(0, 1.1, 0)
    this.pose(0)
  }

  /** Slide along the line towards `x` while still set, before committing. */
  setReadyAim(x: number) {
    if (this.diving) return
    const lim = this.halfWidth * 0.75
    this.readyX = Math.max(-lim, Math.min(lim, x * 0.75))
  }

  dive(x: number, y: number) {
    if (this.diving) return
    this.target.set(x, y, 0)
    this.diving = true
    this.elapsed = 0
  }

  update(dt: number) {
    this.clock += dt
    if (this.diving) this.elapsed += dt
    const p = this.diving ? Math.min(1, this.elapsed / DIVE_TIME) : 0
    this.pose(easeOutCubic(p))
  }

  private pose(s: number) {
    const f = this.figure
    const tx = this.target.x
    const ty = this.target.y

    const lift = Math.max(0, Math.min(0.62, (ty - 1.1) * 0.6))
    const lowness = 1 - Math.min(1, Math.max(0, ty / 2.3)) * 0.3
    const tilt = Math.max(-1.1, Math.min(1.1, tx / this.halfWidth)) * 0.95 * lowness

    this.object.position.set(this.readyX * (1 - s), lift * s, KEEPER_Z + 0.2 * s)
    f.body.rotation.z = -tilt * s
    f.body.rotation.x = -0.12 * s

    const bob = this.diving ? 0 : Math.sin(this.clock * 3.1) * 0.015
    f.hips.position.y = 0.92 - 0.1 * (1 - s) + bob - 0.08 * s

    if (s < 0.001) {
      // Set position: crouched, arms wide, weight on the toes.
      swingLimb(f.shoulders[0], -0.28, -0.62)
      swingLimb(f.shoulders[1], -0.28, 0.62)
      swingLimb(f.legs[0], 0.1, -0.24)
      swingLimb(f.legs[1], 0.1, 0.24)
      this.object.updateMatrixWorld(true)
      return
    }

    this.object.updateMatrixWorld(true)

    const side = tx >= 0 ? 1 : 0
    this._lead.set(tx, ty, 0.05)

    // The lean alone covers most of the goal. Whatever is still out of reach is
    // made up by throwing the body after it, which is what caps the keeper's span.
    const shoulder = f.shoulders[side].getWorldPosition(this._shoulder)
    const gap = this._lead.distanceTo(shoulder) - ARM_LENGTH * 1.08
    if (gap > 0) {
      this._lunge.subVectors(this._lead, shoulder).normalize()
      this.object.position.addScaledVector(this._lunge, Math.min(gap, MAX_LUNGE) * s)
      this.object.position.y = Math.max(0, this.object.position.y)
      this.object.updateMatrixWorld(true)
    }

    const away = Math.sign(tx || 1)
    this._trail.set(tx - away * 0.3, ty - 0.22, -0.08)
    aimLimb(f.shoulders[side], this._lead)
    aimLimb(f.shoulders[1 - side], this._trail)

    // Legs trail the dive and tuck up on high saves.
    const tuck = 0.2 + 0.7 * Math.min(1, Math.max(0, ty / 2.3))
    swingLimb(f.legs[side], tuck * s, -away * 0.3 * s)
    swingLimb(f.legs[1 - side], (tuck + 0.35) * s, -away * 0.1 * s)

    this.object.updateMatrixWorld(true)
  }
}
