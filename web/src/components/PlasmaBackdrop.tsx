import { useRef, useEffect } from 'react'

/* Inferno colormap (perceptually uniform) — same ramp as the equilibrium
   panel, so the backdrop previews the real physics the tool computes. */
const INFERNO: [number, number, number][] = [
  [0, 0, 4], [27, 12, 65], [74, 12, 107], [120, 28, 109], [165, 44, 96],
  [207, 68, 70], [237, 105, 37], [251, 154, 6], [247, 208, 60], [252, 255, 164],
]
function inferno(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (INFERNO.length - 1)
  const i = Math.floor(x)
  const f = x - i
  const a = INFERNO[i]
  const b = INFERNO[Math.min(i + 1, INFERNO.length - 1)]
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ]
}

/**
 * Atmospheric hero backdrop: a large, faint tokamak poloidal cross-section
 * (nested magnetic flux surfaces, inferno-coloured, with a warm core bloom)
 * positioned to bleed off the right edge. Authentic-physics atmosphere, not a
 * decorative glow. Static (no animation) — cheap and non-distracting.
 */
export default function PlasmaBackdrop({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    if (!canvas || !parent) return

    const draw = () => {
      const rect = parent.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, rect.width, rect.height)

      // Large plasma, axis pushed right so the cross-section bleeds off the
      // right edge (and top/bottom) — cinematic, kaldera-style crop.
      const a = rect.height * 0.85          // minor radius (px)
      const cx = rect.width * 0.80          // magnetic axis x (right side)
      const cy = rect.height * 0.5
      const kappa = 1.55                    // elongation
      const delta = 0.45                    // triangularity
      const N = 20                          // nested surfaces

      // Warm core bloom (the "hot" plasma core).
      const bloom = ctx.createRadialGradient(cx + a * 0.12, cy, 0, cx + a * 0.12, cy, a * 1.5)
      bloom.addColorStop(0, 'rgba(252, 178, 98, 0.20)')
      bloom.addColorStop(0.4, 'rgba(210, 92, 48, 0.06)')
      bloom.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = bloom
      ctx.fillRect(0, 0, rect.width, rect.height)

      // Nested flux surfaces (edge → core).
      ctx.lineWidth = 1.1
      const steps = 160
      for (let s = N; s >= 1; s--) {
        const rho = s / N                                    // 1 = edge, →0 = core
        const shift = a * 0.14 * (1 - rho)                   // Shafranov shift outward
        const [r, g, b] = inferno(1 - rho)
        const alpha = 0.09 + 0.5 * Math.pow(1 - rho, 1.4)    // faint, brighter core
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`
        ctx.beginPath()
        for (let k = 0; k <= steps; k++) {
          const th = (k / steps) * Math.PI * 2
          const R = cx + shift + a * rho * Math.cos(th + delta * Math.sin(th))
          const Z = cy - a * rho * kappa * Math.sin(th)
          if (k === 0) ctx.moveTo(R, Z)
          else ctx.lineTo(R, Z)
        }
        ctx.closePath()
        ctx.stroke()
      }
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(parent)
    return () => ro.disconnect()
  }, [])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
