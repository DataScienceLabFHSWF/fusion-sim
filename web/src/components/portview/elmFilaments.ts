import * as THREE from 'three'
import { toroidal } from './types'
import { createGlowTexture } from './glow'

// ── ELM filaments: field-aligned flux ropes torn from the pedestal ──
//
// Real Type-I ELMs eject 10–20 helical filaments that follow the local
// magnetic field-line pitch while accelerating radially outward through the
// SOL. The field-line direction on the plasma edge is dφ ≈ q · dθ, so each
// filament is drawn as a curve on an offset separatrix surface whose toroidal
// angle advances q95 × its poloidal angle — low-q plasmas visibly wind
// tighter. Rendered with the same pooled additive point-sprite technique as
// the strike glow; one extra draw call total.
//
// Timescales are stretched ~100× (real ELM crashes are ~0.2–1 ms) so the
// eruption is visible: brighten at the pedestal, peel outward, fade in the
// SOL, over ~0.45 s.

const MAX_FILAMENTS = 14
const PTS_PER_FILAMENT = 120
const MAX_PTS = MAX_FILAMENTS * PTS_PER_FILAMENT

// Lifecycle (seconds, wall-clock)
const ATTACK = 0.06        // brighten in place at the pedestal
const LIFETIME = 0.45      // total visible duration
const DECAY_TAU = 0.13     // brightness e-folding after the attack
const MAX_EJECT = 0.16     // radial travel over the lifetime (metres)

// Poloidal half-extent of a filament along the boundary (radians of
// geometric poloidal angle around the magnetic axis)
const MIN_EXTENT = 0.55
const MAX_EXTENT = 1.05

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed) * 43758.5453
  return x - Math.floor(x)
}

interface Filament {
  active: boolean
  t0: number          // spawn time
  phi0: number        // toroidal seed angle
  theta0: number      // poloidal seed angle (0 = outboard midplane)
  extent: number      // poloidal half-extent
  pitch: number       // dφ/dθ along the filament (≈ q95 at the edge)
  amp: number         // brightness scale
  seed: number
}

export interface ElmFilamentGroup {
  group: THREE.Group
  /** Store the boundary contour filaments are born on (from the plasma rebuild). */
  setBoundary: (
    contour: [number, number][],
    normals: [number, number][],
    axisR: number,
    axisZ: number,
  ) => void
  /** Trigger a filament burst (call on the ELM rising edge). */
  spawn: (time: number, q95: number, amp: number) => void
  /** Animate — call every frame with the scene clock. */
  update: (time: number) => void
  clear: () => void
}

export function createElmFilamentGroup(): ElmFilamentGroup {
  const group = new THREE.Group()
  group.renderOrder = 2

  const material = new THREE.PointsMaterial({
    map: createGlowTexture(64),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    size: 0.14,
  })

  const posBuffer = new Float32Array(MAX_PTS * 3)
  const colBuffer = new Float32Array(MAX_PTS * 3)
  const geometry = new THREE.BufferGeometry()
  const posAttr = new THREE.BufferAttribute(posBuffer, 3)
  posAttr.setUsage(THREE.DynamicDrawUsage)
  const colAttr = new THREE.BufferAttribute(colBuffer, 3)
  colAttr.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', posAttr)
  geometry.setAttribute('color', colAttr)

  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  points.visible = false
  group.add(points)

  const filaments: Filament[] = Array.from({ length: MAX_FILAMENTS }, () => ({
    active: false, t0: 0, phi0: 0, theta0: 0, extent: 1, pitch: 3, amp: 1, seed: 0,
  }))

  // Boundary lookup: contour points + outward normals sorted by geometric
  // poloidal angle θ around the magnetic axis (θ=0 at the outboard midplane).
  let boundTheta: Float32Array | null = null
  let boundR: Float32Array | null = null
  let boundZ: Float32Array | null = null
  let boundNR: Float32Array | null = null
  let boundNZ: Float32Array | null = null

  const setBoundary = (
    contour: [number, number][],
    normals: [number, number][],
    axisR: number,
    axisZ: number,
  ) => {
    const n = contour.length
    if (n < 8) { boundTheta = null; return }
    const entries: { th: number; r: number; z: number; nr: number; nz: number }[] = []
    for (let i = 0; i < n; i++) {
      const [r, z] = contour[i]
      const th = Math.atan2(z - axisZ, r - axisR)
      // Orient normals outward (away from the axis)
      const dr = r - axisR, dz = z - axisZ
      let [nr, nz] = normals[i]
      if (nr * dr + nz * dz < 0) { nr = -nr; nz = -nz }
      entries.push({ th, r, z, nr, nz })
    }
    entries.sort((a, b) => a.th - b.th)
    boundTheta = new Float32Array(entries.map(e => e.th))
    boundR = new Float32Array(entries.map(e => e.r))
    boundZ = new Float32Array(entries.map(e => e.z))
    boundNR = new Float32Array(entries.map(e => e.nr))
    boundNZ = new Float32Array(entries.map(e => e.nz))
  }

  /** Interpolated boundary sample at poloidal angle θ (wrapped to [-π, π]). */
  const sampleBoundary = (theta: number): { r: number; z: number; nr: number; nz: number } | null => {
    if (!boundTheta || !boundR || !boundZ || !boundNR || !boundNZ) return null
    let th = theta
    while (th > Math.PI) th -= 2 * Math.PI
    while (th < -Math.PI) th += 2 * Math.PI
    const n = boundTheta.length
    // Binary search for the bracketing pair
    let lo = 0, hi = n - 1
    if (th <= boundTheta[0] || th >= boundTheta[n - 1]) {
      // Wraparound segment between last and first points
      const a = n - 1, b = 0
      const span = (boundTheta[b] + 2 * Math.PI) - boundTheta[a]
      const f = span > 1e-9
        ? (((th < boundTheta[0] ? th + 2 * Math.PI : th) - boundTheta[a]) / span)
        : 0
      const fc = Math.max(0, Math.min(1, f))
      return {
        r: boundR[a] + (boundR[b] - boundR[a]) * fc,
        z: boundZ[a] + (boundZ[b] - boundZ[a]) * fc,
        nr: boundNR[a] + (boundNR[b] - boundNR[a]) * fc,
        nz: boundNZ[a] + (boundNZ[b] - boundNZ[a]) * fc,
      }
    }
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (boundTheta[mid] <= th) lo = mid
      else hi = mid
    }
    const span = boundTheta[hi] - boundTheta[lo]
    const f = span > 1e-9 ? (th - boundTheta[lo]) / span : 0
    return {
      r: boundR[lo] + (boundR[hi] - boundR[lo]) * f,
      z: boundZ[lo] + (boundZ[hi] - boundZ[lo]) * f,
      nr: boundNR[lo] + (boundNR[hi] - boundNR[lo]) * f,
      nz: boundNZ[lo] + (boundNZ[hi] - boundNZ[lo]) * f,
    }
  }

  const spawn = (time: number, q95: number, amp: number) => {
    if (!boundTheta) return
    // Filament count scales with the ELM size (n ≈ 10–20 in experiment;
    // we render the handful on the visible side of the torus)
    const count = Math.min(6 + Math.round(amp * 6), MAX_FILAMENTS)
    // Edge field-line pitch — q95 with a floor so the helix never degenerates
    const pitch = Math.max(Math.abs(q95), 2.0)
    for (let i = 0; i < count; i++) {
      const f = filaments[i]
      const s1 = time * 37.7 + i * 13.1
      f.active = true
      f.t0 = time + pseudoRandom(s1 + 4.2) * 0.05  // slight stagger
      // Quasi-regular toroidal spacing with jitter, biased to the visible sector
      f.phi0 = -1.6 + (i / count) * 3.2 + (pseudoRandom(s1) - 0.5) * 0.4
      // Born near the outboard midplane (θ ≈ 0), the ballooning-unstable side
      f.theta0 = (pseudoRandom(s1 + 1.7) - 0.5) * 1.0
      f.extent = MIN_EXTENT + pseudoRandom(s1 + 2.9) * (MAX_EXTENT - MIN_EXTENT)
      f.pitch = pitch
      f.amp = amp * (0.75 + pseudoRandom(s1 + 3.3) * 0.5)
      f.seed = s1
    }
    for (let i = count; i < MAX_FILAMENTS; i++) filaments[i].active = false
  }

  const clear = () => {
    for (const f of filaments) f.active = false
    points.visible = false
  }

  const update = (time: number) => {
    let vi = 0
    for (const f of filaments) {
      if (!f.active) continue
      const life = time - f.t0
      if (life < 0) continue
      if (life > LIFETIME) { f.active = false; continue }

      // Envelope: fast attack, exponential decay
      const env = life < ATTACK
        ? life / ATTACK
        : Math.exp(-(life - ATTACK) / DECAY_TAU)
      // Radial ejection: starts slow, accelerates outward
      const frac = life / LIFETIME
      const eject = MAX_EJECT * frac * frac

      for (let s = 0; s < PTS_PER_FILAMENT && vi < MAX_PTS; s++) {
        const u = (s / (PTS_PER_FILAMENT - 1)) * 2 - 1   // -1..1 along the rope
        const dTheta = u * f.extent
        const theta = f.theta0 + dTheta
        // Field-line helix: toroidal angle advances with poloidal angle
        const phi = f.phi0 + f.pitch * dTheta
        const b = sampleBoundary(theta)
        if (!b) continue

        // The rope's centre erupts furthest; the tied ends lag behind
        const bell = Math.exp(-u * u * 2.5)
        const d = eject * (0.35 + 0.65 * bell)
        const wobble = 0.008 * Math.sin(u * 9.0 + f.seed + time * 6.0)
        const R = b.r + b.nr * (d + wobble)
        const Z = b.z + b.nz * (d + wobble)

        const v = toroidal(R, Z, phi)
        posBuffer[vi * 3] = v.x
        posBuffer[vi * 3 + 1] = v.y
        posBuffer[vi * 3 + 2] = v.z

        // Hot pedestal plasma: white-pink core fading through fuchsia
        const brightness = f.amp * env * bell * 0.9
        colBuffer[vi * 3] = 1.0 * brightness
        colBuffer[vi * 3 + 1] = 0.45 * brightness
        colBuffer[vi * 3 + 2] = 0.75 * brightness
        vi++
      }
    }

    if (vi === 0) {
      points.visible = false
      return
    }
    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
    geometry.setDrawRange(0, vi)
    points.visible = true
  }

  return { group, setBoundary, spawn, update, clear }
}
