/* 🏎 Street Race theme — asphalt sprint: low-poly cars, roadside scenery,
 * billboards, finish gate. Vehicles advance with typing progress.
 * Supports day / sunset / night with full lighting treatment. */

import * as THREE from 'three';
import { TRACK_LENGTH, mulberry32 } from '../world.js';
import { followPlayerSky } from './shared.js';

const LANES = [-4.4, -2.2, 0, 2.2, 4.4];

const expK = (k, dt) => 1 - Math.exp(-k * dt);

/* ---------------- time-of-day presets ---------------- */
const TOD = {
  day: {
    skyTop: '#3f7fd9', skyMid: '#8fc0ea', skyBot: '#d6e9f8',
    fog: '#a9cfeb', fogNear: 140, fogFar: 560,
    sunColor: '#fff4d6', sunIntensity: 1.6,
    hemiSky: '#cfe8ff', hemiGround: '#5a7050', hemiIntensity: 0.9,
    ambient: 0.0, lamps: 0.0, cones: 0.0, stars: 0.0,
    headlight: 5, moon: false,
  },
  sunset: {
    skyTop: '#25246b', skyMid: '#b34a8a', skyBot: '#ff9a5a',
    fog: '#c98a6d', fogNear: 120, fogFar: 520,
    sunColor: '#ffb37a', sunIntensity: 1.1,
    hemiSky: '#d8a7c0', hemiGround: '#5a4a42', hemiIntensity: 0.55,
    ambient: 0.22, lamps: 0.55, cones: 0.08, stars: 0.25,
    headlight: 9, moon: false,
  },
  night: {
    skyTop: '#04060f', skyMid: '#0b1530', skyBot: '#1b3a66',
    fog: '#0e1c36', fogNear: 110, fogFar: 500,
    sunColor: '#8fb0ff', sunIntensity: 0.5,
    hemiSky: '#2c4a70', hemiGround: '#1a2430', hemiIntensity: 0.42,
    ambient: 0.32, lamps: 1.0, cones: 0.17, stars: 1.0,
    headlight: 14, moon: true,
  },
};

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

function skyTexture(tod) {
  // NOTE: sphere UVs put canvas-bottom at the zenith — draw the gradient
  // bottom-up so skyTop lands at the top of the sky.
  return canvasTexture((ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, tod.skyBot);
    g.addColorStop(0.42, tod.skyMid);
    g.addColorStop(1, tod.skyTop);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, 64, 512);
}

function buildCar(color, { player = false } = {}) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: '#16181d', roughness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: '#9fd8ff', roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.85 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.1), paint);
  body.position.y = 0.55; body.castShadow = true;
  g.add(body);

  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.28, 1.3), paint);
  hood.position.set(0, 0.92, -1.2); hood.castShadow = true;
  g.add(hood);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.5, 1.9), glass);
  cabin.position.set(0, 1.06, 0.25); cabin.castShadow = true;
  g.add(cabin);

  if (player) {
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.45), dark);
    spoiler.position.set(0, 1.05, 1.9);
    g.add(spoiler);
    const finL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.4), dark);
    finL.position.set(-0.7, 0.9, 1.9); g.add(finL);
    const finR = finL.clone(); finR.position.x = 0.7; g.add(finR);
  }

  const wheels = [];
  const wgeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 14);
  wgeo.rotateZ(Math.PI / 2);
  for (const [x, z] of [[-0.95, -1.35], [0.95, -1.35], [-0.95, 1.4], [0.95, 1.4]]) {
    const w = new THREE.Mesh(wgeo, dark);
    w.position.set(x, 0.38, z);
    g.add(w);
    wheels.push(w);
  }

  const hl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.06), new THREE.MeshBasicMaterial({ color: '#fff9c8' }));
  hl.position.set(-0.55, 0.62, -2.06); g.add(hl);
  const hr = hl.clone(); hr.position.x = 0.55; g.add(hr);

  const light = new THREE.PointLight('#ffeeb0', 6, 14, 2);
  light.position.set(0, 0.8, -2.4);
  g.add(light);

  // headlight beams — one per lamp, narrow at the bulb, widening forward
  const coneMat = new THREE.MeshBasicMaterial({
    color: '#ffedb0', transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const beamGeo = new THREE.ConeGeometry(0.55, 5.2, 12, 1, true);
  beamGeo.translate(0, -2.6, 0); // apex at origin, base 5.2 ahead (−Z after rotation)
  const beamL = new THREE.Mesh(beamGeo, coneMat);
  beamL.rotation.x = Math.PI / 2 - 0.07; // spread forward, tilted slightly at the road
  beamL.position.set(-0.55, 0.6, -2.06);
  g.add(beamL);
  const beamR = new THREE.Mesh(beamGeo, coneMat);
  beamR.rotation.x = Math.PI / 2 - 0.07;
  beamR.position.set(0.55, 0.6, -2.06);
  g.add(beamR);

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

  return { group: g, wheels, coneMat, flame, flameCore, light };
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
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 3000),
    new THREE.MeshStandardMaterial({ color: '#5d9c4a', roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = -TRACK_LENGTH / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(13.4, TRACK_LENGTH + 160),
    new THREE.MeshStandardMaterial({ color: '#3b3e46', roughness: 0.95 })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.02, -TRACK_LENGTH / 2);
  road.receiveShadow = true;
  group.add(road);

  // dashed lane lines
  const dashGeo = new THREE.PlaneGeometry(0.18, 2.6);
  const dashMat = new THREE.MeshBasicMaterial({ color: '#e8e8e8' });
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
  const startLine = new THREE.Mesh(new THREE.PlaneGeometry(13.4, 1.6), new THREE.MeshBasicMaterial({ map: startTex }));
  startLine.rotation.x = -Math.PI / 2;
  startLine.position.set(0, 0.04, -2);
  group.add(startLine);

  // roadside trees + rocks (instanced)
  const nTrees = 130;
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 1.6, 6);
  const crownGeo = new THREE.ConeGeometry(1.5, 3.4, 7);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#7a5230', roughness: 1 }), nTrees);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: '#2f7d38', roughness: 1 }), nTrees);
  trunks.castShadow = crowns.castShadow = true;
  const qId = new THREE.Quaternion();
  for (let i = 0; i < nTrees; i++) {
    const side = rng() > 0.5 ? 1 : -1;
    const x = side * (10 + rng() * 46);
    const z = 16 - rng() * (TRACK_LENGTH + 30);
    const s = 0.8 + rng() * 1.7;
    qId.setFromEuler(new THREE.Euler(0, rng() * 3, 0));
    m4.compose(new THREE.Vector3(x, 0.8 * s, z), qId, new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(x, (1.6 + 1.7) * s, z), qId, new THREE.Vector3(s, s, s));
    crowns.setMatrixAt(i, m4);
  }
  group.add(trunks, crowns);

  const rocks = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.7),
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
  group.add(rocks);

  // distant mountains
  for (let i = 0; i < 12; i++) {
    const h = 40 + rng() * 70;
    const mt = new THREE.Mesh(
      new THREE.ConeGeometry(30 + rng() * 40, h, 5),
      new THREE.MeshStandardMaterial({ color: '#6f87a8', roughness: 1, flatShading: true })
    );
    const side = i % 2 ? 1 : -1;
    mt.position.set(side * (130 + rng() * 160), h / 2 - 4, -rng() * TRACK_LENGTH);
    group.add(mt);
  }

  // clouds
  const cloudMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 });
  const clouds = [];
  for (let i = 0; i < 14; i++) {
    const cl = new THREE.Group();
    for (let j = 0; j < 3; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(6 + rng() * 5, 7, 5), cloudMat);
      puff.position.set(j * 7 - 7 + rng() * 3, rng() * 2, rng() * 4);
      puff.scale.y = 0.55;
      cl.add(puff);
    }
    cl.position.set((rng() - 0.5) * 300, 55 + rng() * 30, -rng() * (TRACK_LENGTH + 100));
    group.add(cl);
    clouds.push(cl);
  }

  // billboards with playful copy (unlit → glow like neon at night)
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
    const board = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.1), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 4, 0.35), new THREE.MeshStandardMaterial({ color: '#4a4f58' }));
    post.position.set(side * 11, 2, z);
    board.position.set(side * 11, 5.4, z);
    board.rotation.y = side * -Math.PI / 5.2;
    post.castShadow = true;
    group.add(post, board);
  }

  /* ---------- street lamps + light pools (night charm) ---------- */
  const lampGlowTex = radialGlowTexture('#ffcf8a');
  const lamps = [];
  const lampHeadMat = new THREE.MeshBasicMaterial({ color: '#ffe6b0' });
  for (let i = 0; i < 16; i++) {
    const side = i % 2 ? 1 : -1;
    const z = -20 - i * (TRACK_LENGTH / 16);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 5.4, 6), new THREE.MeshStandardMaterial({ color: '#2b3038', roughness: 0.9 }));
    pole.position.set(side * 7.6, 2.7, z);
    pole.castShadow = true;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.1), pole.material);
    arm.position.set(side * 6.9, 5.3, z);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), lampHeadMat);
    head.position.set(side * 6.2, 5.22, z);
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 13),
      new THREE.MeshBasicMaterial({ map: lampGlowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(side * 5.6, 0.05, z);
    group.add(pole, arm, head, pool);
    lamps.push(pool);
  }

  /* ---------- sky dome + stars + moon ---------- */
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(620, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(tod), side: THREE.BackSide, fog: false })
  );
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
    const color = isPlayer ? '#ff4757' : botColors[i % botColors.length];
    const car = buildCar(color, { player: isPlayer });
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
      updateLabel(wpmText, sub) { label.draw(wpmText, sub); },
    });
  });

  /* ---------- time of day ---------- */
  function setTimeOfDay(name) {
    tod = TOD[name] ?? TOD.day;
    sky.material.map = skyTexture(tod);
    sky.material.map.needsUpdate = true;
    world.scene.fog.color.set(tod.fog);
    world.scene.fog.near = tod.fogNear;
    world.scene.fog.far = tod.fogFar;
    world.scene.background = new THREE.Color(tod.fog);
    world.sun.color.set(tod.sunColor);
    world.sun.intensity = tod.sunIntensity;
    world.hemi.color.set(tod.hemiSky);
    world.hemi.groundColor.set(tod.hemiGround);
    world.hemi.intensity = tod.hemiIntensity;
    world.ambient.intensity = tod.ambient;
    starMat.opacity = tod.stars;
    moonGlow.material.opacity = tod.moon ? 0.5 : 0;
    moon.visible = !!tod.moon;
    clouds.forEach((cl) => cl.children.forEach((p) => (p.material.opacity = name === 'night' ? 0.05 : 0.85)));
    lamps.forEach((pool) => (pool.material.opacity = tod.lamps * 0.55));
    lampHeadMat.color.set(tod.lamps > 0.3 ? '#ffe6b0' : '#8b9099');
    vehicles.forEach((v) => {
      v.coneMat.opacity = tod.cones;
      v.light.intensity = tod.headlight;
      v.light.distance = tod.headlight > 8 ? 20 : 14;
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
      const wheelK = (s01 * 14 + 2) * dt;
      v.wheels.forEach((w) => { w.rotation.x -= wheelK; });

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
