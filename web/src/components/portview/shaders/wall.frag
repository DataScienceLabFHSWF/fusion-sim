// Wall tile fragment shader
// Grid lines, Fresnel highlights, per-tile variation, depth shading, region coloring.

precision highp float;

uniform vec3 u_tileColor;
uniform vec2 u_gridSpacing;       // poloidal, toroidal
uniform vec2 u_inboardGridSpacing;
uniform vec2 u_limiterGridSpacing;
uniform vec2 u_divertorGridSpacing;
uniform float u_tileGridDarken;
uniform float u_fresnelStrength;
uniform float u_boltHoleScale;        // per-device tile fastener-hole size (0 = none)
uniform float u_boltHoleScaleInboard; // same, for the inboard/centre-column tiles
uniform float u_borderWidth;
uniform float u_totalArc;         // total poloidal arc length in metres
uniform float u_nSlices;          // number of toroidal slices
uniform float u_maxDepth;         // depth range for shading
uniform vec3 u_divertorColor;
uniform float u_hasDivertor;      // 0 or 1
uniform float u_inboardStyle;     // 0 = tiles, 1 = bands
uniform float u_bandWidth;
uniform float u_vertBandWidth;    // vertical (toroidal) banding width; 0 = off
uniform float u_vertBandContrast; // brightness variation between alternating bands

// Strike point illumination
uniform vec4 u_strikePoints[8];   // (x, y, z, intensity) — up to 8
uniform int u_nStrikePoints;
uniform vec3 u_strikeColor;       // per-device glow color for wall illumination

// Extra port positions: (x, y, z, radius) in Cartesian world space
uniform vec4 u_extraPorts[64];
// Extra port shape info: (shape, toroidalExtent, zRadius, 0)
// shape: 0=circle, 1=square, 2=stadium
uniform vec4 u_extraPortInfo[64];
uniform int u_nExtraPorts;

varying vec2 v_uv;
varying vec3 v_normal;
varying vec3 v_viewDir;
varying vec3 v_worldPos;
varying float v_region;
varying float v_depth;

float gridProximity(vec2 pos, vec2 spacing) {
  vec2 cell = pos / spacing;
  vec2 f = fract(cell);
  vec2 dist = min(f, 1.0 - f) * spacing;
  float minDist = min(dist.x, dist.y);
  return smoothstep(0.0, u_borderWidth, minDist);
}

// ── Procedural tile relief ──────────────────────────────────────────
// A height field over the (poloidal, toroidal) wall parametrization gives
// each tile a beveled edge, a slight random tilt, fastener holes, and fine
// graphite grain. The gradient of this field perturbs the normal so tiles
// catch the strike-point light individually instead of reading as a flat
// painted grid.

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Height (metres) of the wall detail at a point in (poloidal-arc, toroidal-arc)
// space. isBands=1 switches to horizontal-band seams only (JET inboard style).
float tileHeight(vec2 pos, vec2 spacing, float isBands, float boltScale) {
  vec2 cell = pos / spacing;
  vec2 id = floor(cell);
  vec2 f = fract(cell);
  vec2 dEdge = min(f, 1.0 - f) * spacing;
  float minDist = isBands > 0.5 ? dEdge.x : min(dEdge.x, dEdge.y);

  // Beveled seam: flat tile surface dropping into the gap over a narrow
  // chamfer (~12 mm) — much narrower than the visual seam darkening width,
  // so tiles stay flat with crisp edges instead of reading pillowed.
  float h = smoothstep(0.0, 0.012, minDist) * 0.0035;

  // Slight random tilt per tile — real tile rows catch light unevenly
  float rx = hash21(id + 7.3) - 0.5;
  float ry = hash21(id + 3.1) - 0.5;
  h += ((f.x - 0.5) * rx + (f.y - 0.5) * ry) * 0.0015 * (1.0 - isBands);

  // Fastener hole dimples (two per tile), only on reasonably large tiles.
  // boltScale = 0 disables them (also avoids a degenerate smoothstep).
  if (isBands < 0.5 && spacing.x > 0.06 && boltScale > 0.01) {
    vec2 local = (f - 0.5) * spacing;  // metres from tile centre
    float holeOffset = 0.25 * spacing.y;
    float d1 = length(local - vec2(0.0, holeOffset));
    float d2 = length(local + vec2(0.0, holeOffset));
    float dh = min(d1, d2);
    h -= (1.0 - smoothstep(0.004 * boltScale, 0.009 * boltScale, dh)) * 0.004;
  }

  // Fine graphite grain
  h += (vnoise(pos * 40.0) - 0.5) * 0.0003;
  return h;
}

// Mask (0..1) of the fastener holes, for albedo darkening.
float tileHoleMask(vec2 pos, vec2 spacing, float isBands, float boltScale) {
  if (isBands > 0.5 || spacing.x <= 0.06 || boltScale <= 0.01) return 0.0;
  vec2 f = fract(pos / spacing);
  vec2 local = (f - 0.5) * spacing;
  float holeOffset = 0.25 * spacing.y;
  float d1 = length(local - vec2(0.0, holeOffset));
  float d2 = length(local + vec2(0.0, holeOffset));
  return 1.0 - smoothstep(0.003 * boltScale, 0.008 * boltScale, min(d1, d2));
}

void main() {
  vec3 Ngeom = normalize(v_normal);
  vec3 V = normalize(v_viewDir);

  // Region-based grid spacing
  int region = int(v_region + 0.5);
  vec2 spacing = u_gridSpacing;
  vec3 baseColor = u_tileColor;

  if (region == 1) { // Inboard
    spacing = u_inboardGridSpacing;
  } else if (region == 2) { // Limiter
    spacing = u_limiterGridSpacing;
  } else if (region == 5 && u_hasDivertor > 0.5) { // Divertor
    spacing = u_divertorGridSpacing;
    baseColor = u_divertorColor;
  } else if (region == 4) { // Antenna — metallic Faraday screen look
    baseColor = vec3(52.0, 50.0, 48.0);
    spacing = u_gridSpacing * 0.6;
  }

  // Poloidal/toroidal position in metres
  vec2 worldUV = vec2(v_uv.x * u_totalArc, v_uv.y * u_nSlices * spacing.y);

  // JET-style horizontal bands on the inboard column?
  float isBands = (region == 1 && u_inboardStyle > 0.5) ? 1.0 : 0.0;
  vec2 reliefSpacing = isBands > 0.5 ? vec2(u_bandWidth, 1000.0) : spacing;

  // Grid proximity (0 at grid line, 1 between lines)
  float gp;
  if (isBands > 0.5) {
    float bandCell = worldUV.x / u_bandWidth;
    float bandF = fract(bandCell);
    float bandDist = min(bandF, 1.0 - bandF) * u_bandWidth;
    gp = smoothstep(0.0, u_borderWidth, bandDist);
  } else {
    gp = gridProximity(worldUV, spacing);
  }

  // Fastener-hole size for this region: the inboard column can differ from
  // the rest of the vessel (e.g. DIII-D's centre column is smooth).
  float boltScale = (region == 1) ? u_boltHoleScaleInboard : u_boltHoleScale;

  // ── Tile relief: perturb the normal with the height-field gradient ──
  float h0 = tileHeight(worldUV, reliefSpacing, isBands, boltScale);
  const float RELIEF_EPS = 0.004;  // 4 mm gradient sample distance
  float hx = tileHeight(worldUV + vec2(RELIEF_EPS, 0.0), reliefSpacing, isBands, boltScale);
  float hy = tileHeight(worldUV + vec2(0.0, RELIEF_EPS), reliefSpacing, isBands, boltScale);
  vec2 hGrad = vec2(hx - h0, hy - h0) / RELIEF_EPS;
  // Tangent frame on the torus: toroidal direction is horizontal around the
  // machine axis; poloidal direction completes the frame with the normal.
  vec3 Ttor = normalize(vec3(-v_worldPos.y, v_worldPos.x, 0.0));
  vec3 Tpol = normalize(cross(Ngeom, Ttor));
  // Fade the relief with distance — the 4 mm gradient samples alias into
  // moiré on far walls, and distant tiles should read flat anyway.
  float reliefFade = clamp(1.0 - v_depth / u_maxDepth * 0.85, 0.15, 1.0);
  vec3 N = normalize(Ngeom - 1.8 * reliefFade * (Tpol * hGrad.x + Ttor * hGrad.y));

  float holeMask = tileHoleMask(worldUV, reliefSpacing, isBands, boltScale);
  float tileRand = hash21(floor(worldUV / reliefSpacing) + 0.5);

  // ── Vertical (toroidal) banding — JET-style octant panels ──
  // Wide vertical bands with alternating brightness and subtle relief lines
  // at band boundaries, extending all the way around poloidally.
  float bandMod = 1.0;
  if (u_vertBandWidth > 0.001) {
    float toroidalPos = v_uv.y * u_nSlices * spacing.y;
    float bandIndex = floor(toroidalPos / u_vertBandWidth);
    float bandFract = fract(toroidalPos / u_vertBandWidth);
    // Alternating brightness
    float isOdd = mod(bandIndex, 2.0);
    bandMod = mix(1.0, 1.0 - u_vertBandContrast, isOdd);
    // Subtle relief groove at band boundaries
    float edgeDist = min(bandFract, 1.0 - bandFract) * u_vertBandWidth;
    float groove = 1.0 - (1.0 - smoothstep(0.0, 0.012, edgeDist)) * 0.4;
    bandMod *= groove;
  }

  // Per-tile brightness variation (per-fragment hash of the actual grid cell)
  float tileVar = 0.90 + tileRand * 0.20; // range 0.90 — 1.10

  // Fine graphite grain modulation on the albedo
  float grain = 0.94 + vnoise(worldUV * 23.0) * 0.12;

  // Depth-based ambient (darker tiles further from camera)
  // Much darker interior — divertor glow should be the primary light source
  float df = clamp(v_depth / u_maxDepth, 0.0, 1.0);
  float depthMod = 0.04 + (1.0 - df) * 0.36;

  // Fresnel (grazing angle brightening)
  // Use abs() so both normal orientations work correctly
  float NdotV = abs(dot(N, V));
  float fresnel = pow(1.0 - NdotV, 4.0) * u_fresnelStrength * 0.4;

  // Pre-pass: accumulated strike heat at this fragment, for thermal
  // discoloration of the tiles around the strike zones (iridescent
  // oxidation rings, cf. JET inboard tiles).
  float heat = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= u_nStrikePoints) break;
    float dist = length(v_worldPos - u_strikePoints[i].xyz);
    heat += u_strikePoints[i].w / (1.0 + dist * dist * 12.0);
  }

  // Combine tile color
  vec3 color = baseColor / 255.0;
  color *= tileVar * grain * depthMod * bandMod;

  // Fastener holes: dark recesses
  color *= 1.0 - holeMask * 0.55;

  // Thermal discoloration: straw → blue-purple rings where strike heat lands
  float ir = clamp(heat * 1.4, 0.0, 1.0);
  vec3 irTint = mix(vec3(1.0),
                    mix(vec3(1.06, 0.98, 0.82),
                        vec3(0.84, 0.88, 1.08),
                        smoothstep(0.35, 0.9, ir)),
                    smoothstep(0.05, 0.4, ir) * 0.6);
  color *= irTint;

  // Grid line darkening
  color *= mix(1.0 - u_tileGridDarken, 1.0, gp);

  // Fresnel highlight
  color += vec3(fresnel);

  // Strike point wall illumination — Lambert term against the relief normal
  // so tile bevels, tilts, and bolt holes catch the divertor light, plus a
  // tight graphite sheen.
  for (int i = 0; i < 8; i++) {
    if (i >= u_nStrikePoints) break;
    vec3 sp = u_strikePoints[i].xyz;
    float intensity = u_strikePoints[i].w;
    vec3 L = sp - v_worldPos;
    float dist = length(L);
    L /= max(dist, 1e-4);
    float falloff = intensity / (1.0 + dist * dist * 12.0);
    float ndl = clamp(dot(N, L), 0.0, 1.0);
    float shade = 0.25 + 0.75 * ndl;   // soft wrap — recycling light scatters
    color += u_strikeColor * falloff * 0.45 * shade;
    // Graphite sheen: tight specular lobe from the glowing strike line
    vec3 H = normalize(L + V);
    float spec = pow(clamp(dot(N, H), 0.0, 1.0), 24.0);
    color += u_strikeColor * spec * falloff * 0.35;
  }

  // ── Extra port openings ──
  // Each port: position (x,y,z,radius) + info (shape, toroidalExtent, zRadius, 0)
  // Decompose 3D offset into poloidal (Z) and toroidal (phi-arc) components
  // on the wall surface, then apply shape-specific distance functions.
  float fragR = length(v_worldPos.xy);
  float fragPhi = atan(v_worldPos.y, v_worldPos.x);
  float fragZ = v_worldPos.z;

  for (int i = 0; i < 64; i++) {
    if (i >= u_nExtraPorts) break;
    vec4 port = u_extraPorts[i];
    if (port.w < 0.001) continue; // empty slot
    vec4 pinfo = u_extraPortInfo[i];

    // Quick 3D reject
    float dist3d = length(v_worldPos - port.xyz);
    if (dist3d > port.w * 3.0) continue;

    // Decompose into wall-surface coordinates
    float portR = length(port.xy);
    float portPhi = atan(port.y, port.x);
    float portZ = port.z;

    float dz = fragZ - portZ;       // poloidal (vertical) offset
    float dphi = fragPhi - portPhi;  // toroidal angle offset
    // Wrap phi to [-pi, pi]
    if (dphi > 3.14159) dphi -= 6.28318;
    if (dphi < -3.14159) dphi += 6.28318;
    float dtor = dphi * portR;       // toroidal arc-length offset

    float rr = port.w;              // radius (half-width in toroidal dir)
    float zR = pinfo.z;             // zRadius (half-height in poloidal dir)
    if (zR < 0.001) zR = rr;
    float shape = pinfo.x;          // 0=circle, 1=square, 2=stadium
    float ext = pinfo.y;            // toroidal half-extent for stadium

    float inside = 0.0;

    if (shape < 0.5) {
      // Circle: simple radial test
      float ellipDist = sqrt((dz * dz) / (zR * zR) + (dtor * dtor) / (rr * rr));
      inside = 1.0 - smoothstep(0.92, 1.0, ellipDist);
    } else if (shape < 1.5) {
      // Square/rectangle: box distance in (dz, dtor)
      float bx = abs(dtor) / rr;
      float by = abs(dz) / zR;
      float boxDist = max(bx, by);
      inside = 1.0 - smoothstep(0.92, 1.0, boxDist);
    } else {
      // Stadium/racetrack: rectangle with semicircle caps, vertically oriented.
      float reducedZ = max(abs(dz) - ext, 0.0);
      float stadDist = sqrt((reducedZ * reducedZ) / (zR * zR) + (dtor * dtor) / (rr * rr));
      // Enforce outer bounding box
      float totalHalfH = zR + ext;
      if (abs(dz) > totalHalfH * 1.1) stadDist = 2.0;
      inside = 1.0 - smoothstep(0.92, 1.0, stadDist);
    }

    if (inside > 0.01) {
      float texType = pinfo.w;  // 0=dark, 1=rf

      if (texType > 0.5) {
        // ── RF emitter / Faraday screen texture ──
        // Modelled after JET A2 ICRH antennas: clusters of downward-angled
        // ridges in 3-4 vertical sections, darker matte gray finish.

        // Wide ridges: angled slightly downward (mix of Z and toroidal)
        // The angle creates a slight diagonal pattern like real Faraday screens
        // Cluster into 3-4 vertical sub-antenna sections within each port.
        float clusterSpacing = rr * 0.55;  // ~3-4 clusters across port width
        float clusterPhase = dtor / clusterSpacing;
        float clusterFract = fract(clusterPhase + 0.5);
        // Narrow dark gap between clusters
        float clusterGap = 1.0 - smoothstep(0.0, 0.06, clusterFract)
                              - (1.0 - smoothstep(0.94, 1.0, clusterFract));

        // Angled ridges that restart at each cluster boundary.
        // Use local toroidal position within the cluster so each sub-antenna
        // grouping starts its ridges from the same vertical baseline.
        // Add a per-cluster phase offset (0.37 ridges) to ensure adjacent
        // clusters never accidentally align even when the geometry allows it.
        float clusterIndex = floor(clusterPhase + 0.5);
        float localTor = (clusterFract - 0.5) * clusterSpacing;
        float ridgeSpacing = 0.045;
        float ridgeCoord = dz + localTor * 0.3;
        float ridgePhase = ridgeCoord / ridgeSpacing + clusterIndex * 0.37;
        float ridgeFract = fract(ridgePhase);
        // Wider, softer ridges
        float ridge = smoothstep(0.0, 0.25, ridgeFract) * (1.0 - smoothstep(0.55, 0.80, ridgeFract));
        ridge *= (1.0 - clusterGap);

        // Near-black matte base — very dark, no shine
        vec3 rfBase = vec3(0.012, 0.013, 0.015);
        // Ridge — barely lighter, fully matte
        vec3 rfRidge = vec3(0.030, 0.032, 0.036);
        // Negligible view-angle highlight
        float rfSheen = pow(NdotV, 6.0) * 0.005;

        vec3 rfColor = mix(rfBase, rfRidge, ridge) + vec3(rfSheen * ridge);

        // Thin border frame
        float borderDist;
        if (shape < 0.5) {
          borderDist = sqrt((dz*dz)/(zR*zR) + (dtor*dtor)/(rr*rr));
        } else if (shape < 1.5) {
          borderDist = max(abs(dtor)/rr, abs(dz)/zR);
        } else {
          float rZ = max(abs(dz) - ext, 0.0);
          borderDist = sqrt((rZ*rZ)/(zR*zR) + (dtor*dtor)/(rr*rr));
        }
        float frame = smoothstep(0.88, 0.92, borderDist) * (1.0 - smoothstep(0.95, 1.0, borderDist));
        rfColor += vec3(0.02) * frame;

        color = mix(color, rfColor, inside);
      } else {
        // ── Dark recess (NBI ports, circular viewports) ──
        // Nearly black center, slightly lighter rim, thin metal lip
        float shade = mix(0.008, 0.03, inside * inside * 0.5);
        // Subtle rim highlight
        float borderDist;
        if (shape < 0.5) {
          borderDist = sqrt((dz*dz)/(zR*zR) + (dtor*dtor)/(rr*rr));
        } else if (shape < 1.5) {
          borderDist = max(abs(dtor)/rr, abs(dz)/zR);
        } else {
          float rZ = max(abs(dz) - ext, 0.0);
          borderDist = sqrt((rZ*rZ)/(zR*zR) + (dtor*dtor)/(rr*rr));
        }
        float rim = smoothstep(0.88, 0.93, borderDist) * (1.0 - smoothstep(0.95, 1.0, borderDist));
        shade += rim * 0.02 * NdotV;

        color = mix(color, vec3(shade), inside);
      }
    }
  }

  gl_FragColor = vec4(color, 1.0);
}
