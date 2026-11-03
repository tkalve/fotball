import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import {
  GOAL_AREA_DEPTH,
  GOAL_AREA_HALF_WIDTH,
  GOAL_CROSSBAR_HEIGHT,
  PENALTY_AREA_DEPTH,
  PENALTY_AREA_HALF_WIDTH,
  PENALTY_ARC_RADIUS,
  PENALTY_SPOT_Z,
  PITCH_LENGTH,
  PITCH_WIDTH,
} from './constants'
import { makeNetAlpha, makeSkyTexture, makeTurfTexture } from './textures'

/** Roughly the width of one hole in the netting, in metres. */
const NET_CELL = 0.115

/** Mesh and material names in the source file mark the net panels. */
function isNetPart(name: string | undefined) {
  return !!name && /net/i.test(name)
}

/** Mouth dimensions measured off the loaded goal, so gameplay matches the mesh. */
export type GoalMetrics = {
  /** Distance from the centre to the inside face of a post. */
  innerHalfWidth: number
  /** Height of the underside of the crossbar. */
  innerHeight: number
  outerHalfWidth: number
  postRadius: number
  /** How far the net reaches behind the goal line (negative z). */
  depth: number
}

export class World {
  readonly scene = new THREE.Scene()
  readonly goalGroup = new THREE.Group()
  goal: GoalMetrics = {
    innerHalfWidth: 1.8,
    innerHeight: 2.2,
    outerHalfWidth: 2,
    postRadius: 0.1,
    depth: 1.5,
  }

  private sun!: THREE.DirectionalLight
  private renderer: THREE.WebGLRenderer

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    this.buildSky()
    this.buildLights()
    this.buildPitch()
    this.scene.add(this.goalGroup)
  }

  private buildSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(400, 32, 16),
      new THREE.MeshBasicMaterial({
        map: makeSkyTexture(),
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    )
    this.scene.add(sky)
    this.scene.fog = new THREE.Fog(0xc6dced, 45, 150)

    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.45
    pmrem.dispose()
  }

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xbfdcff, 0x3c6b38, 1.1))

    const sun = new THREE.DirectionalLight(0xfff4e0, 2.6)
    sun.position.set(-14, 20, 16)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.bias = -0.0008
    sun.shadow.normalBias = 0.02

    // Tight shadow frustum around the penalty area keeps the texels dense.
    const cam = sun.shadow.camera
    cam.left = -16
    cam.right = 16
    cam.top = 16
    cam.bottom = -10
    cam.near = 1
    cam.far = 60
    cam.updateProjectionMatrix()

    sun.target.position.set(0, 0, 4)
    this.scene.add(sun, sun.target)
    this.sun = sun
  }

  private buildPitch() {
    const turf = makeTurfTexture(this.renderer.capabilities.getMaxAnisotropy())
    turf.repeat.set(PITCH_WIDTH / 2.6, PITCH_LENGTH / 7)

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(PITCH_WIDTH, PITCH_LENGTH),
      new THREE.MeshStandardMaterial({ map: turf, roughness: 0.95, metalness: 0 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.z = PITCH_LENGTH / 2 - 14
    ground.receiveShadow = true
    this.scene.add(ground)

    this.scene.add(this.buildMarkings())
  }

  private buildMarkings() {
    const group = new THREE.Group()
    const paint = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
    })
    const T = 0.12
    const Y = 0.012

    const stripe = (x: number, z: number, w: number, d: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), paint)
      m.rotation.x = -Math.PI / 2
      m.position.set(x, Y, z)
      group.add(m)
    }

    /** Three sides of a box: the goal line closes the fourth. */
    const box = (halfWidth: number, depth: number) => {
      stripe(0, depth, halfWidth * 2 + T, T)
      stripe(-halfWidth, depth / 2, T, depth)
      stripe(halfWidth, depth / 2, T, depth)
    }

    stripe(0, 0, PITCH_WIDTH, T)
    box(PENALTY_AREA_HALF_WIDTH, PENALTY_AREA_DEPTH)
    box(GOAL_AREA_HALF_WIDTH, GOAL_AREA_DEPTH)

    const spot = new THREE.Mesh(new THREE.CircleGeometry(0.11, 20), paint)
    spot.rotation.x = -Math.PI / 2
    spot.position.set(0, Y, PENALTY_SPOT_Z)
    group.add(spot)

    // Only the slice of the arc that pokes out past the penalty area is painted.
    const half = Math.asin(
      Math.min(1, (PENALTY_AREA_DEPTH - PENALTY_SPOT_Z) / PENALTY_ARC_RADIUS),
    )
    const arc = new THREE.Mesh(
      new THREE.RingGeometry(
        PENALTY_ARC_RADIUS - T / 2,
        PENALTY_ARC_RADIUS + T / 2,
        64,
        1,
        -Math.PI + half,
        Math.PI - 2 * half,
      ),
      paint,
    )
    arc.rotation.x = -Math.PI / 2
    arc.position.set(0, Y, PENALTY_SPOT_Z)
    group.add(arc)

    return group
  }

  async loadGoal(url: string) {
    const gltf = await new GLTFLoader().loadAsync(url)
    const model = gltf.scene
    model.updateMatrixWorld(true)

    // The file puts pitch level at y = 0, so the height above it is the crossbar.
    const raw = new THREE.Box3().setFromObject(model)
    const scale = GOAL_CROSSBAR_HEIGHT / raw.max.y
    model.scale.setScalar(scale)
    model.updateMatrixWorld(true)

    const frames: THREE.Mesh[] = []
    const nets: THREE.Mesh[] = []
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const material = o.material as THREE.Material
      ;(isNetPart(o.name) || isNetPart(material?.name) ? nets : frames).push(o)
    })

    const plastic = new THREE.MeshStandardMaterial({
      color: 0xf4f6f6,
      roughness: 0.34,
      metalness: 0.05,
    })
    for (const mesh of frames) {
      mesh.material = plastic
      mesh.castShadow = true
      mesh.receiveShadow = true
    }

    // The net meshes arrive as solid shells with a placeholder colour; the holes
    // are punched in by an alpha grid. Each panel is unwrapped at its own UV
    // scale, so each gets its own repeat and the holes come out the same size
    // on the back as on the sides.
    const anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    for (const mesh of nets) {
      const alphaMap = makeNetAlpha(anisotropy)
      alphaMap.repeat.setScalar(metresPerUv(mesh) / NET_CELL)
      mesh.material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        alphaMap,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        side: THREE.DoubleSide,
        roughness: 0.85,
        metalness: 0,
      })
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.renderOrder = 2
    }

    this.goal = measureMouth(frames, Math.abs(raw.min.z) * scale)
    this.goalGroup.add(model)
    return this.goal
  }

  /** Keeps the sun's shadow box centred on the action. */
  focusShadows(z: number) {
    this.sun.target.position.z = z
    this.sun.target.updateMatrixWorld()
  }
}

/**
 * How many metres of surface one unit of UV covers, read off the mesh's own
 * triangles. The source file's unwrap has no fixed relationship to the scene
 * scale, so this is what keeps the netting's holes a consistent real size.
 */
function metresPerUv(mesh: THREE.Mesh) {
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
  const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
  const index = mesh.geometry.index
  if (!uv) return 1

  const count = index ? index.count : pos.count
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const ua = new THREE.Vector2()
  const ub = new THREE.Vector2()
  const ratios: number[] = []

  for (let i = 0; i + 1 < count; i += 3) {
    const i0 = index ? index.getX(i) : i
    const i1 = index ? index.getX(i + 1) : i + 1
    ua.fromBufferAttribute(uv, i0)
    ub.fromBufferAttribute(uv, i1)
    const span = ua.distanceTo(ub)
    if (span < 1e-6) continue
    a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld)
    b.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld)
    ratios.push(a.distanceTo(b) / span)
  }
  if (!ratios.length) return 1

  // Median, because a stray sliver triangle can have a wild ratio.
  ratios.sort((x, y) => x - y)
  return ratios[ratios.length >> 1]
}

/**
 * Reads the mouth off the frame geometry rather than trusting a bounding box:
 * the posts and crossbar are the same tube, so the crossbar's own thickness
 * gives both the clear height and how far the posts intrude on the width.
 */
function measureMouth(frames: THREE.Mesh[], depth: number): GoalMetrics {
  const v = new THREE.Vector3()
  let maxX = 0
  let maxY = 0

  const sweep = (visit: (p: THREE.Vector3) => void) => {
    for (const mesh of frames) {
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i++) {
        visit(v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld))
      }
    }
  }

  sweep((p) => {
    maxX = Math.max(maxX, Math.abs(p.x))
    maxY = Math.max(maxY, p.y)
  })

  // Underside of the crossbar, sampled away from the posts so the corners miss.
  let crossbar = maxY
  sweep((p) => {
    if (p.y > maxY * 0.7 && Math.abs(p.x) < maxX * 0.4) crossbar = Math.min(crossbar, p.y)
  })

  const tube = maxY - crossbar
  const postRadius = tube / 2
  return {
    outerHalfWidth: maxX,
    postRadius,
    innerHalfWidth: maxX - tube,
    innerHeight: crossbar,
    depth,
  }
}
