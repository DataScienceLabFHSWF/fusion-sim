/**
 * ReplayRoom — page for replaying pre-recorded Snapshot JSON files.
 *
 * Reuses all ControlRoom rendering components (EquilibriumCanvas, StatusPanel,
 * etc.) but drives them from a JSON file instead of the WASM simulation.
 */

import { useCallback, useRef, useState } from 'react'
import { useReplay } from '../lib/useReplay'
import type { Snapshot } from '../lib/types'
import EquilibriumCanvas from '../components/EquilibriumCanvas'
import UnifiedTracePanel from '../components/UnifiedTracePanel'
import StatusPanel from '../components/StatusPanel'
import SettingsDropdown from '../components/SettingsDropdown'
import { ITER_LIMITER } from '../lib/iter-geometry'
import { DIIID_LIMITER } from '../lib/diiid-geometry'
import { JET_LIMITER } from '../lib/jet-geometry'
import { CENTAUR_LIMITER } from '../lib/centaur-geometry'

const DEVICE_LIMITERS: Record<string, [number, number][]> = {
  diiid: DIIID_LIMITER,
  centaur: CENTAUR_LIMITER,
  jet: JET_LIMITER,
  iter: ITER_LIMITER,
}

// Built-in demo episodes served from public/replay/
const DEMO_EPISODES = [
  { id: 'episode_0018', label: 'ITER H-mode #18 (base)', device: 'iter' },
  { id: 'episode_0019', label: 'ITER L-mode #19', device: 'iter' },
]

export default function ReplayRoom() {
  const [state, controls] = useReplay()
  const { displaySnapshot, history, running, scrubTime, finished } = state
  const [loaded, setLoaded] = useState(false)
  const [episodeName, setEpisodeName] = useState('')
  const [deviceId, setDeviceId] = useState('iter')
  const [activeSpeed, setActiveSpeed] = useState(1.0)
  const [loading, setLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const time = displaySnapshot?.time ?? 0
  const duration = displaySnapshot?.duration ?? 100
  const progress = duration > 0 ? (time / duration) * 100 : 0

  const limiterPoints = DEVICE_LIMITERS[deviceId]

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    try {
      const text = await file.text()
      const snapshots: Snapshot[] = JSON.parse(text)
      if (!Array.isArray(snapshots) || snapshots.length === 0) {
        alert('Invalid snapshot file: expected a JSON array of Snapshot objects')
        return
      }
      const dev = snapshots[0].device_id || 'iter'
      setDeviceId(dev)
      setEpisodeName(file.name.replace('.json', ''))
      controls.loadSnapshots(snapshots)
      setLoaded(true)
    } catch (err) {
      alert(`Failed to load file: ${err}`)
    } finally {
      setLoading(false)
    }
  }, [controls])

  const handleDemoLoad = useCallback(async (ep: typeof DEMO_EPISODES[0]) => {
    setLoading(true)
    try {
      const resp = await fetch(`/replay/${ep.id}.json`)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const snapshots: Snapshot[] = await resp.json()
      setDeviceId(ep.device)
      setEpisodeName(ep.id)
      controls.loadSnapshots(snapshots)
      setLoaded(true)
    } catch (err) {
      alert(`Failed to load demo: ${err}`)
    } finally {
      setLoading(false)
    }
  }, [controls])

  const handleSpeedChange = (speed: number) => {
    setActiveSpeed(speed)
    controls.setSpeed(speed)
  }

  // ─── Episode selector (before loading) ───
  if (!loaded) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-[#0a0e17] text-gray-300 gap-6">
        <h1 className="text-2xl font-bold text-cyan-400">🔄 Replay Mode</h1>
        <p className="text-sm text-gray-500 max-w-md text-center">
          Load a pre-recorded simulation snapshot file (JSON) exported from the
          Fusion World Model pipeline, or select a demo episode.
        </p>

        {/* Demo episodes */}
        <div className="flex flex-col gap-2">
          {DEMO_EPISODES.map((ep) => (
            <button
              key={ep.id}
              onClick={() => handleDemoLoad(ep)}
              disabled={loading}
              className="px-4 py-2 bg-gray-800 border border-gray-700 rounded hover:border-cyan-600
                         text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
            >
              {ep.label}
            </button>
          ))}
        </div>

        <div className="text-gray-600 text-xs">— or —</div>

        {/* File upload */}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="px-6 py-3 bg-cyan-700 hover:bg-cyan-600 rounded-lg text-sm font-semibold
                     transition-colors cursor-pointer disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Upload Snapshot JSON'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          onChange={handleFile}
          className="hidden"
        />

        <a href="/" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
          ← Back to simulator
        </a>
      </div>
    )
  }

  // ─── Replay view (same layout as ControlRoom) ───
  return (
    <div className="h-screen flex flex-col bg-[#0a0e17] overflow-hidden">
      {/* ─── Top bar ─── */}
      <div className="flex flex-wrap items-center justify-between px-2 sm:px-3 py-1 sm:py-1.5 border-b border-gray-800 gap-1 sm:gap-2">
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <span className="text-[11px] sm:text-xs font-bold text-cyan-400 bg-cyan-900/40 px-1.5 py-0.5 rounded">
            REPLAY
          </span>
          <span className="text-[11px] sm:text-xs text-gray-400">
            {episodeName} ({deviceId.toUpperCase()})
          </span>
          <span className="text-[10px] text-gray-600">
            {state.snapshotHistory.length} frames
          </span>
        </div>

        {/* Playback controls */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          {!running ? (
            <button
              onClick={controls.play}
              className="px-2 sm:px-3 py-1 bg-cyan-600 hover:bg-cyan-500 rounded text-[11px] sm:text-xs font-semibold
                         transition-colors cursor-pointer flex items-center gap-1"
            >
              ▶ Play
            </button>
          ) : (
            <button
              onClick={controls.pause}
              className="px-2 sm:px-3 py-1 bg-amber-600 hover:bg-amber-500 rounded text-[11px] sm:text-xs font-semibold
                         transition-colors cursor-pointer flex items-center gap-1"
            >
              ⏸ Pause
            </button>
          )}
          <button
            onClick={controls.reset}
            className="px-2 sm:px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-[11px] sm:text-xs font-semibold
                       transition-colors cursor-pointer"
          >
            ↺ Reset
          </button>

          {/* Speed selector */}
          <div className="flex rounded overflow-hidden border border-gray-700">
            {[4, 2, 1.0, 0.5, 0.25].map((s) => (
              <button
                key={s}
                onClick={() => handleSpeedChange(s)}
                className={`px-1 sm:px-1.5 py-1 text-[10px] sm:text-[11px] font-semibold transition-colors cursor-pointer
                  ${activeSpeed === s
                    ? 'bg-gray-600 text-white'
                    : 'bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-gray-300'
                  }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        {/* Time readout */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <div className="font-mono text-[10px] sm:text-xs text-gray-400 tabular-nums whitespace-nowrap">
            t={time.toFixed(3)}s / {duration.toFixed(1)}s
            {scrubTime !== null && (
              <span className="ml-1 text-[9px] sm:text-[10px] text-gray-600">(scrub)</span>
            )}
          </div>
          <SettingsDropdown onRestartTutorial={() => {}} />
        </div>
      </div>

      {/* ─── Main grid (same as ControlRoom minus 3D PortView) ─── */}
      <div className="flex-1 overflow-x-auto">
        <div className="min-w-[768px] h-full grid grid-cols-[1fr_1.5fr_1fr] grid-rows-[1.1fr_1fr] gap-2 p-2 min-h-0">
          {/* Equilibrium */}
          <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
            <EquilibriumCanvas snapshot={displaySnapshot} wallJson={'[]'} limiterPoints={limiterPoints} />
          </div>

          {/* Traces */}
          <div className="col-span-2 bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
            <UnifiedTracePanel
              history={history}
              programJson={'{}'}
              deviceId={deviceId}
              duration={duration}
              finished={finished}
              scrubTime={scrubTime}
              onScrub={controls.setScrubTime}
              elmActive={displaySnapshot?.elm_active ?? false}
            />
          </div>

          {/* Status */}
          <div className="col-span-2 bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
            <StatusPanel
              snapshot={displaySnapshot}
              finished={finished}
              processedProfiles={state.processedProfiles}
              profileTeMax={state.profileTeMax}
              profileNeMax={state.profileNeMax}
              profilePMax={state.profilePMax}
              displayTime={displaySnapshot?.time ?? null}
            />
          </div>

          {/* Info panel (replaces 3D PortView) */}
          <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden flex flex-col items-center justify-center text-gray-500 text-xs p-4">
            <div className="text-cyan-400 text-lg mb-2">📊 World Model Replay</div>
            <div className="text-center space-y-1">
              <p>Device: <span className="text-gray-300">{deviceId.toUpperCase()}</span></p>
              <p>Frames: <span className="text-gray-300">{state.snapshotHistory.length}</span></p>
              <p>Duration: <span className="text-gray-300">{duration.toFixed(1)}s</span></p>
              {displaySnapshot && (
                <>
                  <p>I_p: <span className="text-gray-300">{(displaySnapshot.ip / 1e6).toFixed(2)} MA</span></p>
                  <p>T_e(0): <span className="text-gray-300">{(displaySnapshot.te0 / 1e3).toFixed(1)} keV</span></p>
                  <p>β_N: <span className="text-gray-300">{displaySnapshot.beta_n.toFixed(2)}</span></p>
                  <p>Mode: <span className="text-gray-300">{displaySnapshot.in_hmode ? 'H-mode' : 'L-mode'}</span></p>
                </>
              )}
            </div>
            <button
              onClick={() => { setLoaded(false); controls.reset() }}
              className="mt-4 px-3 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700
                         rounded text-[11px] font-medium transition-colors cursor-pointer"
            >
              Load different episode
            </button>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-gray-900">
        <div
          className="h-full bg-cyan-500 transition-all duration-100"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}
