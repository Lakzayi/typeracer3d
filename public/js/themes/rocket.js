/* 🚀 Orbit Dash theme — a low-orbit drag strip: rockets, glowing energy
 * highway, ring gates, floating asteroids, planet Earth below. */

import * as THREE from 'three';
import { TRACK_LENGTH, mulberry32 } from '../world.js';
import { expK, canvasTexture, radialGlowTexture, makeLabel, stepVehicle, buildFinishGate, followPlayerSky } from './shared.js';

const LANES = [-4.4, -2.2, 0, 2.2, 4.4];

const TOD = {
  day: {
    bg: '#12304f', fog: '#12304f', fogNear: 220, fogFar: 900,
    sunColor: '#fffbe8', sunIntensity: 1.5,
    hemiSky: '#9fd0ff', hemiGround: '#1c2c44', hemiIntensity: 0.7,
    ambient: 0.25, stars: 0.55, rings: 1.0, glow: 0.6,
  },
  sunset: {
    bg: '#2a1436', fog: '#2a1436', fogNear: 200, fogFar: 850,
    sunColor: '#ffb37a', sunIntensity: 1.1,
    hemiSky: '#d88fb0', hemiGround: '#241430', hemiIntensity: 0.6,
    ambient: 0.3, stars: 0.8, rings: 1.0, glow: 0.8,
  },
  night: {
    bg: '#04060f', fog: '#04060f', fogNear: 180, fogFar: 800,
    sunColor: '#8fb0ff', sunIntensity: 0.6,
    hemiSky: '#2c4a70', hemiGround: '#0a0f18', hemiIntensity: 0.5,
    ambient: 0.35, stars: 1.0, rings: 1.4, glow: 1.0,
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
  const shell = new THREE.MeshStandardMaterial({ color: '#e8ecf2', roughness: 0.3, metalness: 0.6 });
  const accent = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: '#9fd8ff', roughness: 0.05, metalness: 0.8, transparent: true, opacity: 0.9 });

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

  // fins (rear, +Z) — slim X-formation so the silhouette reads "rocket"
  const finGeo = new THREE.BoxGeometry(0.07, 0.72, 0.62);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(finGeo, accent);
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    fin.position.set(Math.cos(a) * 0.52, 1.3 + Math.sin(a) * 0.52, 1.5);
    fin.rotation.z = a + Math.PI / 2;
    fin.castShadow = true;
    g.add(fin);
  }

  // engine bell
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.44, 0.5, 10, 1, true), new THREE.MeshStandardMaterial({ color: '#3a4048', roughness: 0.5, metalness: 0.8, side: THREE.DoubleSide }));
  bell.rotation.x = -Math.PI / 2;
  bell.position.set(0, 1.3, 1.6);
  g.add(bell);

  // exhaust — always on (it's a rocket), flares with combo heat
  const jetMat = new THREE.MeshBasicMaterial({ color: '#ff9b45', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const jet = new THREE.Mesh(new THREE.ConeGeometry(0.4, 3.0, 10), jetMat);
  jet.rotation.x = Math.PI / 2;
  jet.position.set(0, 1.3, 3.2);
  g.add(jet);
  const jetCoreMat = new THREE.MeshBasicMaterial({ color: '#ffe9c9', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const jetCore = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1.6, 10), jetCoreMat);
  jetCore.rotation.x = Math.PI / 2;
  jetCore.position.set(0, 1.3, 2.6);
  g.add(jetCore);

  const light = new THREE.PointLight('#ffd9a0', 5, 12, 2);
  light.position.set(0, 1.3, 2.2);
  g.add(light);

  return { group: g, jet, jetMat, jetCore, jetCoreMat, light };
}

export function create(world, { racers, seed, timeOfDay = 'day' }) {
  const rng = mulberry32(seed);
  const group = new THREE.Group();
  let tod = TOD[timeOfDay] ?? TOD.day;

  /* ---------- energy highway ---------- */
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(13.4, TRACK_LENGTH + 160),
    new THREE.MeshStandardMaterial({ color: '#0e2f4a', roughness: 0.4, metalness: 0.6, transparent: true, opacity: 0.72, emissive: '#0a2a44', emissiveIntensity: 0.5 })
  );
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(0, 0, -TRACK_LENGTH / 2);
  group.add(strip);

  // glowing lane dashes (emissive cyan)
  const dashMat = new THREE.MeshBasicMaterial({ color: '#54e0ff' });
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

  const edgeMat = new THREE.MeshBasicMaterial({ color: '#8a7bff' });
  for (const ex of [-6.6, 6.6]) {
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.22, TRACK_LENGTH + 160), edgeMat);
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(ex, 0.03, -TRACK_LENGTH / 2);
    group.add(edge);
  }

  /* ---------- planet Earth below ---------- */
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(240, 32, 24),
    new THREE.MeshStandardMaterial({ map: earthTexture(), roughness: 0.9 })
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

  /* ---------- ring gates ---------- */
  const ringMats = [];
  const rings = [];
  for (let i = 0; i < 12; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: i % 2 ? '#54e0ff' : '#c084fc', transparent: true, opacity: 0.55 });
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
      ctx.strokeStyle = i % 2 ? '#54e0ff' : '#c084fc'; ctx.lineWidth = 5; ctx.strokeRect(4, 4, w - 8, h - 8);
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

  // stars/nebulas ride along with the player, and Earth stays centered below
  // (otherwise the camera exits the "sky" mid-track)
  const celestial = [stars, ...nebulas];

  /* ---------- start + finish ---------- */
  const gateZ = buildFinishGate(group, TRACK_LENGTH, { text: '🚀 FINISH 🚀' });
  const startTex = canvasTexture((ctx) => {
    for (let y = 0; y < 2; y++) for (let x = 0; x < 14; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#0a2a44' : '#9fe8ff';
      ctx.fillRect(x * 20, y * 20, 20, 20);
    }
  }, 280, 40);
  const startLine = new THREE.Mesh(new THREE.PlaneGeometry(13.4, 1.6), new THREE.MeshBasicMaterial({ map: startTex, transparent: true, opacity: 0.9 }));
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
    world.scene.background = new THREE.Color(tod.bg);
    world.scene.fog.color.set(tod.fog);
    world.scene.fog.near = tod.fogNear;
    world.scene.fog.far = tod.fogFar;
    world.sun.color.set(tod.sunColor);
    world.sun.intensity = tod.sunIntensity;
    world.hemi.color.set(tod.hemiSky);
    world.hemi.groundColor.set(tod.hemiGround);
    world.hemi.intensity = tod.hemiIntensity;
    world.ambient.intensity = tod.ambient;
    starMat.opacity = tod.stars;
    nebulas.forEach((n) => (n.material.opacity = name === 'night' ? 0.2 : name === 'sunset' ? 0.17 : 0.1));
    ringMats.forEach((m) => (m.opacity = Math.min(0.85, 0.4 * tod.rings)));
    dashMat.color.set(name === 'night' ? '#7deaff' : '#54e0ff');
    vehicles.forEach((v) => (v.light.intensity = name === 'night' ? 9 : 5));
  }
  setTimeOfDay(timeOfDay);

  /* ---------- per-frame ---------- */
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
      const pulse = 0.42 + Math.sin(now / 600 + i * 0.8) * 0.14;
      ringMats[i].opacity = pulse * tod.rings;
      ring.rotation.z += dt * 0.15;
    });

    state.forEach((rs, i) => {
      const v = vehicles[i];
      if (!v) return;
      const { s01 } = stepVehicle(v, rs, dt, now, { bobAmp: 0.16, bobFreq: 130 });

      // jet always burning; combo heat = afterburner
      const heat = rs.comboHeat ?? 0;
      const flicker = 0.85 + Math.random() * 0.3;
      const power = 0.35 + s01 * 0.5 + heat * 0.8;
      v.jet.scale.set(0.7 + power * 0.7, power * flicker, 0.7 + power * 0.7);
      v.jetMat.opacity = Math.min(0.9, 0.3 + s01 * 0.35 + heat * 0.4);
      v.jetCore.scale.set(0.8 + heat * 0.9, power * flicker, 0.8 + heat * 0.9);
      v.jetCoreMat.opacity = Math.min(0.95, 0.4 + heat * 0.5);
    });
  }

  return { group, vehicles, update, finishZ: gateZ, setTimeOfDay };
}
