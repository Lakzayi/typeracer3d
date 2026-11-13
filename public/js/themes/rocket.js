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
    bg: '#b8d4ea', fogDensity: 0.0016, exposure: 1.08,
    skyTop: '#1e56b0', skyMid: '#4f86c0', skyBot: '#b8d4ea',
    sunRig: [-34, 14, -46], sunDisc: 1.2, envSun: 1.0,
    sunColor: '#fffbe8', sunIntensity: 3.0,
    hemiSky: '#b8dcff', hemiGround: '#5a6048', hemiIntensity: 0.5,
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
    // rim-lit halo
    bg: '#04060f', fogDensity: 0.0016, exposure: 0.6,
    skyTop: '#01030a', skyMid: '#04060f', skyBot: '#0a1226',
    sunRig: [-30, 20, 50], sunDisc: 0, envSun: 0.12,
    sunColor: '#8fa8ff', sunIntensity: 0.9,
    hemiSky: '#2c4a70', hemiGround: '#0a0f18', hemiIntensity: 0.65,
    ambient: 0.06, stars: 1.0, rings: 1.4, glow: 1.0, jetLight: 34, plume: 0.65,
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

function buildRocket(color, { player = false } = {}) {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: '#cfd4dc', roughness: 0.45, metalness: 0.5, envMapIntensity: 0.7 });
  const accent = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.4, envMapIntensity: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: '#9fd8ff', roughness: 0.05, metalness: 0.8, transparent: true, opacity: 0.9, envMapIntensity: 1.0 });

  // hull + nose (flies toward -Z)
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.58, 2.7, 12), shell);
  body.rotation.x = -Math.PI / 2;
  body.position.y = 1.3;
  body.castShadow = true;
  g.add(body);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.4, 12), accent);
  band.rotation.x = -Math.PI / 2;
  band.position.set(0, 1.3, -0.5);
  g.add(band);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.3, 12), accent);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, 1.3, -1.95);
  nose.castShadow = true;
  g.add(nose);

  // porthole
  const port = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), glass);
  port.position.set(0, 1.55, -0.95);
  g.add(port);

  // fins (rear, +Z) — slim swept X-formation: the outer edge tapers so the
  // fins read as fins, not flat cross-boards (critic r6, §5.3); all four merge
  // into one draw call (§1.3)
  const fins = [];
  const finGeo = new THREE.BoxGeometry(0.07, 0.72, 0.62);
  {
    const fp = finGeo.attributes.position;
    for (let i = 0; i < fp.count; i++) {
      if (fp.getY(i) > 0) {
        fp.setY(i, fp.getY(i) * 0.9);
        fp.setZ(i, fp.getZ(i) * 0.45 + 0.18);
      }
    }
    finGeo.computeVertexNormals();
  }
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(finGeo, accent);
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    fin.position.set(Math.cos(a) * 0.52, 1.3 + Math.sin(a) * 0.52, 1.5);
    fin.rotation.z = a + Math.PI / 2;
    fin.castShadow = true;
    fins.push(fin);
  }
  g.add(new THREE.Mesh(mergeStaticMeshes(fins), accent)); // 4 fins → 1 draw

  // engine bell — LOW env response: sooty metal must not mirror the sky env
  // (the env sun blob turned the bell/cap into a cream mirror disc, r7 shot)
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.44, 0.5, 10, 1, true), new THREE.MeshStandardMaterial({ color: '#3a4048', roughness: 0.75, metalness: 0.6, envMapIntensity: 0.25, side: THREE.DoubleSide }));
  bell.rotation.x = -Math.PI / 2;
  bell.position.set(0, 1.3, 1.6);
  g.add(bell);

  // dark rear cap — the body's open rear face was catching full sun and
  // reading as the "burned white disc" behind the plume (critic r7); real
  // engine housings are dark matte metal
  const rearCap = new THREE.Mesh(new THREE.CircleGeometry(0.5, 12), new THREE.MeshStandardMaterial({ color: '#23262c', roughness: 0.85, metalness: 0.35, envMapIntensity: 0.25 }));
  rearCap.position.set(0, 1.3, 1.355);
  g.add(rearCap);

  // exhaust — always on (it's a rocket), flares with combo heat; capped so
  // ACES keeps color/detail instead of a burned white blob (critic r2).
  // r5: a long hot COLUMN, not a round blob — narrow core cone inside a
  // longer plume cone inside a faint wide column (critic r5, §5.4)
  const jetMat = new THREE.MeshBasicMaterial({ color: '#ff9b45', transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
  const jet = new THREE.Mesh(new THREE.ConeGeometry(0.3, 4.6, 10), jetMat);
  jet.rotation.x = Math.PI / 2;
  jet.position.set(0, 1.3, 3.9);
  g.add(jet);
  const jetCoreMat = new THREE.MeshBasicMaterial({ color: '#ffd9a0', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  const jetCore = new THREE.Mesh(new THREE.ConeGeometry(0.11, 2.8, 10), jetCoreMat);
  jetCore.rotation.x = Math.PI / 2;
  jetCore.position.set(0, 1.3, 2.9);
  g.add(jetCore);
  const jetColumnMat = new THREE.MeshBasicMaterial({ color: '#ff8a3d', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
  const jetColumn = new THREE.Mesh(new THREE.ConeGeometry(0.55, 7.0, 10, 1, true), jetColumnMat);
  jetColumn.rotation.x = Math.PI / 2;
  jetColumn.position.set(0, 1.3, 4.9);
  g.add(jetColumn);

  // nozzle glow sprite — small, dim: bloom, not a star (critic r2: ~10% burned).
  // r7: tighter still — the halo was swallowing the fins and lower body
  const jetGlowMat = new THREE.SpriteMaterial({
    map: radialGlowTexture('#ff9b45'), transparent: true, opacity: 0.25,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const jetGlow = new THREE.Sprite(jetGlowMat);
  jetGlow.scale.set(0.9, 0.9, 1);
  jetGlow.position.set(0, 1.3, 2.2);
  g.add(jetGlow);

  // bots: cheap longer exhaust smear (§5.4 budget alternative to a trail)
  let smearMat = null;
  if (!player) {
    smearMat = new THREE.MeshBasicMaterial({ color: '#ff9b45', transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false });
    const smear = new THREE.Mesh(new THREE.ConeGeometry(0.24, 4.5, 8), smearMat);
    smear.rotation.x = Math.PI / 2;
    smear.position.set(0, 1.3, 4.4);
    g.add(smear);
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
    g.add(trail);
  }

  // only the player carries a real light (PLAN §1.2); intensity per TOD below
  let light = null;
  if (player) {
    light = new THREE.PointLight('#ffd9a0', 0, 12, 2);
    // below-behind the nozzle, ~2.9 units off the rear faces: at (0,1.3,2.2)
    // inverse-square blasted the cap/bell to cream-white — the "burned core"
    // was self-illumination, proven by the r7 probes (critic r7)
    light.position.set(0, 0.85, 4.4);
    g.add(light);
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
  g.add(hover);

  return { group: g, jet, jetMat, jetCore, jetCoreMat, jetColumnMat, jetGlowMat, smearMat, trail, light, shellMat: shell, accentMat: accent };
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

  // launch-complex ground far below the strip — horizon context so the rocks
  // don't float in an empty gradient (critic r5). r10: olive-tan terrain like
  // the real-day-launch photo foreground, not navy (r10 #2). r11: macro
  // patches (scrub vs sandy clearings) so it stops reading as one flat olive
  const terrainPBR = makeGroundPBR({
    seed: 43, octaves: 5, firstLattice: 3, gain: 0.55, normalStrength: 2.0,
    color: rampHex(['#3e4a2e', '#55603a', '#63683c', '#4a5230']),
    rough: (h) => 0.9 + h * 0.08,
    macro: {
      seed: 437, firstLattice: 2, amount: 0.35,
      color: rampHex(['#5a5c36', '#8a8256', '#6e7040']),
    },
  });
  terrainPBR.map.repeat.set(48, 72);
  terrainPBR.normalMap.repeat.set(48, 72);
  terrainPBR.roughMap.repeat.set(48, 72);
  // r11: low rolling hills on the far terrain — the r10 ground/sky junction
  // was one dead-straight line across the whole shot (photo tell). No props
  // sit on this plane (asteroids float), so displacement is free of grounding.
  const groundDunes = makeDunes(4300, { cell: 170, octaves: 3, gain: 0.5 });
  const groundFade = (x) => { // flat under the strip, rolling beyond its edge
    const t = Math.min(1, Math.max(0, (Math.abs(x) - 9) / 26));
    return t * t * (3 - 2 * t);
  };
  const groundGeo = new THREE.PlaneGeometry(1600, 2400, 64, 96);
  displaceGroundPlane(groundGeo, groundDunes, { amp: 4.5, fadeFn: groundFade });
  const launchGround = new THREE.Mesh(
    groundGeo,
    new THREE.MeshStandardMaterial({
      color: '#ffffff', map: terrainPBR.map, normalMap: terrainPBR.normalMap,
      roughnessMap: terrainPBR.roughMap, roughness: 1, envMapIntensity: 0.2,
    })
  );
  launchGround.rotation.x = -Math.PI / 2;
  launchGround.position.set(0, -14, -TRACK_LENGTH / 2);
  launchGround.receiveShadow = true;
  group.add(launchGround);

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
      astX[i] = side * (14 + rng() * 60);
      astY[i] = rng() * 26 - 4;
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
    const color = isPlayer ? '#ff4757' : botColors[i % botColors.length];
    const rocket = buildRocket(color, { player: isPlayer });
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
      v.jetColumnMat.opacity = tod.plume * 0.24 * plumeK;
      if (v.smearMat) v.smearMat.opacity = Math.max(0.18, tod.plume * 0.4 * plumeK); // bots read too (r4)
      if (v.light) v.light.intensity = tod.jetLight; // player only — the jet is the lamp
      // sooty metal must not mirror the env sun — night rims stay physical
      // (r7 note + r10 #5); day: real glints on the white shell
      const vehEnv = name === 'night' ? 0.2 : name === 'sunset' ? 0.45 : 0.8;
      v.shellMat.envMapIntensity = vehEnv;
      v.accentMat.envMapIntensity = vehEnv;
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
      // end-on (chase cam) the additive cones stack into one disc — keep the
      // rest-state stack dim so the core keeps color, not white (critic r7)
      v.jetMat.opacity = Math.min(0.45, 0.1 + s01 * 0.3 + heat * 0.3) * plumeK;
      v.jetCore.scale.set(0.8 + heat * 0.9, power * flicker, 0.8 + heat * 0.9);
      v.jetCoreMat.opacity = Math.min(0.42, 0.12 + s01 * 0.2 + heat * 0.25) * plumeK;
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
