/* 🚤 River Rapids theme — a canyon river sprint: boats, animated water,
 * buoys as lane markers, cliffs, docks with lanterns. */

import * as THREE from 'three';
import { TRACK_LENGTH, mulberry32 } from '../world.js';
import { expK, canvasTexture, radialGlowTexture, makeLabel, stepVehicle, buildFinishGate, followPlayerSky } from './shared.js';

const LANES = [-4.4, -2.2, 0, 2.2, 4.4];

const TOD = {
  day: {
    skyTop: '#3f7fd9', skyMid: '#8fc0ea', skyBot: '#d6e9f8',
    fog: '#a9cfeb', fogNear: 140, fogFar: 560,
    sunColor: '#fff4d6', sunIntensity: 1.6,
    hemiSky: '#cfe8ff', hemiGround: '#3c5a52', hemiIntensity: 0.9,
    ambient: 0.0, lanterns: 0.0, stars: 0.0, water: '#2e93a8', navLights: 0.35,
  },
  sunset: {
    skyTop: '#25246b', skyMid: '#b34a8a', skyBot: '#ff9a5a',
    fog: '#c98a6d', fogNear: 120, fogFar: 520,
    sunColor: '#ffb37a', sunIntensity: 1.1,
    hemiSky: '#d8a7c0', hemiGround: '#3c4a44', hemiIntensity: 0.55,
    ambient: 0.22, lanterns: 0.6, stars: 0.25, water: '#5d84a8', navLights: 0.8,
  },
  night: {
    skyTop: '#04060f', skyMid: '#0b1530', skyBot: '#1b3a66',
    fog: '#0e1c36', fogNear: 110, fogFar: 500,
    sunColor: '#8fb0ff', sunIntensity: 0.5,
    hemiSky: '#2c4a70', hemiGround: '#152028', hemiIntensity: 0.42,
    ambient: 0.32, lanterns: 1.0, stars: 1.0, water: '#123049', navLights: 1.0,
  },
};

function buildBoat(color, { player = false } = {}) {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.2 });
  const deckMat = new THREE.MeshStandardMaterial({ color: '#e8dcc4', roughness: 0.9 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#20242c', roughness: 0.8 });

  // hull: flat box + pointed bow (-Z)
  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 3.4), hullMat);
  hull.position.y = 0.42; hull.castShadow = true;
  g.add(hull);
  const bow = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.5, 4), hullMat);
  bow.rotation.x = -Math.PI / 2;
  bow.rotation.z = Math.PI / 4;
  bow.position.set(0, 0.42, -2.35);
  bow.scale.y = 0.38; // flatten cone into a prow
  bow.castShadow = true;
  g.add(bow);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 2.4), deckMat);
  deck.position.set(0, 0.72, 0.2);
  g.add(deck);

  // windshield + tiny driver
  const shield = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.34, 0.08), new THREE.MeshStandardMaterial({ color: '#9fd8ff', roughness: 0.1, transparent: true, opacity: 0.85 }));
  shield.position.set(0, 1.02, -0.7);
  g.add(shield);
  const driver = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.3), new THREE.MeshStandardMaterial({ color: player ? '#ff4757' : '#2b3242', roughness: 0.9 }));
  torso.position.y = 0.25;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshStandardMaterial({ color: '#e6b98f', roughness: 0.9 }));
  head.position.y = 0.62;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: player ? '#ffffff' : '#39404e', roughness: 0.6 }));
  helmet.position.y = 0.66;
  driver.add(torso, head, helmet);
  driver.position.set(0, 0.78, 0.35);
  g.add(driver);

  // outboard motor
  const motor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.3), darkMat);
  motor.position.set(0, 0.62, 1.85);
  g.add(motor);

  // navigation lights (port red / starboard green) — shine at dusk/night
  const navMat = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.3 });
  const navL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), navMat('#ff5252'));
  navL.position.set(-0.85, 0.75, -0.2);
  const navR = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), navMat('#3ddc84'));
  navR.position.set(0.85, 0.75, -0.2);
  g.add(navL, navR);

  const light = new THREE.PointLight('#ffeeb0', 5, 13, 2);
  light.position.set(0, 1.0, -1.6);
  g.add(light);

  // wake: white foam strip trailing behind (+Z), riding on the water surface
  const wakeMat = new THREE.MeshBasicMaterial({ color: '#eaf7ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const wake = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 5.5), wakeMat);
  wake.rotation.x = -Math.PI / 2;
  wake.position.set(0, 0.46, 3.6);
  g.add(wake);

  // combo spray: burst cone behind the boat
  const sprayMat = new THREE.MeshBasicMaterial({ color: '#bfeaff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const spray = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.4, 8), sprayMat);
  spray.rotation.x = Math.PI / 2;
  spray.position.set(0, 0.6, 3.0);
  g.add(spray);

  return { group: g, wake, wakeMat, spray, sprayMat, navL, navR, navMats: [navL.material, navR.material], light };
}

export function create(world, { racers, seed, timeOfDay = 'day' }) {
  const rng = mulberry32(seed);
  const group = new THREE.Group();
  let tod = TOD[timeOfDay] ?? TOD.day;

  /* ---------- banks & canyon ---------- */
  const banks = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 3000),
    new THREE.MeshStandardMaterial({ color: '#a68a5e', roughness: 1 })
  );
  banks.rotation.x = -Math.PI / 2;
  banks.position.set(0, 0.35, -TRACK_LENGTH / 2);
  banks.receiveShadow = true;
  group.add(banks);

  // the river
  const waterTex = canvasTexture((ctx, w, h) => {
    // opaque white base so the map multiplies to the water color instead of black
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.30)' : 'rgba(18,58,68,0.22)';
      ctx.beginPath();
      ctx.ellipse(Math.random() * w, Math.random() * h, 8 + Math.random() * 26, 1.5 + Math.random() * 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 256, 256);
  waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
  waterTex.repeat.set(3, 60);
  const waterMat = new THREE.MeshStandardMaterial({ color: tod.water, roughness: 0.25, metalness: 0.15, map: waterTex });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(14.6, TRACK_LENGTH + 200), waterMat);
  water.rotation.x = -Math.PI / 2;
  // above the banks (y=0.35) so the river actually reads as water
  water.position.set(0, 0.42, -TRACK_LENGTH / 2);
  group.add(water);

  // canyon cliffs (rock clusters along both sides)
  const cliffMat = new THREE.MeshStandardMaterial({ color: '#8a6f56', roughness: 1, flatShading: true });
  for (let i = 0; i < 90; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * (13 + rng() * 22);
    const z = 16 - rng() * (TRACK_LENGTH + 40);
    const s = 2.5 + rng() * 6;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), cliffMat);
    rock.position.set(x, s * 0.55, z);
    rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    rock.castShadow = true;
    group.add(rock);
  }

  // reeds near the waterline
  const reedMat = new THREE.MeshStandardMaterial({ color: '#4d7d3a', roughness: 1 });
  for (let i = 0; i < 120; i++) {
    const side = rng() > 0.5 ? 1 : -1;
    const x = side * (7 + rng() * 4);
    const z = 16 - rng() * (TRACK_LENGTH + 20);
    const reed = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 1 + rng() * 1.2, 4), reedMat);
    reed.position.set(x, 0.8, z);
    reed.rotation.z = (rng() - 0.5) * 0.25;
    group.add(reed);
  }

  // buoys as lane dividers (bobbing red/white spheres)
  const buoyGroups = [];
  const buoyRed = new THREE.MeshStandardMaterial({ color: '#e04848', roughness: 0.6 });
  const buoyWhite = new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.6 });
  for (const lx of [-3.3, -1.1, 1.1, 3.3]) {
    for (let z = 10; z > -TRACK_LENGTH; z -= 24) {
      const b = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), (Math.round(z / 24) % 2) ? buoyRed : buoyWhite);
      body.position.y = 0.22;
      body.castShadow = true;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 4), buoyWhite);
      pole.position.y = 0.6;
      b.add(body, pole);
      b.position.set(lx, 0.42, z);
      b.userData.phase = rng() * 10;
      group.add(b);
      buoyGroups.push(b);
    }
  }

  // docks with lanterns (lantern light pools at night)
  const lampGlowTex = radialGlowTexture('#ffcf8a');
  const dockMat = new THREE.MeshStandardMaterial({ color: '#8a6a45', roughness: 1 });
  const poleMat = new THREE.MeshStandardMaterial({ color: '#5d4630', roughness: 1 });
  const lampHeadMat = new THREE.MeshBasicMaterial({ color: '#8b9099' });
  const pools = [];
  for (let i = 0; i < 10; i++) {
    const side = i % 2 ? 1 : -1;
    const z = -40 - i * (TRACK_LENGTH / 10) - rng() * 20;
    const dock = new THREE.Mesh(new THREE.BoxGeometry(5, 0.25, 3), dockMat);
    dock.position.set(side * 8.6, 0.5, z);
    dock.castShadow = true;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 3.4, 6), poleMat);
    post.position.set(side * 7.2, 2.2, z);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), lampHeadMat);
    head.position.set(side * 7.2, 3.9, z);
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 14),
      new THREE.MeshBasicMaterial({ map: lampGlowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(side * 6.6, 0.46, z);
    group.add(dock, post, head, pool);
    pools.push(pool);
  }

  /* ---------- sky + stars + moon ---------- */
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(620, 24, 16),
    new THREE.MeshBasicMaterial({ map: (() => {
      // canvas-bottom lands at zenith → draw gradient bottom-up
      const c = document.createElement('canvas'); c.width = 64; c.height = 512;
      const ctx = c.getContext('2d');
      const gr = ctx.createLinearGradient(0, 0, 0, 512);
      gr.addColorStop(0, tod.skyBot); gr.addColorStop(0.42, tod.skyMid); gr.addColorStop(1, tod.skyTop);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 512);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    })(), side: THREE.BackSide, fog: false })
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

  /* ---------- finish + start ---------- */
  const gateZ = buildFinishGate(group, TRACK_LENGTH, { text: '🏁 FINISH 🏁' });
  const startTex = canvasTexture((ctx) => {
    for (let y = 0; y < 2; y++) for (let x = 0; x < 14; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#10333a' : '#e8f4f6';
      ctx.fillRect(x * 20, y * 20, 20, 20);
    }
  }, 280, 40);
  const startLine = new THREE.Mesh(new THREE.PlaneGeometry(14.6, 1.6), new THREE.MeshBasicMaterial({ map: startTex, transparent: true, opacity: 0.85 }));
  startLine.rotation.x = -Math.PI / 2;
  startLine.position.set(0, 0.46, -2);
  group.add(startLine);

  /* ---------- boats ---------- */
  const botColors = ['#2e86ff', '#ffb020', '#9b59ff', '#20c997', '#ff7ab6'];
  const vehicles = [];
  racers.forEach((r, i) => {
    const isPlayer = r.isPlayer;
    const lane = isPlayer ? 2 : [1, 3, 0, 4][i - 1] ?? 1;
    const color = isPlayer ? '#ff4757' : botColors[i % botColors.length];
    const boat = buildBoat(color, { player: isPlayer });
    boat.group.position.set(LANES[lane] ?? 0, 0, 0);
    group.add(boat.group);

    const label = makeLabel(isPlayer ? 'YOU' : r.name, isPlayer ? '#ff6b78' : '#9fd0ff');
    label.sprite.position.set(0, 3.0, 0);
    boat.group.add(label.sprite);

    vehicles.push({
      ...boat,
      label,
      lane,
      baseX: LANES[lane] ?? 0,
      color,
      isPlayer,
      wobble: rng() * 10,
      updateLabel(wpmText, sub) { label.draw(wpmText, sub); },
    });
  });

  /* ---------- time of day ---------- */
  function setTimeOfDay(name) {
    tod = TOD[name] ?? TOD.day;
    // redraw sky gradient
    const ctx = sky.material.map.image.getContext('2d');
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
    waterMat.color.set(tod.water);
    pools.forEach((p) => (p.material.opacity = tod.lanterns * 0.55));
    lampHeadMat.color.set(tod.lanterns > 0.3 ? '#ffe6b0' : '#8b9099');
    vehicles.forEach((v) => {
      v.navMats.forEach((m) => (m.opacity = tod.navLights));
      v.light.intensity = name === 'night' ? 12 : name === 'sunset' ? 8 : 5;
    });
  }
  setTimeOfDay(timeOfDay);

  /* ---------- per-frame ---------- */
  function update(dt, state) {
    if (!state) return;
    const now = performance.now();

    // sky rides along with the player (see followPlayerSky)
    followPlayerSky(celestial, vehicles[0]?.visZ ?? 0);

    // flowing water + bobbing buoys
    waterTex.offset.y -= dt * 0.06;
    for (const b of buoyGroups) {
      b.position.y = 0.42 + Math.sin(now / 500 + b.userData.phase) * 0.09;
      b.rotation.z = Math.sin(now / 650 + b.userData.phase) * 0.12;
    }

    state.forEach((rs, i) => {
      const v = vehicles[i];
      if (!v) return;
      const { s01 } = stepVehicle(v, rs, dt, now, { bobAmp: 0.1, bobFreq: 55 });

      // wake grows with speed; combo spray bursts with heat
      v.wakeMat.opacity = Math.min(0.38, s01 * 0.42);
      v.wake.scale.set(0.8 + s01 * 0.6, 0.6 + s01 * 1.1, 1);
      const heat = rs.comboHeat ?? 0;
      const flicker = 0.8 + Math.random() * 0.35;
      v.spray.scale.set(0.5 + heat * 1.1, heat * flicker, 0.5 + heat * 1.1);
      v.sprayMat.opacity = Math.min(0.85, heat * 0.9);
    });
  }

  return { group, vehicles, update, finishZ: gateZ, setTimeOfDay };
}
