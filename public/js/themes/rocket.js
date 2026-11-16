/* 🚀 Orbit Dash theme — a low-orbit drag strip: rockets, glowing energy
 * highway, ring gates, floating asteroids, planet Earth below. */

import * as THREE from 'three';
import { TRACK_LENGTH, mulberry32 } from '../world.js';
import { expK, canvasTexture, radialGlowTexture, makeLabel, stepVehicle, buildFinishGate, followPlayerSky, createSkyDome, setSkyDome, makeGroundPBR, rampHex, mergeStaticMeshes, makeDunes, displaceGroundPlane, jitterRock } from './shared.js';

const LANES = [-4.4, -2.2, 0, 2.2, 4.4];

const TOD = {
  // r10 #2: rocket-day must read FULL DAYLIGHT like refs/real-world/
  // real-day-launch.jpg — deep blue zenith, pale haze horizon, bright concrete
  // pad, strong sun. The pad was near-navy and the sun a washed blob; now the
  // strip is textured concrete, the dome carries the gradient + a real ~2° sun
  // disc, and exposure/sun intensity are raised.
  day: {
    // sun forward-upper-left (rig z<0 = in frame above the horizon) so the
    // disc is visible AND the asteroid lit-faces/shadow agree with it
    // (critic r7). y=14 keeps the disc clear of the top edge.
    // r13 (MED #3 again — the r12 render still read env-lit from the wrong
    // side): azimuth pushed more LATERAL (-38,-42) so the left limb catches
    // direct sun from a steeper side angle, envSun 1.0→0.62 (the sky-mirror
    // was the brightest thing on the body), sun 3.4→3.8 with shell env
    // 0.55→0.38, and hemi up 0.5→0.58 so the shadow side stays filled blue
    // rather than dead — the LIT/SHADOW contrast now comes from the SUN
    bg: '#b8d4ea', fogDensity: 0.0016, exposure: 1.08,
    skyTop: '#1e56b0', skyMid: '#4f86c0', skyBot: '#b8d4ea',
    sunRig: [-38, 15, -42], sunDisc: 1.2, envSun: 0.62,
    sunColor: '#fffbe8', sunIntensity: 3.8,
    hemiSky: '#b8dcff', hemiGround: '#5a6048', hemiIntensity: 0.58,
    ambient: 0.05, stars: 0.0, rings: 1.0, glow: 0.6, jetLight: 26, plume: 0.85,
  },
  sunset: {
    bg: '#2a1436', fogDensity: 0.0014, exposure: 0.85,
    skyTop: '#1a0e28', skyMid: '#2a1436', skyBot: '#5a3a5a',
    sunRig: [30, 16, 44], sunDisc: 0.8, sunTint: '#ffb37a', envSun: 0.5,
    sunColor: '#ffb37a', sunIntensity: 1.3,
    hemiSky: '#d88fb0', hemiGround: '#241430', hemiIntensity: 0.28,
    ambient: 0.08, stars: 0.8, rings: 1.0, glow: 0.8, jetLight: 34, plume: 0.9,
  },
  night: {
    // r10 #5: engine-bell/fin rims glowed hotter than physical — envSun 0.12
    // (dim moon glint) + jetLight 42→34 keeps the plume readable without the
    // rim-lit halo. r12 (LOW #12: fin OUTER faces still too bright/saturated):
    // jetLight 34→18 AND the accent paint itself dims to 0.5 at night —
    // moonlight alone never renders a saturated red
    bg: '#04060f', fogDensity: 0.0016, exposure: 0.6,
    skyTop: '#01030a', skyMid: '#04060f', skyBot: '#0a1226',
    sunRig: [-30, 20, 50], sunDisc: 0, envSun: 0.12,
    sunColor: '#8fa8ff', sunIntensity: 0.9,
    hemiSky: '#2c4a70', hemiGround: '#0a0f18', hemiIntensity: 0.65,
    ambient: 0.06, stars: 1.0, rings: 1.4, glow: 1.0, jetLight: 18, plume: 0.65,
  },
};

function earthTexture() {
  return canvasTexture((ctx, w, h) => {
    // ocean
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1d5fa8'); g.addColorStop(1, '#164a8a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // continents
    ctx.fillStyle = '#3f9152';
    const blobs = [[0.1, 0.3, 60, 34], [0.3, 0.6, 44, 26], [0.55, 0.25, 70, 40], [0.8, 0.65, 50, 30], [0.65, 0.8, 34, 18]];
    for (const [x, y, rw, rh] of blobs) {
      ctx.beginPath();
      ctx.ellipse(x * w, y * h, rw, rh, Math.random(), 0, Math.PI * 2);
      ctx.fill();
    }
    // polar caps
    ctx.fillStyle = '#e8f2ff';
    ctx.fillRect(0, 0, w, 14); ctx.fillRect(0, h - 14, w, 14);
    // clouds
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 26; i++) {
      ctx.beginPath();
      ctx.ellipse(Math.random() * w, Math.random() * h, 20 + Math.random() * 40, 6 + Math.random() * 10, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 512, 256);
}

/* rocket shell panel map — u wraps the body (8 panel seams), v runs engine →
 * nose tip: faint vertical seams, three weld rings, soot wash at the engine
 * end and light weathering streaks. Zero files, real surface break-up. */
function rocketPanelTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f1f3f5';
  ctx.fillRect(0, 0, 256, 256);
  // subtle tonal mottling per panel
  for (let p = 0; p < 8; p++) {
    ctx.fillStyle = `rgba(${p % 2 ? 210 : 225}, ${p % 2 ? 214 : 228}, ${p % 2 ? 220 : 232}, 0.25)`;
    ctx.fillRect(p * 32, 0, 32, 256);
  }
  // panel seams (vertical in v-space → rings around the body)
  ctx.fillStyle = 'rgba(70,76,84,0.5)';
  for (let p = 0; p <= 8; p++) ctx.fillRect(p * 32 - 1, 30, 1.6, 200);
  // weld rings at three stations
  for (const y of [70, 130, 180]) ctx.fillRect(0, y, 256, 2);
  // soot wash at the engine end (v near 0 = canvas bottom? v=0 at profile start
  // = rear/engine side; canvas y is flipped vs v — soot at BOTTOM of canvas)
  const soot = ctx.createLinearGradient(0, 256, 0, 215);
  soot.addColorStop(0, 'rgba(30,30,32,0.55)');
  soot.addColorStop(1, 'rgba(30,30,32,0)');
  ctx.fillStyle = soot;
  ctx.fillRect(0, 215, 256, 41);
  // weathering streaks running down the body
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(120,124,130,${0.05 + Math.random() * 0.09})`;
    ctx.fillRect(Math.random() * 256, 40 + Math.random() * 150, 1 + Math.random() * 2, 20 + Math.random() * 60);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* soft venting-vapor alpha: streaked along the flow (v), soft at the cylinder
 * silhouette (sin(π·u) kills the hard shell edges from every view direction),
 * fading out toward the far end — replaces the crisp chevron cones (r11 #4) */
function plumeAlphaTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(128, 256);
  const streaks = [];
  for (let i = 0; i < 26; i++) streaks.push({ u: Math.random(), w: 2 + Math.random() * 9, a: 0.3 + Math.random() * 0.7 });
  for (let y = 0; y < 256; y++) {
    const v = y / 255;                       // 0 far end → 1 nozzle
    const along = Math.pow(v, 0.65);          // dense at the nozzle, wispy far
    for (let x = 0; x < 128; x++) {
      const u = x / 127;
      const radial = Math.pow(Math.sin(u * Math.PI), 1.4);
      let s = 0.35;
      for (const st of streaks) {
        const d = Math.abs(u - st.u);
        if (d < st.w / 128) s += st.a * (1 - d / (st.w / 128)) * 0.5;
      }
      const a = Math.min(1, s) * radial * along;
      const i = (y * 128 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

/* paint = { primary: fins/bands, secondary: nose cap + tail band, variant } —
 * variant 0 classic booster · 1 stubby short-hauler · 2 needle interceptor */
function buildRocket(paint, { player = false } = {}) {
  const P = typeof paint === 'string' ? { primary: paint, secondary: null, variant: 0 } : (paint ?? {});
  const color = P.primary ?? '#ff4757';
  const variant = P.variant ?? 0;
  const g = new THREE.Group();
  // variant wrapper — label sprite rides on g, unscaled
  const model = new THREE.Group();
  g.add(model);
  const add = (m) => model.add(m);
  // r12/r13 (critic MED #3: the paint's env reflection overpowered the
  // sun-facing diffuse side): metalness 0.5→0.26, env 0.7→0.38, roughness
  // 0.46 — the SUN-side diffuse now clearly out-brightens any sky mirror; the
  // panel map adds the seams that read as real aerospace skin
  const shell = new THREE.MeshStandardMaterial({
    color: '#dfe3e8', map: rocketPanelTexture(), roughness: 0.46, metalness: 0.26, envMapIntensity: 0.38,
  });
  const accent = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.22, envMapIntensity: 0.6 });
  accent.userData.base = accent.color.clone(); // night dimming (fin saturation, r11 #12)
  const accent2 = new THREE.MeshStandardMaterial({ color: P.secondary ?? '#e8e6e0', roughness: 0.4, metalness: 0.22, envMapIntensity: 0.6 });
  accent2.userData.base = accent2.color.clone();
  const glass = new THREE.MeshStandardMaterial({ color: '#9fd8ff', roughness: 0.05, metalness: 0.8, transparent: true, opacity: 0.9, envMapIntensity: 1.0 });

  /* hull + ogive nose: ONE lathe — boat-tail flare at the engine, constant
   * mid-body, smooth curved nose cone (flies toward -Z). 16 segments. */
  const shellProfile = [
    [0.46, 0], [0.50, 0.08], [0.545, 0.22], [0.55, 0.4], [0.55, 2.1],
    [0.52, 2.4], [0.46, 2.72], [0.36, 3.02], [0.24, 3.28], [0.12, 3.48], [0.0, 3.62],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(shellProfile, 16, 0, Math.PI * 2), shell);
  body.rotation.x = -Math.PI / 2; // +Y (profile up = nose) → -Z forward
  body.position.set(0, 1.3, 1.35); // engine end at +1.35, nose tip ≈ -2.27
  body.castShadow = true;
  add(body);

  // accent ring bands (merged into ONE mesh)
  const bandA = new THREE.Mesh(new THREE.CylinderGeometry(0.556, 0.556, 0.2, 16, 1, true), accent);
  bandA.rotation.x = Math.PI / 2;
  bandA.position.set(0, 1.3, 0.3);
  const bandB = bandA.clone();
  bandB.position.z = -0.78; // shoulder ring (shell r ≈ 0.55 there)
  const bandC = bandA.clone();
  bandC.scale.set(1, 0.5, 1);
  bandC.position.z = 0.95;
  add(new THREE.Mesh(mergeStaticMeshes([bandA, bandB, bandC]), accent));

  // porthole — offset to the shell RADIUS so it actually shows (the old one
  // sat at 0.25 from the axis, fully buried inside the 0.55 body)
  const port = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), glass);
  port.position.set(0, 1.3 + 0.51, -0.55);
  add(port);

  // fins (rear, +Z) — extruded trapezoid planform with a BEVELED edge: real
  // airfoil-ish thickness instead of a flat board (r12 modeling mandate).
  // Chord → Z (leading edge forward), span → radial, thickness → tangential.
  const finShape = new THREE.Shape();
  finShape.moveTo(-0.12, 0);
  finShape.lineTo(0.7, 0);
  finShape.lineTo(0.52, 0.66);
  finShape.lineTo(0.16, 0.66);
  finShape.closePath();
  const finGeo = new THREE.ExtrudeGeometry(finShape, {
    depth: 0.05, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.03, bevelSegments: 2,
  });
  finGeo.rotateY(-Math.PI / 2); // shape X → +Z (chord along the body axis)
  const fins = [];
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(finGeo, accent);
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    fin.position.set(Math.cos(a) * 0.5, 1.3 + Math.sin(a) * 0.5, 0.6);
    fin.rotation.z = a;
    fins.push(fin);
  }
  const finMesh = new THREE.Mesh(mergeStaticMeshes(fins), accent);
  finMesh.castShadow = true;
  add(finMesh);

  // engine bell — lathe with a real bell curve (throat → expansion), sooty
  // metal with LOW env response (must not mirror the sky env, r7)
  const bellProfile = [
    [0.26, 0], [0.29, 0.07], [0.35, 0.18], [0.4, 0.3], [0.425, 0.4],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const bell = new THREE.Mesh(new THREE.LatheGeometry(bellProfile, 14), new THREE.MeshStandardMaterial({ color: '#3a4048', roughness: 0.75, metalness: 0.6, envMapIntensity: 0.25, side: THREE.DoubleSide }));
  bell.rotation.x = Math.PI / 2; // opening aft (+Z)
  bell.position.set(0, 1.3, 1.36);
  add(bell);

  // dark rear cap — the body's open rear face was catching full sun and
  // reading as the "burned white disc" behind the plume (critic r7); real
  // engine housings are dark matte metal
  const rearCap = new THREE.Mesh(new THREE.CircleGeometry(0.46, 14), new THREE.MeshStandardMaterial({ color: '#23262c', roughness: 0.85, metalness: 0.35, envMapIntensity: 0.25 }));
  rearCap.position.set(0, 1.3, 1.365);
  add(rearCap);

  // exhaust — r12: soft VENTING VAPOR, not stacked cones (critic r11 LOW #4:
  // translucent beige cone with a crisp chevron seam). Two alpha-textured
  // open cylinders (streaked, silhouette-soft) + a small nozzle glow sprite.
  const plumeTex = plumeAlphaTexture();
  const jetMat = new THREE.MeshBasicMaterial({
    color: '#ffc9a0', map: plumeTex, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.4, 5.2, 14, 1, true), jetMat);
  jet.rotation.x = Math.PI / 2; // narrow far end aft (+Y → +Z)
  jet.position.set(0, 1.3, 1.36 + 2.6);
  add(jet);
  const jetCoreMat = new THREE.MeshBasicMaterial({
    color: '#fff1d8', map: plumeTex, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const jetCore = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.22, 2.4, 12, 1, true), jetCoreMat);
  jetCore.rotation.x = Math.PI / 2;
  jetCore.position.set(0, 1.3, 1.36 + 1.2);
  add(jetCore);

  // nozzle glow sprite — small, dim: bloom, not a star (critic r2: ~10% burned).
  // r7: tighter still — the halo was swallowing the fins and lower body
  const jetGlowMat = new THREE.SpriteMaterial({
    map: radialGlowTexture('#ff9b45'), transparent: true, opacity: 0.25,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const jetGlow = new THREE.Sprite(jetGlowMat);
  jetGlow.scale.set(0.9, 0.9, 1);
  jetGlow.position.set(0, 1.3, 2.2);
  add(jetGlow);

  // bots: cheap longer exhaust smear (§5.4 budget alternative to a trail)
  let smearMat = null;
  if (!player) {
    smearMat = new THREE.MeshBasicMaterial({
      color: '#ffc9a0', map: plumeTex, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const smear = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, 4.2, 12, 1, true), smearMat);
    smear.rotation.x = Math.PI / 2;
    smear.position.set(0, 1.3, 1.36 + 2.1);
    add(smear);
  }

  // vapor trail — player only: 60-point ring buffer, additive colors fade to
  // black with age (§5.4; no per-frame allocation, arrays preallocated)
  let trail = null;
  if (player) {
    const N = 60;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) pos[i * 3 + 1] = 1e6; // parked far away until used
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 0.55, vertexColors: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    trail = new THREE.Points(geo, mat);
    trail.frustumCulled = false;
    trail.userData = { next: 0, since: 0 };
    add(trail);
  }

  // only the player carries a real light (PLAN §1.2); intensity per TOD below
  let light = null;
  if (player) {
    light = new THREE.PointLight('#ffd9a0', 0, 12, 2);
    // below-behind the nozzle, ~2.9 units off the rear faces: at (0,1.3,2.2)
    // inverse-square blasted the cap/bell to cream-white — the "burned core"
    // was self-illumination, proven by the r7 probes (critic r7)
    light.position.set(0, 0.85, 4.4);
    add(light);
  }

  // hover shadow — cheap dark blob on the strip so the rocket doesn't float
  // (critic r6, SPEC §2 fake-shadow allowance)
  const hoverTex = canvasTexture((ctx, w, h) => {
    const g4 = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g4.addColorStop(0, 'rgba(2,8,14,0.6)');
    g4.addColorStop(0.6, 'rgba(2,8,14,0.3)');
    g4.addColorStop(1, 'rgba(2,8,14,0)');
    ctx.fillStyle = g4;
    ctx.fillRect(0, 0, w, h);
  }, 128, 128);
  const hover = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 4.2),
    new THREE.MeshBasicMaterial({ map: hoverTex, transparent: true, depthWrite: false })
  );
  hover.rotation.x = -Math.PI / 2;
  // offset opposite the day sun (upper-left-forward → shadow right-rear) so
  // the blob and the real shadows agree (critic r7)
  hover.position.set(0.4, 0.045, 0.75);
  add(hover);

  /* ---- SECONDARY accents: painted nose cap + aft band (two-tone livery) ---- */
  const noseCap = new THREE.Mesh(new THREE.ConeGeometry(0.155, 0.5, 14), accent2);
  noseCap.rotation.x = -Math.PI / 2; // points forward (-Z)
  noseCap.position.set(0, 1.3, -2.18);
  noseCap.castShadow = true;
  add(noseCap);
  const bandD = new THREE.Mesh(new THREE.CylinderGeometry(0.556, 0.556, 0.14, 16, 1, true), accent2);
  bandD.rotation.x = Math.PI / 2;
  bandD.position.set(0, 1.3, 1.06);
  add(bandD);

  /* ---- variant — three silhouettes that read at a glance:
   * v0 classic rocket · v1 heavy lifter: fat body, big twin strap-on
   * boosters with nozzles + cruciform tail fins · v2 space fighter:
   * slender delta-wing interceptor with canopy and twin engines */
  if (variant === 1) { // heavy lifter — fat, short, twin side boosters
    model.scale.set(1.2, 1.1, 0.85);
    const boosterParts = [];
    for (const bx of [-0.62, 0.62]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.21, 1.9, 10), accent2);
      b.rotation.x = Math.PI / 2;
      b.position.set(bx, 1.06, 0.8);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.32, 10), accent);
      tip.rotation.x = -Math.PI / 2;
      tip.position.set(bx, 1.06, -0.35);
      const noz = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.28, 10), accent2);
      noz.rotation.x = Math.PI / 2; // bell opens aft
      noz.position.set(bx, 1.06, 1.82);
      boosterParts.push(b, tip, noz);
    }
    const boosters = new THREE.Mesh(mergeStaticMeshes(boosterParts), accent);
    boosters.castShadow = true;
    add(boosters);
    // cruciform tail fins — cargo-lifter attitude
    const lifterFins = [];
    for (const fa of [Math.PI / 2, Math.PI * 7 / 6, Math.PI * 11 / 6]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.52, 0.62), accent);
      fin.position.set(Math.cos(fa) * 0.5, 1.3 + Math.sin(fa) * 0.5, 1.5);
      fin.rotation.z = fa;
      lifterFins.push(fin);
    }
    const lifterFinMesh = new THREE.Mesh(mergeStaticMeshes(lifterFins), accent);
    lifterFinMesh.castShadow = true;
    add(lifterFinMesh);
  } else if (variant === 2) { // space fighter — slender delta interceptor
    model.scale.set(0.88, 0.92, 1.16);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.7, 10), accent);
    spike.rotation.x = -Math.PI / 2;
    spike.position.set(0, 1.3, -2.62);
    add(spike);
    // swept delta wings + winglets — the fighter silhouette
    const wingParts = [];
    for (const wx of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.05, 0.8), accent);
      wing.rotation.y = -wx * 0.5; // swept aft
      wing.rotation.z = wx * -0.09; // slight droop
      wing.position.set(wx * 0.68, 1.24, 1.1);
      wingParts.push(wing);
      const winglet = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.34), accent2);
      winglet.position.set(wx * 1.28, 1.3, 1.42);
      winglet.rotation.y = -wx * 0.5;
      wingParts.push(winglet);
    }
    const wings = new THREE.Mesh(mergeStaticMeshes(wingParts), accent);
    wings.castShadow = true;
    add(wings);
    // cockpit bubble + twin engine bells
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 9), glass);
    canopy.scale.set(0.8, 0.75, 1.55);
    canopy.position.set(0, 1.62, -1.0);
    add(canopy);
    const nozParts = [];
    for (const nx of [-0.17, 0.17]) {
      const noz = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.32, 10), accent2);
      noz.rotation.x = Math.PI / 2;
      noz.position.set(nx, 1.3, 2.28);
      nozParts.push(noz);
    }
    const nozzles = new THREE.Mesh(mergeStaticMeshes(nozParts), accent2);
    nozzles.castShadow = true;
    add(nozzles);
  }

  return { group: g, jet, jetMat, jetCore, jetCoreMat, jetGlowMat, smearMat, trail, light, shellMat: shell, accentMat: accent };
}

export function create(world, { racers, seed, timeOfDay = 'day' }) {
  const rng = mulberry32(seed);
  const group = new THREE.Group();
  let tod = TOD[timeOfDay] ?? TOD.day;
  let plumeK = 1;                  // TOD scale for the additive plume stack — night
                                   // rims must stay dim (critic r10 #5); declared
                                   // here because setTimeOfDay() runs at create-time
  // reused temporaries for the instanced asteroids/rings — update() must not
  // allocate (SPEC §1.3); declared before the build blocks that use them
  const _rm4 = new THREE.Matrix4();
  const _rv = new THREE.Vector3();
  const _rs = new THREE.Vector3(1, 1, 1);
  const _rq = new THREE.Quaternion();
  const _re = new THREE.Euler();

  /* ---------- energy highway ---------- */
  // r10 #2: the pad read near-navy and dusk-like. Now: light concrete PBR
  // (aggregate speckle + normal relief + roughness variation), like the real
  // launch-complex imagery. Opaque — transparency was a haze crutch.
  const padPBR = makeGroundPBR({
    seed: 88, octaves: 5, firstLattice: 4, gain: 0.5, normalStrength: 2.6,
    // warmed toward the tan concrete of the real launch-complex photo — the
    // r10 ramp + blue emissive gave the pad a cold navy cast in daylight
    color: rampHex(['#98938a', '#b0aba0', '#bcb7ac', '#a49f96']),
    rough: (h) => 0.72 + h * 0.2,
  });
  padPBR.map.repeat.set(7, 530);        // ~1.9m tile → 4cm aggregate
  padPBR.normalMap.repeat.set(7, 530);
  padPBR.roughMap.repeat.set(7, 530);
  const stripMat = new THREE.MeshStandardMaterial({
    color: '#ffffff', map: padPBR.map, normalMap: padPBR.normalMap,
    roughnessMap: padPBR.roughMap, roughness: 1, metalness: 0.1,
    emissive: '#0a2a44', emissiveIntensity: 0.5, envMapIntensity: 0.4,
  });
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(13.4, TRACK_LENGTH + 160),
    stripMat
  );
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(0, 0, -TRACK_LENGTH / 2);
  strip.receiveShadow = true; // the r9 critic's "no shadow under the rocket" — the strip never received
  group.add(strip);

  // lane dashes — muted cyan, reads as paint not neon (critic r1)
  const dashMat = new THREE.MeshStandardMaterial({ color: '#2fa8c4', roughness: 0.9, transparent: true }); // lit only by real light at night (r6)
  const dashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.16, 2.8), dashMat, 5 * 90);
  const m4 = new THREE.Matrix4();
  const qFlat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  let di = 0;
  for (const lx of [-3.3, -1.1, 1.1, 3.3]) {
    for (let z = 20; z > -TRACK_LENGTH; z -= 10) {
      m4.compose(new THREE.Vector3(lx, 0.03, z), qFlat, new THREE.Vector3(1, 1, 1));
      dashes.setMatrixAt(di++, m4);
    }
  }
  dashes.count = di;
  group.add(dashes);

  // structural side rails — Standard material so they're LIT by the scene
  // (Basic = unlit = uniform neon brightness along the whole track, critic r7)
  const edgeMat = new THREE.MeshStandardMaterial({ color: '#3a465e', roughness: 0.85, metalness: 0.2 });
  for (const ex of [-6.6, 6.6]) {
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.22, TRACK_LENGTH + 160), edgeMat);
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(ex, 0.03, -TRACK_LENGTH / 2);
    group.add(edge);
  }

  /* ---------- planet Earth below ---------- */
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(240, 32, 24),
    new THREE.MeshStandardMaterial({ map: earthTexture(), roughness: 0.9, envMapIntensity: 0.5 })
  );
  earth.position.set(0, -285, -TRACK_LENGTH / 2);
  earth.rotation.z = 0.35;
  group.add(earth);
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(252, 32, 24),
    new THREE.MeshBasicMaterial({ color: '#7fc4ff', transparent: true, opacity: 0.12, side: THREE.BackSide, depthWrite: false })
  );
  atmo.position.copy(earth.position);
  group.add(atmo);

  /* ---------- real space below ---------- */
  // r14: the olive launch-complex terrain plane is GONE — with the chase cam
  // grazing over the strip it read as an ordinary ground plane and killed the
  // space fantasy ("it has a ground, it is not really space"). The pad now
  // floats in the void: Earth below, stars around, nothing else.

  /* ---------- ring gates ---------- */
  // ONE InstancedMesh + per-instance color (alternating teal/steel) instead of
  // 12 meshes — 12 → 1 draw calls (§1.3). The old per-ring spin about z was
  // invisible on a rotationally-symmetric torus; the pulse stays (single phase).
  const ringGeo = new THREE.TorusGeometry(7.4, 0.16, 8, 40);
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.3 });
  const RING_N = 12;
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, RING_N);
  rings.frustumCulled = false;
  {
    const _rq = new THREE.Quaternion();
    const _rc = new THREE.Color();
    for (let i = 0; i < RING_N; i++) {
      _rm4.compose(_rv.set(0, 1.4, -40 - i * (TRACK_LENGTH / RING_N)), _rq, _rs.set(1, 1, 1));
      rings.setMatrixAt(i, _rm4);
      _rc.set(i % 2 ? '#3fb0cc' : '#5a6a8a');
      rings.setColorAt(i, _rc);
    }
    rings.instanceColor.needsUpdate = true;
  }
  group.add(rings);

  /* ---------- asteroids ---------- */
  // ONE InstancedMesh with per-instance spin/drift state in typed arrays —
  // 46 rocks were 46 draw calls (§1.3); composing reuses module temporaries.
  const rockMat = new THREE.MeshStandardMaterial({ color: '#6e7684', roughness: 1, flatShading: true });
  const AST_N = 46;
  const asteroids = new THREE.InstancedMesh(jitterRock(new THREE.DodecahedronGeometry(1, 0), { amp: 0.28, seed: 46, freq: 3.0 }), rockMat, AST_N);
  asteroids.frustumCulled = false;
  const astX = new Float32Array(AST_N), astY = new Float32Array(AST_N), astZ = new Float32Array(AST_N);
  const astS = new Float32Array(AST_N), astRX = new Float32Array(AST_N), astRY = new Float32Array(AST_N);
  const astSpin = new Float32Array(AST_N), astDrift = new Float32Array(AST_N), astDY = new Float32Array(AST_N);
  {
    const _rq2 = new THREE.Quaternion();
    for (let i = 0; i < AST_N; i++) {
      const s = 0.5 + rng() * 3.2;
      const side = rng() > 0.5 ? 1 : -1;
      // r14: the ground plane is gone — asteroids now OWN the void and spread
      // freely through the altitude band instead of hugging a horizon line
      astX[i] = side * (16 + rng() * 64);
      astY[i] = -8 + rng() * 30;
      astZ[i] = 16 - rng() * (TRACK_LENGTH + 60);
      astS[i] = s;
      astRX[i] = rng() * 3; astRY[i] = rng() * 3;
      astSpin[i] = (rng() - 0.5) * 0.6;
      astDrift[i] = rng() * 10;
      _rq2.setFromEuler(_re.set(astRX[i], astRY[i], 0));
      _rm4.compose(_rv.set(astX[i], astY[i], astZ[i]), _rq2, _rs.set(s, s, s));
      asteroids.setMatrixAt(i, _rm4);
    }
  }
  group.add(asteroids);

  /* ---------- satellites + a little moon + service pylons ---------- */
  // real-space dressing now that the terrain is gone: two satellites with
  // solar wings, a cratered moon opposite Earth, and under-strip truss pylons
  // with cyan markers so the highway reads as engineered, floating in the void
  const satBodyMat = new THREE.MeshStandardMaterial({ color: '#c9ccd4', roughness: 0.4, metalness: 0.6 });
  const panelMat = new THREE.MeshStandardMaterial({ color: '#1e3f66', roughness: 0.35, metalness: 0.3, emissive: '#0a1f3a', emissiveIntensity: 0.4 });
  const satBodyParts = [], panelParts = [];
  for (let i = 0; i < 2; i++) {
    const side = i % 2 ? 1 : -1;
    const sx = side * (26 + rng() * 18);
    const sy = 10 + rng() * 8;
    const sz = -60 - i * (TRACK_LENGTH / 2);
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 2.2));
    body.position.set(sx, sy, sz);
    body.rotation.y = rng() * 3;
    satBodyParts.push(body);
    const dish = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.4, 10));
    dish.position.set(sx, sy + 0.9, sz);
    satBodyParts.push(dish);
    for (const ps of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 1.1));
      wing.position.set(sx + ps * 2.0, sy, sz);
      wing.rotation.y = body.rotation.y;
      panelParts.push(wing);
    }
  }
  const satBodies = new THREE.Mesh(mergeStaticMeshes(satBodyParts), satBodyMat);
  satBodies.castShadow = true;
  group.add(satBodies);
  const satPanels = new THREE.Mesh(mergeStaticMeshes(panelParts), panelMat);
  group.add(satPanels);

  // small cratered moon riding opposite Earth — depth cue for the void
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(60, 24, 18),
    new THREE.MeshStandardMaterial({ color: '#9a9aa2', roughness: 1, envMapIntensity: 0.2, flatShading: true })
  );
  moon.position.set(-170, 95, -TRACK_LENGTH - 220);
  group.add(moon);

  // under-strip truss pylons: the highway floats, but it reads as BUILT
  const pylonMat = new THREE.MeshStandardMaterial({ color: '#2e3850', roughness: 0.8, metalness: 0.3 });
  const pylonTipMat = new THREE.MeshBasicMaterial({ color: '#4fd8ff' });
  const pylonParts = [], pylonTips = [];
  const PYLON_N = Math.ceil(TRACK_LENGTH / 55);
  for (let i = 0; i < PYLON_N; i++) {
    const pz = 10 - i * 55;
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.6, 0.3));
      leg.position.set(side * 6.6, -1.3, pz);
      leg.rotation.z = side * 0.5;
      pylonParts.push(leg);
      const cross = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.16, 0.16));
      cross.position.set(side * 7.2, -1.4, pz);
      pylonParts.push(cross);
    }
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 5));
    tip.position.set(0, -1.6, pz);
    pylonTips.push(tip);
  }
  const pylons = new THREE.Mesh(mergeStaticMeshes(pylonParts), pylonMat);
  group.add(pylons);
  const pylonGlow = new THREE.Mesh(mergeStaticMeshes(pylonTips), pylonTipMat);
  group.add(pylonGlow);

  /* ---------- holo signs ---------- */
  const slogans = ['TYPE FASTER!', 'WPM > gravity', 'Orbit Dash', '🚤 boats SOON', '🐎 horses SOON', 'to infinity…'];
  const holoMats = [];
  for (let i = 0; i < 5; i++) {
    const side = i % 2 ? 1 : -1;
    const z = -60 - i * (TRACK_LENGTH / 5) - rng() * 30;
    const tex = canvasTexture((ctx, w, h) => {
      ctx.fillStyle = 'rgba(6,20,34,0.9)'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = i % 2 ? '#3fa8c4' : '#8a6fc8'; ctx.lineWidth = 5; ctx.strokeRect(4, 4, w - 8, h - 8);
      ctx.fillStyle = '#eaf6ff'; ctx.font = '800 26px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(slogans[i % slogans.length], w / 2, h / 2);
    }, 320, 110);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 3.0), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    board.position.set(side * 11.5, 5.2, z);
    board.rotation.y = side * -Math.PI / 5;
    group.add(board);
    holoMats.push(board.material);
  }

  /* ---------- stars & nebula sprites ---------- */
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(800 * 3);
  for (let i = 0; i < 800; i++) {
    const th = rng() * Math.PI * 2;
    const ph = rng() * Math.PI;
    const r = 600;
    starPos[i * 3] = Math.cos(th) * Math.sin(ph) * r;
    starPos[i * 3 + 1] = Math.cos(ph) * r * 0.9 + 40;
    starPos[i * 3 + 2] = Math.sin(th) * Math.sin(ph) * r - 200;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: '#dfe9ff', size: 2.0, sizeAttenuation: false, transparent: true, opacity: 0.8, fog: false });
  const stars = new THREE.Points(starGeo, starMat);
  group.add(stars);

  const nebulaColors = ['#7a5cff', '#ff5ea8', '#3aa8ff'];
  const nebulas = [];
  for (let i = 0; i < 4; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialGlowTexture(nebulaColors[i % nebulaColors.length]),
      transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sp.scale.set(380, 380, 1);
    sp.position.set((rng() - 0.5) * 800, 100 + rng() * 200, -500 - rng() * 200);
    group.add(sp);
    nebulas.push(sp);
  }

  // launch-day sky dome — deep blue zenith → pale haze horizon with a real
  // ~2° sun disc (shared.js), replacing the flat background + washed 90-unit
  // sprite blob (critic r10 #2). Stars sit INSIDE the dome radius so they
  // still show at night.
  const sky = createSkyDome(620);
  group.add(sky);

  // stars/nebulas ride along with the player, and Earth stays centered below
  // (otherwise the camera exits the "sky" mid-track)
  const celestial = [sky, stars, ...nebulas];

  /* ---------- start + finish ---------- */
  const gateZ = buildFinishGate(group, TRACK_LENGTH, { text: '🚀 FINISH 🚀' });
  const startTex = canvasTexture((ctx) => {
    for (let y = 0; y < 2; y++) for (let x = 0; x < 14; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#3a3f44' : '#d8dade'; // concrete + worn white
      ctx.fillRect(x * 20, y * 20, 20, 20);
    }
  }, 280, 40);
  const startLine = new THREE.Mesh(new THREE.PlaneGeometry(13.4, 1.6), new THREE.MeshStandardMaterial({ map: startTex, roughness: 0.9, transparent: true, opacity: 0.9 }));
  startLine.rotation.x = -Math.PI / 2;
  startLine.position.set(0, 0.04, -2);
  group.add(startLine);

  /* ---------- rockets ---------- */
  const botColors = ['#2e86ff', '#ffb020', '#9b59ff', '#20c997', '#ff7ab6'];
  const vehicles = [];
  racers.forEach((r, i) => {
    const isPlayer = r.isPlayer;
    const lane = isPlayer ? 2 : [1, 3, 0, 4][i - 1] ?? 1;
    const paint = r.paint ?? { primary: isPlayer ? '#ff4757' : botColors[i % botColors.length], secondary: null, variant: 0 };
    const color = paint.primary ?? '#ff4757';
    const rocket = buildRocket(paint, { player: isPlayer });
    rocket.group.position.set(LANES[lane] ?? 0, 0, 0);
    group.add(rocket.group);

    const label = makeLabel(isPlayer ? 'YOU' : r.name, isPlayer ? '#ff6b78' : '#9fd0ff');
    label.sprite.position.set(0, 3.2, 0);
    rocket.group.add(label.sprite);

    vehicles.push({
      ...rocket,
      label,
      lane,
      baseX: LANES[lane] ?? 0,
      color,
      isPlayer,
      wobble: rng() * 10,
      updateLabel(wpmText, sub) { label.draw(wpmText, sub); },
    });
  });

  /* ---------- time of day (space tints) ---------- */
  function setTimeOfDay(name) {
    tod = TOD[name] ?? TOD.day;
    setSkyDome(sky, tod); // gradient sky + real sun disc (r10 #2)
    world.scene.background.set(tod.bg);
    // space fog: thin — only darkens far asteroids, never a curtain
    // (GRAPHICS_PLAN §3.4); FogExp2 replaces the old linear near/far
    world.setFog(tod.bg, tod.fogDensity);
    world.setExposure(tod.exposure);
    world.setEnvironment(tod.skyTop, tod.skyMid, tod.skyBot, '#5a6048', { x: tod.sunRig[0], y: tod.sunRig[1], z: tod.sunRig[2] }, tod.envSun); // terrain bounce + sun glint (envSun: dim at night, r10 #5)
    world.sunRig.set(tod.sunRig[0], tod.sunRig[1], tod.sunRig[2]);
    world.sun.color.set(tod.sunColor);
    world.sun.intensity = tod.sunIntensity;
    world.hemi.color.set(tod.hemiSky);
    world.hemi.groundColor.set(tod.hemiGround);
    world.hemi.intensity = tod.hemiIntensity;
    world.ambient.intensity = tod.ambient;
    starMat.opacity = tod.stars;
    nebulas.forEach((n) => (n.material.opacity = name === 'night' ? 0.2 : name === 'sunset' ? 0.17 : 0.06));
    // rings at physical subtlety — no neon arcade hoops in the sky (critic r5)
    ringMat.opacity = Math.min(0.13, 0.22 * tod.rings);
    // worn runway paint on concrete: pale yellow by day, faint at night (r5)
    dashMat.color.set(name === 'night' ? '#3d4a52' : '#d8d2b8');
    dashMat.opacity = name === 'night' ? 0.45 : 1.0; // de-neon the lane dashes (r4/r7)
    edgeMat.color.set(name === 'night' ? '#26304a' : '#3a465e'); // rails lit, not self-lit (r7)
    // night: darken the concrete albedo + faint blue emissive so the corridor
    // stays readable but the pad does not glow like a lamp (r9/r10)
    stripMat.color.set(name === 'night' ? '#3a4148' : name === 'sunset' ? '#787878' : '#ffffff');
    stripMat.emissiveIntensity = name === 'night' ? 0.32 : name === 'sunset' ? 0.4 : 0.04;
    holoMats.forEach((m) => (m.opacity = name === 'night' ? 0.5 : name === 'sunset' ? 0.7 : 0.9));
    plumeK = name === 'night' ? 0.5 : name === 'sunset' ? 0.75 : 1.0; // dims the
    // additive cones that back-light the bell rim + fin edges at night (r10 #5)
    vehicles.forEach((v) => {
      v.jetMat.opacity = tod.plume * plumeK;
      v.jetCoreMat.opacity = tod.plume * 0.55 * plumeK; // core keeps color, reads in daylight (r6/r7 burn fix)
      if (v.smearMat) v.smearMat.opacity = Math.max(0.18, tod.plume * 0.4 * plumeK); // bots read too (r4)
      if (v.light) v.light.intensity = tod.jetLight; // player only — the jet is the lamp
      // sooty metal must not mirror the env sun — night rims stay physical
      // (r7 note + r10 #5); day: real glints on the white shell
      const vehEnv = name === 'night' ? 0.2 : name === 'sunset' ? 0.4 : 0.38;
      v.shellMat.envMapIntensity = vehEnv;
      v.accentMat.envMapIntensity = vehEnv;
      // r12 (LOW #12): moonlight never renders a SATURATED fin — the accent
      // albedo itself dims with the TOD (jetLight also dropped 34→18)
      const accentK = name === 'night' ? 0.5 : name === 'sunset' ? 0.75 : 1.0;
      v.accentMat.color.copy(v.accentMat.userData.base).multiplyScalar(accentK);
    });
  }
  setTimeOfDay(timeOfDay);

  /* ---------- per-frame ---------- */
  const _tv = new THREE.Vector3(); // reused trail sampler (no per-frame alloc);
  function update(dt, state) {
    if (!state) return;
    const now = performance.now();

    // stars/nebulas ride along; Earth stays centered below the player
    const anchorZ = vehicles[0]?.visZ ?? 0;
    followPlayerSky(celestial, anchorZ);
    earth.position.z = anchorZ;
    atmo.position.z = anchorZ;

    // slow planet spin + drifting asteroids + pulsing rings — asteroid
    // spin/drift live in typed arrays, matrices composed with reused temps
    earth.rotation.y += dt * 0.01;
    for (let i = 0; i < AST_N; i++) {
      astRX[i] += astSpin[i] * dt;
      astRY[i] += astSpin[i] * 0.7 * dt;
      astDY[i] += Math.sin(now / 2600 + astDrift[i]) * dt * 0.4;
      _re.set(astRX[i], astRY[i], 0);
      _rq.setFromEuler(_re);
      _rm4.compose(_rv.set(astX[i], astY[i] + astDY[i], astZ[i]), _rq, _rs.set(astS[i], astS[i], astS[i]));
      asteroids.setMatrixAt(i, _rm4);
    }
    asteroids.instanceMatrix.needsUpdate = true;
    // ring pulse: one shared phase (per-ring offsets were invisible at ≤0.13
    // opacity and forced 12 separate materials)
    const pulse = 0.22 + Math.sin(now / 600) * 0.08; // low ceiling — no neon
    ringMat.opacity = Math.min(0.35, pulse * tod.rings);

    state.forEach((rs, i) => {
      const v = vehicles[i];
      if (!v) return;
      const { s01 } = stepVehicle(v, rs, dt, now, { bobAmp: 0.16, bobFreq: 130 });

      // jet always burning; combo heat = afterburner (capped so nothing burns out)
      const heat = rs.comboHeat ?? 0;
      const flicker = 0.85 + Math.random() * 0.3;
      const power = 0.35 + s01 * 0.5 + heat * 0.8;
      v.jet.scale.set(0.7 + power * 0.7, power * flicker, 0.7 + power * 0.7);
      // r12: higher IDLE floor — the alpha-streaked vapor cylinders all but
      // vanished at rest with the old 0.1 floor (r11 LOW #4's "sprite-like"
      // complaint cuts both ways: idle venting must stay visible, softly)
      v.jetMat.opacity = Math.min(0.5, 0.24 + s01 * 0.26 + heat * 0.25) * plumeK;
      v.jetCore.scale.set(0.8 + heat * 0.9, power * flicker, 0.8 + heat * 0.9);
      v.jetCoreMat.opacity = Math.min(0.45, 0.18 + s01 * 0.18 + heat * 0.22) * plumeK;
      v.jetGlowMat.opacity = Math.min(0.1, 0.03 + power * 0.06) * plumeK; // halo must not swallow the fins (r7)

      // vapor trail: sample the nozzle every 40ms into the ring buffer and
      // fade every point's additive color toward black with age
      const t = v.trail;
      if (t) {
        t.since += dt;
        const posAttr = t.geometry.attributes.position;
        const colAttr = t.geometry.attributes.color;
        const col = colAttr.array;
        for (let i = 0; i < col.length; i++) col[i] = Math.max(0, col[i] - dt * 0.9);
        if (t.since > 0.04 && (s01 > 0.05 || heat > 0.2)) {
          t.since = 0;
          _tv.set(0, 1.3, 3.0);
          v.group.localToWorld(_tv);
          const i = t.userData.next;
          posAttr.setXYZ(i, _tv.x, _tv.y, _tv.z);
          const b = 0.28 + s01 * 0.25;
          col[i * 3] = b; col[i * 3 + 1] = b * 0.75; col[i * 3 + 2] = b * 0.5;
          t.userData.next = (i + 1) % 60;
        }
        colAttr.needsUpdate = true;
        posAttr.needsUpdate = true;
        t.material.opacity = 0.25 + s01 * 0.35;
      }
    });
  }

  return { group, vehicles, update, finishZ: gateZ, setTimeOfDay };
}
