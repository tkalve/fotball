import * as THREE from 'three'
import { KIT_STRIKER, PENALTY_SPOT_Z } from './constants'
import { createFigure, swingLimb, type Figure } from './Figure'

const RUNUP_TIME = 1.15
const FOLLOW_TIME = 0.6
/** Which foot swings; the other one plants beside the ball. */
const KICK_LEG = 0

export class Striker {
  readonly figure: Figure
  readonly object: THREE.Group

  private start = new THREE.Vector3()
  private plant = new THREE.Vector3(0.32, 0, PENALTY_SPOT_Z + 0.12)
  private t = 0
  private running = false
  private contacted = false
  private leanBias = 0

  constructor() {
    this.figure = createFigure(KIT_STRIKER, 0x2a2f45, 0xd9a06a)
    this.object = this.figure.root
    this.object.rotation.y = Math.PI
    this.reset(0)
  }

  /** `bias` in [-1, 1] hints at the side the shot is going — a readable tell. */
  reset(bias: number) {
    this.running = false
    this.contacted = false
    this.t = 0
    this.leanBias = Math.max(-1, Math.min(1, bias))
    this.start.set(-this.leanBias * 0.9, 0, PENALTY_SPOT_Z + 3.3)
    this.object.position.copy(this.start)
    this.object.visible = true
    this.pose(0)
  }

  beginRunUp() {
    if (this.running) return
    this.running = true
    this.t = 0
  }

  /** Recolour the shirt so a player's colour follows them across role swaps. */
  setKit(color: number) {
    this.figure.shirt.color.setHex(color)
  }

  /**
   * Idle a few steps back from the ball before the run-up, leaning and turning
   * towards `aimX` so the stance reads as a getting-ready tell.
   */
  ready(aimX: number, halfWidth: number) {
    if (this.running) return
    this.reset(aimX / halfWidth)
  }

  get runUpProgress() {
    return Math.min(1, this.t / RUNUP_TIME)
  }

  /** True on the single frame the boot meets the ball. */
  update(dt: number) {
    if (!this.running) {
      this.pose(0)
      return false
    }
    const was = this.t
    this.t += dt
    this.pose(this.t)
    if (!this.contacted && was < RUNUP_TIME && this.t >= RUNUP_TIME) {
      this.contacted = true
      return true
    }
    return false
  }

  private pose(t: number) {
    const f = this.figure

    if (!this.running) {
      // Getting-ready stance: stand a few steps back and lean/turn towards the
      // aim rather than sliding bodily across.
      this.object.position.copy(this.start)
      this.object.rotation.y = Math.PI + this.leanBias * 0.5
      f.body.rotation.x = 0.03
      f.body.rotation.z = -this.leanBias * 0.34
      swingLimb(f.legs[0], 0.06, -0.2)
      swingLimb(f.legs[1], 0.06, 0.2)
      swingLimb(f.shoulders[0], -0.12, -0.34)
      swingLimb(f.shoulders[1], -0.12, 0.34)
      f.hips.position.y = 0.92
      this.object.updateMatrixWorld(true)
      return
    }

    const run = Math.min(1, t / RUNUP_TIME)

    // Accelerate into the ball rather than gliding at a constant speed.
    const travel = run * run * (3 - 2 * run)
    this.object.position.lerpVectors(this.start, this.plant, travel)
    this.object.rotation.y = Math.PI - (this.start.x - this.plant.x) * 0.18 * (1 - run)

    f.body.rotation.x = -0.1 * run
    f.body.rotation.z = 0

    if (t < RUNUP_TIME) {
      // Three strides, then a big backswing on the last one.
      const stride = Math.sin(run * Math.PI * 5.5)
      const windUp = Math.max(0, (run - 0.62) / 0.38)
      swingLimb(f.legs[KICK_LEG], stride * 0.55 + windUp * 1.0)
      swingLimb(f.legs[1 - KICK_LEG], -stride * 0.55)
      swingLimb(f.shoulders[0], -stride * 0.5, -0.18)
      swingLimb(f.shoulders[1], stride * 0.5, 0.18)
      f.hips.position.y = 0.92 + Math.abs(stride) * 0.025
    } else {
      const after = Math.min(1, (t - RUNUP_TIME) / FOLLOW_TIME)
      swingLimb(f.legs[KICK_LEG], -0.5 - after * 0.75)
      swingLimb(f.legs[1 - KICK_LEG], 0.18)
      swingLimb(f.shoulders[0], 0.55 - after * 0.2, -0.75)
      swingLimb(f.shoulders[1], -0.3, 0.9)
      f.body.rotation.x = -0.1 - after * 0.12
      f.hips.position.y = 0.92 - after * 0.04
    }

    this.object.updateMatrixWorld(true)
  }
}
