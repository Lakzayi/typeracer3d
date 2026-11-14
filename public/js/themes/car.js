/* 🏎 Street Race theme — asphalt sprint: low-poly cars, roadside scenery,
 * billboards, finish gate. Vehicles advance with typing progress.
 * Supports day / sunset / night with full lighting treatment. */

import * as THREE from 'three';
import { TRACK_LENGTH, mulberry32 } from '../world.js';
import { followPlayerSky, mergeInstancedGeometry, mergeStaticMeshes, createSkyDome, setSkyDome, makeGroundPBR, rampHex, jitterRock, superRing, loftSections } from './shared.js';

const LANES = [-4.4, -2.2, 0, 2.2, 4.4];

// r12 modeling pass — REAL wheels: the tire is a lathe with bulged sidewalls
// and rounded shoulders (not a raw cylinder), the rim is a domed dish with
// ten spokes + hub merged into one geometry. Both stay InstancedMesh pairs
// (2 draw calls per car) and spin via the same per-frame matrix compose as
// before (SPEC §1.3).
const tireProfile = [
  [0.215, -0.145], [0.30, -0.125], [0.355, -0.07], [0.372, -0.02],
  [0.372, 0.02], [0.355, 0.07], [0.30, 0.125], [0.215, 0.145],
].map(([r, y]) => new THREE.Vector2(r, y));
const WHEEL_GEO = new THREE.LatheGeometry(tireProfile, 18);
WHEEL_GEO.rotateZ(Math.PI / 2); // lathe axis Y → axle axis X
const rimProfile = [
  [0.02, -0.11], [0.15, -0.08], [0.19, -0.03],
  [0.19, 0.03], [0.15, 0.08], [0.02, 0.11],
].map(([r, y]) => new THREE.Vector2(r, y));
const RIM_GEO0 = new THREE.LatheGeometry(rimProfile, 16);
RIM_GEO0.rotateZ(Math.PI / 2);
let RIM_GEO = RIM_GEO0;
{ // spokes on BOTH faces (geometry is shared by left/right wheels, so the
  // symmetric pair reads correctly from any side) + center hub
  const spokes = [];
  for (const face of [-0.075, 0.075]) {
    for (let s = 0; s < 5; s++) {
      const a = (s / 5) * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.016, 0.055));
      sp.position.set(Math.cos(a) * 0.105, face, Math.sin(a) * 0.105);
      sp.rotation.y = -a;
      spokes.push(sp);
    }
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 10));
  RIM_GEO = mergeStaticMeshes([new THREE.Mesh(RIM_GEO), ...spokes, hub]);
}
const WHEEL_POS = [[-0.86, -1.35], [0.86, -1.35], [-0.86, 1.4], [0.86, 1.4]];
const _XAXIS = new THREE.Vector3(1, 0, 0);
const _wq = new THREE.Quaternion();
const _wm4 = new THREE.Matrix4();
const _wv = new THREE.Vector3();
const _w1 = new THREE.Vector3(1, 1, 1);

const expK = (k, dt) => 1 - Math.exp(-k * dt);

/* car-paint surface break-up — mapped by the loft's UVs (u: around the ring,
 * v: bow→stern). Door/hood shut-lines, a darker rocker band under the doors
 * and faint metallic-flake noise give the body panels seams under full sun. */
function carPaintTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 256, 256);
  // rocker panel band — u≈0.5 is the ring bottom
  const rg = ctx.createLinearGradient(0, 256 * 0.40, 0, 256 * 0.60);
  rg.addColorStop(0, 'rgba(0,0,0,0)');
  rg.addColorStop(0.5, 'rgba(0,0,0,0.22)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 256 * 0.40, 256, 256 * 0.20);
  // shut lines (hood cut, door cuts) — only across the side/top arcs
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  for (const [v, u0, u1] of [[0.20, 0.02, 0.42], [0.40, 0.06, 0.44], [0.62, 0.56, 0.94], [0.40, 0.56, 0.94]]) {
    ctx.fillRect(v * 256, u0 * 256, 2.5, (u1 - u0) * 256);
  }
  // flake noise
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '20,20,25'},0.05)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------------- time-of-day presets ---------------- */
const TOD = {
  day: {
    // sunny blue sky — coherent with the sharp mapped shadows (critic r6:
    // overcast white sky + hard shadows contradict). sunDisc 1.0: the dome
    // shader now shows a real ~2° sun at the sunRig azimuth
    skyTop: '#2f6ad0', skyMid: '#5a9be0', skyBot: '#bfdff2',
    fogDensity: 0.0026, exposure: 1.0, sunRig: [34, 62, 18], sunDisc: 1.0,
    sunColor: '#fff2e0', sunIntensity: 2.6, envSun: 1.0,
    hemiSky: '#cfe4ff', hemiGround: '#6a7a58', hemiIntensity: 0.55,
    ambient: 0.0, lamps: 0.0, cones: 0.0, beam: 0.0, stars: 0.0,
    headlight: 0, tail: 0.15, moon: false, ground: '#ffffff', grass: '#ffffff',
  },
  sunset: {
    skyTop: '#25246b', skyMid: '#b34a8a', skyBot: '#ff9a5a',
    fogDensity: 0.0026, exposure: 0.85, sunRig: [70, 11, 6], sunDisc: 0.9, sunTint: '#ffc27a',
    sunColor: '#ff9a55', sunIntensity: 1.7, envSun: 0.7,
    hemiSky: '#e0a8b8', hemiGround: '#5a4038', hemiIntensity: 0.35,
    ambient: 0.0, lamps: 0.55, cones: 0.0, beam: 0.08, stars: 0.25,
    headlight: 350, tail: 0.8, moon: false, ground: '#c8b8a8', grass: '#c8b8a8',
  },
  night: {
    // near-black sky, silhouetted ground (critic r6: navy luma 32 vs refs 6–14).
    // r7: moon 0.5→0.32 — long near-black tree shadows contradicted a dim moon;
    // ground now multiplies the textured albedo (cold desaturated, r7).
    // r12: hemi 0.55→0.68 — the r11 render fell to pure black outside the lamp
    // pools; a night photo keeps faint skyglow on the asphalt (LOW #7)
    skyTop: '#03050c', skyMid: '#081120', skyBot: '#12233f',
    fogDensity: 0.0030, exposure: 0.85, sunRig: [-26, 48, 34], sunDisc: 0,
    sunColor: '#8fb0ff', sunIntensity: 0.32, envSun: 0.12,
    hemiSky: '#31456a', hemiGround: '#141c26', hemiIntensity: 0.68,
    ambient: 0.05, lamps: 1.0, cones: 0.0, beam: 0.1, stars: 1.0,
    // real low-beam ≈ 800–1500 cd; 60 cd is invisible after grazing-angle +
    // inverse-square + ACES (measured live: 60 cd → (0,1,6) on the road)
    headlight: 800, tail: 1.2, headGlow: 1.6, moon: true, ground: '#3d4640', grass: '#3d4640',
  },
};
TOD.day.headGlow = 0.02;
TOD.sunset.headGlow = 0.5;

function canvasTexture(draw, w = 256, h = 128) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function radialGlowTexture(color = '#ffd9a0') {
  return canvasTexture((ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, color + 'cc');
    g.addColorStop(0.45, color + '33');
    g.addColorStop(1, color + '00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, 128, 128);
}

/* paint = { primary, secondary, variant } — variant 0 GT sedan · 1 muscle · 2 rally */
function buildCar(p0, { player = false } = {}) {
  const P = typeof p0 === 'string' ? { primary: p0, secondary: null, variant: 0 } : (p0 ?? {});
  const color = P.primary ?? '#ff4757';
  const variant = P.variant ?? 0;
  const g = new THREE.Group();
  // r12/r13 paint: clearcoat lacquer + panel/seam map from the loft UVs and a
  // strong metallic base so full-sun shots read as GLOSS, not matte plastic
  // (critic LOW #6): r13 sharpens the coat (rr 0.05) and pushes env response
  // to 1.75 so the sky sheen on the horizontal panels is unmistakable
  const paintMat = new THREE.MeshPhysicalMaterial({
    color, map: carPaintTexture(), roughness: 0.3, metalness: 0.66,
    clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 1.75,
  });
  const paint = paintMat; // keep the historic variable name for the body mesh
  // secondary color — roof cap / scoop / spoiler / stripes (two-tone livery)
  const accentMat = P.secondary ? new THREE.MeshPhysicalMaterial({
    color: P.secondary, map: carPaintTexture(), roughness: 0.3, metalness: 0.66,
    clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 1.75,
  }) : null;
  const dark = new THREE.MeshStandardMaterial({ color: '#16181d', roughness: 0.95, metalness: 0.0, envMapIntensity: 0.05 });
  // r12 iterate: real car glass reads DARK from outside (black interior + a
  // sliver of sky reflection) — the pale tint read as a solid canopy.
  // Two-tone liveries: the canopy is tinted toward the SECONDARY color so the
  // combo reads from the chase cam (the roof cap alone hides under the glass)
  const glass = new THREE.MeshStandardMaterial({
    color: P.secondary ?? '#2e4a5e', roughness: 0.08, metalness: 0.65,
    transparent: true, opacity: P.secondary ? 0.62 : 0.78, envMapIntensity: 1.5,
  });

  /* ---- lower body: one loft — bumper nose → hood → beltline → deck → tail.
   * Superellipse sections (k=3) give rounded body sides, the station heights
   * give the three-box silhouette (hood drop, belt peak, trunk step). ONE
   * indexed geometry ≈ 250 verts. Variant tables reshape the SAME footprint:
   * muscle chops the roof and widens the hips, rally lifts the whole body
   * over bigger arches. */
  const N = 20, K = 3.0;
  let st = [ // [z, halfWidth, bottomY, topY]
    [-2.075, 0.84, 0.36, 0.68],  // nose tip
    [-2.04, 0.90, 0.31, 0.84],   // front face
    [-1.85, 0.93, 0.30, 0.79],   // hood leading edge
    [-1.55, 0.94, 0.30, 0.82],
    [-1.15, 0.94, 0.30, 0.86],
    [-0.70, 0.94, 0.30, 0.91],
    [-0.45, 0.94, 0.30, 0.94],   // cowl
    [0.25, 0.95, 0.30, 1.00],    // belt peak at the B-pillar
    [0.90, 0.95, 0.30, 1.00],
    [1.45, 0.93, 0.30, 0.97],    // rear deck
    [1.90, 0.91, 0.30, 0.92],
    [2.075, 0.85, 0.36, 0.86],   // tail face
  ];
  let gh = [ // greenhouse [z, halfWidth, y0, y1]
    [-0.50, 0.88, 0.92, 1.00],
    [-0.28, 0.82, 0.94, 1.24],
    [-0.02, 0.72, 1.04, 1.37],
    [0.55, 0.70, 1.07, 1.41],
    [0.95, 0.74, 1.03, 1.33],
    [1.20, 0.82, 0.94, 1.05],
  ];
  let roofY = 1.40, mirrorY = 1.00;
  if (variant === 1) { // muscle — hips out, roof chopped, deck shortened
    st = st.map(([z, hw, y0, y1]) => [z, Math.min(1.02, hw + 0.06), y0, y1]);
    gh = gh.map(([z, hw, y0, y1]) => [z, Math.min(1.0, hw + 0.04), y0, y1 - 0.13]);
    roofY = 1.27;
  } else if (variant === 2) { // rally — the whole body rides 9cm higher
    st = st.map(([z, hw, y0, y1]) => [z, hw, y0 + 0.09, y1 + 0.09]);
    gh = gh.map(([z, hw, y0, y1]) => [z, hw, y0 + 0.09, y1 + 0.09]);
    roofY = 1.49; mirrorY = 1.09;
  }
  const bodyRings = st.map(([z, hw, y0, y1]) => superRing(0, (y0 + y1) / 2, z, hw, (y1 - y0) / 2, K, N));
  const bodyGeo = loftSections(bodyRings, { capStart: true, capEnd: true });

  // fender arches — half-torus flares over the four wheels; merged into the
  // paint mesh (wheel arches were the top car mandate this round)
  const archR = variant === 2 ? 0.50 : 0.44;
  const archTube = variant === 2 ? 0.10 : 0.085;
  const arches = [];
  for (const wz of [-1.35, 1.4]) {
    for (const wx of [-0.90, 0.90]) {
      const arch = new THREE.Mesh(new THREE.TorusGeometry(archR, archTube, 8, 18, Math.PI));
      arch.rotation.y = Math.PI / 2; // arc into the ZY plane (over the wheel)
      arch.position.set(wx, 0.38, wz);
      arches.push(arch);
    }
  }
  // roof cap (secondary two-tone when the livery has one) + mirror shells
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.06, 1.5), accentMat ?? paint);
  roof.position.set(0, roofY, 0.42);
  const mirrorShells = [];
  for (const mx of [-0.98, 0.98]) {
    const shell = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.09, 0.07), paint);
    shell.position.set(mx, mirrorY, -0.38);
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.04), paint);
    stalk.position.set(mx * 0.92, mirrorY - 0.015, -0.38);
    stalk.rotation.z = mx > 0 ? -0.25 : 0.25;
    mirrorShells.push(shell, stalk);
  }
  const bodyMesh = new THREE.Mesh(mergeStaticMeshes([
    new THREE.Mesh(bodyGeo), ...arches, roof, ...mirrorShells,
  ]), paint);
  bodyMesh.castShadow = true;
  g.add(bodyMesh);

  /* ---- greenhouse: tapered glass loft with a dark interior block so the
   * tinted canopy reads as glass over a cabin, not an empty shell (the gh
   * station table is variant-shaped above) */
  const cabin = new THREE.Mesh(
    loftSections(gh.map(([z, hw, y0, y1]) => superRing(0, (y0 + y1) / 2, z, hw, (y1 - y0) / 2, 2.6, N)), { capStart: true, capEnd: true }),
    glass
  );
  cabin.castShadow = true;
  const interior = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.42, 1.6), dark);
  interior.position.set(0, 0.98, 0.32);
  g.add(cabin, interior);

  /* ---- trim: bumpers, grille, light housings, mirror glass, handles,
   * exhaust tips — one merged dark mesh (1 draw) */
  const trimParts = [];
  const bumper = (front) => {
    const sgn = front ? -1 : 1;
    const rings = [
      superRing(0, 0.51, sgn * 2.15, 0.86, 0.17, 3.2, N),
      superRing(0, 0.51, sgn * 2.09, 0.91, 0.19, 3.2, N),
      superRing(0, 0.51, sgn * 2.02, 0.92, 0.20, 3.2, N),
    ];
    return new THREE.Mesh(loftSections(rings, { capStart: front, capEnd: !front }));
  };
  trimParts.push(bumper(true), bumper(false));
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.16, 0.05));
  grille.position.set(0, 0.55, -2.055);
  trimParts.push(grille);
  for (const lx of [-0.56, 0.56]) { // headlight + taillight Housings (lenses below)
    const hh = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.16, 0.05));
    hh.position.set(lx, 0.62, -2.05);
    const th = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.15, 0.05));
    th.position.set(lx, 0.68, 2.05);
    trimParts.push(hh, th);
  }
  for (const mx of [-0.985, 0.985]) { // mirror glass faces rearward
    const mg = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.015));
    mg.position.set(mx, 1.0, -0.345);
    trimParts.push(mg);
  }
  for (const hx of [-0.95, 0.95]) { // flush door handles
    for (const hz of [0.05, 0.68]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.035, 0.15));
      h.position.set(hx, 0.88, hz);
      trimParts.push(h);
    }
  }
  for (const ex of [-0.38, 0.38]) { // exhaust tips
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.14, 8));
    tip.rotation.x = Math.PI / 2;
    tip.position.set(ex, 0.33, 2.12);
    trimParts.push(tip);
  }
  const trimMesh = new THREE.Mesh(mergeStaticMeshes(trimParts), dark);
  trimMesh.castShadow = true;
  g.add(trimMesh);

  /* ---- variant-specific character parts ---- */
  const acc = accentMat ?? dark;
  if (variant === 1) { // muscle: hood scoop, side stripes, rear wing (always)
    const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.08, 0.52), acc);
    scoop.position.set(0, 0.90, -1.28);
    const stripes = [];
    const hipW = st[7][1]; // belt-peak half width (widened) + proud of the body
    for (const sx of [-(hipW + 0.02), hipW + 0.02]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 3.5), acc);
      stripe.position.set(sx, 0.56, 0.12);
      stripes.push(stripe);
    }
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.09, 0.5), acc);
    wing.position.set(0, 1.10, 1.92);
    const finL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.42), acc);
    finL.position.set(-0.72, 0.94, 1.92);
    const finR = finL.clone(); finR.position.x = 0.72;
    const muscleParts = new THREE.Mesh(mergeStaticMeshes([scoop, ...stripes, wing, finL, finR]), acc);
    muscleParts.castShadow = true;
    g.add(muscleParts);
  } else if (variant === 2) { // rally: roof rails + forward light bar
    const rackParts = [];
    for (const rx of [-0.48, 0.48]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, 1.35), acc);
      rail.position.set(rx, roofY + 0.05, 0.45);
      rackParts.push(rail);
    }
    for (const px of [-0.42, -0.14, 0.14, 0.42]) {
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.07, 10), dark);
      pod.rotation.x = Math.PI / 2; // lens faces forward
      pod.position.set(px, roofY + 0.06, -0.38);
      rackParts.push(pod);
    }
    const rack = new THREE.Mesh(mergeStaticMeshes(rackParts), acc);
    rack.castShadow = true;
    g.add(rack);
  }

  if (player && variant !== 1) { // muscle already wears its wing
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.45), dark);
    spoiler.position.set(0, 1.05, 1.9);
    const finL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.4), dark);
    finL.position.set(-0.7, 0.9, 1.9);
    const finR = finL.clone(); finR.position.x = 0.7;
    g.add(new THREE.Mesh(mergeStaticMeshes([spoiler, finL, finR]), dark));
  }

  // inset light fixtures — housings are in the trim mesh; the lenses sit
  // slightly proud of the body face. Emissive follows the TOD (day: a pale
  // glass fixture; night: the lamp actually glows)
  const headMat = new THREE.MeshStandardMaterial({ color: '#e9e6da', roughness: 0.25, metalness: 0.3, emissive: '#fff6cc', emissiveIntensity: 0.02 });
  const hl = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.11, 0.04), headMat);
  hl.position.set(-0.56, 0.62, -2.045);
  const hr = hl.clone(); hr.position.x = 0.56;
  g.add(new THREE.Mesh(mergeStaticMeshes([hl, hr]), headMat));

  const tailMat = new THREE.MeshStandardMaterial({ color: '#2a0508', emissive: '#ff2a33', emissiveIntensity: 0.15 });
  const tl = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.10, 0.04), tailMat);
  tl.position.set(-0.56, 0.68, 2.045);
  const tr = tl.clone(); tr.position.x = 0.56;
  g.add(new THREE.Mesh(mergeStaticMeshes([tl, tr]), tailMat));

  // chrome rim disc — face sits proud of the tire sidewall so the disc reads
  // from directly behind (critic r5)
  const rimMat = new THREE.MeshStandardMaterial({ color: '#b8bcc4', roughness: 0.25, metalness: 0.9, envMapIntensity: 1.0 });
  const wheels = new THREE.InstancedMesh(WHEEL_GEO, dark, 4);
  const rims = new THREE.InstancedMesh(RIM_GEO, rimMat, 4);
  wheels.frustumCulled = rims.frustumCulled = false;
  {
    const _q0 = new THREE.Quaternion();
    for (let wi = 0; wi < 4; wi++) {
      _wm4.compose(_wv.set(WHEEL_POS[wi][0], 0.38, WHEEL_POS[wi][1]), _q0, _w1);
      wheels.setMatrixAt(wi, _wm4);
      rims.setMatrixAt(wi, _wm4);
    }
  }
  g.add(wheels, rims);

  // only the player carries a real light (PLAN §1.2: 5 lights → 1) — a SpotLight
  // so the beam actually pools on the road ahead instead of glowing in a bubble.
  // Wide penumbra: night pool gets soft edges (critic r4). Bots skip the beam
  // cones + pool entirely (opacity-0 draws were pure waste, §1.3).
  let light = null, coneMat = null, beamPoolMat = null;
  if (player) {
    light = new THREE.SpotLight('#fff3d0', 0, 28, 0.5, 0.75, 2);
    light.position.set(0, 0.8, -2.2);
    light.target.position.set(0, 0, -14);
    light.castShadow = false;
    g.add(light, light.target);

    // headlight beams — FrontSide so the bright interior is not visible through
    // the cabin glass from behind (critic r2). Apex low at the lamp, tilted down.
    coneMat = new THREE.MeshBasicMaterial({
      color: '#ffedb0', transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
    });
    const beamGeo = new THREE.ConeGeometry(0.3, 5.2, 12, 1, true);
    beamGeo.translate(0, -2.6, 0);
    const beamL = new THREE.Mesh(beamGeo, coneMat);
    beamL.rotation.x = Math.PI / 2 - 0.14;
    beamL.position.set(-0.56, 0.55, -2.06);
    const beamR = new THREE.Mesh(beamGeo, coneMat);
    beamR.rotation.x = Math.PI / 2 - 0.07;
    beamR.position.set(0.56, 0.6, -2.06);
    g.add(new THREE.Mesh(mergeStaticMeshes([beamL, beamR]), coneMat));

    // low-beam pool — soft light lying ON the asphalt ahead of the lamps
    beamPoolMat = new THREE.MeshBasicMaterial({
      map: radialGlowTexture('#ffe9b8'), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const beamPool = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 11), beamPoolMat);
    beamPool.rotation.x = -Math.PI / 2;
    beamPool.position.set(0, 0.05, -7.5);
    g.add(beamPool);
  }

  // exhaust flame (combo heat) — points backwards (+Z)
  const flameMat = new THREE.MeshBasicMaterial({
    color: '#ff9b3d', transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.26, 1.5, 8), flameMat);
  flame.rotation.x = -Math.PI / 2;
  flame.position.set(0, 0.45, 2.6);
  g.add(flame);
  const flameCore = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.9, 8), flameMat.clone());
  flameCore.material.color = new THREE.Color('#ffe08a');
  flameCore.rotation.x = -Math.PI / 2;
  flameCore.position.set(0, 0.45, 2.2);
  g.add(flameCore);

  return { group: g, wheels, rims, coneMat, beamPoolMat, flame, flameCore, light, tailMat, headMat };
}

function makeLabel(name, colorCss) {
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

export function create(world, { racers, seed, timeOfDay = 'day' }) {
  const rng = mulberry32(seed);
  const group = new THREE.Group();
  let tod = TOD[timeOfDay] ?? TOD.day;

  /* ---------- environment ---------- */
  // grass — seeded noise albedo (four-tone turf ramp: deep green → dry straw),
  // normal + roughness maps for micro-relief. Kills the "one uniform emerald
  // color" flatness (critic r10 #4) with zero asset files. r11: coarse MACRO
  // patches (dry yellow-green meadows vs denser turf) — the r10 render still
  // read as one repeating emerald tint with diagonal noise streaks; real
  // grassland varies in 10–30m patches (see refs/real-world/real-horse.jpg)
  const grassPBR = makeGroundPBR({
    seed: 101, octaves: 5, firstLattice: 4, gain: 0.55, normalStrength: 2.2,
    color: rampHex(['#44682f', '#5b8f42', '#6da04e', '#96a352']),
    rough: (h) => 0.92 + h * 0.06,
    macro: {
      seed: 1017, firstLattice: 2, amount: 0.42,
      color: rampHex(['#4c7231', '#8ba050', '#b3a75c']),
    },
  });
  grassPBR.map.repeat.set(44, 190);   // ~16m tile → 5m patches down to 0.3m blades
  grassPBR.normalMap.repeat.set(44, 190);
  grassPBR.roughMap.repeat.set(44, 190);
  const groundMat = new THREE.MeshStandardMaterial({
    color: '#ffffff', map: grassPBR.map, normalMap: grassPBR.normalMap,
    roughnessMap: grassPBR.roughMap, roughness: 1, envMapIntensity: 0.2,
  });
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 3000),
    groundMat
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = -TRACK_LENGTH / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // asphalt — aggregate speckle albedo + normal relief + roughness variation
  // (0.78–0.95), replacing the single flat gray (r10 realism pass)
  const asphaltPBR = makeGroundPBR({
    seed: 55, octaves: 5, firstLattice: 4, gain: 0.55, normalStrength: 3.0,
    color: rampHex(['#2f3237', '#3b3e44', '#44474d', '#4b4e54']),
    rough: (h) => 0.78 + h * 0.17,
  });
  asphaltPBR.map.repeat.set(6, 520);  // ~2m tile → 3–6cm aggregate
  asphaltPBR.normalMap.repeat.set(6, 520);
  asphaltPBR.roughMap.repeat.set(6, 520);
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(13.4, TRACK_LENGTH + 160),
    new THREE.MeshStandardMaterial({
      color: '#ffffff', map: asphaltPBR.map, normalMap: asphaltPBR.normalMap,
      roughnessMap: asphaltPBR.roughMap, roughness: 1, envMapIntensity: 0.25,
    })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.02, -TRACK_LENGTH / 2);
  road.receiveShadow = true;
  group.add(road);

  // wheel-track wear — the darker compressed lanes every driven road photo
  // shows along the wheel lines (real asphalt never wears uniformly). One soft
  // alpha texture repeated along the track, 4 strips merged into ONE mesh (+1
  // draw call — SPEC §1.3 budget holds)
  const wearTex = canvasTexture((ctx, w, h) => {
    const g2 = ctx.createLinearGradient(0, 0, w, 0);
    g2.addColorStop(0, 'rgba(10,12,14,0)');
    g2.addColorStop(0.5, 'rgba(10,12,14,0.55)');
    g2.addColorStop(1, 'rgba(10,12,14,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);
    // faint lengthwise streaks inside the band (tire tread smear)
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `rgba(8,10,12,${0.05 + Math.random() * 0.08})`;
      ctx.fillRect(Math.random() * w, 0, 1 + Math.random() * 2, h);
    }
  }, 64, 256);
  wearTex.wrapS = wearTex.wrapT = THREE.RepeatWrapping;
  wearTex.repeat.set(1, 90);
  const wearMat = new THREE.MeshBasicMaterial({ map: wearTex, transparent: true, opacity: 0.34, depthWrite: false });
  const wearParts = [];
  // strip positions = the wheel-track clusters of the five LANES (laneX±1.03
  // collapses to three pairs: ±1.1, ±3.3, ±5.43)
  for (const lx of [-5.43, -3.3, -1.1, 1.1, 3.3, 5.43]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.85, TRACK_LENGTH + 120), wearMat);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(lx, 0.035, -TRACK_LENGTH / 2);
    wearParts.push(strip);
  }
  group.add(new THREE.Mesh(mergeStaticMeshes(wearParts), wearMat));

  // dashed lane lines — Standard so night light falls off across them
  // (critic r5: Basic stayed readable at any distance)
  const dashGeo = new THREE.PlaneGeometry(0.18, 2.6);
  const dashMat = new THREE.MeshStandardMaterial({ color: '#e8e8e8', roughness: 0.9 });
  const dashes = new THREE.InstancedMesh(dashGeo, dashMat, 5 * 90);
  const m4 = new THREE.Matrix4(), qFlat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  let di = 0;
  for (const lx of [-3.3, -1.1, 1.1, 3.3]) {
    for (let z = 20; z > -TRACK_LENGTH; z -= 10) {
      m4.compose(new THREE.Vector3(lx, 0.03, z), qFlat, new THREE.Vector3(1, 1, 1));
      dashes.setMatrixAt(di++, m4);
    }
  }
  dashes.count = di;
  group.add(dashes);

  // start line (checker)
  const startTex = canvasTexture((ctx) => {
    for (let y = 0; y < 2; y++) for (let x = 0; x < 14; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      ctx.fillRect(x * 20, y * 20, 20, 20);
    }
  }, 280, 40);
  const startLine = new THREE.Mesh(new THREE.PlaneGeometry(13.4, 1.6), new THREE.MeshStandardMaterial({ map: startTex, roughness: 0.9 }));
  startLine.rotation.x = -Math.PI / 2;
  startLine.position.set(0, 0.04, -2);
  group.add(startLine);

  // roadside trees + rocks — instanced template matrices, then merged into one
  // regular Mesh each (InstancedMesh never enters the shadow depth pass in
  // this three build, so merged Meshes are what make tree shadows real).
  // r12: canopy = three NOISE-JITTERED cone blobs (position-keyed displacement
  // makes every lobe lumpy, so trees stop reading as identical clean cones)
  const nTrees = 130;
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 1.6, 6);
  const crownMat = new THREE.MeshStandardMaterial({ color: '#2f7d38', roughness: 1 });
  const crownBlobA = new THREE.Mesh(jitterRock(new THREE.ConeGeometry(1.5, 2.3, 8), { amp: 0.17, seed: 311, freq: 2.6 }));
  crownBlobA.position.y = -0.6;
  const crownBlobB = new THREE.Mesh(jitterRock(new THREE.ConeGeometry(1.05, 2.1, 8), { amp: 0.17, seed: 312, freq: 2.6 }));
  crownBlobB.position.y = 0.85;
  crownBlobB.rotation.y = 0.5;
  const crownBlobC = new THREE.Mesh(jitterRock(new THREE.ConeGeometry(0.7, 1.5, 7), { amp: 0.18, seed: 313, freq: 2.8 }));
  crownBlobC.position.set(0.35, 1.75, -0.2);
  crownBlobC.rotation.y = 1.1;
  const crownGeo = mergeStaticMeshes([crownBlobA, crownBlobB, crownBlobC]);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#7a5230', roughness: 1 }), nTrees);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, nTrees);
  const qId = new THREE.Quaternion();
  for (let i = 0; i < nTrees; i++) {
    const side = rng() > 0.5 ? 1 : -1;
    const x = side * (10 + rng() * 46);
    const z = 16 - rng() * (TRACK_LENGTH + 30);
    const s = 0.8 + rng() * 1.7;
    const cw = 0.85 + rng() * 0.45; // crown width variance breaks the clone look (critic r5)
    qId.setFromEuler(new THREE.Euler(0, rng() * 3, 0));
    m4.compose(new THREE.Vector3(x, 0.8 * s, z), qId, new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(x, (1.6 + 1.7) * s, z), qId, new THREE.Vector3(s * cw, s, s * cw));
    crowns.setMatrixAt(i, m4);
  }
  const trunkMesh = new THREE.Mesh(mergeInstancedGeometry(trunks), trunks.material);
  const crownMesh = new THREE.Mesh(mergeInstancedGeometry(crowns), crowns.material);
  trunkMesh.castShadow = crownMesh.castShadow = true;
  trunkMesh.name = 'treeTrunks'; crownMesh.name = 'treeCrowns';
  group.add(trunkMesh, crownMesh);
  trunks.dispose(); crowns.dispose(); trunkGeo.dispose(); crownGeo.dispose();

  const rocks = new THREE.InstancedMesh(
    jitterRock(new THREE.DodecahedronGeometry(0.7), { amp: 0.3, seed: 55, freq: 3.5 }),
    new THREE.MeshStandardMaterial({ color: '#8d9298', roughness: 1 }),
    40
  );
  for (let i = 0; i < 40; i++) {
    const side = rng() > 0.5 ? 1 : -1;
    qId.setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3));
    m4.compose(
      new THREE.Vector3(side * (9 + rng() * 30), 0.3, 10 - rng() * (TRACK_LENGTH + 20)),
      qId,
      new THREE.Vector3(0.5 + rng(), 0.5 + rng(), 0.5 + rng())
    );
    rocks.setMatrixAt(i, m4);
  }
  const rockMesh = new THREE.Mesh(mergeInstancedGeometry(rocks), rocks.material);
  rockMesh.castShadow = true;
  group.add(rockMesh);
  rocks.dispose();

  // distant mountains — 12 separate Meshes merged into one (12 → 1 draw calls).
  // r12: noise-jittered flanks — clean 5-sided pyramids read as low-poly props
  // even at distance (modeling mandate: real silhouettes)
  const mountainMeshes = [];
  const mountainMat = new THREE.MeshStandardMaterial({ color: '#6f87a8', roughness: 1, flatShading: true });
  for (let i = 0; i < 12; i++) {
    const h = 40 + rng() * 70;
    const mt = new THREE.Mesh(jitterRock(new THREE.ConeGeometry(30 + rng() * 40, h, 7), { amp: 0.13, seed: 70 + i, freq: 1.6 }), mountainMat);
    const side = i % 2 ? 1 : -1;
    mt.position.set(side * (130 + rng() * 160), h / 2 - 4, -rng() * TRACK_LENGTH);
    mountainMeshes.push(mt);
  }
  const mountains = new THREE.Mesh(mergeStaticMeshes(mountainMeshes), mountainMat);
  group.add(mountains);

  // clouds — merged into ONE mesh; fewer, smaller, higher puffs so the sunny
  // blue actually shows through (critic r6: white wash covered the sky)
  const cloudMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 });
  const cloudPuffs = [];
  for (let i = 0; i < 8; i++) {
    const cx = (rng() - 0.5) * 300, cy = 70 + rng() * 35, cz = -rng() * (TRACK_LENGTH + 100);
    for (let j = 0; j < 3; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(4 + rng() * 3.5, 7, 5), cloudMat);
      puff.position.set(cx + j * 6 - 6 + rng() * 3, cy + rng() * 2, cz + rng() * 4);
      puff.scale.y = 0.55;
      cloudPuffs.push(puff);
    }
  }
  const clouds = new THREE.Mesh(mergeStaticMeshes(cloudPuffs), cloudMat);
  group.add(clouds);

  // scenery that must sink BELOW the night sky as silhouettes (critic r5:
  // mountains/clouds/trees stayed brighter than the sky at night)
  const sceneryDim = [
    { mat: mountainMat, base: mountainMat.color.clone() },
    { mat: cloudMat, base: cloudMat.color.clone() },
    { mat: trunkMesh.material, base: trunkMesh.material.color.clone() },
    { mat: crownMesh.material, base: crownMesh.material.color.clone() },
    { mat: rockMesh.material, base: rockMesh.material.color.clone() },
  ];

  // billboards with playful copy (unlit → glow like neon at night) — dimmed
  // per TOD in setTimeOfDay, so the materials are collected here. Posts share
  // one material and merge into ONE mesh (6 → 1 draws, §1.3 budget).
  const boardMats = [];
  const boardPostParts = [];
  const boardPostMat = new THREE.MeshStandardMaterial({ color: '#4a4f58' });
  const slogans = ['TYPE FASTER!', 'wpm > everything', 'TypeRacer 3D', '🚤 try River Rapids', '🐎 try Wild West', '🚀 try Orbit Dash', 'no typos allowed'];
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1;
    const z = -60 - i * (TRACK_LENGTH / 6) - rng() * 30;
    const tex = canvasTexture((ctx, w, h) => {
      ctx.fillStyle = '#101623'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#4f8cff'; ctx.lineWidth = 6; ctx.strokeRect(4, 4, w - 8, h - 8);
      ctx.fillStyle = '#fff'; ctx.font = '800 26px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(slogans[i % slogans.length], w / 2, h / 2);
    }, 320, 110);
    const boardMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true });
    boardMats.push(boardMat);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.1), boardMat);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 4, 0.35), boardPostMat);
    post.position.set(side * 11, 2, z);
    board.position.set(side * 11, 5.4, z);
    board.rotation.y = side * -Math.PI / 5.2;
    post.castShadow = true;
    board.castShadow = true;
    group.add(board);
    boardPostParts.push(post);
  }
  const boardPosts = new THREE.Mesh(mergeStaticMeshes(boardPostParts), boardPostMat);
  boardPosts.castShadow = true;
  group.add(boardPosts);

  /* ---------- street lamps + light pools (night charm) ---------- */
  // merged into 3 meshes total: poles+arms, heads, pools (64 → 3 draw calls)
  const lampGlowTex = radialGlowTexture('#ffcf8a');
  const lampHeadMat = new THREE.MeshBasicMaterial({ color: '#ffe6b0' });
  const lampPoleMat = new THREE.MeshStandardMaterial({ color: '#2b3038', roughness: 0.9 });
  const lampPoolMat = new THREE.MeshBasicMaterial({ map: lampGlowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const lampPoleMeshes = [], lampHeadMeshes = [], lampPoolMeshes = [];
  for (let i = 0; i < 16; i++) {
    const side = i % 2 ? 1 : -1;
    const z = -20 - i * (TRACK_LENGTH / 16);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 5.4, 6), lampPoleMat);
    pole.position.set(side * 7.6, 2.7, z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.1), lampPoleMat);
    arm.position.set(side * 6.9, 5.3, z);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), lampHeadMat);
    head.position.set(side * 6.2, 5.22, z);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(9, 13), lampPoolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(side * 5.6, 0.05, z);
    lampPoleMeshes.push(pole, arm);
    lampHeadMeshes.push(head);
    lampPoolMeshes.push(pool);
  }
  const lampPoles = new THREE.Mesh(mergeStaticMeshes(lampPoleMeshes), lampPoleMat);
  lampPoles.castShadow = true;
  const lampHeads = new THREE.Mesh(mergeStaticMeshes(lampHeadMeshes), lampHeadMat);
  const lampPools = new THREE.Mesh(mergeStaticMeshes(lampPoolMeshes), lampPoolMat);
  group.add(lampPoles, lampHeads, lampPools);

  /* ---------- sky dome + stars + moon ---------- */
  // shader dome: eased atmospheric gradient + real ~2° sun disc (shared.js);
  // replaces the canvas-gradient texture + separate sun sprite (r10)
  const sky = createSkyDome(620);
  group.add(sky);

  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(420 * 3);
  for (let i = 0; i < 420; i++) {
    const th = rng() * Math.PI * 2, ph = rng() * Math.PI * 0.42;
    const r = 590;
    starPos[i * 3] = Math.cos(th) * Math.sin(ph + 0.12) * r;
    starPos[i * 3 + 1] = Math.cos(ph) * r * 0.85 + 60;
    starPos[i * 3 + 2] = Math.sin(th) * Math.sin(ph + 0.12) * r - 200;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: '#cfe0ff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false });
  const stars = new THREE.Points(starGeo, starMat);
  group.add(stars);

  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(16, 16, 12),
    new THREE.MeshBasicMaterial({ color: '#eef3ff', fog: false })
  );
  moon.position.set(-180, 240, -420);
  const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialGlowTexture('#cfe0ff'), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  moonGlow.scale.set(120, 120, 1);
  moonGlow.position.copy(moon.position);
  group.add(moon, moonGlow);

  // these must follow the player, or the camera exits the skybox mid-track
  const celestial = [sky, stars, moon, moonGlow];

  /* ---------- finish gate ---------- */
  const gateZ = -TRACK_LENGTH;
  const pillarMat = new THREE.MeshStandardMaterial({ color: '#22262e', roughness: 0.7 });
  const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8, 0.7), pillarMat);
  p1.position.set(-7, 4, gateZ); p1.castShadow = true;
  const p2 = p1.clone(); p2.position.x = 7;
  group.add(p1, p2);
  const bannerTex = canvasTexture((ctx, w, h) => {
    ctx.fillStyle = '#0e1420'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffd75e'; ctx.font = '900 64px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🏁 FINISH 🏁', w / 2, h / 2);
  }, 512, 96);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(14.5, 2.4), new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide }));
  banner.position.set(0, 6.6, gateZ);
  group.add(banner);

  /* ---------- vehicles ---------- */
  const botColors = ['#2e86ff', '#ffb020', '#9b59ff', '#20c997', '#ff7ab6'];
  const vehicles = [];
  racers.forEach((r, i) => {
    const isPlayer = r.isPlayer;
    const lane = isPlayer ? 2 : [1, 3, 0, 4][i - 1] ?? 1;
    const paint = r.paint ?? { primary: isPlayer ? '#ff4757' : botColors[i % botColors.length], secondary: null, variant: 0 };
    const color = paint.primary ?? '#ff4757';
    const car = buildCar(paint, { player: isPlayer });
    car.group.position.set(LANES[lane] ?? 0, 0, 0);
    // model already faces -Z (headlights at local -Z) — no rotation needed
    group.add(car.group);

    const label = makeLabel(isPlayer ? 'YOU' : r.name, isPlayer ? '#ff6b78' : '#9fd0ff');
    label.sprite.position.set(0, 2.9, 0);
    car.group.add(label.sprite);

    vehicles.push({
      ...car,
      label,
      lane,
      baseX: LANES[lane] ?? 0,
      color,
      isPlayer,
      wobble: rng() * 10,
      visZ: 0,
      wheelSpin: 0,
      updateLabel(wpmText, sub) { label.draw(wpmText, sub); },
    });
  });

  /* ---------- time of day ---------- */
  function setTimeOfDay(name) {
    tod = TOD[name] ?? TOD.day;
    setSkyDome(sky, tod); // gradient + real sun disc, written once per TOD
    // fog fades toward the sky's horizon band, not a generic gray
    // (GRAPHICS_PLAN §1.4); FogExp2 density replaces the old linear near/far
    world.setFog(tod.skyBot, tod.fogDensity);
    world.scene.background.set(tod.skyBot);
    world.setExposure(tod.exposure);
    // envSun scales the HDR blob: 1.0 by day (paint glint, r10 #4), ~0.12 at
    // night so the moon glint stays dim (r10 #5)
    world.setEnvironment(tod.skyTop, tod.skyMid, tod.skyBot, tod.ground, { x: tod.sunRig[0], y: tod.sunRig[1], z: tod.sunRig[2] }, tod.envSun);
    groundMat.color.set(tod.grass); // multiplies the grass albedo map (night: cold dim)
    world.sunRig.set(tod.sunRig[0], tod.sunRig[1], tod.sunRig[2]);
    world.sun.color.set(tod.sunColor);
    world.sun.intensity = tod.sunIntensity;
    world.hemi.color.set(tod.hemiSky);
    world.hemi.groundColor.set(tod.hemiGround);
    world.hemi.intensity = tod.hemiIntensity;
    world.ambient.intensity = tod.ambient;
    boardMats.forEach((m) => (m.opacity = name === 'night' ? 0.55 : name === 'sunset' ? 0.8 : 1.0));
    starMat.opacity = tod.stars;
    moonGlow.material.opacity = tod.moon ? 0.5 : 0;
    moon.visible = !!tod.moon;
    cloudMat.opacity = name === 'night' ? 0.05 : name === 'sunset' ? 0.8 : 0.72; // fewer white wash on a sunny day (r6)
    // night: scenery albedo and env dip so mountains/clouds/trees read as
    // silhouettes darker than the sky (critic r5)
    const sceneryK = name === 'night' ? 0.28 : name === 'sunset' ? 0.75 : 1.0;
    const sceneryEnv = name === 'night' ? 0.08 : name === 'sunset' ? 0.5 : 1.0;
    sceneryDim.forEach(({ mat, base }) => {
      mat.color.copy(base).multiplyScalar(sceneryK);
      mat.envMapIntensity = sceneryEnv; // clouds are Basic: no-op, harmless
    });
    lampPoolMat.opacity = tod.lamps * 0.8;
    lampPools.visible = tod.lamps > 0.01; // skip the pools' draw call by day
    lampHeadMat.color.set(tod.lamps > 0.3 ? '#ffe6b0' : '#8b9099');
    lampHeadMat.toneMapped = tod.lamps <= 0.3; // night head = brightest element (critic r5)
    vehicles.forEach((v) => {
      if (v.coneMat) v.coneMat.opacity = tod.cones; // player only (r12: bots
      // never had a light source — the opacity-0 cones were wasted draws)
      if (v.beamPoolMat) v.beamPoolMat.opacity = tod.beam * 4.5;
      v.tailMat.emissiveIntensity = tod.tail;
      v.headMat.emissiveIntensity = tod.headGlow ?? 0.02; // inset fixture glows at night
      if (v.light) v.light.intensity = tod.headlight; // bots: emissive quads only
    });
  }
  setTimeOfDay(timeOfDay);

  /* ---------- per-frame ---------- */
  let labelTimer = 0;
  function update(dt, state) {
    if (!state) return;
    labelTimer += dt;
    const refreshLabels = labelTimer > 0.35;
    if (refreshLabels) labelTimer = 0;

    // sky rides along with the player (see followPlayerSky)
    followPlayerSky(celestial, vehicles[0]?.visZ ?? 0);

    state.forEach((rs, i) => {
      const v = vehicles[i];
      if (!v) return;
      const targetZ = -rs.progress01 * TRACK_LENGTH;
      v.visZ += (targetZ - v.visZ) * expK(9, dt); // smooth visual motion
      v.group.position.z = v.visZ;

      const s01 = rs.speed01 ?? 0;
      v.group.position.y = Math.abs(Math.sin(performance.now() / 90 + v.wobble)) * 0.05 * s01;
      v.group.rotation.z = Math.sin(performance.now() / 240 + v.wobble) * 0.015 * s01;
      if (rs.errorT > 0) {
        v.group.rotation.z += (Math.random() - 0.5) * 0.12;
        rs.errorT -= dt;
      }
      // wheels spin via the two InstancedMeshes (tires + rims) — one shared
      // angle, matrices composed with reused temporaries (no per-frame alloc)
      const wheelK = (s01 * 14 + 2) * dt;
      v.wheelSpin -= wheelK;
      _wq.setFromAxisAngle(_XAXIS, v.wheelSpin);
      for (let wi = 0; wi < 4; wi++) {
        _wm4.compose(_wv.set(WHEEL_POS[wi][0], 0.38, WHEEL_POS[wi][1]), _wq, _w1);
        v.wheels.setMatrixAt(wi, _wm4);
        v.rims.setMatrixAt(wi, _wm4);
      }
      v.wheels.instanceMatrix.needsUpdate = true;
      v.rims.instanceMatrix.needsUpdate = true;

      // combo flames (player)
      const heat = rs.comboHeat ?? 0;
      const flicker = 0.85 + Math.random() * 0.3;
      v.flame.scale.set(0.6 + heat * 0.9, heat * flicker, 0.6 + heat * 0.9);
      v.flame.material.opacity = heat * 0.85;
      v.flameCore.scale.set(0.6 + heat * 0.7, heat * flicker, 0.6 + heat * 0.7);
      v.flameCore.material.opacity = heat * 0.9;

      if (refreshLabels) {
        const wpm = Math.round(rs.wpm ?? 0);
        v.updateLabel(`${wpm} wpm`, rs.finished ? 'finished' : `${Math.round(rs.progress01 * 100)}%`);
      }
    });
  }

  return { group, vehicles, update, finishZ: gateZ, setTimeOfDay };
}
