import * as THREE from 'three'

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return { c, ctx: c.getContext('2d')! }
}

/** Mown turf: two alternating bands of green plus fine blade noise. */
export function makeTurfTexture(anisotropy: number) {
  const { c, ctx } = canvas(512, 512)

  ctx.fillStyle = '#3f8c42'
  ctx.fillRect(0, 0, 512, 512)
  ctx.fillStyle = '#4ea052'
  ctx.fillRect(0, 0, 512, 256)

  const img = ctx.getImageData(0, 0, 512, 512)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 26
    d[i] += n
    d[i + 1] += n * 1.3
    d[i + 2] += n * 0.6
  }
  ctx.putImageData(img, 0, 0)

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = anisotropy
  return tex
}

/**
 * Classic football panelling. The twelve black pentagons of a truncated
 * icosahedron are exactly the spherical Voronoi cells of the icosahedron's
 * vertices, so each texel just asks how deep inside its nearest cell it sits.
 */
export function makeBallTexture(anisotropy: number) {
  const PHI = (1 + Math.sqrt(5)) / 2
  const centres: number[][] = []
  for (const s1 of [1, -1]) {
    for (const s2 of [1, -1]) {
      const l = Math.hypot(1, PHI)
      centres.push([0, s1 / l, (s2 * PHI) / l])
      centres.push([s1 / l, (s2 * PHI) / l, 0])
      centres.push([(s2 * PHI) / l, 0, s1 / l])
    }
  }

  const W = 1024
  const H = 512
  const { c, ctx } = canvas(W, H)
  const img = ctx.createImageData(W, H)
  const d = img.data

  for (let y = 0; y < H; y++) {
    const theta = ((y + 0.5) / H) * Math.PI
    const st = Math.sin(theta)
    const ct = Math.cos(theta)
    for (let x = 0; x < W; x++) {
      const phi = ((x + 0.5) / W) * Math.PI * 2
      const dx = st * Math.cos(phi)
      const dy = ct
      const dz = st * Math.sin(phi)

      let best = -2
      let second = -2
      for (const n of centres) {
        const dot = dx * n[0] + dy * n[1] + dz * n[2]
        if (dot > best) {
          second = best
          best = dot
        } else if (dot > second) {
          second = dot
        }
      }

      // The cell's deepest point scores 0.553; 0.25 carves out a tidy pentagon.
      const depth = best - second
      let v: number
      if (depth > 0.25) v = 26
      else if (depth > 0.215) v = 90
      else v = 240 + (Math.random() - 0.5) * 10

      const i = (y * W + x) * 4
      d[i] = v
      d[i + 1] = v
      d[i + 2] = v === 240 ? v - 4 : v
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = anisotropy
  return tex
}

/** Vertical sky gradient, painted onto a backside dome. */
export function makeSkyTexture() {
  const { c, ctx } = canvas(4, 256)
  const g = ctx.createLinearGradient(0, 0, 0, 256)
  g.addColorStop(0, '#2d6fc4')
  g.addColorStop(0.45, '#7cb3e8')
  g.addColorStop(0.78, '#cfe4f5')
  g.addColorStop(1, '#e8eef2')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 4, 256)

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * Alpha mask for goal netting: one cell of a square grid, with the strands
 * through the middle of the tile so it repeats seamlessly. Used as an alphaMap,
 * which samples the green channel, so white is strand and black is hole.
 */
export function makeNetAlpha(anisotropy: number) {
  const S = 64
  const STRAND = 6
  const { c, ctx } = canvas(S, S)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, S, S)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, (S - STRAND) / 2, S, STRAND)
  ctx.fillRect((S - STRAND) / 2, 0, STRAND, S)

  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = anisotropy
  return tex
}
