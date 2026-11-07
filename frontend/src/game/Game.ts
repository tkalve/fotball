import * as THREE from 'three'
import { Ball } from './Ball'
import { Keeper } from './Keeper'
import { Striker } from './Striker'
import { World } from './World'
import { solveShot } from './physics'
import { RUNUP_TIME } from './Striker'
import {
  BALL_RADIUS,
  GOAL_CROSSBAR_HEIGHT,
  MAX_CURVE,
  MAX_SHOT_SPEED,
  MIN_SHOT_SPEED,
  PENALTY_SPOT_Z,
  PHYSICS_STEP,
  POWER_SWEEP,
} from './constants'

export type Mode = 'striker' | 'keeper'
export type Phase = 'ready' | 'charging' | 'winding' | 'flight' | 'result'
export type Outcome = 'goal' | 'save' | 'post' | 'miss'

export type Stats = {
  striker: { shots: number; goals: number }
  keeper: { faced: number; saves: number }
}

export type GameState = {
  mode: Mode
  phase: Phase
  loading: boolean
  /** 0..1 while charging a shot. */
  power: number
  /** -1..1 sidespin the striker has dialled in. */
  curve: number
  outcome: Outcome | null
  stats: Stats
  hint: string
}

/** Outbound hooks the online layer wires up; null while playing offline. */
export type NetHooks = {
  shoot: (s: { target: { x: number; y: number }; speed: number; curve: number }) => void
  dive: (d: { x: number; y: number }) => void
  result: (outcome: Outcome) => void
}

const RESULT_HOLD = 1.9
const FLIGHT_TIMEOUT = 4.5

// Online only, on both ends: hold the ball on the spot for a wind-up (the keeper
// watches the striker's run-up and reads the tell), then play the opening of the
// shot in slow motion, easing back to real speed, so there is time to react.
const WINDUP_TIME = RUNUP_TIME
const SLOWMO_DURATION = 0.7
const SLOWMO_SCALE = 0.3

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export class Game {
  private renderer: THREE.WebGLRenderer
  private world: World
  private ball: Ball
  private keeper = new Keeper()
  private striker = new Striker()

  private strikerCam = new THREE.PerspectiveCamera(44, 1, 0.1, 500)
  private keeperCam = new THREE.PerspectiveCamera(55, 1, 0.1, 500)
  private camera = this.strikerCam

  private reticle: THREE.Group
  private ghost: THREE.Mesh

  private raycaster = new THREE.Raycaster()
  private goalPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
  private pointer = new THREE.Vector2()
  private pointerPx = new THREE.Vector2()
  private chargeStartPx = 0

  private aim = new THREE.Vector3(0, 1.1, 0)
  private shotTarget = new THREE.Vector3()
  private spin = new THREE.Vector3()

  private phase: Phase = 'ready'
  private mode: Mode = 'striker'
  private outcome: Outcome | null = null
  private powerT = 0
  private curve = 0
  private timer = 0
  private flightTime = 0
  private saved = false
  private aiDiveAt = Infinity
  private aiDiveTarget = new THREE.Vector2()
  private runUpDelay = 0

  private pendingShot: { target: THREE.Vector3; speed: number; curve: number } | null = null
  private windupTimer = 0
  private slowmoTime = 0

  private stats: Stats = {
    striker: { shots: 0, goals: 0 },
    keeper: { faced: 0, saves: 0 },
  }

  private online = false
  private net: NetHooks | null = null

  private listeners = new Set<(s: GameState) => void>()
  private loading = true
  private running = false
  private disposed = false
  private lastTime = 0
  private frame = 0
  private resizeObserver: ResizeObserver
  private canvas: HTMLCanvasElement
  private lookAt = new THREE.Vector3(0, 1.1, 0)

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05

    this.world = new World(this.renderer)
    this.ball = new Ball(this.renderer.capabilities.getMaxAnisotropy())

    this.world.scene.add(this.ball.mesh, this.ball.trail)
    this.world.scene.add(this.keeper.object, this.striker.object)

    this.reticle = makeReticle()
    this.ghost = makeGhost()
    this.world.scene.add(this.reticle, this.ghost)

    this.strikerCam.position.set(0, 2.5, PENALTY_SPOT_Z + 4.6)
    this.keeperCam.position.set(0, 4.3, -6.2)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas.parentElement ?? canvas)
    this.resize()

    this.bindInput()

    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).fotball = this
    }
  }

  /** Dev handle for poking at the scene from the console. */
  get debugScene() {
    return this.world.scene
  }

  async init() {
    const goal = await this.world.loadGoal(`${import.meta.env.BASE_URL}NewGoalll.glb`)
    if (this.disposed) return
    this.keeper.halfWidth = goal.innerHalfWidth
    this.loading = false
    this.resetRound()
    this.running = true
    this.lastTime = performance.now()
    this.frame = requestAnimationFrame(this.tick)
    this.emit()
  }

  dispose() {
    this.disposed = true
    this.running = false
    cancelAnimationFrame(this.frame)
    this.resizeObserver.disconnect()
    this.unbindInput()
    this.renderer.dispose()
  }

  subscribe(fn: (s: GameState) => void) {
    this.listeners.add(fn)
    fn(this.snapshot())
    return () => this.listeners.delete(fn)
  }

  setMode(mode: Mode) {
    if (mode === this.mode) return
    this.mode = mode
    this.camera = mode === 'striker' ? this.strikerCam : this.keeperCam
    this.resize()
    this.resetRound()
  }

  resetStats() {
    this.stats = { striker: { shots: 0, goals: 0 }, keeper: { faced: 0, saves: 0 } }
    this.emit()
  }

  // -------------------------------------------------------------------- online

  /** Switch the game into networked play. Disables all AI and local scoring. */
  enableOnline(hooks: NetHooks) {
    this.online = true
    this.net = hooks
  }

  /** The server assigns a role each round; strikers shoot, keepers dive. */
  beginRound(role: Mode) {
    this.mode = role
    this.camera = role === 'striker' ? this.strikerCam : this.keeperCam
    this.resize()
    this.resetRound()
  }

  /** Keeper side: the opponent's shot arrived — wind up, then launch in slow-mo. */
  applyRemoteShoot(shot: { target: { x: number; y: number }; speed: number; curve: number }) {
    if (!this.online || this.mode !== 'keeper' || this.phase !== 'ready') return
    this.beginWindup(new THREE.Vector3(shot.target.x, shot.target.y, 0), shot.speed, shot.curve)
  }

  /**
   * Online only: hold the ball for a wind-up before launching, shown on both
   * ends. The keeper watches the striker's run-up (leaning towards the shot) so
   * they can read it; the striker gets the matching beat so the save attempt
   * relayed back lands in time with the slow-motion flight.
   */
  private beginWindup(target: THREE.Vector3, speed: number, curve: number) {
    this.pendingShot = { target: target.clone(), speed, curve }
    this.phase = 'winding'
    this.slowmoTime = 0
    if (this.mode === 'keeper') {
      const bias = clamp(target.x / this.world.goal.innerHalfWidth, -1, 1)
      this.striker.reset(bias * 0.9)
      this.striker.beginRunUp()
    } else {
      this.windupTimer = WINDUP_TIME
    }
    this.emit()
  }

  /** Striker side: animate the opponent keeper committing to a dive. */
  applyRemoteDive(dive: { x: number; y: number }) {
    if (!this.online || this.mode !== 'striker') return
    this.keeper.dive(dive.x, dive.y)
  }

  /** Striker side: the keeper is authoritative, so take its outcome as truth. */
  applyRemoteResult(outcome: Outcome) {
    if (!this.online || this.mode !== 'striker') return
    this.finish(outcome)
  }

  // ---------------------------------------------------------------- round flow

  private resetRound() {
    this.phase = 'ready'
    this.outcome = null
    this.saved = false
    this.powerT = 0
    this.curve = 0
    this.timer = 0
    this.flightTime = 0
    this.aiDiveAt = Infinity
    this.pendingShot = null
    this.windupTimer = 0
    this.slowmoTime = 0
    this.ball.place(0, BALL_RADIUS, PENALTY_SPOT_Z)
    this.keeper.reset()
    this.aim.set(0, 1.1, 0)

    if (this.mode === 'keeper' && !this.online) {
      this.shotTarget.copy(this.pickAiShot())
      const bias = clamp(this.shotTarget.x / this.world.goal.innerHalfWidth, -1, 1)
      this.striker.reset(bias * (Math.random() < 0.75 ? 1 : -0.4))
      this.runUpDelay = 0.7 + Math.random() * 0.6
    } else {
      this.striker.object.visible = false
    }

    this.snapCamera()
    this.emit()
  }

  /** Where the computer striker aims: corners most of the time, but not always. */
  private pickAiShot() {
    const g = this.world.goal
    const side = Math.random() < 0.5 ? -1 : 1
    const corner = Math.random()
    let x: number
    let y: number
    if (corner < 0.16) {
      x = (Math.random() - 0.5) * g.innerHalfWidth * 0.7
      y = 0.3 + Math.random() * 0.9
    } else {
      x = side * g.innerHalfWidth * (0.52 + Math.random() * 0.42)
      y =
        corner < 0.62
          ? 0.25 + Math.random() * 0.55
          : g.innerHeight * (0.6 + Math.random() * 0.32)
    }
    return new THREE.Vector3(x, y, 0)
  }

  private launch(target: THREE.Vector3, speed: number, curve: number) {
    this.spin.set(0, -curve * 60, curve * 8)
    const vel = solveShot(this.ball.position, target, speed, this.spin)
    this.ball.velocity.copy(vel)
    this.ball.spin.copy(this.spin)
    this.ball.clearTrail()
    this.phase = 'flight'
    this.flightTime = 0
    this.saved = false
    this.outcome = null

    if (this.online) {
      // Score lives on the server; AI keeper stays out of networked rounds.
    } else if (this.mode === 'striker') {
      this.stats.striker.shots++
      this.planAiDive(target)
    } else {
      this.stats.keeper.faced++
    }
    this.emit()
  }

  /** The computer keeper reads the shot imperfectly and commits late. */
  private planAiDive(target: THREE.Vector3) {
    const g = this.world.goal
    const readsIt = Math.random() < 0.64
    const stayCentral = Math.random() < 0.08

    let x = target.x + (Math.random() - 0.5) * 1.0
    let y = target.y + (Math.random() - 0.5) * 0.9
    if (!readsIt) x = -target.x * (0.5 + Math.random() * 0.6)
    if (stayCentral) {
      x *= 0.25
      y = 1.0
    }

    this.aiDiveTarget.set(
      clamp(x, -g.innerHalfWidth - 0.2, g.innerHalfWidth + 0.2),
      clamp(y, 0.15, g.innerHeight),
    )
    this.aiDiveAt = 0.12 + Math.random() * 0.16
  }

  private finish(outcome: Outcome) {
    if (this.outcome) return
    this.outcome = outcome
    this.phase = 'result'
    this.timer = 0
    if (!this.online) {
      if (this.mode === 'striker' && outcome === 'goal') this.stats.striker.goals++
      if (this.mode === 'keeper' && outcome !== 'goal') this.stats.keeper.saves++
    }
    this.emit()
  }

  /**
   * Who decides the round. Offline, whoever is local decides. Online, the keeper
   * is the single authority and reports up; the striker only waits for that word.
   */
  private resolve(outcome: Outcome) {
    if (this.online && this.mode === 'striker') return
    this.finish(outcome)
    if (this.online && this.mode === 'keeper') this.net?.result(outcome)
  }

  // ------------------------------------------------------------------ the loop

  private tick = (now: number) => {
    if (!this.running) return
    this.frame = requestAnimationFrame(this.tick)

    const dt = Math.min(0.05, (now - this.lastTime) / 1000)
    this.lastTime = now
    this.update(dt)
    this.renderer.render(this.world.scene, this.camera)
  }

  private update(dt: number) {
    if (this.loading) return

    if (this.phase === 'charging') {
      // Ping-pong so overshooting the meter costs you power.
      this.powerT = (this.powerT + dt / POWER_SWEEP) % 2
    }

    // Online wind-up: the ball waits on the spot before launching. On the keeper
    // the striker's run-up drives the timing (and gives the tell to read); on the
    // striker a plain timer keeps both ends roughly in step. The wind-up itself
    // plays at real speed.
    if (this.phase === 'winding' && this.pendingShot) {
      const contact =
        this.mode === 'keeper' ? this.striker.update(dt) : (this.windupTimer -= dt) <= 0
      if (contact) {
        const s = this.pendingShot
        this.pendingShot = null
        this.slowmoTime = 0
        this.launch(s.target, s.speed, s.curve)
      }
    }

    // Both ends read the opening of the shot in slow motion, ramping back up to
    // real speed; everything shares one time scale so it stays coherent.
    let scale = 1
    if (this.online && this.phase === 'flight') {
      this.slowmoTime += dt
      scale = SLOWMO_SCALE + (1 - SLOWMO_SCALE) * clamp(this.slowmoTime / SLOWMO_DURATION, 0, 1)
    }
    const sdt = dt * scale

    if (this.mode === 'keeper' && this.phase === 'ready' && !this.online) {
      this.runUpDelay -= dt
      if (this.runUpDelay <= 0) this.striker.beginRunUp()
      if (this.striker.update(dt)) {
        const speed = MIN_SHOT_SPEED + Math.random() * (MAX_SHOT_SPEED - MIN_SHOT_SPEED)
        this.launch(this.shotTarget, speed, (Math.random() - 0.5) * 1.1)
      }
    } else if (this.mode === 'keeper' && !this.online) {
      this.striker.update(dt)
    } else if (this.mode === 'keeper' && this.online && this.phase !== 'winding') {
      // Keep the striker's follow-through alive, slowed with the rest of the shot.
      this.striker.update(sdt)
    }

    if (this.phase === 'flight') {
      this.flightTime += sdt
      if (!this.online && this.mode === 'striker' && this.flightTime >= this.aiDiveAt) {
        this.keeper.dive(this.aiDiveTarget.x, this.aiDiveTarget.y)
        this.aiDiveAt = Infinity
      }
      this.stepFlight(sdt)
      if (!this.outcome && this.flightTime > FLIGHT_TIMEOUT) this.resolve('miss')
    }

    this.keeper.update(sdt)

    if (this.phase === 'result') {
      this.timer += dt
      this.stepFlight(dt)
      // Online, the server decides when the next round starts.
      if (this.timer > RESULT_HOLD && !this.online) this.resetRound()
    }

    this.updateMarkers()
    this.updateCamera(sdt)
    this.world.focusShadows(clamp(this.ball.position.z, 0, 12))
  }

  private stepFlight(dt: number) {
    let remaining = dt
    while (remaining > 0) {
      const h = Math.min(PHYSICS_STEP, remaining)
      remaining -= h

      const prevZ = this.ball.position.z
      const prevX = this.ball.position.x
      const prevY = this.ball.position.y
      this.ball.step(h)

      if (!this.saved && this.checkKeeper()) continue
      if (prevZ > 0 && this.ball.position.z <= 0) {
        this.checkGoalPlane(prevX, prevY, prevZ)
      }
      this.holdInNet()
    }
    this.ball.applyRotation(dt)
    if (this.ball.velocity.lengthSq() > 1) this.ball.pushTrail()
  }

  private _hit = new THREE.Vector3()

  private checkKeeper() {
    const p = this.ball.position
    if (p.z > 2.5 || p.z < -0.9) return false

    for (const s of this.keeper.hitSpheres) {
      const c = s.node.getWorldPosition(this._hit)
      const r = s.radius + BALL_RADIUS
      const d2 = c.distanceToSquared(p)
      if (d2 > r * r) continue

      const n = p.clone().sub(c)
      if (n.lengthSq() < 1e-6) n.set(0, 0, 1)
      n.normalize()
      p.copy(c).addScaledVector(n, r + 0.001)
      this.ball.velocity.reflect(n).multiplyScalar(0.42)
      // A parried ball should never dribble back towards the line.
      if (this.ball.velocity.z < 1) this.ball.velocity.z = 1 + Math.random() * 3
      this.ball.spin.multiplyScalar(0.2)
      this.saved = true
      this.resolve('save')
      return true
    }
    return false
  }

  private checkGoalPlane(prevX: number, prevY: number, prevZ: number) {
    const p = this.ball.position
    const f = prevZ / (prevZ - p.z)
    const x = prevX + (p.x - prevX) * f
    const y = prevY + (p.y - prevY) * f
    const g = this.world.goal

    const insideX = Math.abs(x) < g.innerHalfWidth - BALL_RADIUS * 0.3
    const insideY = y < g.innerHeight - BALL_RADIUS * 0.3
    if (insideX && insideY && y > 0) {
      this.resolve('goal')
      return
    }

    const framedX = Math.abs(x) < g.outerHalfWidth + BALL_RADIUS
    const framedY = y > 0 && y < GOAL_CROSSBAR_HEIGHT + BALL_RADIUS
    if (framedX && framedY) {
      p.z = BALL_RADIUS * 0.5
      this.ball.velocity.z = Math.abs(this.ball.velocity.z) * 0.55
      this.ball.velocity.x *= 0.6
      this.ball.spin.multiplyScalar(0.3)
      this.resolve('post')
      return
    }

    this.resolve('miss')
  }

  /** Stops a scored ball from flying out through the back of the net. */
  private holdInNet() {
    const p = this.ball.position
    const g = this.world.goal
    if (p.z > -0.05 || Math.abs(p.x) > g.innerHalfWidth) return
    const back = -(g.depth - 0.2)
    if (p.z < back) {
      p.z = back
      this.ball.velocity.z = Math.abs(this.ball.velocity.z) * 0.2
    }
    this.ball.velocity.multiplyScalar(0.94)
  }

  // ----------------------------------------------------------------- presentation

  private updateMarkers() {
    const aimingShot = this.mode === 'striker' && (this.phase === 'ready' || this.phase === 'charging')
    this.reticle.visible = aimingShot
    if (aimingShot) {
      this.reticle.position.set(this.aim.x, this.aim.y, 0.06)
      const t = this.powerLevel()
      const s = 0.85 + t * 0.5
      this.reticle.scale.setScalar(s)
      const mat = (this.reticle.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial
      mat.color.setHSL(0.33 - t * 0.33, 0.85, 0.55)
    }

    const aimingDive =
      this.mode === 'keeper' && !this.keeper.hasCommitted && this.phase !== 'result'
    this.ghost.visible = aimingDive
    if (aimingDive) this.ghost.position.set(this.aim.x, this.aim.y, 0.06)
  }

  /** Jumps the camera to its resting framing instead of easing into it. */
  private snapCamera() {
    this.lookAt.copy(
      this.mode === 'striker' ? _tmpVec.set(0, 0.6, 0.4) : _tmpVec.set(0, 1, 4),
    )
    this.updateCamera(5)
    this.camera.updateMatrixWorld()
  }

  private updateCamera(dt: number) {
    const k = 1 - Math.exp(-dt * 4)
    if (this.mode === 'striker') {
      const chasing = this.phase === 'flight' || this.phase === 'result'
      const targetX = chasing ? this.ball.position.x * 0.45 : this.aim.x * 0.1
      const targetY = chasing ? 2.5 + this.ball.position.y * 0.16 : 2.5
      this.strikerCam.position.x += (targetX - this.strikerCam.position.x) * k
      this.strikerCam.position.y += (targetY - this.strikerCam.position.y) * k
      // Off the shot, the view only leans towards the reticle rather than following it.
      const look = chasing
        ? this.ball.position
        : _tmpVec.set(this.aim.x * 0.3, 0.6 + (this.aim.y - 1.1) * 0.25, 0.4)
      this.lookAt.lerp(look, k)
      this.strikerCam.lookAt(this.lookAt)
    } else {
      const chasing = this.phase === 'flight' || this.phase === 'result'
      this.lookAt.lerp(
        chasing ? this.ball.position : _tmpVec.set(0, 1, 4),
        k * 0.8,
      )
      this.keeperCam.position.x +=
        (this.keeper.object.position.x * 0.18 - this.keeperCam.position.x) * k
      this.keeperCam.position.y += (4.3 - this.keeperCam.position.y) * k
      this.keeperCam.lookAt(this.lookAt)
    }
  }

  private powerLevel() {
    return this.powerT <= 1 ? this.powerT : 2 - this.powerT
  }

  private resize() {
    const host = this.canvas.parentElement
    const w = host?.clientWidth || this.canvas.clientWidth || 1
    const h = host?.clientHeight || this.canvas.clientHeight || 1
    this.renderer.setSize(w, h, false)
    for (const cam of [this.strikerCam, this.keeperCam]) {
      cam.aspect = w / h
      cam.updateProjectionMatrix()
    }
  }

  // ----------------------------------------------------------------------- input

  private bindInput() {
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('keydown', this.onKeyDown)
  }

  private unbindInput() {
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('keydown', this.onKeyDown)
  }

  private onPointerMove = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect()
    this.pointerPx.set(e.clientX - r.left, e.clientY - r.top)
    this.pointer.set((this.pointerPx.x / r.width) * 2 - 1, -(this.pointerPx.y / r.height) * 2 + 1)
    this.updateAim()

    if (this.phase === 'charging') {
      this.curve = clamp((this.pointerPx.x - this.chargeStartPx) / (r.width * 0.22), -1, 1) * MAX_CURVE
      this.emit()
    }
  }

  private updateAim() {
    // Pointer events can land before the first frame of a new mode, when the
    // camera's world matrix is still from the one we switched away from.
    this.camera.updateMatrixWorld()
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.ray.intersectPlane(this.goalPlane, _tmpVec)
    if (!hit) return
    const g = this.world.goal
    if (this.mode === 'striker') {
      this.aim.set(
        clamp(hit.x, -g.outerHalfWidth - 1.1, g.outerHalfWidth + 1.1),
        clamp(hit.y, 0.08, g.innerHeight + 1.1),
        0,
      )
    } else {
      this.aim.set(
        clamp(hit.x, -g.innerHalfWidth - 0.15, g.innerHalfWidth + 0.15),
        clamp(hit.y, 0.12, g.innerHeight),
        0,
      )
    }
  }

  private onPointerDown = (e: PointerEvent) => {
    if (this.loading) return
    const r = this.canvas.getBoundingClientRect()
    this.pointerPx.set(e.clientX - r.left, e.clientY - r.top)
    this.pointer.set((this.pointerPx.x / r.width) * 2 - 1, -(this.pointerPx.y / r.height) * 2 + 1)
    this.updateAim()

    if (this.mode === 'striker') {
      if (this.phase !== 'ready') return
      this.phase = 'charging'
      this.powerT = 0
      this.curve = 0
      this.chargeStartPx = this.pointerPx.x
      this.emit()
    } else {
      if (this.keeper.hasCommitted) return
      this.keeper.dive(this.aim.x, this.aim.y)
      if (this.online) this.net?.dive({ x: this.aim.x, y: this.aim.y })
      this.emit()
    }
  }

  private onPointerUp = () => {
    if (this.mode !== 'striker' || this.phase !== 'charging') return
    const power = this.powerLevel()
    const speed = MIN_SHOT_SPEED + power * (MAX_SHOT_SPEED - MIN_SHOT_SPEED)
    this.shotTarget.copy(this.aim)
    if (this.online) {
      this.net?.shoot({
        target: { x: this.shotTarget.x, y: this.shotTarget.y },
        speed,
        curve: this.curve,
      })
      this.beginWindup(this.shotTarget, speed, this.curve)
    } else {
      this.launch(this.shotTarget, speed, this.curve)
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.mode !== 'keeper' || this.keeper.hasCommitted) return
    const g = this.world.goal
    const map: Record<string, [number, number]> = {
      a: [-g.innerHalfWidth, 0.4],
      ArrowLeft: [-g.innerHalfWidth, 0.4],
      d: [g.innerHalfWidth, 0.4],
      ArrowRight: [g.innerHalfWidth, 0.4],
      q: [-g.innerHalfWidth, g.innerHeight * 0.9],
      e: [g.innerHalfWidth, g.innerHeight * 0.9],
      w: [0, g.innerHeight * 0.9],
      ArrowUp: [0, g.innerHeight * 0.9],
      s: [0, 0.4],
      ArrowDown: [0, 0.4],
    }
    const t = map[e.key]
    if (!t) return
    e.preventDefault()
    this.keeper.dive(t[0], t[1])
    if (this.online) this.net?.dive({ x: t[0], y: t[1] })
    this.emit()
  }

  // ----------------------------------------------------------------------- state

  private snapshot(): GameState {
    return {
      mode: this.mode,
      phase: this.phase,
      loading: this.loading,
      power: this.powerLevel(),
      curve: this.curve,
      outcome: this.outcome,
      stats: {
        striker: { ...this.stats.striker },
        keeper: { ...this.stats.keeper },
      },
      hint: this.hint(),
    }
  }

  private hint() {
    if (this.loading) return 'Loading the goal…'
    if (this.mode === 'striker') {
      if (this.phase === 'charging') return 'Release to shoot — slide sideways to bend it'
      if (this.phase === 'ready') return 'Aim with the mouse, hold to build power'
      if (this.phase === 'winding' || this.phase === 'flight') return 'Watch the keeper try to save it…'
      return ''
    }
    if (this.phase === 'winding') return 'Read the run-up — dive to save it'
    if (this.phase === 'ready') return 'Pick your spot and click to dive — or use Q W E / A S D'
    return ''
  }

  private emit() {
    const s = this.snapshot()
    for (const fn of this.listeners) fn(s)
  }

  /** The power meter animates every frame, so it gets its own cheap read. */
  readPower() {
    return { power: this.powerLevel(), charging: this.phase === 'charging', curve: this.curve }
  }
}

const _tmpVec = new THREE.Vector3()

function makeReticle() {
  const g = new THREE.Group()
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.1, 0.135, 28),
    new THREE.MeshBasicMaterial({ color: 0x5fe08a, transparent: true, opacity: 0.95, depthTest: false }),
  )
  ring.renderOrder = 10
  g.add(ring)

  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(0.03, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }),
  )
  dot.renderOrder = 10
  g.add(dot)
  return g
}

function makeGhost() {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.16, 0.21, 24),
    new THREE.MeshBasicMaterial({ color: 0x8be0ff, transparent: true, opacity: 0.7, depthTest: false }),
  )
  m.renderOrder = 10
  return m
}
