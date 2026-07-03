# Port View 3D Audit & Improvement Ideas

Audit of `web/src/components/portview/` (the three.js first-person tokamak interior view), with improvement proposals for first-wall realism, plasma appearance, divertor strike-point glow, and ELM visualization. Reference points: DIII-D interior photos (segmented graphite tiles with bolt holes, diagnostic port bands, recessed ICH/helicon antennas), the JET interior (ICRH Faraday screens, inboard guard limiter ribs, iridescent thermal discoloration on the centre column), and the DIII-D unwrapped diagnostic/port map.

---

## 1. How it works today

**Module layout** (~2,700 lines + 324 lines GLSL):

| File | Role |
|---|---|
| `geometry.ts` | Sweeps the device's real limiter contour toroidally into one indexed wall mesh; builds the viewport cylinder |
| `wallMaterial.ts` + `shaders/wall.{vert,frag}` | Custom `ShaderMaterial` — procedural tile grid, region coloring, port decals, strike-point illumination |
| `plasma.ts` | Separatrix + divertor-leg "volume" as 6 (4 for legs) additively-blended offset mesh shells with per-vertex Fresnel |
| `glow.ts` | Strike-point glow: 600 additive point sprites per strike point, geometric strike-point finding |
| `config.ts` | Per-device configs (DIII-D, CENTAUR, ITER, SPARC, JET): camera, tile spacing, ~40–60 ports each, antenna boxes, hand-tuned glow/opacity/power constants |
| `index.tsx` | React orchestration; all sim-driven updates run in a `useEffect` keyed on `snapshot` |
| `postprocessing.ts` | RenderPass → UnrealBloomPass (half-res, str 0.7 / rad 0.4 / thr 0.6) → OutputPass |

**Key facts established by the audit:**

- **The wall is one continuous mesh; tiles are entirely shader-faked.** `buildWallGeometry` (`geometry.ts:16-218`) sweeps the densified limiter contour through 100 toroidal slices. "Tiles" are a world-space grid pattern in `wall.frag:64-69` (`gridProximity`: `fract()` distance to cell boundary → `smoothstep` dark seam) plus a ±8% per-tile brightness jitter from a build-time hash baked into a vertex attribute (`wall.frag:127`). No bevels, no normal/bump mapping, no image textures anywhere, flat per-quad normals.
- **Only the main viewport is a real hole.** All other ports (up to 64) are per-fragment SDF decals in a uniform array (`wall.frag:159-292`) — circle/square/stadium shapes with a painted-on "dark recess" gradient or a procedural "rf" ridged Faraday-screen pattern. No depth, no occlusion, no geometry.
- **The divertor is a paint job.** `WallRegion.Divertor` is a Z-threshold classification (`geometry.ts:70-72`) that swaps tile color/spacing — no plates, baffles, or shelf geometry. Only CENTAUR and JET even define `divertorRegion`; DIII-D, ITER, SPARC fall through to generic regions.
- **The plasma is honest to the equilibrium.** Shell geometry is built from the solver's actual separatrix contour (elongation/triangularity/X-points come from physics, `plasma.ts:313-322`), with correct double-null handling and legs truncated at the wall. Limb brightening is per-vertex JS Fresnel, additively blended — no fragment shader, no raymarching. Color responds **only to `te0`** (`plasma.ts:788-792`).
- **Strike-point positions are physical; strike-point brightness is not.** `glow.ts:250-330` correctly intersects separatrix legs with the wall polygon. But intensity = hand-tuned `DEVICE_POWER_SCALE` constant × fixed `GLOW_INTENSITY`, gated by a flat-top state machine, and positions are **frozen** once glow activates (`index.tsx:380-393`).
- **ELMs are a global flash.** `elm_active` → uniform 5× brightness multiply + white shift on every plasma vertex (`plasma.ts:46-48, 794-795`). No filaments, no mode structure, no helicity, no decay envelope.
- **Disruption = clear-color flash.** Plasma vanishes instantly; the renderer clear color flashes red-orange and decays (`index.tsx:423-464`). No precursor, no vessel response.
- **A rich divertor physics model already exists and is unused by the 3D view.** `computeDivertorHeatFlux` (`fusionPhysics.ts:423-553`, Eich/Loarte/Pitts-based) returns `q_peak`, `q_interELM`, `lambda_q`, `p_sol`, `f_detach`, `elm_q`, `tau_elm`, `wall_material`, and `DivertorThermalModel` integrates per-tile surface temperature — all consumed only by `StatusPanel`. The port view reimplements a cruder proxy.

### Unused data already plumbed or one hop away

PortView consumes ~17 of ~55 snapshot fields. Available but unused, roughly in order of visual value:

| Quantity | Where | Obvious visual use |
|---|---|---|
| `q_peak`, `lambda_q`, `f_detach`, `elm_q`, `tau_elm`, `t_surface` | `computeDivertorHeatFlux` / `DivertorThermalModel` | Physically-driven strike glow (§4) |
| `q95` | snapshot | Field-line pitch for ELM filament helicity (§5) |
| `elm_energy_loss`, `elm_type` | snapshot (already latched in `useSimulation.ts:232-245`) | Per-event ELM size/character |
| `disruption_risk`, `diagnostics.locked_mode` | snapshot | Graduated pre-disruption visuals |
| `ne_bar`, `f_greenwald`, `ne_ped`/`te_ped` | snapshot | Edge glow density scaling, MARFE onset, H-mode pedestal sharpness |
| `impurity_fraction`, `neon_puff`, `d2_puff` | snapshot | Plasma/divertor color shifts (seeding, detachment), gas-puff plume |
| `p_rad`, `p_fus`/`q_plasma` | snapshot / `computeFusion` | Radiative dimming; core brightness by fusion power |
| `is_limited`, `magnetic_config` | snapshot | Authoritative topology instead of inferring from `xpoint_r > 0` |
| `betaN`, `fluxSurfaces`, `axisZ` | **already passed into `plasmaGroup.update()` but never read** (`plasma.ts:75,77,85`) | Wire in or delete |

---

## 2. Defects & housekeeping found during the audit

1. **Dead code:** `buildExtraPortDecals` (`geometry.ts:445-536`) and `createExtraPortMaterial` (`wallMaterial.ts:149-191`) are fully implemented but never imported. Delete or adopt (§3.3 suggests adopting a geometry approach for large ports).
2. **Dead uniforms/params:** `params.betaN`, `params.fluxSurfaces`, `params.axisZ` accepted by `plasma.ts` `update()` but never read. `u_nExtraPorts` exists but the shader loop ignores it.
3. **Per-fragment port loop always runs 64 iterations** (`wall.frag:167`) with `continue` on empty slots, unlike the strike loop which breaks at `u_nStrikePoints` (`wall.frag:151`). One-line fix: `if (i >= u_nExtraPorts) break;`. This is the wall shader's main hotspot on mobile GPUs.
4. **Stale comment:** bloom tuning comment in `postprocessing.ts:29-31` cites 0.5/0.8/0.5; code uses 0.6/0.7/0.4.
5. **No disposal on final unmount:** the mount-effect cleanup (`index.tsx:121-127`) disposes only the renderer; wall/port/plasma/glow geometries and materials leak GPU memory if the component unmounts without a prior rebuild.
6. **RAF loop never pauses** — no `document.visibilityState` / IntersectionObserver gating; bloom compositing runs even when the sim is paused or the tab is hidden.
7. **Frozen strike points:** once flat-top glow activates, strike positions never track the equilibrium again (`index.tsx:380-393`) — wrong during slow ramp-down or strike-point sweeps. Replace freeze with an exponential moving average (low-pass) of the physical strike position: kills jitter, keeps drift.
8. **Glow shimmer is throttled to physics-tick rate**, not display rate: `glow.update()` is called from the snapshot effect, not the RAF loop, so flicker/jitter animation stutters if ticks are slow. Move time-based animation into `animate()`.
9. **Topology inferred, not read:** diverted/double-null state derived from `xpoint_r > 0` rather than `is_limited`/`magnetic_config`.

---

## 3. First wall & in-vessel structure realism

The reference photos suggest the wall reads "real" because of four things the current view lacks: **per-tile depth** (bevels, gaps, slight misalignment), **surface response to light** (graphite sheen, metallic panels), **discrete hardware** (bolt holes, antennas with actual Faraday-screen bars, recessed ports with visible depth), and **history** (thermal discoloration, erosion darkening near the divertor).

### 3.1 Per-tile relief without geometry (biggest visual win / effort ratio)

Stay with the single swept mesh, but upgrade `wall.frag`:

- **Procedural normal perturbation at tile seams.** The grid function already knows the distance to the nearest seam. Take its screen-space or analytic gradient and tilt the normal into the gap over the `u_borderWidth` band — every tile gets a beveled edge that catches the strike-point light and Fresnel term. This is ~15 lines of GLSL and transforms the look, because the strike-point illumination (`wall.frag:150-157`) is already per-fragment and directional.
- **Per-tile identity in the fragment shader.** Compute the cell ID from the same world-space poloidal/toroidal coordinates used for the grid (`floor(pos / spacing)`) and hash it in-shader, instead of (or in addition to) the baked vertex attribute. That unlocks per-tile: slight normal tilt (each tile a fraction of a degree off — the DIII-D photo's tile rows visibly catch light differently), brightness/hue variation, and discoloration (below). The baked `a_tileHash` can then be removed.
- **Bolt/dowel holes.** DIII-D graphite tiles show 1–2 small dark fastener holes per tile. In tile-local coordinates (`fract(pos/spacing)`), draw 1–2 small dark discs with a tiny normal dimple, position jittered by tile hash. Cheap, and instantly reads "engineered."
- **Graphite grain / roughness.** A 2-3 octave value-noise (or a small tiling noise texture — loading one 256² texture is fine and cheaper than 3 octaves of ALU) modulating brightness at ~1–3 cm scale, plus a slightly stronger anisotropic sheen along the toroidal direction for the inboard column (JET's centre column shows strong vertical/horizontal brushed structure).
- **Thermal discoloration bands.** The JET photo's most striking feature: iridescent blue/straw/purple oxidation bands on the inboard midplane tiles. Procedurally: a poloidal-band mask (Gaussian in arc-length around the midplane and around the strike zones) blending toward an iridescence ramp (straw → magenta → blue as a function of the noise + band intensity). Static per device is already convincing; §4 upgrades the strike-zone part to live temperature.
- **Erosion/deposition darkening** near the divertor region boundary — a subtle darkening gradient into the divertor, plus lighter "leading edge" tile edges there.

All of the above is per-fragment ALU with no new draw calls. If mobile perf becomes a concern, bake it once per device into an albedo+normal texture atlas rendered to a `WebGLRenderTarget` at device load, then sample two textures in a trivially cheap wall shader.

### 3.2 Real RF antennas (ICRH Faraday screens)

Both photos show what the flat `'rf'` decal can't fake: recessed boxes with rows of horizontal cylindrical bars and a protective frame of brighter limiter tiles. Build a small reusable antenna module as real geometry:

- One `InstancedMesh` of cylinders (the screen bars, ~15–30 instances), a recessed back plate (dark, emissive-none), and a raised graphite frame around the opening (reuses the tile shader with `WallRegion.Limiter` styling).
- Place at the existing `antennae` config boxes (`config.ts`), oriented to the local wall normal via `sampleContourAtAngle`. 2–4 antennas per device × ~3 draw calls each is negligible.
- Optionally modulate a faint emissive tint on the bars by `prog_p_ich`/`prog_p_ech` when RF is on — the sim already programs those waveforms, and it gives players a visual cue that heating is live.

Keep the shader `'rf'` decal for far/small antenna ports; use geometry for the 1–3 prominent ones near the camera.

### 3.3 Ports with actual depth

- **Promote the ~6–10 largest/closest ports per device to real recessed geometry:** short inward-extruded cylinders/stadium tubes with a dark interior gradient and a metallic rim ring, using the (currently dead) decal machinery as a starting point — or better, actually cut the wall quads (the `portTest` skip logic in `buildWallGeometry:46-54` already does this for the main viewport; generalize it to N ports) and insert a tube mesh per port. Parallax from a real cavity is what the SDF decal can never deliver at grazing angles.
- Keep distant/small ports as decals, but add a **rim highlight normal tilt** (bright top edge, dark bottom, from the strike-glow direction) so they stop looking sticker-flat.
- Some DIII-D ports contain visible hardware (mirrors, graphite louvers, pyrometer tubes — see the unwrapped map). One or two "hero" ports near the camera with a simple prop inside (angled mirror disc, tube) sell the whole wall.

### 3.4 Distinct divertor and centre-column structure

- **Divertor geometry:** give DIII-D-family devices a real lower divertor — a shelf/baffle profile (3–5 extra contour points in the wall polygon region below the X-point, or a separate swept strip mesh for the target plates) with its own tile pattern (radial rails, tighter toroidal spacing, like the DIII-D floor). Since the wall is contour-driven, the cleanest path is enriching the device wall contour itself near the divertor and adding a `divertorRegion` entry for DIII-D/ITER/SPARC (currently missing).
- **Centre column:** JET/DIII-D inboard walls read as a distinct massive column. Cheap version: `inboardStyle: 'bands'` everywhere plus stronger vertical panel joints and the anisotropic sheen from §3.1. Better: a separate inboard cylinder mesh with faceted panels (JET's inboard guard limiter ribs) — the region classification (`R < axisR*0.85`) already identifies it.

---

## 4. Divertor glow: wire in the physics you already have

Replace the hand-tuned `DEVICE_POWER_SCALE` pipeline with `computeDivertorHeatFlux` + `DivertorThermalModel` (both exist, referenced to Eich 2013 / Loarte 2003 / Pitts 2009, and are already stepped for `StatusPanel`):

- **Brightness ← `q_peak` / `q_interELM`** (log-scaled), instead of a per-device constant. The D-D vs D-T halving and flat-top gating heuristics mostly fall out for free because `p_sol` already encodes them.
- **Glow band width ← `lambda_q` × flux expansion.** The point-sprite cloud in `glow.ts` takes its R/Z jitter amplitude from config; drive it from the physical SOL width instead, so ITER's few-mm λ_q reads as a razor-thin brilliant line and DIII-D's is a softer band.
- **Tile color ← `t_surface` blackbody.** Map the thermal model's surface temperature to incandescence (nothing below ~550 °C, dull red ~700, orange ~950, yellow-white 1200+) and feed it into `u_strikeColor` / a new per-strike color, replacing the static per-device tint. Carbon (DIII-D) vs tungsten (`wall_material`) can set slightly different emissivity/tint. This also gives a beautiful free effect: **afterglow** — tiles cool over seconds after the pulse ends or the strike point moves.
- **Detachment ← `f_detach`.** As detachment fraction rises (density/neon seeding), the bright attached strike line should dim and be replaced by a soft volumetric radiating blob lifted off the plate toward the X-point (reuse the leg-shell technique with a localized bright region that migrates up the leg as `f_detach → 1`). This is one of the most physically meaningful visuals a tokamak sim can show, the model already computes it, and neon-seeding (`neon_puff`) gives it a color hook (colder, redder radiation zone).
- **ELM strikes ← `elm_q` + `tau_elm`:** on each ELM, flash the strike glow with the ELM heat-flux contribution decaying over the deposition timescale (visually stretched), synchronized with the filament impact (§5).
- **Unfreeze strike points** (defect #7): EMA-filter the physical position instead of freezing it, so slow sweeps and ramp-downs track.

Also worth considering: the strike-point wall illumination loop (`wall.frag:150-157`) uses isotropic 1/(1+12d²) falloff from point samples. Replacing the 5-point phi sampling with a proper **line/ring light integral** (analytic ring-light approximation using distance to the strike circle in R-Z and in phi separately) removes the visible "beads" of light toroidally and lights the divertor slot more like the continuous glowing ring it is.

---

## 5. ELMs with 3D filament helicity

Currently `elm_active` → whole-plasma 5× flash. A physically-shaped upgrade, in increasing order of effort:

**5.1 Make the flash an event, not a state.** Detect the rising edge, drive an intensity envelope (fast ~30 ms rise, ~150–300 ms decay stretched for visibility), scale peak by `elm_energy_loss / w_th`, and localize it: weight the per-vertex flash by poloidal position so it's strongest at the outboard midplane and pedestal (an `exp(-((θ-θ_omp)/σ)²)` mask over the existing per-vertex color loop). Type-I vs Type-III (`elm_type`) → big/rare vs small/frequent envelopes. This alone fixes "the whole plasma blinks."

**5.2 Helical filament ropes (the marquee feature).** ELM filaments are field-aligned flux ropes torn from the pedestal, ejected radially while following the local field-line pitch. The sim already provides everything needed:

- **Geometry:** for each filament, generate a curve on an offset separatrix surface: start at pedestal radius near the outboard midplane at random toroidal angle φ₀, and advance in poloidal angle θ while advancing toroidally with the field-line pitch, **dφ = q(θ-dependent pitch ≈ q95) · dθ** — i.e. the same parametrization as the separatrix contour (`sampleContourAtAngle` / the contour arc table in `plasma.ts` can supply R(θ), Z(θ)), pushed outward by a growing radial offset Δr(t). Sweep ~±60–120° of poloidal extent per filament. Render each as a `TubeGeometry` ribbon or, cheaper, reuse the additive point-sprite technique from `glow.ts` (points along the curve, Gaussian sprite, additive) — the sprite approach needs zero new materials and matches the existing soft-glow aesthetic.
- **Population:** spawn n ≈ 8–16 filaments (real Type-I ELMs show toroidal mode numbers n ~ 10–20) at quasi-regular toroidal spacing with jitter; count and brightness scale with `elm_energy_loss`.
- **Lifecycle:** over the event envelope: (1) brighten in place at the pedestal, (2) accelerate radially outward (Δr from 0 to ~10–20 cm) while the footpoint stays field-aligned — this is what makes them visibly *helical* rather than radial spokes, (3) fade as they cross the SOL, (4) hand off to a strike-glow flash (§4 `elm_q`) with a short delay. Total visual duration ~200–400 ms.
- **Perf:** pool the buffers like everything else in this module (e.g. 16 filaments × 200 points, pre-allocated `Float32Array`, `DynamicDrawUsage`); the whole system is one extra draw call and a small per-frame CPU loop, same order as the existing 4,800-point glow cloud.
- The curve math is ~50 lines; the pitch is the first real consumer of `q95`, which also makes the visualization *teach* something — filaments visibly wind tighter at low q95.

**5.3 Optional pedestal texture between ELMs:** a faint slowly-drifting striation pattern on the plasma edge (per-vertex brightness modulated by `sin(n·φ + m·θ + ωt)` with low amplitude) hints at edge turbulence and makes the ELM ejection feel like it grows out of something rather than appearing from nowhere.

---

## 6. Plasma appearance (bulk)

- **Density and radiation in the color/opacity model.** Keep `te0` → hue, and add: `ne_bar` (or `ne_ped`) → edge shell opacity (denser edge = brighter recycling glow); `p_rad/p_loss` → overall emission boost with a color pull toward the impurity line color; `impurity_fraction`/`neon_puff` → tint (carbon: subtle blue-green; neon: orange-red). Fuel is already known (`mass_number`) — pure D magenta-pink vs D-T slightly whiter core is a nice touch.
- **H-mode vs L-mode distinction.** Currently `in_hmode` changes nothing visually. In H-mode, tighten the shell stack (smaller `SHELL_OFFSETS` spread or higher Fresnel exponent) so the edge reads as a sharp pedestal skin; in L-mode use the current fuzzier profile. The transition itself (a visible "sharpening" at the L-H transition) is a great pedagogical beat and is just lerping two constants.
- **MARFE / density-limit cue:** as `f_greenwald → 1`, grow a localized soft glow blob on the inboard midplane (same sprite technique). Pairs naturally with `disruption_risk`.
- **Sawteeth** (if/when the core model exposes them): periodic subtle core brightness collapse-and-recover. Low priority.
- **Use or remove the dead `betaN`/`fluxSurfaces`/`axisZ` params.** `fluxSurfaces` could drive 1–2 faint interior shells at ψ ≈ 0.7, 0.9 to give the core internal structure when viewed edge-on.

## 7. Disruptions & precursors

- **Precursor stage:** `disruption_risk` and `diagnostics.locked_mode` are continuous/leading signals. Map risk > ~0.5 to a growing m/n=2/1-style wobble (low-frequency per-vertex displacement of the shell radii, `cos(2θ - φ + ωt)`), brightness flicker, and a cold-front color shift. Locked mode → the wobble *stops rotating* (locks in φ) — subtle, physical, and ominous.
- **The crash itself:** replace instant-vanish + clear-color flash with a ~4-frame sequence: plasma column shifts vertically (VDE-like, direction from `xpoint` dominance), compresses, whole-wall illumination spike (reuse the strike uniform array at high intensity across many phi points), then vanish into the existing decaying flash. Even 10 frames of choreography reads dramatically better than a screen tint.

## 8. Integration & performance items

- Bound the port loop with `u_nExtraPorts` (defect #3) and delete the dead decal code (#1).
- Move time-based animation (glow shimmer, ELM envelopes, filament motion) into the RAF `animate()` loop with sim state read from a ref, so animation is smooth at display rate while physics updates at tick rate (#8).
- Pause the RAF loop on `document.visibilityState === 'hidden'` / IntersectionObserver (#6); dispose geometries+materials on unmount (#5).
- A shared "PortView physics adapter": one function that derives the full visual parameter set (`DivertorState`, `FusionState`, ELM event queue, EMA-filtered strike points) from a snapshot, unit-testable, keeping `index.tsx`'s effect from growing more ad-hoc state machines than it already has (the flat-top detector is ~100 lines of refs).
- Consider emitting strike-point (R,Z) from the Rust equilibrium directly in the snapshot eventually — the JS wall-intersection duplicate can then be deleted and physics/visuals can't disagree.

---

## 9. Suggested priority order

| # | Item | Impact | Effort |
|---|---|---|---|
| 1 | Wire `computeDivertorHeatFlux`/thermal model into glow (§4: q_peak, λ_q, t_surface blackbody, afterglow) | Very high — the room's main light source becomes physical | Medium |
| 2 | Tile relief in `wall.frag` (§3.1: seam bevel normals, per-tile tilt, bolt holes, grain) | Very high — fixes "flat CG wall" at a stroke | Low-medium |
| 3 | ELM event envelope + outboard localization (§5.1) | High | Low |
| 4 | Helical ELM filaments (§5.2, uses `q95`, `elm_energy_loss`) | High — marquee feature | Medium |
| 5 | Detachment visual + neon seeding color (§4) | High, pedagogically unique | Medium |
| 6 | Thermal discoloration + erosion bands (§3.1) | Medium-high | Low |
| 7 | Real ICRH antenna module (§3.2) | Medium-high near camera | Medium |
| 8 | Recessed geometry for hero ports (§3.3) | Medium | Medium |
| 9 | H-mode pedestal sharpening, density/impurity color (§6) | Medium | Low |
| 10 | Disruption precursor wobble + crash choreography (§7) | Medium | Medium |
| 11 | Divertor plate/centre-column geometry (§3.4) | Medium | Medium-high |
| 12 | Housekeeping: port-loop break, dead code, disposal, RAF pause, strike EMA (§2) | Correctness/perf | Low |

Items 1–3 together would likely change the perceived quality of the view more than everything else combined: physically-lit incandescent divertor tiles, beveled graphite in that light, and ELMs that behave like events.
