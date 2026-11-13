/* Shared helpers for all 3D themes (labels, textures, vehicle motion). */

import * as THREE from 'three';
import { TRACK_LENGTH, mulberry32 } from '../world.js';

export const expK = (k, dt) => 1 - Math.exp(-k * dt);

export function canvasTexture(draw, w = 256, h = 128) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function radialGlowTexture(color = '#ffd9a0') {
  return canvasTexture((ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, color + 'cc');
    g.addColorStop(0.45, color + '33');
    g.addColorStop(1, color + '00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, 128, 128);
}

/* ---------------- procedural PBR texture kit ------------------------------
 * Tileable seeded value-noise height field → albedo / tangent-space normal /
 * roughness canvas textures. Canvas-generated NORMAL + ROUGHNESS maps give the
 * big ground planes real micro-relief and tonal breakup with zero asset files
 * (SPEC §1.1: no deps/downloads needed; canvas textures are the sanctioned
 * path). Everything is built ONCE at theme create — never inside update()
 * (SPEC §1.3: no per-frame allocations). */

function _noiseTile(size, latX, latY, seed) {
  const rng = mulberry32(seed);
  const g = new Float32Array(latX * latY);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const out = new Float32Array(size * size);
  const sx = latX / size, sy = latY / size;
  for (let y = 0; y < size; y++) {
    const fy = y * sy, iy = Math.floor(fy), ty = fy - iy;
    const y0 = iy % latY, y1 = (iy + 1) % latY;
    const wy = ty * ty * (3 - 2 * ty);
    const r0 = y0 * latX, r1 = y1 * latX;
    for (let x = 0; x < size; x++) {
      const fx = x * sx, ix = Math.floor(fx), tx = fx - ix;
      const x0 = ix % latX, x1 = (ix + 1) % latX;
      const wx = tx * tx * (3 - 2 * tx);
      const a = g[r0 + x0], b = g[r0 + x1], c = g[r1 + x0], d = g[r1 + x1];
      out[y * size + x] = a + (b - a) * wx + (c - a) * wy + (a - b - c + d) * wx * wy;
    }
  }
  return out;
}

/* multi-octave tileable fbm; `stretch` anisotropizes the cells (dune ripples) */
function _fbmTile(size, { seed, octaves, firstLattice, gain, stretch = 1 }) {
  const out = new Float32Array(size * size);
  let amp = 1, total = 0, lat = firstLattice, s = seed >>> 0;
  for (let o = 0; o < octaves; o++) {
    s = (s + 0x9E3779B9) >>> 0;
    const n = _noiseTile(size, lat, Math.max(2, Math.round(lat * stretch)), s);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp; amp *= gain; lat *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function _wrapTex(c, { srgb = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4; // ground planes are seen at grazing angles — keep detail
  return t;
}

const _hexCache = {};
function hexRGB(hex) {
  if (!_hexCache[hex]) {
    const n = parseInt(hex.slice(1), 16);
    _hexCache[hex] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return _hexCache[hex];
}

/* ['#hex', '#hex', …] → (h 0..1) → [r,g,b] — color-ramp helper for albedos */
export function rampHex(stops) {
  const rgbs = stops.map(hexRGB);
  return (h) => {
    const t = Math.min(0.9999, Math.max(0, h)) * (rgbs.length - 1);
    const i = Math.floor(t), f = t - i;
    const a = rgbs[i], b = rgbs[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  };
}

/* Build { map, normalMap, roughMap } from ONE seeded noise field.
 * color(h,u,v) → [r,g,b] 0..255 · rough(h) → 0..1 · normalStrength scales the
 * relief (height deltas are ~±0.05, so strength 2–6 gives believable bumps).
 * `macro` (optional): a second, much coarser fbm field blended into the albedo
 * — real terrain shows large tonal patches (dry vs lush grass, wet vs dry
 * sand) that fine-grain noise alone cannot give (critic r10 #4). */
export function makeGroundPBR({
  size = 256, seed = 11, octaves = 5, firstLattice = 4, gain = 0.5, stretch = 1,
  color, rough = null, normalStrength = 0.8, macro = null,
} = {}) {
  const h = _fbmTile(size, { seed, octaves, firstLattice, gain, stretch });
  let lo = 1, hi = 0;
  for (let i = 0; i < h.length; i++) { if (h[i] < lo) lo = h[i]; if (h[i] > hi) hi = h[i]; }
  const span = (hi - lo) || 1;
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - lo) / span;

  let macroField = null;
  if (macro) {
    macroField = _fbmTile(size, {
      seed: (macro.seed ?? (seed * 7 + 13)) >>> 0,
      octaves: macro.octaves ?? 3,
      firstLattice: macro.firstLattice ?? 3,
      gain: macro.gain ?? 0.5,
      stretch: macro.stretch ?? 1,
    });
    lo = 1; hi = 0;
    for (let i = 0; i < macroField.length; i++) { if (macroField[i] < lo) lo = macroField[i]; if (macroField[i] > hi) hi = macroField[i]; }
    const mspan = (hi - lo) || 1;
    for (let i = 0; i < macroField.length; i++) macroField[i] = (macroField[i] - lo) / mspan;
  }

  const albedoC = document.createElement('canvas');
  albedoC.width = albedoC.height = size;
  {
    const ctx = albedoC.getContext('2d');
    const img = ctx.createImageData(size, size);
    const d = img.data;
    const amt = macro ? macro.amount ?? 0.35 : 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let c = color(h[i], x / size, y / size);
      if (macro) {
        const m = macro.color(macroField[i], x / size, y / size);
        c = [c[0] + (m[0] - c[0]) * amt, c[1] + (m[1] - c[1]) * amt, c[2] + (m[2] - c[2]) * amt];
      }
      d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  let normalMap = null;
  if (normalStrength > 0) {
    const nc = document.createElement('canvas');
    nc.width = nc.height = size;
    const ctx = nc.getContext('2d');
    const img = ctx.createImageData(size, size);
    const d = img.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const xl = (x - 1 + size) % size, xr = (x + 1) % size;
      const yu = (y - 1 + size) % size, yd = (y + 1) % size;
      const dx = (h[y * size + xr] - h[y * size + xl]) * normalStrength;
      const dy = (h[yd * size + x] - h[yu * size + x]) * normalStrength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      d[i] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      d[i + 1] = Math.round((dy * inv * 0.5 + 0.5) * 255);
      d[i + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    normalMap = _wrapTex(nc, {});
  }

  let roughMap = null;
  if (rough) {
    const rc = document.createElement('canvas');
    rc.width = rc.height = size;
    const ctx = rc.getContext('2d');
    const img = ctx.createImageData(size, size);
    const d = img.data;
    for (let i = 0; i < h.length; i++) {
      const v = Math.round(Math.min(1, Math.max(0, rough(h[i]))) * 255);
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    roughMap = _wrapTex(rc, {});
  }

  return { map: _wrapTex(albedoC, { srgb: true }), normalMap, roughMap };
}

/* View-angle Fresnel on the SPECULAR IBL term — onBeforeCompile patch for
 * MeshStandardMaterial (core shader surgery, no addons). Real surfaces mirror
 * mostly at grazing angles: from the chase camera the far water/ground is seen
 * grazing (fN→1) while the near field is steep (fN→0), so envSpecular =
 * envMapIntensity * (base + rim * (1-N·V)^exp) puts the sky mirror at the
 * horizon and a darker, denser color underfoot — exactly what a river photo
 * shows (critic r10 #1). The anchor is the vendored r160 chunk
 * `envmap_physical_pars_fragment` whose getIBLRadiance ends with
 * `return envMapColor.rgb * envMapIntensity;` (vendor line ~13926) — the
 * diffuse irradiance return differs, so the replace hits the specular lobe
 * only. onBeforeCompile runs BEFORE resolveIncludes (vendor 30038 vs 20201),
 * so the include is swapped with the runtime ShaderChunk text, not raw GLSL. */
export function applyFresnelEnv(mat, { base = 0.35, rim = 0.65, exp = 3.0 } = {}) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFresBase = { value: base };
    shader.uniforms.uFresRim = { value: rim };
    shader.uniforms.uFresExp = { value: exp };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', [
        '#include <common>',
        'uniform float uFresBase;',
        'uniform float uFresRim;',
        'uniform float uFresExp;',
      ].join('\n'))
      .replace(
        '#include <envmap_physical_pars_fragment>',
        THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
          'return envMapColor.rgb * envMapIntensity;',
          [
            'float fN = 1.0 - abs( dot( normal, viewDir ) );',
            'float fres = uFresBase + uFresRim * pow( fN, uFresExp );',
            'return envMapColor.rgb * envMapIntensity * fres;',
          ].join('\n\t\t\t')
        )
      );
  };
  mat.customProgramCacheKey = () => 'fresnel-env';
  return mat;
}

/* ---------------- deterministic dune/terrain relief -----------------------
 * Value-noise sampler over world XZ (no tiling, seeded) + a plane displacer.
 * Big flat ground planes read fake because their horizon is a perfectly
 * straight line; ±2m undulation beyond the play corridor breaks it (SPEC:
 * vertex displacement encouraged). Built once at create(), never per frame. */

function _ihash2(ix, iz, s) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function _vnoise2(fx, fz, s) {
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const wx = tx * tx * (3 - 2 * tx), wz = tz * tz * (3 - 2 * tz);
  const a = _ihash2(ix, iz, s), b = _ihash2(ix + 1, iz, s);
  const c = _ihash2(ix, iz + 1, s), d = _ihash2(ix + 1, iz + 1, s);
  return a + (b - a) * wx + (c - a) * wz + (a - b - c + d) * wx * wz;
}

/* (x, z) → 0..1, feature size ≈ `cell` world units, `octaves` detail layers */
export function makeDunes(seed, { cell = 90, octaves = 3, gain = 0.5 } = {}) {
  return (x, z) => {
    let amp = 1, total = 0, sum = 0, c = cell, s = seed >>> 0;
    for (let o = 0; o < octaves; o++) {
      s = (s + 0x9E3779B9) >>> 0;
      sum += _vnoise2(x / c, z / c, s) * amp;
      total += amp; amp *= gain; c *= 0.5;
    }
    return sum / total;
  };
}

/* Displace a ground PlaneGeometry BEFORE the standard rotation.x = -π/2 flip
 * (local +z == world up, local +y == world -z). fadeFn(worldX, worldZ) → 0..1
 * gates the amplitude — return 0 across the play corridor so vehicles, props
 * and lane markers stay flat. Mutates geometry, recomputes smooth normals. */
export function displaceGroundPlane(geo, sampler, { amp = 2, fadeFn = null } = {}) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = -pos.getY(i); // local y maps to world -z
    const k = fadeFn ? fadeFn(x, z) : 1;
    pos.setZ(i, (sampler(x, z) - 0.5) * 2 * amp * k);
  }
  geo.computeVertexNormals();
}

/* Irregularize a polyhedron (rocks/asteroids/cliffs): push each vertex along
 * its radial direction by seeded noise of its POSITION — position-keyed so
 * duplicated (non-indexed) verts stay watertight. Clean dodecahedra read as
 * props; lumpy silhouettes read as rock (SPEC: vertex displacement). */
export function jitterRock(geo, { amp = 0.25, seed = 7, freq = 2.2 } = {}) {
  const pos = geo.attributes.position;
  const n = makeDunes(seed, { cell: 1 / freq, octaves: 2, gain: 0.5 });
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = v.length();
    const k = 1 + (n(v.x, v.y * 7.13 + v.z) - 0.5) * 2 * amp;
    v.multiplyScalar(k);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/* ---------------- gradient sky dome with a real sun disc -------------------
 * One ShaderMaterial dome per theme: eased 3-stop atmospheric gradient
 * (zenith → mid → horizon haze), plus a REAL sun — a ~2°-wide HDR disc with a
 * tight warm corona placed at the sunRig azimuth. The old 90-unit sprite disc
 * read as a washed blob and was invisible by day in half the themes; a small
 * bright disc is what a photo shows (critic r10 brief #2/#6). Uniforms are
 * written ONLY from setTimeOfDay — never per frame. */
export function createSkyDome(radius = 620) {
  const uniforms = {
    uZenith:  { value: new THREE.Color('#2f6ad0') },
    uMid:     { value: new THREE.Color('#5a9be0') },
    uHorizon: { value: new THREE.Color('#bfdff2') },
    uSunDir:  { value: new THREE.Vector3(0, 1, 0) },
    uSunTint: { value: new THREE.Color('#fff2d8') },
    uSunI:    { value: 0 },
  };
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 32, 20),
    new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uZenith, uMid, uHorizon, uSunTint, uSunDir;
        uniform float uSunI;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          // stops tuned for the chase camera: it only sees up to ~25° elevation,
          // so the ZENITH must blend in INSIDE the frame — the r10 stops kept
          // the visible sky at uMid (pale) and the rocket-day sun sat in a
          // washed haze (probe: sky-top mean RGB (98,135,172) vs the deep blue
          // of refs/real-world/real-day-launch.jpg). Zenith now lands by h≈0.42.
          vec3 col = mix(uHorizon, uMid, smoothstep(0.01, 0.16, h));
          col = mix(col, uZenith, smoothstep(0.09, 0.42, h));
          // below the horizon the dome falls into pure haze (matches ground fog)
          col = mix(uHorizon, col, smoothstep(-0.06, 0.015, h));
          float c = dot(d, normalize(uSunDir));
          float disc = smoothstep(0.99980, 0.99996, c);   // ~1° core, HDR-bright
          float corona = pow(max(c, 0.0), 2000.0);        // tight warm rim (~2°)
          float halo = pow(max(c, 0.0), 400.0) * 0.12;    // compact glare — the
          // old pow(150)*0.25 + wide gradient kept a pale 15° wash around the
          // sun (probe: luma 0.87 at 2-4°, 0.6 plateau to 24°; r11 re-tune)
          col += uSunTint * (disc * 5.5 + corona * 1.1 + halo) * uSunI;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    })
  );
  return mesh;
}

/* shared setTimeOfDay → dome uniform writer (no per-frame use) */
export function setSkyDome(sky, tod) {
  const u = sky.material.uniforms;
  u.uZenith.value.set(tod.skyTop);
  u.uMid.value.set(tod.skyMid);
  u.uHorizon.value.set(tod.skyLow ?? tod.skyBot);
  const len = Math.hypot(tod.sunRig[0], tod.sunRig[1], tod.sunRig[2]) || 1;
  u.uSunDir.value.set(tod.sunRig[0] / len, tod.sunRig[1] / len, tod.sunRig[2] / len);
  u.uSunTint.value.set(tod.sunTint ?? '#fff2d8');
  u.uSunI.value = tod.sunDisc ?? 0;
}

/* Low sun disc for sunset skies — the visible source behind the warm light
 * (SPEC §2: light must come from a visible source). Position it along the
 * theme's sunRig direction, fade opacity to 0 outside sunset.
 * A camera-facing Mesh plane (PlaneGeometry already faces the chase camera):
 * Sprites proved unreliable to rasterize in this environment (r4), Meshes
 * render deterministically. Normal-blended hot core + soft corona — pure
 * additive glow washes out against a bright sunset sky (critic r4). */
export function makeSunDisc(color = '#ffd9a0') {
  const tex = canvasTexture((ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, '#fff8ec');      // hot core — reads as the disc itself
    g.addColorStop(0.09, '#fff2d8');
    g.addColorStop(0.16, color + 'e6'); // warm corona
    g.addColorStop(0.38, color + '55');
    g.addColorStop(0.6, color + '18');
    g.addColorStop(1, color + '00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, 256, 256);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90),
    new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0,
      depthWrite: false, fog: false,
    })
  );
  mesh.renderOrder = 5; // after the sky dome, before HUD-ish overlays
  return mesh;
}

/* ---- static scenery merging ----------------------------------------------
 * This vendored three build never renders InstancedMesh into the shadow depth
 * pass (a regular Mesh at the same spot casts fine — verified in r4), so all
 * shadow-casting scenery is merged into single regular Meshes. Merging also
 * keeps each scenery family at one draw call (GRAPHICS_PLAN §6). */

const _mgV = new THREE.Vector3();
const _mgN = new THREE.Vector3();
const _mgM = new THREE.Matrix4();
const _mgNM = new THREE.Matrix3();

/* parts: [{ geo, matrix }] — emits one non-indexed BufferGeometry with
 * position/normal/uv, every part pre-transformed by its matrix. */
function mergeParts(parts) {
  let total = 0;
  for (const { geo } of parts) {
    const vc = geo.attributes.position.count;
    total += geo.index ? geo.index.count : vc;
  }
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uvs = new Float32Array(total * 2);
  let o = 0;
  for (const { geo, matrix } of parts) {
    const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
    const idx = geo.index;
    const count = idx ? idx.count : p.count;
    _mgNM.getNormalMatrix(matrix);
    for (let k = 0; k < count; k++) {
      const vi = idx ? idx.getX(k) : k;
      _mgV.fromBufferAttribute(p, vi).applyMatrix4(matrix);
      pos[(o + k) * 3] = _mgV.x; pos[(o + k) * 3 + 1] = _mgV.y; pos[(o + k) * 3 + 2] = _mgV.z;
      _mgN.fromBufferAttribute(n, vi).applyMatrix3(_mgNM).normalize();
      nor[(o + k) * 3] = _mgN.x; nor[(o + k) * 3 + 1] = _mgN.y; nor[(o + k) * 3 + 2] = _mgN.z;
      if (uv) { uvs[(o + k) * 2] = uv.getX(vi); uvs[(o + k) * 2 + 1] = uv.getY(vi); }
    }
    o += count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return g;
}

/* InstancedMesh → one merged geometry (instances baked in local space). */
export function mergeInstancedGeometry(im) {
  const parts = [];
  for (let i = 0; i < im.count; i++) {
    im.getMatrixAt(i, _mgM);
    parts.push({ geo: im.geometry, matrix: _mgM.clone() });
  }
  return mergeParts(parts);
}

/* Separate static Meshes → one merged geometry, meshes removed from parent.
 * Returns the geometry; caller wraps it in a Mesh with the shared material. */
export function mergeStaticMeshes(meshes) {
  const parts = [];
  for (const mesh of meshes) {
    mesh.updateMatrix();
    parts.push({ geo: mesh.geometry, matrix: mesh.matrix.clone() });
  }
  const g = mergeParts(parts);
  for (const mesh of meshes) {
    mesh.parent?.remove(mesh);
    mesh.geometry.dispose();
  }
  return g;
}

/* name + live wpm label above a vehicle */
export function makeLabel(name, colorCss) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 80;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(3.6, 1.12, 1);
  sprite.renderOrder = 20;

  const draw = (wpmText, sub) => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 80);
    ctx.font = '800 30px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(name, 128, 34); ctx.fillStyle = colorCss; ctx.fillText(name, 128, 34);
    ctx.font = '700 22px Segoe UI, sans-serif';
    ctx.strokeText(sub, 128, 64); ctx.fillStyle = '#ffffff'; ctx.fillText(sub, 128, 64);
    tex.needsUpdate = true;
  };
  draw('', '');
  return { sprite, draw };
}

/* Generic per-frame vehicle motion: smooth z, bob, error wobble, labels.
 * Theme-specific animation (flames, legs, spray…) happens in the theme. */
export function stepVehicle(v, rs, dt, now, opts = {}) {
  const targetZ = -rs.progress01 * TRACK_LENGTH;
  v.visZ = (v.visZ ?? 0) + (targetZ - (v.visZ ?? 0)) * expK(9, dt);
  v.group.position.z = v.visZ;

  const s01 = rs.speed01 ?? 0;
  if (v.baseY === undefined) v.baseY = v.group.position.y;
  const bobAmp = opts.bobAmp ?? 0.05;
  const bobFreq = opts.bobFreq ?? 90;
  v.group.position.y = v.baseY + Math.abs(Math.sin(now / bobFreq + v.wobble)) * bobAmp * s01;
  v.group.rotation.z = Math.sin(now / 240 + v.wobble) * 0.015 * s01;
  if (rs.errorT > 0) {
    v.group.rotation.z += (Math.random() - 0.5) * 0.12;
    rs.errorT -= dt;
  }

  v.labelTimer = (v.labelTimer ?? 1) + dt;
  if (v.labelTimer > 0.35) {
    v.labelTimer = 0;
    v.updateLabel?.(
      `${Math.round(rs.wpm ?? 0)} wpm`,
      rs.finished ? 'finished' : `${Math.round(rs.progress01 * 100)}%`
    );
  }
  return { s01, spin: (s01 * 14 + 2) * dt };
}

/* Standard finish gate with custom banner text/color */
export function buildFinishGate(group, TRACK_LENGTH, { text = '🏁 FINISH 🏁', color = '#ffd75e', bg = '#0e1420' } = {}) {
  const gateZ = -TRACK_LENGTH;
  const pillarMat = new THREE.MeshStandardMaterial({ color: '#22262e', roughness: 0.7 });
  const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8, 0.7), pillarMat);
  p1.position.set(-7, 4, gateZ); p1.castShadow = true;
  const p2 = p1.clone(); p2.position.x = 7;
  group.add(new THREE.Mesh(mergeStaticMeshes([p1, p2]), pillarMat)); // 2 → 1 draws (§1.3)
  const bannerTex = canvasTexture((ctx, w, h) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = color; ctx.font = '900 64px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);
  }, 512, 96);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(14.5, 2.4), new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide }));
  banner.position.set(0, 6.6, gateZ);
  group.add(banner);
  return gateZ;
}

/* Sky elements (dome, stars, moon, nebulas…) must ride along with the player —
 * the track is ~900 units long, so a skybox centered on the world origin would
 * be left behind around mid-track. Each object keeps its original z-offset
 * relative to the player, so it behaves like an infinitely-far backdrop. */
export function followPlayerSky(objects, anchorZ) {
  for (const o of objects) {
    if (!o) continue;
    if (o.userData.skyZ0 === undefined) o.userData.skyZ0 = o.position.z;
    o.position.z = anchorZ + o.userData.skyZ0;
  }
}
