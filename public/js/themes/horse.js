/* 🐎 Wild West Ride theme — a dusty desert trail: galloping horses with
 * riders, cacti, mesas, fences, campfires at night, lantern poles. */

import * as THREE from 'three';
import { TRACK_LENGTH, mulberry32 } from '../world.js';
import { expK, canvasTexture, radialGlowTexture, makeLabel, stepVehicle, buildFinishGate, followPlayerSky, makeSunDisc, mergeInstancedGeometry, mergeStaticMeshes } from './shared.js';

const LANES = [-4.4, -2.2, 0, 2.2, 4.4];

const TOD = {
  day: {
    skyTop: '#3f7fd9', skyMid: '#9cc4e8', skyBot: '#f2ddb8',
    fogDensity: 0.0020, exposure: 1.0, sunRig: [32, 60, 20],
    sunColor: '#fff2e0', sunIntensity: 2.7,
    hemiSky: '#d8e8ff', hemiGround: '#a87a50', hemiIntensity: 0.6,
    ambient: 0.0, lanterns: 0.0, fires: 0.0, stars: 0.0, lanternLight: 0, fireLight: 0,
  },
  sunset: {
    skyTop: '#3a2468', skyMid: '#c25a4e', skyBot: '#ffb05a',
    fogDensity: 0.0026, exposure: 0.85, sunRig: [72, 9, 4],
    sunColor: '#ff8a3d', sunIntensity: 1.75,
    hemiSky: '#f0a878', hemiGround: '#7a5238', hemiIntensity: 0.38,
    ambient: 0.0, lanterns: 0.6, fires: 0.7, stars: 0.25, lanternLight: 0, fireLight: 7,
  },
  night: {
    // near-black sky + near-black desert; pools live on the fixed lantern
    // poles and campfires only (critic r6: ground luma 41 vs refs 4–23)
    skyTop: '#03050c', skyMid: '#081020', skyBot: '#101f38',
    fogDensity: 0.0032, exposure: 0.78, sunRig: [-24, 46, 32],
    sunColor: '#8fb0ff', sunIntensity: 0.5,
    hemiSky: '#2a3f60', hemiGround: '#16130e', hemiIntensity: 0.55,
    ambient: 0.04, lanterns: 1.0, fires: 1.0, stars: 1.0, lanternLight: 0, fireLight: 12,
  },
};

function buildHorse(color, { player = false } = {}) {
  const g = new THREE.Group();
  const coat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, envMapIntensity: 0.05 });
  const maneMat = new THREE.MeshStandardMaterial({ color: '#2a2019', roughness: 1, envMapIntensity: 0.05 });
  const skin = new THREE.MeshStandardMaterial({ color: '#e6b98f', roughness: 0.9 });

  // body — box with chest/rump taper: front deeper, hindquarters narrower so
  // the rear silhouette stops reading as a raw rectangle (critic r5, §5.3)
  const bodyGeo = new THREE.BoxGeometry(0.95, 0.95, 2.3);
  {
    const pos = bodyGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      if (z > 0.6) { pos.setX(i, pos.getX(i) * 0.8); pos.setY(i, pos.getY(i) * 0.86); }      // rump tuck
      else if (z < -0.6) { pos.setX(i, pos.getX(i) * 1.08); pos.setY(i, pos.getY(i) * 1.1); } // chest
    }
    bodyGeo.computeVertexNormals();
  }
  const body = new THREE.Mesh(bodyGeo, coat);
  body.position.y = 1.25; body.castShadow = true;
  g.add(body);
  const rump = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.62, 0.5), coat);
  rump.position.set(0, 1.24, 1.2);
  g.add(rump);

  // neck — arched (§5.3): steeper pivot so the head rises above the withers
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.15, 0.5), coat);
  neck.position.set(0, 1.9, -1.05);
  neck.rotation.x = 0.95;
  neck.castShadow = true;
  g.add(neck);
  // head rides HIGH and forward of the rider's hat so the silhouette reads
  // from the chase camera (critic r6: "neck is a plain vertical box")
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.44, 0.9), coat);
  head.position.set(0, 2.88, -1.52);
  head.rotation.x = -0.55; // muzzle levels forward off the arched neck
  head.castShadow = true;
  g.add(head);
  const earGeo = new THREE.ConeGeometry(0.07, 0.2, 4);
  const earL = new THREE.Mesh(earGeo, coat); earL.position.set(-0.12, 3.14, -1.42);
  const earR = earL.clone(); earR.position.x = 0.12;
  g.add(earL, earR);
  const mane = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.2, 0.2), maneMat);
  mane.position.set(0, 2.08, -0.86);
  mane.rotation.x = 0.95;
  g.add(mane);

  // tail — fuller fall of hair hanging from the dock (visible below the rump
  // from astern, critic r5)
  const tail = new THREE.Group();
  const tailUpper = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.72, 0.3), maneMat);
  tailUpper.geometry.translate(0, -0.32, 0.04);
  const tailLower = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.95, 0.24), maneMat);
  tailLower.geometry.translate(0, -0.45, 0.02);
  tailLower.position.set(0, -0.54, 0.12);
  tailLower.rotation.x = 0.3;
  tailLower.rotation.y = 0.3; // slight twist so hair reads 3D, not a flat quad (critic r7)
  tail.add(tailUpper, tailLower);
  tail.position.set(0, 1.5, 1.48);
  tail.rotation.x = 0.9;
  g.add(tail);

  // legs — two-segment with knee (§5.3): pronounced upper/lower contrast AND a
  // dark lower segment so the joint reads from astern (critic r5/r6)
  const upperGeo = new THREE.BoxGeometry(0.27, 0.5, 0.32);
  upperGeo.translate(0, -0.25, 0);
  const lowerGeo = new THREE.BoxGeometry(0.12, 0.45, 0.14);
  lowerGeo.translate(0, -0.225, 0);
  const hoofGeo = new THREE.BoxGeometry(0.14, 0.12, 0.2);
  hoofGeo.translate(0, -0.06, 0);
  const legs = [];
  const lowers = [];
  for (const [x, z] of [[-0.38, -0.85], [0.38, -0.85], [-0.38, 0.95], [0.38, 0.95]]) {
    const leg = new THREE.Mesh(upperGeo, coat);
    leg.position.set(x, 1.05, z);
    leg.rotation.z = x < 0 ? -0.06 : 0.06; // slight outward splay — perfectly vertical pillars read as sticks (r9)
    const lower = new THREE.Mesh(lowerGeo, maneMat); // dark lower = visible joint
    lower.position.set(0, -0.5, 0);
    lower.rotation.x = 0.55; // pronounced standing knee bend so the joint breaks the leg line (r9 critic)
    const hoof = new THREE.Mesh(hoofGeo, maneMat);
    hoof.position.set(0, -0.45, 0);
    lower.add(hoof);
    leg.add(lower);
    leg.castShadow = true;
    g.add(leg);
    legs.push(leg);
    lowers.push(lower);
  }

  // rider (tiny cowboy) — slim: the torso was nearly as wide as the rump and
  // the hat brim a giant disc, hiding the neck/head silhouette (critic r7)
  const rider = new THREE.Group();
  const shirtMat = new THREE.MeshStandardMaterial({ color: player ? '#ffd75e' : '#3a4a6b', roughness: 0.9, envMapIntensity: 0.15 });
  shirtMat.userData.base = shirtMat.color.clone(); // per-TOD dim (night fill below)
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.55, 0.26), shirtMat);
  torso.position.y = 0.5;
  const headR = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), skin);
  skin.userData.base = skin.color.clone();
  headR.position.y = 0.9;
  const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 10), maneMat);
  hatBrim.position.y = 1.0;
  const hatTop = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.16, 10), maneMat);
  hatTop.position.y = 1.09;
  const legMat = new THREE.MeshStandardMaterial({ color: '#5a4630', roughness: 1 });
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.15), legMat);
  legL.position.set(-0.13, 0.18, 0);
  const legR = legL.clone(); legR.position.x = 0.13;
  rider.add(torso, headR, hatBrim, hatTop, legL, legR);
  rider.position.set(0, 1.66, 0.3);
  g.add(rider);

  // player lantern — real light that lights the trail at night
  const lantern = new THREE.Group();
  // dark lantern housing with a TOD-tied emissive core — a Basic yellow box
  // stayed sun-bright even at noon, reading as a floating yellow quad beside
  // the flank (r9 critic)
  const cage = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.14),
    new THREE.MeshStandardMaterial({ color: '#4a3d2e', roughness: 0.7, emissive: '#ffb84d', emissiveIntensity: 0 }));
  const lanternLight = new THREE.PointLight('#ffbb55', 0, 9, 2);
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

  return { group: g, legs, lowers, tail, dust, dustMat, lanternLight, cage, riderMats: [shirtMat, skin] };
}

export function create(world, { racers, seed, timeOfDay = 'day' }) {
  const rng = mulberry32(seed);
  const group = new THREE.Group();
  let tod = TOD[timeOfDay] ?? TOD.day;

  /* ---------- desert ---------- */
  // desert sand — subtle blotch variation so the floor isn't one flat color
  // (critic r6: uniform luma-185 floor)
  const sandTex = canvasTexture((ctx, w, h) => {
    ctx.fillStyle = '#d9b070';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(255,235,190,0.10)' : 'rgba(120,85,50,0.08)';
      ctx.beginPath();
      ctx.ellipse(Math.random() * w, Math.random() * h, 6 + Math.random() * 22, 3 + Math.random() * 8, Math.random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 256, 256);
  sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping;
  sandTex.repeat.set(26, 80);
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 3000),
    new THREE.MeshStandardMaterial({ color: '#ffffff', map: sandTex, roughness: 1, envMapIntensity: 0.15 })
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.z = -TRACK_LENGTH / 2;
  sand.receiveShadow = true;
  group.add(sand);

  // the trail
  const trail = new THREE.Mesh(
    new THREE.PlaneGeometry(13.4, TRACK_LENGTH + 160),
    new THREE.MeshStandardMaterial({ color: '#b58a55', roughness: 1, envMapIntensity: 0.15 })
  );
  trail.rotation.x = -Math.PI / 2;
  trail.position.set(0, 0.02, -TRACK_LENGTH / 2);
  trail.receiveShadow = true;
  group.add(trail);

  // hoof-worn lane guides — soft tone close to the sand so they don't read as
  // repeated hard stripes (critic r6); Standard, so night doesn't self-lit
  const rutMat = new THREE.MeshStandardMaterial({ color: '#c09a62', roughness: 1, envMapIntensity: 0.2 });
  const ruts = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.22, TRACK_LENGTH + 120), rutMat, 5);
  const m4 = new THREE.Matrix4();
  const qFlat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  LANES.forEach((lx, i) => {
    m4.compose(new THREE.Vector3(lx, 0.03, -TRACK_LENGTH / 2), qFlat, new THREE.Vector3(1, 1, 1));
    ruts.setMatrixAt(i, m4);
  });
  group.add(ruts);

  // fence posts — instanced template merged into one Mesh so posts cast shadows
  // (InstancedMesh never enters the shadow depth pass in this three build)
  const postMat = new THREE.MeshStandardMaterial({ color: '#6e5236', roughness: 1, envMapIntensity: 0.15 });
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
  const postMesh = new THREE.Mesh(mergeInstancedGeometry(posts), postMat);
  postMesh.castShadow = true;
  group.add(postMesh);
  posts.dispose();

  // cacti — proper saguaro form: trunk + upward elbow arms (critic r5, §5.3).
  // Every part is merged into ONE mesh so arms cost no extra draw calls.
  const cactusMat = new THREE.MeshStandardMaterial({ color: '#497a4a', roughness: 1 });
  const cactusParts = [];
  for (let i = 0; i < 70; i++) {
    const side = rng() > 0.5 ? 1 : -1;
    const x = side * (12 + rng() * 40);
    const z = 16 - rng() * (TRACK_LENGTH + 30);
    const h = 1.6 + rng() * 2.2;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, h, 7), cactusMat);
    trunk.position.set(x, h / 2, z);
    cactusParts.push(trunk);
    const nArms = rng() > 0.5 ? 2 : 1;
    for (let a = 0; a < nArms; a++) {
      const armSide = a === 0 ? 1 : -1;
      const armY = h * (0.45 + rng() * 0.25);
      // horizontal elbow, then vertical forearm (saguaro silhouette)
      const elbow = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.42, 6), cactusMat);
      elbow.rotation.z = armSide * Math.PI / 2;
      elbow.position.set(x + armSide * 0.42, armY, z);
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, h * 0.32, 6), cactusMat);
      fore.position.set(x + armSide * 0.6, armY + h * 0.16, z);
      cactusParts.push(elbow, fore);
    }
  }
  const cacti = new THREE.Mesh(mergeStaticMeshes(cactusParts), cactusMat);
  cacti.castShadow = true;
  group.add(cacti);

  // mesas on the horizon (stacked boxes) — darkened at night (critic r2:
  // distant blocks read dusk-pink); materials collected for per-TOD tinting
  const mesaMats = [];
  const mesaBase = ['#b5714a', '#a3654a'];
  for (let i = 0; i < 10; i++) {
    const side = i % 2 ? 1 : -1;
    const w = 30 + rng() * 40, h = 18 + rng() * 26, d = 20 + rng() * 30;
    const mesa = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: mesaBase[i % 2], roughness: 1, flatShading: true });
    mesaMats.push(mat);
    const base = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.7, d), mat);
    base.position.y = h * 0.35;
    const top = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, h * 0.3, d * 0.7), mat);
    top.position.y = h * 0.85;
    mesa.add(base, top);
    mesa.position.set(side * (120 + rng() * 160), 0, -rng() * TRACK_LENGTH);
    group.add(mesa);
  }

  // telegraph poles
  const teleMat = new THREE.MeshStandardMaterial({ color: '#4f3a26', roughness: 1, envMapIntensity: 0.15 });
  for (let i = 0; i < 12; i++) {
    const side = i % 2 ? 1 : -1;
    const z = -30 - i * (TRACK_LENGTH / 12);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 6, 6), teleMat);
    pole.position.set(side * 12, 3, z);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.1), teleMat);
    bar.position.set(side * 12, 5.4, z);
    pole.castShadow = bar.castShadow = true;
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
    post.castShadow = true;
    board.castShadow = true;
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

  /* ---------- lantern poles along the trail (merged: 42 → 3 meshes) ---------- */
  const lampGlowTex = radialGlowTexture('#ffcf8a');
  const lampHeadMat = new THREE.MeshBasicMaterial({ color: '#8b9099' });
  const poolMat = new THREE.MeshBasicMaterial({ map: lampGlowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const poleParts = [], headParts = [], poolParts = [];
  for (let i = 0; i < 14; i++) {
    const side = i % 2 ? 1 : -1;
    const z = -20 - i * (TRACK_LENGTH / 14);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 3.6, 6), teleMat);
    post.position.set(side * 8.2, 1.8, z);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), lampHeadMat);
    head.position.set(side * 8.2, 3.7, z);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(9, 13), poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(side * 7.8, 0.05, z);
    poleParts.push(post);
    headParts.push(head);
    poolParts.push(pool);
  }
  const lampPosts = new THREE.Mesh(mergeStaticMeshes(poleParts), teleMat);
  lampPosts.castShadow = true;
  const lampHeads = new THREE.Mesh(mergeStaticMeshes(headParts), lampHeadMat);
  const pools = [new THREE.Mesh(mergeStaticMeshes(poolParts), poolMat)];
  group.add(lampPosts, lampHeads, pools[0]);

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

  // low sunset sun — visible source for the warm light (SPEC §2)
  const sunDisc = makeSunDisc('#ffc27a');
  celestial.push(sunDisc);
  group.add(sunDisc); // was never in the scene graph — the disc could not render (r4)

  // ONE campfire light that snaps to the fire nearest the player (§3.3) —
  // a real warm source for the night fires without 8 extra lights
  const fireLight = new THREE.PointLight('#ff9b45', 0, 14, 2);
  fireLight.castShadow = false;
  group.add(fireLight);

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
    // EMPIRICAL mapping (r6): canvas TOP = zenith, position 0.5 = horizon
    const gr = ctx.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0, tod.skyTop);
    gr.addColorStop(0.28, tod.skyMid);
    gr.addColorStop(0.5, tod.skyBot); // fog band at the horizon
    gr.addColorStop(1, tod.skyBot);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 512);
    sky.material.map.needsUpdate = true;

    // fog fades to the horizon band of the sky (GRAPHICS_PLAN §1.4)
    world.setFog(tod.skyBot, tod.fogDensity);
    world.scene.background.set(tod.skyBot);
    world.setExposure(tod.exposure);
    world.setEnvironment(tod.skyTop, tod.skyMid, tod.skyBot, '#d9b070'); // sand bounce
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
    sunDisc.material.opacity = name === 'sunset' ? 0.55 : 0;
    fireLight.userData.base = tod.fireLight;
    mesaMats.forEach((m, i) => {
      if (name === 'night') m.color.set(i % 2 ? '#241a12' : '#1e1610');
      else m.color.set(mesaBase[i % 2]);
    });
    starMat.opacity = tod.stars;
    moonGlow.material.opacity = name === 'night' ? 0.5 : 0;
    moon.visible = name === 'night';
    pools.forEach((p) => (p.material.opacity = tod.lanterns * 0.55));
    lampHeadMat.color.set(tod.lanterns > 0.3 ? '#ffe6b0' : '#8b9099');
    // the lamp head is an emitting surface: let it punch through tone mapping
    // at night — brightest element of the night scene (critic r5)
    lampHeadMat.toneMapped = tod.lanterns <= 0.3;
    fires.forEach((f) => {
      f.userData.flame.material.opacity = tod.fires * 0.9;
      f.userData.glow.material.opacity = tod.fires * 0.5;
    });
    vehicles.forEach((v) => {
      // no light rides with the horse: night pools belong to the FIXED lantern
      // poles and campfires only (critic r5: player halo had no visible source)
      v.lanternLight.intensity = 0;
      v.cage.visible = true; // small visible lantern prop, emits nothing
      v.cage.material.emissiveIntensity = tod.lanterns * 1.4; // glows only when it's actually dark (r9)
      // rider albedo dims with the TOD: a bright mustard shirt + skin glowed
      // against the near-black horse at night (critic r7) — cold dim fill
      const riderK = name === 'night' ? 0.3 : name === 'sunset' ? 0.65 : 1.0;
      v.riderMats.forEach((m) => {
        m.color.copy(m.userData.base).multiplyScalar(riderK);
        m.envMapIntensity = name === 'night' ? 0.05 : 0.15;
      });
    });
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

    // the single firelight snaps to the fire nearest the player (§3.3)
    const p0 = vehicles[0]?.group.position;
    if (p0) {
      let best = null, bestD = 35 * 35;
      for (const f of fires) {
        const dx = f.position.x - p0.x, dz = f.position.z - p0.z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = f; }
      }
      if (best && fireLight.userData.base) {
        fireLight.position.set(best.position.x, 0.9, best.position.z);
        fireLight.intensity = fireLight.userData.base * (0.85 + Math.sin(now / 90 + best.userData.phase) * 0.1);
      } else fireLight.intensity = 0;
    }

    state.forEach((rs, i) => {
      const v = vehicles[i];
      if (!v) return;
      const { s01 } = stepVehicle(v, rs, dt, now, { bobAmp: 0.12, bobFreq: 55 });

      // gallop: diagonal leg pairs swing, faster with speed; the knee bends
      // only in the swing phase (sin>0) so hooves don't slide on the ground
      v.gallop += dt * (4 + s01 * 14);
      const amp = 0.15 + s01 * 0.55;
      v.legs[0].rotation.x = Math.sin(v.gallop) * amp;
      v.legs[3].rotation.x = Math.sin(v.gallop) * amp;
      v.legs[1].rotation.x = Math.sin(v.gallop + Math.PI) * amp;
      v.legs[2].rotation.x = Math.sin(v.gallop + Math.PI) * amp;
      const knee = (ph) => 0.25 + Math.max(0, Math.sin(ph)) * 0.9 * amp;
      v.lowers[0].rotation.x = knee(v.gallop);
      v.lowers[3].rotation.x = knee(v.gallop);
      v.lowers[1].rotation.x = knee(v.gallop + Math.PI);
      v.lowers[2].rotation.x = knee(v.gallop + Math.PI);
      v.tail.rotation.x = 1.05 + Math.sin(now / 300 + v.wobble) * 0.15;

      // dust: speed + combo heat
      const heat = rs.comboHeat ?? 0;
      const puff = Math.min(1, s01 * 0.55 + heat * 0.7);
      v.dustMat.opacity = puff * 0.55;
      v.dust.scale.set(2 + puff * 2.6, 1.2 + puff * 1.6, 1);
    });
  }

  return { group, vehicles, update, finishZ: gateZ, setTimeOfDay };
}
