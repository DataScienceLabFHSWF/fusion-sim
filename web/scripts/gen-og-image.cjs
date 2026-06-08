#!/usr/bin/env node
/**
 * Generate web/public/og-image.png — the social-share thumbnail:
 * a tokamak poloidal cross-section (nested magnetic flux surfaces, inferno
 * colormap, warm core glow) bleeding off the right on a near-black field,
 * matching the landing-page hero. Pure Node (no native deps): renders into an
 * RGB buffer at 2× supersampling and PNG-encodes via zlib.
 *
 *   node web/scripts/gen-og-image.cjs
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

// Square so iMessage (which center-crops link previews to a square) shows the
// centered cross-section, not a cropped middle band of a wide image.
const W = 1200, H = 1200, SS = 2
const w = W * SS, h = H * SS

// Near-black background (the app base color #0e0f11).
const BG = [0x0e, 0x0f, 0x11]
const buf = new Float64Array(w * h * 3)
for (let i = 0; i < w * h; i++) {
  buf[i * 3] = BG[0]; buf[i * 3 + 1] = BG[1]; buf[i * 3 + 2] = BG[2]
}

// Inferno colormap (perceptually uniform), matching the equilibrium panel.
const INF = [
  [0, 0, 4], [27, 12, 65], [74, 12, 107], [120, 28, 109], [165, 44, 96],
  [207, 68, 70], [237, 105, 37], [251, 154, 6], [247, 208, 60], [252, 255, 164],
]
const inferno = (t) => {
  const x = Math.max(0, Math.min(1, t)) * (INF.length - 1)
  const i = Math.floor(x), f = x - i
  const a = INF[i], b = INF[Math.min(i + 1, INF.length - 1)]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

// Plasma geometry — centered cross-section (slight top/bottom bleed).
const a = h * 0.40, cx = w * 0.5, cy = h * 0.5, kappa = 1.5, delta = 0.45, N = 16

// Warm core bloom (additive).
const bcx = cx + a * 0.12, bcy = cy, br = a * 1.5
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - bcx, y - bcy) / br
    if (d >= 1) continue
    const f = Math.pow(1 - d, 2.2) * 0.40
    const i = (y * w + x) * 3
    buf[i] += 252 * f; buf[i + 1] += 178 * f; buf[i + 2] += 98 * f
  }
}

// Alpha-blend a point (additive-ish over current pixel).
const plot = (px, py, r, g, b, al) => {
  const x = Math.round(px), y = Math.round(py)
  if (x < 0 || y < 0 || x >= w || y >= h) return
  const i = (y * w + x) * 3
  buf[i] = buf[i] * (1 - al) + r * al
  buf[i + 1] = buf[i + 1] * (1 - al) + g * al
  buf[i + 2] = buf[i + 2] * (1 - al) + b * al
}

// Nested flux surfaces (edge → core), densely sampled for continuous lines.
for (let s = N; s >= 1; s--) {
  const rho = s / N
  const shift = a * 0.14 * (1 - rho)
  const [r, g, b] = inferno(1 - rho)
  const al = Math.min(1, (0.28 + 0.62 * Math.pow(1 - rho, 1.4)))
  const steps = 1600
  for (let k = 0; k <= steps; k++) {
    const th = (k / steps) * Math.PI * 2
    const R = cx + shift + a * rho * Math.cos(th + delta * Math.sin(th))
    const Z = cy - a * rho * kappa * Math.sin(th)
    // 3×3 brush (~3px at 2×SS → ~1.5px line after downsample) for visibility.
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const edge = ox === 0 && oy === 0 ? 1 : ox === 0 || oy === 0 ? 0.55 : 0.3
        plot(R + ox, Z + oy, r, g, b, al * edge)
      }
    }
  }
}

// Gentle radial vignette toward the corners for depth.
const vmaxR = Math.hypot(w, h) * 0.5
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - w * 0.5, y - h * 0.5) / vmaxR
    const cover = Math.max(0, (d - 0.55)) * 0.9
    if (cover <= 0) continue
    const i = (y * w + x) * 3
    buf[i] = buf[i] * (1 - cover) + BG[0] * cover
    buf[i + 1] = buf[i + 1] * (1 - cover) + BG[1] * cover
    buf[i + 2] = buf[i + 2] * (1 - cover) + BG[2] * cover
  }
}

// Downsample 2×2 → final RGB bytes.
const out = Buffer.alloc(W * H * 3)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let r = 0, g = 0, bl = 0
    for (let dy = 0; dy < SS; dy++) {
      for (let dx = 0; dx < SS; dx++) {
        const i = ((y * SS + dy) * w + (x * SS + dx)) * 3
        r += buf[i]; g += buf[i + 1]; bl += buf[i + 2]
      }
    }
    const n = SS * SS
    const o = (y * W + x) * 3
    out[o] = Math.max(0, Math.min(255, Math.round(r / n)))
    out[o + 1] = Math.max(0, Math.min(255, Math.round(g / n)))
    out[o + 2] = Math.max(0, Math.min(255, Math.round(bl / n)))
  }
}

// ── PNG encode (8-bit RGB) ──
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (b) => {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0)
  return Buffer.concat([len, td, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
// raw scanlines with filter byte 0
const raw = Buffer.alloc(H * (1 + W * 3))
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 3)] = 0
  out.copy(raw, y * (1 + W * 3) + 1, y * W * 3, (y + 1) * W * 3)
}
const idat = zlib.deflateSync(raw, { level: 9 })
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
])
const outPath = path.join(__dirname, '..', 'public', 'og-image.png')
fs.writeFileSync(outPath, png)
console.log(`wrote ${outPath} (${(png.length / 1024).toFixed(1)} KB, ${W}×${H})`)
