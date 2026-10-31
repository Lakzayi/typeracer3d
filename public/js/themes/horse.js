/* 🐎 Wild West Ride theme — a dusty desert trail: galloping horses with
 * riders, cacti, mesas, fences, campfires at night, lantern poles. */

import * as THREE from 'three';
import { TRACK_LENGTH, mulberry32 } from '../world.js';
import { expK, canvasTexture, radialGlowTexture, makeLabel, stepVehicle, buildFinishGate, followPlayerSky } from './shared.js';

const LANES = [-4.4, -2.2, 0, 2.2, 4.4];

const TOD = {
  day: {
    skyTop: '#3f7fd9', skyMid: '#9cc4e8', skyBot: '#f2ddb8',
    fog: '#e3c9a0', fogNear: 150, fogFar: 580,
    sunColor: '#fff0c8', sunIntensity: 1.65,
    hemiSky: '#cfe4ff', hemiGround: '#8a6a45', hemiIntensity: 0.9,
    ambient: 0.0, lanterns: 0.0, fires: 0.0, stars: 0.0, lanternLight: 0,
  },
  sunset: {
    skyTop: '#3a2468', skyMid: '#c25a4e', skyBot: '#ffb05a',
    fog: '#d9925e', fogNear: 130, fogFar: 540,
    sunColor: '#ff9a4a', sunIntensity: 1.25,
    hemiSky: '#e8a87a', hemiGround: '#7a5638', hemiIntensity: 0.6,
    ambient: 0.2, lanterns: 0.6, fires: 0.7, stars: 0.25, lanternLight: 7,
  },
  night: {
    skyTop: '#04060f', skyMid: '#0b1530', skyBot: '#1b3a66',
    fog: '#101a2e', fogNear: 110, fogFar: 500,
    sunColor: '#8fb0ff', sunIntensity: 0.5,
    hemiSky: '#2c4a70', hemiGround: '#1e1a14', hemiIntensity: 0.4,
    ambient: 0.3, lanterns: 1.0, fires: 1.0, stars: 1.0, lanternLight: 12,
  },
};

function buildHorse(color, { player = false } = {}) {
  const g = new THREE.Group();
  const coat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const maneMat = new THREE.MeshStandardMaterial({ color: '#2a2019', roughness: 1 });
  const skin = new THREE.MeshStandardMaterial({ color: '#e6b98f', roughness: 0.9 });

  // body
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.95, 2.3), coat);
  body.position.y = 1.25; body.castShadow = true;
  g.add(body);
  const rump = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.6), coat);
  rump.position.set(0, 1.28, 1.15);
  g.add(rump);

  // neck + head + ears + mane
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.15, 0.5), coat);
  neck.position.set(0, 1.85, -1.15);
  neck.rotation.x = 0.55;
  neck.castShadow = true;
  g.add(neck);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.85), coat);
  head.position.set(0, 2.42, -1.55);
  head.rotation.x = -0.25;
  head.castShadow = true;
  g.add(head);
  const earGeo = new THREE.ConeGeometry(0.07, 0.2, 4);
  const earL = new THREE.Mesh(earGeo, coat); earL.position.set(-0.12, 2.68, -1.42);
  const earR = earL.clone(); earR.position.x = 0.12;
  g.add(earL, earR);
  const mane = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.15, 0.2), maneMat);
  mane.position.set(0, 2.0, -0.98);
  mane.rotation.x = 0.55;
  g.add(mane);

  // tail
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.95, 0.16), maneMat);
  tail.geometry.translate(0, -0.42, 0);
  tail.position.set(0, 1.45, 1.5);
  tail.rotation.x = 0.5;
  g.add(tail);

  // legs — pivot at the hip/shoulder for gallop swing
  const legGeo = new THREE.BoxGeometry(0.2, 1.0, 0.22);
  legGeo.translate(0, -0.5, 0);
  const legs = [];
  for (const [x, z] of [[-0.34, -0.85], [0.34, -0.85], [-0.34, 0.95], [0.34, 0.95]]) {
    const leg = new THREE.Mesh(legGeo, coat);
    leg.position.set(x, 1.05, z);
    leg.castShadow = true;
    g.add(leg);
    legs.push(leg);
  }

  // rider (tiny cowboy)
  const rider = new THREE.Group();
  const shirtMat = new THREE.MeshStandardMaterial({ color: player ? '#ffd75e' : '#3a4a6b', roughness: 0.9 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.55, 0.32), shirtMat);
  torso.position.y = 0.5;
  const headR = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), skin);
  headR.position.y = 0.92;
  const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 10), maneMat);
  hatBrim.position.y = 1.04;
  const hatTop = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.18, 10), maneMat);
  hatTop.position.y = 1.14;
  const legMat = new THREE.MeshStandardMaterial({ color: '#5a4630', roughness: 1 });
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 0.16), legMat);
  legL.position.set(-0.16, 0.18, 0);
  const legR = legL.clone(); legR.position.x = 0.16;
  rider.add(torso, headR, hatBrim, hatTop, legL, legR);
  rider.position.set(0, 1.72, 0.25);
  g.add(rider);

  // player lantern — real light that lights the trail at night
  const lantern = new THREE.Group();
  const cage = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.14), new THREE.MeshBasicMaterial({ color: '#ffb84d' }));
  const lanternLight = new THREE.PointLight('#ffbb55', 0, 16, 2);
  lantern.add(cage, lanternLight);
  lantern.position.set(-0.42, 2.15, 0.4);
  g.add(lantern);

  // dust puff behind hooves (speed) — grows with combo heat
  const dustTex = radialGlowTexture('#c9a76a');
  const dustMat = new THREE.SpriteMaterial({ map: dustTex, transparent: true, opacity: 0, depthWrite: false });
  const dust = new THREE.Sprite(dustMat);
  dust.scale.set(2.4, 1.4, 1);
  dust.position.set(0, 0.5, 1.9);
  g.add(dust);

  return { group: g, legs, tail, dust, dustMat, lanternLight };
}

export function create(world, { racers, seed, timeOfDay = 'day' }) {
  const rng = mulberry32(seed);
  const group = new THREE.Group();
  let tod = TOD[timeOfDay] ?? TOD.day;

  /* ---------- desert ---------- */
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 3000),
    new THREE.MeshStandardMaterial({ color: '#d9b070', roughness: 1 })
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.z = -TRACK_LENGTH / 2;
  sand.receiveShadow = true;
  group.add(sand);

  // the trail
  const trail = new THREE.Mesh(
    new THREE.PlaneGeometry(13.4, TRACK_LENGTH + 160),
    new THREE.MeshStandardMaterial({ color: '#b58a55', roughness: 1 })
  );
  trail.rotation.x = -Math.PI / 2;
  trail.position.set(0, 0.02, -TRACK_LENGTH / 2);
  trail.receiveShadow = true;
  group.add(trail);

  // hoof-worn lane guides (darker ruts)
  const rutMat = new THREE.MeshBasicMaterial({ color: '#97714a' });
  const ruts = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.3, TRACK_LENGTH + 120), rutMat, 5);
  const m4 = new THREE.Matrix4();
  const qFlat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  LANES.forEach((lx, i) => {
    m4.compose(new THREE.Vector3(lx, 0.03, -TRACK_LENGTH / 2), qFlat, new THREE.Vector3(1, 1, 1));
    ruts.setMatrixAt(i, m4);
  });
  group.add(ruts);

  // fence posts + rails along both sides
  const postMat = new THREE.MeshStandardMaterial({ color: '#6e5236', roughness: 1 });
  const fenceCount = 2 * Math.floor(TRACK_LENGTH / 12);
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 1.1, 0.16), postMat, fenceCount);
  let pi = 0;
  for (let z = 8; z > -TRACK_LENGTH && pi < fenceCount; z -= 12) {
    for (const side of [-1, 1]) {
      const q = new THREE.Quaternion();
      m4.compose(new THREE.Vector3(side * 7.6, 0.55, z), q, new THREE.Vector3(1, 1, 1));
      posts.setMatrixAt(pi++, m4);
    }
  }
  posts.count = pi;
  group.add(posts);

  // cacti
  const cactusMat = new THREE.MeshStandardMaterial({ color: '#4d8a4a', roughness: 1 });
  for (let i = 0; i < 70; i++) {
    const side = rng() > 0.5 ? 1 : -1;
    const x = side * (12 + rng() * 40);
    const z = 16 - rng() * (TRACK_LENGTH + 30);
    const h = 1.6 + rng() * 2.2;
    const cactus = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, h, 7), cactusMat);
    trunk.position.y = h / 2;
    trunk.castShadow = true;
    cactus.add(trunk);
    if (rng() > 0.4) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, h * 0.5, 6), cactusMat);
      arm.position.set(0.4, h * 0.6, 0);
      arm.rotation.z = -0.4;
      cactus.add(arm);
    }
    cactus.position.set(x, 0, z);
    group.add(cactus);
  }

  // mesas on the horizon (stacked boxes)
  for (let i = 0; i < 10; i++) {
    const side = i % 2 ? 1 : -1;
    const w = 30 + rng() * 40, h = 18 + rng() * 26, d = 20 + rng() * 30;
    const mesa = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: i % 2 ? '#b5714a' : '#a3654a', roughness: 1, flatShading: true });
    const base = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.7, d), mat);
    base.position.y = h * 0.35;
    const top = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, h * 0.3, d * 0.7), mat);
    top.position.y = h * 0.85;
    mesa.add(base, top);
    mesa.position.set(side * (120 + rng() * 160), 0, -rng() * TRACK_LENGTH);
    group.add(mesa);
  }

  // telegraph poles
  const teleMat = new THREE.MeshStandardMaterial({ color: '#4f3a26', roughness: 1 });
  for (let i = 0; i < 12; i++) {
    const side = i % 2 ? 1 : -1;
    const z = -30 - i * (TRACK_LENGTH / 12);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 6, 6), teleMat);
    pole.position.set(side * 12, 3, z);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.1), teleMat);
    bar.position.set(side * 12, 5.4, z);
    group.add(pole, bar);
  }

  // wooden roadside signs
  const slogans = ['GIDDY UP!', '🐎 no saddle, no glory', 'Wild West Ride', '🚤 boats SOON', '🚀 rockets SOON', 'yeehaw = wpm'];
  const signPostMat = postMat;
  for (let i = 0; i < 5; i++) {
    const side = i % 2 ? 1 : -1;
    const z = -50 - i * (TRACK_LENGTH / 5) - rng() * 25;
    const tex = canvasTexture((ctx, w, h) => {
      ctx.fillStyle = '#7a5a38'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#4f3a26'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, w - 8, h - 8);
      ctx.fillStyle = '#f5e8d0'; ctx.font = '800 26px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(slogans[i % slogans.length], w / 2, h / 2);
    }, 320, 110);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 2.9), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.6, 0.3), signPostMat);
    post.position.set(side * 10.4, 1.8, z);
    board.position.set(side * 10.4, 4.6, z);
    board.rotation.y = side * -Math.PI / 5.5;
    group.add(post, board);
  }

  /* ---------- campfires (night soul of the desert) ---------- */
  const fireGlowTex = radialGlowTexture('#ff9b3d');
  const fires = [];
  const logMat = new THREE.MeshStandardMaterial({ color: '#4a3320', roughness: 1 });
  const flameMat = new THREE.MeshBasicMaterial({ color: '#ff9b3d', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < 8; i++) {
    const side = i % 2 ? 1 : -1;
    const z = -60 - i * (TRACK_LENGTH / 8) - rng() * 30;
    const f = new THREE.Group();
    for (let j = 0; j < 3; j++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 5), logMat);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = (j * Math.PI) / 3;
      log.position.y = 0.12;
      f.add(log);
    }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.1, 7), flameMat.clone());
    flame.position.y = 0.65;
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 7),
      new THREE.MeshBasicMaterial({ map: fireGlowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.05;
    f.add(flame, glow);
    f.position.set(side * 10.5, 0, z);
    f.userData = { flame, glow, phase: rng() * 10 };
    group.add(f);
    fires.push(f);
  }

  /* ---------- lantern poles along the trail ---------- */
  const lampGlowTex = radialGlowTexture('#ffcf8a');
  const lampHeadMat = new THREE.MeshBasicMaterial({ color: '#8b9099' });
  const pools = [];
  for (let i = 0; i < 14; i++) {
    const side = i % 2 ? 1 : -1;
    const z = -20 - i * (TRACK_LENGTH / 14);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 3.6, 6), teleMat);
    post.position.set(side * 8.2, 1.8, z);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), lampHeadMat);
    head.position.set(side * 8.2, 3.7, z);
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 13),
      new THREE.MeshBasicMaterial({ map: lampGlowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(side * 7.8, 0.05, z);
    group.add(post, head, pool);
    pools.push(pool);
  }

  /* ---------- sky + stars + moon ---------- */
  const skyTexCanvas = document.createElement('canvas');
  skyTexCanvas.width = 64; skyTexCanvas.height = 512;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(620, 24, 16),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(skyTexCanvas), side: THREE.BackSide, fog: false })
  );
  sky.material.map.colorSpace = THREE.SRGBColorSpace;
  group.add(sky);

  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(500 * 3);
  for (let i = 0; i < 500; i++) {
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

  const moon = new THREE.Mesh(new THREE.SphereGeometry(16, 16, 12), new THREE.MeshBasicMaterial({ color: '#eef3ff', fog: false }));
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

  /* ---------- start + finish ---------- */
  const gateZ = buildFinishGate(group, TRACK_LENGTH, { text: '🐎 FINISH 🐎' });
  const startTex = canvasTexture((ctx) => {
    for (let y = 0; y < 2; y++) for (let x = 0; x < 14; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#3a2a18' : '#e8dcc4';
      ctx.fillRect(x * 20, y * 20, 20, 20);
    }
  }, 280, 40);
  const startLine = new THREE.Mesh(new THREE.PlaneGeometry(13.4, 1.6), new THREE.MeshBasicMaterial({ map: startTex }));
  startLine.rotation.x = -Math.PI / 2;
  startLine.position.set(0, 0.04, -2);
  group.add(startLine);

  /* ---------- horses ---------- */
  const botColors = ['#6b4a2f', '#8a8f98', '#4a3a5c', '#a85a3a', '#c7b8a0'];
  const labelColors = ['#ffd75e', '#9fd0ff', '#c4a7ff', '#ffb08a', '#e8e2d0'];
  const vehicles = [];
  racers.forEach((r, i) => {
    const isPlayer = r.isPlayer;
    const lane = isPlayer ? 2 : [1, 3, 0, 4][i - 1] ?? 1;
    const color = isPlayer ? '#7a4a26' : botColors[(i - 1 + botColors.length) % botColors.length];
    const horse = buildHorse(color, { player: isPlayer });
    horse.group.position.set(LANES[lane] ?? 0, 0, 0);
    group.add(horse.group);

    const label = makeLabel(isPlayer ? 'YOU' : r.name, isPlayer ? '#ff6b78' : labelColors[i % labelColors.length]);
    label.sprite.position.set(0, 3.6, 0);
    horse.group.add(label.sprite);

    vehicles.push({
      ...horse,
      label,
      lane,
      baseX: LANES[lane] ?? 0,
      color,
      isPlayer,
      wobble: rng() * 10,
      gallop: rng() * 10,
      updateLabel(wpmText, sub) { label.draw(wpmText, sub); },
    });
  });

  /* ---------- time of day ---------- */
  function setTimeOfDay(name) {
    tod = TOD[name] ?? TOD.day;
    const ctx = skyTexCanvas.getContext('2d');
    const gr = ctx.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0, tod.skyBot); gr.addColorStop(0.42, tod.skyMid); gr.addColorStop(1, tod.skyTop);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 512);
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
    moonGlow.material.opacity = name === 'night' ? 0.5 : 0;
    moon.visible = name === 'night';
    pools.forEach((p) => (p.material.opacity = tod.lanterns * 0.55));
    lampHeadMat.color.set(tod.lanterns > 0.3 ? '#ffe6b0' : '#8b9099');
    fires.forEach((f) => {
      f.userData.flame.material.opacity = tod.fires * 0.9;
      f.userData.glow.material.opacity = tod.fires * 0.5;
    });
    vehicles.forEach((v) => (v.lanternLight.intensity = v.isPlayer ? tod.lanternLight : 0));
  }
  setTimeOfDay(timeOfDay);

  /* ---------- per-frame ---------- */
  function update(dt, state) {
    if (!state) return;
    const now = performance.now();

    // sky rides along with the player (see followPlayerSky)
    followPlayerSky(celestial, vehicles[0]?.visZ ?? 0);

    // campfire flicker
    for (const f of fires) {
      const k = 0.85 + Math.sin(now / 90 + f.userData.phase) * 0.1 + Math.random() * 0.08;
      f.userData.flame.scale.set(k, k, k);
    }

    state.forEach((rs, i) => {
      const v = vehicles[i];
      if (!v) return;
      const { s01 } = stepVehicle(v, rs, dt, now, { bobAmp: 0.12, bobFreq: 55 });

      // gallop: diagonal leg pairs swing, faster with speed
      v.gallop += dt * (4 + s01 * 14);
      const amp = 0.15 + s01 * 0.55;
      v.legs[0].rotation.x = Math.sin(v.gallop) * amp;
      v.legs[3].rotation.x = Math.sin(v.gallop) * amp;
      v.legs[1].rotation.x = Math.sin(v.gallop + Math.PI) * amp;
      v.legs[2].rotation.x = Math.sin(v.gallop + Math.PI) * amp;
      v.tail.rotation.x = 0.5 + Math.sin(now / 300 + v.wobble) * 0.15;

      // dust: speed + combo heat
      const heat = rs.comboHeat ?? 0;
      const puff = Math.min(1, s01 * 0.55 + heat * 0.7);
      v.dustMat.opacity = puff * 0.55;
      v.dust.scale.set(2 + puff * 2.6, 1.2 + puff * 1.6, 1);
    });
  }

  return { group, vehicles, update, finishZ: gateZ, setTimeOfDay };
}
