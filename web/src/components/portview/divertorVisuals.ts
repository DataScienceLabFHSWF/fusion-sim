// Physics → visuals adapter for the divertor strike-point glow.
//
// Replaces the previous hand-tuned constant-brightness pipeline with values
// derived from the real divertor model in lib/fusionPhysics.ts:
//   q_peak / q_interELM  → glow brightness (log-mapped, ELMs spike it)
//   lambda_q             → strike band width on the target
//   f_detach             → detachment dims and broadens the glow
//   t_surface (thermal)  → blackbody incandescence blended into the tint
//
// DEVICE_POWER_SCALE remains as art direction for the *absolute* scale per
// device (DIII-D barely perceptible → ITER dazzling); the physics modulates
// brightness *within* a shot: ramp-up, ELM transients, detachment, ramp-down.

import type { Snapshot } from '../../lib/types'
import { computeDivertorHeatFlux, DivertorThermalModel } from '../../lib/fusionPhysics'
import { getDevice, type Device } from '../../lib/wasm'
import { DEVICE_POWER_SCALE, DEFAULT_POWER_SCALE } from './config'

export interface RGB { r: number; g: number; b: number }

export interface DivertorVisualState {
  /** Glow brightness driver, 0 at no SOL power → ~2 for ITER-class ELM spikes */
  intensity: number
  /** Strike band half-width on the target (metres) — λ_q × flux expansion */
  bandWidth: number
  /** Detachment fraction 0..1 (already folded into intensity; exposed for effects) */
  detachFrac: number
  /** Tile surface temperature (°C) from the thermal model */
  tSurface: number
  /**
   * Incandescence blend weight 0..1 — how strongly the glow tint should shift
   * from the device's recycling-light color toward blackbody white/orange.
   */
  incandescence: number
  /** Blackbody color at tSurface (only meaningful when incandescence > 0) */
  blackbody: RGB
}

/** Approximate blackbody color (Tanner Helland fit), normalized 0..1. */
export function blackbodyRGB(tempC: number): RGB {
  const T = Math.max(tempC + 273.15, 800)
  const t100 = T / 100
  const g = Math.min(Math.max((99.47 * Math.log(t100) - 161.12) / 255, 0), 1)
  const b = t100 <= 19
    ? 0
    : Math.min(Math.max((138.52 * Math.log(t100 - 10) - 305.04) / 255, 0), 1)
  return { r: 1.0, g, b }
}

/**
 * Log-map a heat flux (MW/m²) to a 0..~1.2 brightness driver.
 * ~3 MW/m² (DIII-D flat-top) → ~0.4, ~10 (ITER inter-ELM) → ~0.7,
 * ELM spikes of 50+ push past 1.
 */
function heatFluxToBrightness(qMW: number): number {
  return Math.log1p(Math.max(qMW, 0)) / Math.log1p(30)
}

export class DivertorVisuals {
  private deviceId: string
  private device: Device | null
  private thermal: DivertorThermalModel
  private prevTime = 0
  private smoothedIntensity = 0

  constructor(deviceId: string) {
    this.deviceId = deviceId
    this.device = getDevice(deviceId)
    this.thermal = new DivertorThermalModel(deviceId)
  }

  reset(): void {
    this.thermal.reset()
    this.prevTime = 0
    this.smoothedIntensity = 0
  }

  /** Advance the thermal model and derive visual parameters for this frame. */
  update(snapshot: Snapshot): DivertorVisualState {
    let device = this.device
    if (!device) {
      // WASM device table unavailable — fall back to a dead divertor.
      return {
        intensity: 0, bandWidth: 0.04, detachFrac: 0,
        tSurface: 0, incandescence: 0, blackbody: blackbodyRGB(0),
      }
    }
    // Respect the DD/DT fuel override the same way StatusPanel does.
    if (snapshot.mass_number != null && snapshot.mass_number !== device.mass_number) {
      device = { ...device, mass_number: snapshot.mass_number }
    }

    const div = computeDivertorHeatFlux(snapshot, device)

    // ── Thermal model stepping (mirrors StatusPanel) ──
    const t = snapshot.time ?? 0
    const dt = t > this.prevTime ? t - this.prevTime : 0
    this.prevTime = t
    if (snapshot.ip < 0.01 || dt < 0 || dt > 2.0) {
      this.thermal.reset()
    }
    const tSurface = dt > 0 && dt < 2.0
      ? this.thermal.step(div.q_interELM, div.elm_q, div.tau_elm, dt)
      : this.thermal.t_surface

    // ── Brightness: log-mapped q_peak × per-device art scale ──
    const artScale = Math.pow(
      DEVICE_POWER_SCALE[this.deviceId] ?? DEFAULT_POWER_SCALE, 0.6)
    const raw = heatFluxToBrightness(div.q_peak) * artScale

    // Fast attack (ELM spikes appear immediately), quick decay back to the
    // inter-ELM baseline — the transient should read as a sharp pulse, not
    // linger. `raw` floors the decay, so the baseline glow itself is steady.
    if (raw >= this.smoothedIntensity) {
      this.smoothedIntensity += (raw - this.smoothedIntensity) * 0.6
    } else {
      this.smoothedIntensity = Math.max(raw, this.smoothedIntensity * 0.62)
    }

    // ── Band width: λ_q mapped through a typical target flux expansion.
    // λ_q is millimetres at the midplane; the wetted band on the target is
    // wider by the flux expansion (~7–18×). Kept as a visual half-width.
    const bandWidth = Math.min(Math.max(div.lambda_q * 1e-3 * 8, 0.012), 0.15)

    // ── Incandescence: tiles start glowing visibly around ~550°C,
    // fully dominate the tint by ~1300°C.
    const incandescence = Math.min(Math.max((tSurface - 550) / 750, 0), 1)

    return {
      intensity: this.smoothedIntensity,
      bandWidth,
      detachFrac: div.f_detach,
      tSurface,
      incandescence,
      blackbody: blackbodyRGB(tSurface),
    }
  }
}
