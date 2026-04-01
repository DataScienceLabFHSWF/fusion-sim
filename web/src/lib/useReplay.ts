/**
 * useReplay — hook for replaying pre-recorded Snapshot JSON files.
 *
 * Provides the same SimState interface as useSimulation so all existing
 * rendering components (EquilibriumCanvas, StatusPanel, etc.) work unchanged.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Snapshot, TracePoint, ProcessedProfile } from './types'
import { processProfileFrames } from './profileUtils'
import type { SimState } from './useSimulation'

export interface ReplayControls {
  loadSnapshots: (snapshots: Snapshot[]) => void
  play: () => void
  pause: () => void
  reset: () => void
  setScrubTime: (time: number | null) => void
  setSpeed: (speed: number) => void
}

function snapshotToTrace(s: Snapshot): TracePoint {
  return {
    t: s.time,
    ip: s.ip,
    te0: s.te0,
    ne_bar: s.ne_bar,
    w_th: s.w_th,
    p_input: s.p_input,
    p_rad: s.p_rad,
    p_loss: s.p_loss,
    d_alpha: s.diagnostics?.d_alpha ?? 0,
    beta_n: s.beta_n,
    disruption_risk: s.disruption_risk,
    li: s.li,
    q95: s.q95,
    v_loop: s.diagnostics?.v_loop ?? 0,
    h_factor: s.h_factor,
    f_greenwald: s.f_greenwald,
    ne_ped: s.ne_ped,
    te_ped: s.te_ped,
    ne_line: s.ne_line,
    impurity_fraction: s.impurity_fraction,
    elm_suppressed: s.elm_suppressed,
    elm_active: s.elm_active,
  }
}

export function useReplay(): [SimState, ReplayControls] {
  const allSnapshotsRef = useRef<Snapshot[]>([])
  const allTracesRef = useRef<TracePoint[]>([])
  const indexRef = useRef(0)
  const runningRef = useRef(false)
  const rafRef = useRef(0)
  const speedRef = useRef(1.0)
  const lastFrameRef = useRef(0)

  const [state, setState] = useState<SimState>({
    snapshot: null,
    displaySnapshot: null,
    history: [],
    snapshotHistory: [],
    running: false,
    wallJson: '[]',
    programJson: '{}',
    scrubTime: null,
    finished: false,
    processedProfiles: null,
    profileTeMax: 0,
    profileNeMax: 0,
    profilePMax: 0,
  })

  const loadSnapshots = useCallback((snapshots: Snapshot[]) => {
    allSnapshotsRef.current = snapshots
    allTracesRef.current = snapshots.map(snapshotToTrace)
    indexRef.current = 0

    // Process profiles
    const profileFrames = snapshots
      .filter((s) => s.te_profile?.length > 0)
      .map((s) => ({
        time: s.time,
        te_profile: s.te_profile,
        ne_profile: s.ne_profile,
        in_hmode: s.in_hmode,
      }))
    const profileResult = profileFrames.length > 0
      ? processProfileFrames(profileFrames)
      : { profiles: [], teMax: 0, neMax: 0, pMax: 0 }

    const first = snapshots[0] ?? null
    setState({
      snapshot: first,
      displaySnapshot: first,
      history: allTracesRef.current,
      snapshotHistory: snapshots,
      running: false,
      wallJson: '[]',
      programJson: '{}',
      scrubTime: null,
      finished: true, // all data is pre-recorded
      processedProfiles: profileResult.profiles,
      profileTeMax: profileResult.teMax,
      profileNeMax: profileResult.neMax,
      profilePMax: profileResult.pMax,
    })
  }, [])

  // Animation loop for playback
  const tick = useCallback((timestamp: number) => {
    if (!runningRef.current) return

    const all = allSnapshotsRef.current
    if (all.length === 0) return

    // Advance index based on elapsed wall time × speed
    const elapsed = (timestamp - lastFrameRef.current) / 1000 // seconds
    lastFrameRef.current = timestamp

    const currentSnap = all[indexRef.current]
    const targetTime = currentSnap.time + elapsed * speedRef.current

    // Find next snapshot at or past targetTime
    let newIdx = indexRef.current
    while (newIdx < all.length - 1 && all[newIdx + 1].time <= targetTime) {
      newIdx++
    }

    if (newIdx >= all.length - 1) {
      // Reached end
      indexRef.current = all.length - 1
      runningRef.current = false
      const snap = all[indexRef.current]
      setState((prev) => ({
        ...prev,
        snapshot: snap,
        displaySnapshot: snap,
        running: false,
      }))
      return
    }

    indexRef.current = newIdx
    const snap = all[newIdx]

    setState((prev) => ({
      ...prev,
      snapshot: snap,
      displaySnapshot: snap,
      running: true,
      scrubTime: null,
    }))

    rafRef.current = requestAnimationFrame(tick)
  }, [])

  const play = useCallback(() => {
    if (allSnapshotsRef.current.length === 0) return
    runningRef.current = true
    lastFrameRef.current = performance.now()
    setState((prev) => ({ ...prev, running: true, scrubTime: null }))
    rafRef.current = requestAnimationFrame(tick)
  }, [tick])

  const pause = useCallback(() => {
    runningRef.current = false
    cancelAnimationFrame(rafRef.current)
    setState((prev) => ({ ...prev, running: false }))
  }, [])

  const reset = useCallback(() => {
    runningRef.current = false
    cancelAnimationFrame(rafRef.current)
    indexRef.current = 0
    const first = allSnapshotsRef.current[0] ?? null
    setState((prev) => ({
      ...prev,
      snapshot: first,
      displaySnapshot: first,
      running: false,
      scrubTime: null,
    }))
  }, [])

  const setScrubTime = useCallback((time: number | null) => {
    const all = allSnapshotsRef.current
    if (time === null || all.length === 0) {
      setState((prev) => ({
        ...prev,
        scrubTime: null,
        displaySnapshot: all[indexRef.current] ?? null,
      }))
      return
    }

    // Binary search for closest snapshot
    let lo = 0
    let hi = all.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (all[mid].time < time) lo = mid + 1
      else hi = mid
    }
    // Check neighbors for closest
    if (lo > 0 && Math.abs(all[lo - 1].time - time) < Math.abs(all[lo].time - time)) {
      lo = lo - 1
    }

    setState((prev) => ({
      ...prev,
      scrubTime: time,
      displaySnapshot: all[lo],
    }))
  }, [])

  const setSpeed = useCallback((speed: number) => {
    speedRef.current = speed
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return [
    state,
    { loadSnapshots, play, pause, reset, setScrubTime, setSpeed },
  ]
}
