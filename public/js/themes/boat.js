/* 🚤 River Rapids theme — a canyon river sprint: boats, animated water,
 * buoys as lane markers, cliffs, docks with lanterns. */

import * as THREE from 'three';
import { TRACK_LENGTH, mulberry32 } from '../world.js';
import { expK, canvasTexture, radialGlowTexture, makeLabel, stepVehicle, buildFinishGate, followPlayerSky, makeSunDisc, mergeStaticMeshes } from './shared.js';

const LANES = [-4.4, -2.2, 0, 2.2, 4.4];

const TOD = {
  day: {
    // fog pulled back so it only fades the far distance (critic r7: uniform
    // white curtain) + a more tonal horizon band. waterEnv 1.15: at grazing
    // angles the canal is a near-perfect mirror — env 2.1 reflected the bright
    // sky back and washed the whole scene (measured in the r7 day shot)
    skyTop: '#3f7fd9', skyMid: '#7fb4e4', skyBot: '#b9d6ee',
    fogDensity: 0.0022, exposure: 1.0, sunRig: [30, 58, 22],
    sunColor: '#fff2e0', sunIntensity: 2.5,
    hemiSky: '#cfe8ff', hemiGround: '#3c5a52', hemiIntensity: 0.5,
    ambient: 0.0, lanterns: 0.0, stars: 0.0, water: '#14586e', waterEnv: 1.15, navLights: 0.35,
    headlight: 0,
  },
  sunset: {
    // ORANGE sky family — the water reflects the sky, so a magenta skyBand
    // turned the water purple (critic r6): dusk blue top, orange mid/horizon.
    // r7: sun/hemi less saturated so shadowed sand/rocks stay cool instead of
    // everything reading as one orange filter
    skyTop: '#3a2a4a', skyMid: '#e8874a', skyBot: '#ffb26a', skyLow: '#ffc98a',
    // deeper terracotta haze, and thinner than r8: the bright horizon band as
    // fog painted every midground object the same pastel orange (r9 critic)
    fog: '#e09a66', fogDensity: 0.0021, exposure: 0.85,
    // sun just over the canyon rim: elevation ~8° (critic r6: sun sat too high)
    sunRig: [-28, 8, -52],
    sunColor: '#ffb87c', sunIntensity: 1.6,
    hemiSky: '#c9a8b8', hemiGround: '#33302e', hemiIntensity: 0.36,
    ambient: 0.0, lanterns: 0.6, stars: 0.25, water: '#4a4347', waterEnv: 2.0, navLights: 0.8,
    headlight: 14,
  },
  night: {
    skyTop: '#04060f', skyMid: '#0b1530', skyBot: '#1b3a66',
    fogDensity: 0.0030, exposure: 0.85, sunRig: [-22, 44, 30],
    sunColor: '#8fb0ff', sunIntensity: 0.65,
    hemiSky: '#35507c', hemiGround: '#152028', hemiIntensity: 0.9,
    ambient: 0.05, lanterns: 1.0, stars: 1.0, water: '#123049', waterEnv: 1.4, navLights: 1.0,
    headlight: 160,
  },
};

function buildBoat(color, { player = false } = {}) {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.15, envMapIntensity: 0.6 });
  const deckMat = new THREE.MeshStandardMaterial({ color: '#e8dcc4', roughness: 0.9 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#20242c', roughness: 0.8 });

  // hull: box tapered toward the stern + chined at the waterline (PLAN §5.2),
  // then a flattened cone prow (-Z)
  const hullGeo = new THREE.BoxGeometry(1.7, 0.5, 3.4);
  {
    const pos = hullGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      if (z > 1.5) pos.setX(i, pos.getX(i) * 0.6); // stern narrows hard (critic r6)
      if (z < -1.5) pos.setX(i, pos.getX(i) * 1.12); // bow widens (§5.2)
      if (pos.getY(i) < 0) pos.setX(i, pos.getX(i) * 0.8); // chine toward the waterline
    }
    hullGeo.computeVertexNormals();
  }
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.position.y = 0.42; hull.castShadow = true;
  g.add(hull);
  const bow = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.5, 4), hullMat);
  bow.rotation.x = -Math.PI / 2;
  bow.rotation.z = Math.PI / 4;
  bow.position.set(0, 0.42, -2.45);
  bow.scale.y = 0.3; // flatten cone into a long prow
  bow.castShadow = true;
  g.add(bow);
  // fenders: dark rub-rail beads along the waterline contact
  const fenderGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.9, 8);
  const fenderL = new THREE.Mesh(fenderGeo, darkMat);
  fenderL.rotation.z = Math.PI / 2;
  fenderL.position.set(-0.88, 0.3, 0);
  const fenderR = fenderL.clone(); fenderR.position.x = 0.88;
  g.add(fenderL, fenderR);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.12, 2.4), deckMat);
  deck.position.set(0, 0.72, 0.2);
  g.add(deck);

  // small cabin behind the driver — hull-scale superstructure (§5.2)
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.4, 0.8), deckMat);
  cabin.position.set(0, 0.95, 0.9); cabin.castShadow = true;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.06, 0.86), hullMat);
  roof.position.set(0, 1.17, 0.9);
  g.add(cabin, roof);

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

  // only the player carries a real light (PLAN §1.2) — same contract as the
  // car. Rides ABOVE the deck so it reads as deck-lantern light; at deck
  // height it lit the water through the hull = "glowing from below" (r4)
  let light = null;
  if (player) {
    light = new THREE.PointLight('#ffeeb0', 0, 9, 2);
    light.position.set(0, 1.7, -1.6);
    g.add(light);
  }

  // wake: V-shaped foam trailing behind (+Z) — two diverging soft arms instead
  // of a solid rectangle (critic r4: rectangular wake)
  const wakeTex = canvasTexture((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(234,247,255,0.85)';
    ctx.lineCap = 'round';
    const arm = (x0, spread) => {
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(w / 2, 10);                  // apex at the transom (canvas top)
      ctx.quadraticCurveTo(w / 2 + x0 * 0.3, h * 0.38, w / 2 + x0 * spread, h - 8);
      ctx.stroke();
      ctx.lineWidth = 3;                       // thinner bright core
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.moveTo(w / 2, 10);
      ctx.quadraticCurveTo(w / 2 + x0 * 0.3, h * 0.38, w / 2 + x0 * spread, h - 8);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(234,247,255,0.85)';
    };
    arm(-w * 0.44, w * 0.5);
    arm(w * 0.44, w * 0.5);
    // churn right at the transom — soft: a bright radial blob here reads as a
    // sourceless glow under the hull (critic r5)
    const g = ctx.createRadialGradient(w / 2, 14, 0, w / 2, 14, 26);
    g.addColorStop(0, 'rgba(255,255,255,0.38)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, 128, 256);
  const wakeMat = new THREE.MeshBasicMaterial({ map: wakeTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const wake = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 7), wakeMat);
  wake.rotation.x = -Math.PI / 2;
  wake.position.set(0, 0.46, 4.4);
  g.add(wake);

  // contact shadow — dark radial footprint the hull casts on the water
  // (critic r5: boat had no contact shadow, motor crossed the waterline bare)
  const shadowTex = canvasTexture((ctx, w, h) => {
    const g2 = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g2.addColorStop(0, 'rgba(6,20,26,0.72)');
    g2.addColorStop(0.55, 'rgba(6,20,26,0.4)');
    g2.addColorStop(1, 'rgba(6,20,26,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);
  }, 128, 128);
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 5.4),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.85, depthWrite: false })
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.set(0, 0.445, 0.6);
  g.add(contact);

  // hull waterline churn — small foam ring where motor and transom meet the
  // water; a real, always-present source for the glow (critic r5)
  const foamTex = canvasTexture((ctx, w, h) => {
    const g3 = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g3.addColorStop(0, 'rgba(240,250,255,0.5)');
    g3.addColorStop(0.6, 'rgba(240,250,255,0.18)');
    g3.addColorStop(1, 'rgba(240,250,255,0)');
    ctx.fillStyle = g3;
    ctx.fillRect(0, 0, w, h);
  }, 96, 96);
  const foam = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 2.2),
    new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(0, 0.452, 2.7);
  g.add(foam);

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

  // the river — finer, subtler ripple ellipses: the old big dark blobs read
  // as paint stains (critic r5)
  const waterTex = canvasTexture((ctx, w, h) => {
    // opaque white base so the map multiplies to the water color instead of black
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 110; i++) {
      ctx.fillStyle = i % 3 ? 'rgba(255,255,255,0.13)' : 'rgba(18,58,68,0.05)';
      ctx.beginPath();
      ctx.ellipse(Math.random() * w, Math.random() * h, 5 + Math.random() * 14, 0.8 + Math.random() * 1.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 256, 256);
  waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
  waterTex.repeat.set(3, 60);
  // §4 water: low roughness + real metalness so the sky env actually mirrors
  // (critic r4/r5: flat turquoise with painted stains). r7: roughness 0.07 so
  // the env sun-blob gives a visible glint (env alone = gradient = invisible)
  // r9: metalness 0.5 — from the chase cam the water is seen from ABOVE, where
  // a dielectric's Fresnel reflectance collapses to ~4% and the env never shows
  // no matter how low the roughness; half-metal keeps the mirror at every angle
  const waterMat = new THREE.MeshStandardMaterial({ color: tod.water, roughness: 0.07, metalness: 0.5, map: waterTex, envMapIntensity: tod.waterEnv });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(14.6, TRACK_LENGTH + 200), waterMat);
  water.receiveShadow = true;
  water.rotation.x = -Math.PI / 2;
  // above the banks (y=0.35) so the river actually reads as water
  water.position.set(0, 0.42, -TRACK_LENGTH / 2);
  group.add(water);

  // wet-sand shore bands (critic r7: hard clean water/sand edge) — a dark
  // gradient hugging the waterline on both banks, merged into ONE mesh.
  // Sits above the water plane so it reads as soaked sand, not depth fog.
  const shoreTex = canvasTexture((ctx, w, h) => {
    const gr = ctx.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, 'rgba(28,44,52,0.62)');   // soaked edge at the water
    gr.addColorStop(0.45, 'rgba(64,58,48,0.30)'); // damp sand
    gr.addColorStop(1, 'rgba(90,80,60,0)');       // dry — fades into the bank
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, w, h);
  }, 64, 8);
  shoreTex.wrapS = THREE.RepeatWrapping;
  shoreTex.repeat.set(1, 120);
  const shoreMat = new THREE.MeshBasicMaterial({ map: shoreTex, transparent: true, depthWrite: false });
  const shoreL = new THREE.Mesh(new THREE.PlaneGeometry(2.6, TRACK_LENGTH + 200), shoreMat);
  shoreL.rotation.x = -Math.PI / 2;
  shoreL.position.set(8.2, 0.428, -TRACK_LENGTH / 2);
  const shoreR = shoreL.clone();
  shoreR.rotation.z = Math.PI; // mirror the gradient toward the other bank
  shoreR.position.x = -8.2;
  const shores = new THREE.Mesh(mergeStaticMeshes([shoreL, shoreR]), shoreMat);
  group.add(shores);

  // canyon cliffs — 90 rocks merged into ONE mesh (90 → 1 draw calls)
  const cliffMat = new THREE.MeshStandardMaterial({ color: '#8a6f56', roughness: 1, flatShading: true });
  const cliffMeshes = [];
  for (let i = 0; i < 90; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * (13 + rng() * 22);
    const z = 16 - rng() * (TRACK_LENGTH + 40);
    const s = 2.5 + rng() * 6;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), cliffMat);
    rock.position.set(x, s * 0.55, z);
    rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    cliffMeshes.push(rock);
  }
  const cliffs = new THREE.Mesh(mergeStaticMeshes(cliffMeshes), cliffMat);
  cliffs.castShadow = true;
  group.add(cliffs);

  // reeds near the waterline — 120 blades merged into ONE mesh (120 → 1)
  const reedMat = new THREE.MeshStandardMaterial({ color: '#4d7d3a', roughness: 1 });
  const reedMeshes = [];
  for (let i = 0; i < 120; i++) {
    const side = rng() > 0.5 ? 1 : -1;
    const x = side * (7 + rng() * 4);
    const z = 16 - rng() * (TRACK_LENGTH + 20);
    const reed = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 1 + rng() * 1.2, 4), reedMat);
    reed.position.set(x, 0.8, z);
    reed.rotation.z = (rng() - 0.5) * 0.25;
    reedMeshes.push(reed);
  }
  const reeds = new THREE.Mesh(mergeStaticMeshes(reedMeshes), reedMat);
  group.add(reeds);

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
    post.castShadow = true;
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
      // canvas-bottom lands at zenith → draw gradient bottom-up; skyBot holds
      // through the horizon (position 0.5) so the fog band matches (critic r4)
      const c = document.createElement('canvas'); c.width = 64; c.height = 512;
      const ctx = c.getContext('2d');
      // EMPIRICAL mapping (r6): canvas TOP = zenith, position 0.5 = horizon
      const gr = ctx.createLinearGradient(0, 0, 0, 512);
      gr.addColorStop(0, tod.skyTop);
      gr.addColorStop(0.28, tod.skyMid);
      gr.addColorStop(0.5, tod.skyBot);
      if (tod.skyLow) gr.addColorStop(0.47, tod.skyLow); // warm band just over the horizon
      gr.addColorStop(1, tod.skyBot); // blue in frame (r6)
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

  // low sunset sun — visible source for the warm light (SPEC §2)
  const sunDisc = makeSunDisc('#ffc27a');
  celestial.push(sunDisc);
  group.add(sunDisc); // was never in the scene graph — the disc could not render (r4)

  // golden sun path on the water at sunset — the classic reflection stripe,
  // laid toward the sun azimuth (critic r2: water needs a warm light path).
  // Elongated soft texture: fades at BOTH ends and the sides, so no burned
  // blob near the camera (critic r4)
  const glitterTex = canvasTexture((ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const nx = Math.abs(x - w / 2) / (w / 2);           // 0 center → 1 side
        const ny = Math.abs(y - h / 2) / (h / 2);           // 0 center → 1 end
        const side = Math.max(0, 1 - nx * nx * 1.9);        // soft side edges
        const along = Math.max(0, 1 - ny * ny * 1.15);      // soft both ends
        const a = Math.pow(side * along, 1.5);
        const i = (y * w + x) * 4;
        img.data[i] = 255; img.data[i + 1] = 208; img.data[i + 2] = 148;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }, 128, 512);
  const glitter = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 240),
    new THREE.MeshBasicMaterial({ map: glitterTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  glitter.rotation.x = -Math.PI / 2;
  group.add(glitter);
  const glitterDir = { x: 0, z: -1 };

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
    // redraw sky gradient — canvas TOP = zenith, position 0.5 = horizon (r6)
    const ctx = sky.material.map.image.getContext('2d');
    const gr = ctx.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0, tod.skyTop);
    gr.addColorStop(0.28, tod.skyMid);
    gr.addColorStop(0.5, tod.skyBot);
    if (tod.skyLow) gr.addColorStop(0.47, tod.skyLow); // warm band just over the horizon
    gr.addColorStop(1, tod.skyBot);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 512);
    sky.material.map.needsUpdate = true;

    // fog fades to the horizon band of the sky (GRAPHICS_PLAN §1.4)
    // fog can sit deeper than the sky's horizon band: a pastel-bright horizon
    // color AS fog veils the whole midground uniformly (r9 critic: sunset read
    // as one global orange filter) — themes may override with tod.fog
    world.setFog(tod.fog ?? tod.skyBot, tod.fogDensity);
    world.scene.background.set(tod.skyBot);
    world.setExposure(tod.exposure);
    // env gets the sun blob so the water shows a real specular glint at the
    // sun azimuth (critic r7: water had zero reflection/specular)
    world.setEnvironment(tod.skyTop, tod.skyMid, tod.skyBot, '#a68a5e', { x: tod.sunRig[0], y: tod.sunRig[1], z: tod.sunRig[2] }); // bank bounce
    world.sunRig.set(tod.sunRig[0], tod.sunRig[1], tod.sunRig[2]);
    world.sun.color.set(tod.sunColor);
    world.sun.intensity = tod.sunIntensity;
    world.hemi.color.set(tod.hemiSky);
    world.hemi.groundColor.set(tod.hemiGround);
    world.hemi.intensity = tod.hemiIntensity;
    world.ambient.intensity = tod.ambient;
    // visible sun disc rides the sunRig direction (anchor for the warm light)
    const rigLen = Math.hypot(tod.sunRig[0], tod.sunRig[1], tod.sunRig[2]);
    sunDisc.position.set(tod.sunRig[0] / rigLen * 550, tod.sunRig[1] / rigLen * 550, tod.sunRig[2] / rigLen * 550);
    sunDisc.userData.skyZ0 = sunDisc.position.z; // re-stamp backdrop offset (was captured before placement)
    sunDisc.material.opacity = name === 'sunset' ? 0.7 : 0;
    // glitter stripe toward the sun azimuth, laid from the player outwards
    glitterDir.x = tod.sunRig[0] / Math.hypot(tod.sunRig[0], tod.sunRig[2]);
    glitterDir.z = tod.sunRig[2] / Math.hypot(tod.sunRig[0], tod.sunRig[2]);
    glitter.rotation.z = Math.atan2(glitterDir.x, glitterDir.z);
    glitter.material.opacity = name === 'sunset' ? 0.3 : 0; // focal glint path (critic r7)
    starMat.opacity = tod.stars;
    moonGlow.material.opacity = name === 'night' ? 0.5 : 0;
    moon.visible = name === 'night';
    waterMat.color.set(tod.water);
    waterMat.envMapIntensity = tod.waterEnv; // warm sky path on the water at sunset
    // reeds take the ambient tint: orange sunset warms them off pure green
    // (critic r5: reeds kept their day green under orange light)
    reedMat.color.set(name === 'sunset' ? '#7d6f3c' : name === 'night' ? '#2c3a2a' : '#4d7d3a');
    pools.forEach((p) => (p.material.opacity = tod.lanterns * 0.55));
    lampHeadMat.color.set(tod.lanterns > 0.3 ? '#ffe6b0' : '#8b9099');
    vehicles.forEach((v) => {
      v.navMats.forEach((m) => (m.opacity = tod.navLights));
      if (v.light) v.light.intensity = tod.headlight; // player only
    });
  }
  setTimeOfDay(timeOfDay);

  /* ---------- per-frame ---------- */
  function update(dt, state) {
    if (!state) return;
    const now = performance.now();

    // sky rides along with the player (see followPlayerSky)
    followPlayerSky(celestial, vehicles[0]?.visZ ?? 0);

    // the glitter stripe leads from the boat toward the sun azimuth
    const p0 = vehicles[0]?.group.position;
    if (p0) glitter.position.set(p0.x + glitterDir.x * 145, 0.47, p0.z + glitterDir.z * 145);

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

      // wake grows with speed; a real boat idles with a visible wash even
      // stopped (0.16 floor so a stationary boat still reads as IN water)
      v.wakeMat.opacity = Math.max(0.16, Math.min(0.42, s01 * 0.42));
      v.wake.scale.set(0.8 + s01 * 0.6, 0.6 + s01 * 1.1, 1);
      const heat = rs.comboHeat ?? 0;
      const flicker = 0.8 + Math.random() * 0.35;
      v.spray.scale.set(0.5 + heat * 1.1, heat * flicker, 0.5 + heat * 1.1);
      v.sprayMat.opacity = Math.min(0.85, heat * 0.9);
    });
  }

  return { group, vehicles, update, finishZ: gateZ, setTimeOfDay };
}
