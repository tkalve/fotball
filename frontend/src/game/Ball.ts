import * as THREE from 'three'
import {
  BALL_RADIUS,
  DRAG_K,
  GRAVITY,
  GROUND_FRICTION,
  GROUND_RESTITUTION,
  MAGNUS_K,
} from './constants'
import { makeBallTexture } from './textures'

const TRAIL_POINTS = 90

const _acc = new THREE.Vector3()
const _tmp = new THREE.Vector3()
const _axis = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

export class Ball {
  readonly mesh: THREE.Mesh
  readonly trail: THREE.Line
  readonly position = new THREE.Vector3()
  readonly velocity = new THREE.Vector3()
  /** Angular velocity in rad/s; only the Magnus force reads it. */
  readonly spin = new THREE.Vector3()

  private trailPositions = new Float32Array(TRAIL_POINTS * 3)
  private trailCount = 0

  constructor(anisotropy: number) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 40, 28),
      new THREE.MeshStandardMaterial({
        map: makeBallTexture(anisotropy),
        roughness: 0.42,
        metalness: 0.02,
      }),
    )
    this.mesh.castShadow = true

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3))
    geo.setDrawRange(0, 0)
    this.trail = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32 }),
    )
    this.trail.frustumCulled = false
  }

  place(x: number, y: number, z: number) {
    this.position.set(x, y, z)
    this.velocity.set(0, 0, 0)
    this.spin.set(0, 0, 0)
    this.mesh.position.copy(this.position)
    this.mesh.quaternion.identity()
    this.clearTrail()
  }

  clearTrail() {
    this.trailCount = 0
    this.trail.geometry.setDrawRange(0, 0)
  }

  pushTrail() {
    if (this.trailCount >= TRAIL_POINTS) {
      this.trailPositions.copyWithin(0, 3)
      this.trailCount = TRAIL_POINTS - 1
    }
    this.position.toArray(this.trailPositions, this.trailCount * 3)
    this.trailCount++
    this.trail.geometry.setDrawRange(0, this.trailCount)
    this.trail.geometry.attributes.position.needsUpdate = true
  }

  /** One fixed physics substep: gravity, quadratic drag, Magnus, ground bounce. */
  step(dt: number) {
    const v = this.velocity
    const speed = v.length()

    _acc.set(0, -GRAVITY, 0)
    if (speed > 0.001) {
      _acc.addScaledVector(v, -DRAG_K * speed)
      _acc.addScaledVector(_tmp.copy(this.spin).cross(v), MAGNUS_K)
    }

    v.addScaledVector(_acc, dt)
    this.position.addScaledVector(v, dt)

    if (this.position.y < BALL_RADIUS) {
      this.position.y = BALL_RADIUS
      if (v.y < 0) {
        v.y = -v.y * GROUND_RESTITUTION
        v.x *= GROUND_FRICTION
        v.z *= GROUND_FRICTION
        this.spin.multiplyScalar(0.5)
        if (v.y < 0.4) v.y = 0
      }
    }
  }

  /** Rolls the texture in the direction of travel. */
  applyRotation(dt: number) {
    const speed = this.velocity.length()
    if (speed > 0.02) {
      _axis.copy(UP).cross(this.velocity)
      if (_axis.lengthSq() > 1e-6) {
        _axis.normalize()
        this.mesh.rotateOnWorldAxis(_axis, (speed * dt) / BALL_RADIUS)
      }
    }
    this.mesh.position.copy(this.position)
  }
}
