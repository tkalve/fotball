import * as THREE from 'three'

export const ARM_LENGTH = 0.62
export const LEG_LENGTH = 0.9
export const HIP_HEIGHT = 0.92
export const SHOULDER_Y = 0.56
export const GLOVE_RADIUS = 0.1

/** A sphere that stands in for part of the body when testing ball contact. */
export type HitSphere = { node: THREE.Object3D; radius: number }

export type Figure = {
  /** Positioned in the world; never rotated. */
  root: THREE.Group
  /** Carries the dive/run pose. */
  body: THREE.Group
  hips: THREE.Group
  head: THREE.Mesh
  shoulders: [THREE.Group, THREE.Group]
  gloves: [THREE.Object3D, THREE.Object3D]
  legs: [THREE.Group, THREE.Group]
  feet: [THREE.Object3D, THREE.Object3D]
  hitSpheres: HitSphere[]
  /** The kit (shirt/arm) material, so the figure can be recoloured per player. */
  shirt: THREE.MeshStandardMaterial
}

const DOWN = new THREE.Vector3(0, -1, 0)
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()

/** Builds a limb that hangs down from a pivot and can be aimed and stretched. */
function limb(
  length: number,
  radius: number,
  material: THREE.Material,
  tipRadius: number,
  tipMaterial: THREE.Material,
) {
  const pivot = new THREE.Group()

  const bone = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, length - radius * 2, 4, 10),
    material,
  )
  bone.position.y = -length / 2
  bone.castShadow = true
  pivot.add(bone)

  const tip = new THREE.Mesh(new THREE.SphereGeometry(tipRadius, 14, 10), tipMaterial)
  tip.position.y = -length
  tip.castShadow = true
  pivot.add(tip)

  pivot.userData.baseLength = length
  pivot.userData.tip = tip
  return pivot
}

export function createFigure(kit: number, trim: number, hands: number): Figure {
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a06a, roughness: 0.75 })
  const shirt = new THREE.MeshStandardMaterial({ color: kit, roughness: 0.68 })
  const shorts = new THREE.MeshStandardMaterial({ color: trim, roughness: 0.7 })
  const boot = new THREE.MeshStandardMaterial({ color: 0x15161c, roughness: 0.4 })
  const glove = new THREE.MeshStandardMaterial({ color: hands, roughness: 0.55 })

  const root = new THREE.Group()
  const body = new THREE.Group()
  const hips = new THREE.Group()
  hips.position.y = HIP_HEIGHT
  body.add(hips)
  root.add(body)

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.34, 6, 14), shirt)
  torso.position.y = 0.3
  torso.scale.z = 0.72
  torso.castShadow = true
  hips.add(torso)

  const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.08, 4, 12), shorts)
  pelvis.rotation.z = Math.PI / 2
  pelvis.scale.set(1, 1, 0.78)
  pelvis.castShadow = true
  hips.add(pelvis)

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.08, 10), skin)
  neck.position.y = 0.6
  hips.add(neck)

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.125, 20, 14), skin)
  head.position.y = 0.73
  head.scale.z = 1.1
  head.castShadow = true
  hips.add(head)

  const shoulders: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()]
  const gloves: [THREE.Object3D, THREE.Object3D] = [new THREE.Object3D(), new THREE.Object3D()]
  const legs: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()]
  const feet: [THREE.Object3D, THREE.Object3D] = [new THREE.Object3D(), new THREE.Object3D()]

  for (const i of [0, 1]) {
    const side = i === 0 ? -1 : 1

    const arm = limb(ARM_LENGTH, 0.055, shirt, GLOVE_RADIUS, glove)
    arm.position.set(side * 0.22, SHOULDER_Y, 0)
    hips.add(arm)
    shoulders[i] = arm
    gloves[i] = arm.userData.tip

    const leg = limb(LEG_LENGTH, 0.08, skin, 0.085, boot)
    leg.position.set(side * 0.1, -0.02, 0)
    hips.add(leg)
    legs[i] = leg
    feet[i] = leg.userData.tip
  }

  const hitSpheres: HitSphere[] = [
    { node: gloves[0], radius: GLOVE_RADIUS + 0.025 },
    { node: gloves[1], radius: GLOVE_RADIUS + 0.025 },
    { node: head, radius: 0.15 },
    { node: torso, radius: 0.22 },
    { node: pelvis, radius: 0.19 },
    { node: feet[0], radius: 0.1 },
    { node: feet[1], radius: 0.1 },
  ]

  // Mid-limb samples stop the ball slipping through an outstretched arm or leg.
  for (const i of [0, 1]) {
    for (const t of [0.45, 0.78]) {
      const m = new THREE.Object3D()
      m.position.y = -ARM_LENGTH * t
      shoulders[i].add(m)
      hitSpheres.push({ node: m, radius: 0.09 })

      const n = new THREE.Object3D()
      n.position.y = -LEG_LENGTH * t
      legs[i].add(n)
      hitSpheres.push({ node: n, radius: 0.11 })
    }
  }

  return { root, body, hips, head, shoulders, gloves, legs, feet, hitSpheres, shirt }
}

/**
 * Swings a limb so its tip reaches towards `worldTarget`, stretching between
 * `minStretch` and `maxStretch` of its rest length. Returns the reach used.
 */
export function aimLimb(
  pivot: THREE.Group,
  worldTarget: THREE.Vector3,
  maxStretch = 1.12,
  minStretch = 0.72,
) {
  const base = pivot.userData.baseLength as number
  const parent = pivot.parent
  if (!parent) return 0

  parent.updateWorldMatrix(true, false)
  const local = parent.worldToLocal(_a.copy(worldTarget))
  const dir = local.sub(pivot.position)
  const dist = dir.length()
  if (dist < 1e-4) return 0

  dir.divideScalar(dist)
  pivot.quaternion.setFromUnitVectors(DOWN, dir)
  // A floor on the extension stops the limb folding inside the torso when the
  // body has already carried the shoulder onto the target.
  const reach = Math.min(Math.max(dist, base * minStretch), base * maxStretch)
  pivot.scale.setScalar(1)
  pivot.scale.y = reach / base
  // Undo the stretch on the hand/boot so it stays round.
  ;(pivot.userData.tip as THREE.Object3D).scale.set(1, base / reach, 1)
  return reach
}

/** Points a limb along a plain euler swing instead of at a target. */
export function swingLimb(pivot: THREE.Group, pitch: number, roll = 0) {
  pivot.scale.setScalar(1)
  ;(pivot.userData.tip as THREE.Object3D).scale.setScalar(1)
  pivot.quaternion.setFromEuler(_euler.set(pitch, 0, roll))
}

const _euler = new THREE.Euler()

export function worldTip(pivot: THREE.Group, out = _b) {
  return (pivot.userData.tip as THREE.Object3D).getWorldPosition(out)
}
