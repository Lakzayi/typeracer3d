/* 🚀 Orbit Dash theme — a low-orbit drag strip: rockets, glowing energy
 * highway, ring gates, floating asteroids, planet Earth below. */

import * as THREE from 'three';
import { TRACK_LENGTH, mulberry32 } from '../world.js';
import { expK, canvasTexture, radialGlowTexture, makeLabel, stepVehicle, buildFinishGate, followPlayerSky, makeSunDisc } from './shared.js';

const LANES = [-4.4, -2.2, 0, 2.2, 4.4];

const TOD = {
  // "day" reads as a bright launch-day sky (critic r2: navy+stars had no day
  // logic). stars 0 by day (critic r4: stars in a day sky), plume per TOD so
  // the jet reads at noon but doesn't burn at night, jetLight tamed (r4 halo)
  day: {
    // sun forward-upper-left (rig z<0 = in frame above the horizon) so the
    // disc is visible AND the asteroid lit-faces/shadow agree with it
    // (critic r7). y=12 → elevation ≈12°: 18° still clipped at the top edge
    bg: '#4f86c0', fogDensity: 0.0016, exposure: 1.0, sunRig: [-34, 12, -46],
    sunColor: '#fffbe8', sunIntensity: 2.3,
    hemiSky: '#9fd0ff', hemiGround: '#1c2c44', hemiIntensity: 0.35,
    ambient: 0.08, stars: 0.0, rings: 1.0, glow: 0.6, jetLight: 26, plume: 0.85,
  },
  sunset: {
    bg: '#2a1436', fogDensity: 0.0014, exposure: 0.85, sunRig: [30, 16, 44],
    sunColor: '#ffb37a', sunIntensity: 1.3,
    hemiSky: '#d88fb0', hemiGround: '#241430', hemiIntensity: 0.28,
    ambient: 0.08, stars: 0.8, rings: 1.0, glow: 0.8, jetLight: 34, plume: 0.9,
  },
  night: {
    bg: '#04060f', fogDensity: 0.0016, exposure: 0.6, sunRig: [-30, 20, 50],
    sunColor: '#8fa8ff', sunIntensity: 0.9,
    hemiSky: '#2c4a70', hemiGround: '#0a0f18', hemiIntensity: 0.65,
    ambient: 0.06, stars: 1.0, rings: 1.4, glow: 1.0, jetLight: 42, plume: 0.65,
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
  // fins read as fins, not flat cross-boards (critic r6, §5.3)
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
    g.add(fin);
  }

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

  return { group: g, jet, jetMat, jetCore, jetCoreMat, jetColumnMat, jetGlowMat, smearMat, trail, light };
}

export function create(world, { racers, seed, timeOfDay = 'day' }) {
  const rng = mulberry32(seed);
  const group = new THREE.Group();
  let tod = TOD[timeOfDay] ?? TOD.day;

  /* ---------- energy highway ---------- */
  const stripMat = new THREE.MeshStandardMaterial({ color: '#0e2f4a', roughness: 0.4, metalness: 0.6, transparent: true, opacity: 0.72, emissive: '#0a2a44', emissiveIntensity: 0.5 });
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
  // don't float in an empty gradient (critic r5, real-day-launch)
  const launchGround = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 2400),
    new THREE.MeshStandardMaterial({ color: '#182839', roughness: 1 })
  );
  launchGround.rotation.x = -Math.PI / 2;
  launchGround.position.set(0, -14, -TRACK_LENGTH / 2);
  launchGround.receiveShadow = true;
  group.add(launchGround);

  /* ---------- ring gates ---------- */
  const ringMats = [];
  const rings = [];
  for (let i = 0; i < 12; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: i % 2 ? '#3fb0cc' : '#5a6a8a', transparent: true, opacity: 0.3 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(7.4, 0.16, 8, 40), mat);
    ring.position.set(0, 1.4, -40 - i * (TRACK_LENGTH / 12));
    group.add(ring);
    ringMats.push(mat);
    rings.push(ring);
  }

  /* ---------- asteroids ---------- */
  const rockMat = new THREE.MeshStandardMaterial({ color: '#6e7684', roughness: 1, flatShading: true });
  const asteroids = [];
  for (let i = 0; i < 46; i++) {
    const s = 0.5 + rng() * 3.2;
    const a = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
    const side = rng() > 0.5 ? 1 : -1;
    a.position.set(side * (14 + rng() * 60), rng() * 26 - 4, 16 - rng() * (TRACK_LENGTH + 60));
    a.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    a.userData.spin = (rng() - 0.5) * 0.6;
    a.userData.drift = rng() * 10;
    group.add(a);
    asteroids.push(a);
  }

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

  // launch-day sun — the visible source for the warm directional light
  // (critic r5: day sky had no sun)
  const sunDisc = makeSunDisc('#fff3d0');
  group.add(sunDisc);

  // stars/nebulas ride along with the player, and Earth stays centered below
  // (otherwise the camera exits the "sky" mid-track)
  const celestial = [stars, ...nebulas, sunDisc];

  /* ---------- start + finish ---------- */
  const gateZ = buildFinishGate(group, TRACK_LENGTH, { text: '🚀 FINISH 🚀' });
  const startTex = canvasTexture((ctx) => {
    for (let y = 0; y < 2; y++) for (let x = 0; x < 14; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#0a2a44' : '#6f98a4';
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
    world.scene.background.set(tod.bg);
    // space fog: thin — only darkens far asteroids, never a curtain
    // (GRAPHICS_PLAN §3.4); FogExp2 replaces the old linear near/far
    world.setFog(tod.bg, tod.fogDensity);
    world.setExposure(tod.exposure);
    world.setEnvironment(tod.bg, tod.bg, tod.bg, '#0a1626', { x: tod.sunRig[0], y: tod.sunRig[1], z: tod.sunRig[2] }); // void + earthshine + sun glint
    world.sunRig.set(tod.sunRig[0], tod.sunRig[1], tod.sunRig[2]);
    world.sun.color.set(tod.sunColor);
    world.sun.intensity = tod.sunIntensity;
    world.hemi.color.set(tod.hemiSky);
    world.hemi.groundColor.set(tod.hemiGround);
    world.hemi.intensity = tod.hemiIntensity;
    world.ambient.intensity = tod.ambient;
    // visible sun rides the rig direction (critic r5: day sky had no sun)
    const rigLen2 = Math.hypot(tod.sunRig[0], tod.sunRig[1], tod.sunRig[2]);
    sunDisc.position.set(tod.sunRig[0] / rigLen2 * 550, tod.sunRig[1] / rigLen2 * 550, tod.sunRig[2] / rigLen2 * 550);
    sunDisc.userData.skyZ0 = sunDisc.position.z;
    starMat.opacity = tod.stars;
    nebulas.forEach((n) => (n.material.opacity = name === 'night' ? 0.2 : name === 'sunset' ? 0.17 : 0.1));
    // rings at physical subtlety — no neon arcade hoops in the sky (critic r5)
    ringMats.forEach((m) => (m.opacity = Math.min(0.13, 0.22 * tod.rings)));
    dashMat.color.set(name === 'night' ? '#22485a' : '#57909e'); // muted teal paint (r5)
    dashMat.opacity = name === 'night' ? 0.45 : 1.0; // de-neon the lane dashes (r4/r7)
    edgeMat.color.set(name === 'night' ? '#26304a' : '#3a465e'); // rails lit, not self-lit (r7)
    stripMat.emissiveIntensity = name === 'night' ? 0.32 : 0.5; // corridor must stay readable at night (r9 critic: black void)
    holoMats.forEach((m) => (m.opacity = name === 'night' ? 0.5 : name === 'sunset' ? 0.7 : 0.9));
    sunDisc.material.opacity = name === 'day' ? 0.75 : name === 'sunset' ? 0.6 : 0; // readable source (r7)
    vehicles.forEach((v) => {
      v.jetMat.opacity = tod.plume;
      v.jetCoreMat.opacity = tod.plume * 0.55; // core keeps color, reads in daylight (r6/r7 burn fix)
      v.jetColumnMat.opacity = tod.plume * 0.24;
      if (v.smearMat) v.smearMat.opacity = Math.max(0.3, tod.plume * 0.4); // bots read too (r4)
      if (v.light) v.light.intensity = tod.jetLight; // player only — the jet is the lamp
    });
  }
  setTimeOfDay(timeOfDay);

  /* ---------- per-frame ---------- */
  const _tv = new THREE.Vector3(); // reused trail sampler (no per-frame alloc)
  function update(dt, state) {
    if (!state) return;
    const now = performance.now();

    // stars/nebulas ride along; Earth stays centered below the player
    const anchorZ = vehicles[0]?.visZ ?? 0;
    followPlayerSky(celestial, anchorZ);
    earth.position.z = anchorZ;
    atmo.position.z = anchorZ;

    // slow planet spin + drifting asteroids + pulsing rings
    earth.rotation.y += dt * 0.01;
    for (const a of asteroids) {
      a.rotation.x += a.userData.spin * dt;
      a.rotation.y += a.userData.spin * 0.7 * dt;
      a.position.y += Math.sin(now / 2600 + a.userData.drift) * dt * 0.4;
    }
    rings.forEach((ring, i) => {
      const pulse = 0.22 + Math.sin(now / 600 + i * 0.8) * 0.08; // low ceiling — no neon
      ringMats[i].opacity = Math.min(0.35, pulse * tod.rings);
      ring.rotation.z += dt * 0.15;
    });

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
      v.jetMat.opacity = Math.min(0.45, 0.1 + s01 * 0.3 + heat * 0.3);
      v.jetCore.scale.set(0.8 + heat * 0.9, power * flicker, 0.8 + heat * 0.9);
      v.jetCoreMat.opacity = Math.min(0.42, 0.12 + s01 * 0.2 + heat * 0.25);
      v.jetGlowMat.opacity = Math.min(0.1, 0.03 + power * 0.06); // halo must not swallow the fins (r7)

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
