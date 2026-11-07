/* 🏎 Street Race theme — asphalt sprint: low-poly cars, roadside scenery,
 * billboards, finish gate. Vehicles advance with typing progress.
 * Supports day / sunset / night with full lighting treatment. */

import * as THREE from 'three';
import { TRACK_LENGTH, mulberry32 } from '../world.js';
import { followPlayerSky, makeSunDisc, mergeInstancedGeometry, mergeStaticMeshes } from './shared.js';

const LANES = [-4.4, -2.2, 0, 2.2, 4.4];

const expK = (k, dt) => 1 - Math.exp(-k * dt);

/* ---------------- time-of-day presets ---------------- */
const TOD = {
  day: {
    // sunny blue sky — coherent with the sharp mapped shadows (critic r6:
    // overcast white sky + hard shadows contradict)
    skyTop: '#2f6ad0', skyMid: '#5a9be0', skyBot: '#bfdff2',
    fogDensity: 0.0026, exposure: 1.0, sunRig: [34, 62, 18],
    sunColor: '#fff2e0', sunIntensity: 2.6,
    hemiSky: '#cfe4ff', hemiGround: '#6a7a58', hemiIntensity: 0.55,
    ambient: 0.0, lamps: 0.0, cones: 0.0, beam: 0.0, stars: 0.0,
    headlight: 0, tail: 0.15, moon: false, ground: '#5d9c4a', grass: '#5d9c4a',
  },
  sunset: {
    skyTop: '#25246b', skyMid: '#b34a8a', skyBot: '#ff9a5a',
    fogDensity: 0.0026, exposure: 0.85, sunRig: [70, 11, 6],
    sunColor: '#ff9a55', sunIntensity: 1.7,
    hemiSky: '#e0a8b8', hemiGround: '#5a4038', hemiIntensity: 0.35,
    ambient: 0.0, lamps: 0.55, cones: 0.0, beam: 0.08, stars: 0.25,
    headlight: 350, tail: 0.8, moon: false, ground: '#5a4a30', grass: '#4a4530',
  },
  night: {
    // near-black sky, silhouetted ground (critic r6: navy luma 32 vs refs 6–14).
    // r7: moon 0.5→0.32 — long near-black tree shadows contradicted a dim moon;
    // grass forced cold/desaturated (was reading day-green)
    skyTop: '#03050c', skyMid: '#081120', skyBot: '#12233f',
    fogDensity: 0.0030, exposure: 0.85, sunRig: [-26, 48, 34],
    sunColor: '#8fb0ff', sunIntensity: 0.32,
    hemiSky: '#2a3f60', hemiGround: '#121a24', hemiIntensity: 0.55,
    ambient: 0.04, lamps: 1.0, cones: 0.0, beam: 0.1, stars: 1.0,
    // real low-beam ≈ 800–1500 cd; 60 cd is invisible after grazing-angle +
    // inverse-square + ACES (measured live: 60 cd → (0,1,6) on the road)
    headlight: 800, tail: 1.2, moon: true, ground: '#0d1410', grass: '#232e26',
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
  // bottom-up so skyTop lands at the top of the sky. skyBot holds through the
  // horizon (gradient position 0.5 = dome equator) so the fog band matches the
  // horizon — no hard line where dome meets fog (critic r4).
  return canvasTexture((ctx, w, h) => {
    // EMPIRICAL mapping (r6): canvas TOP = zenith, position 0.5 = horizon
    // (the old comment had it backwards — skyTop was painted at the nadir)
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, tod.skyTop);
    g.addColorStop(0.28, tod.skyMid);
    g.addColorStop(0.5, tod.skyBot); // fog band at the horizon
    g.addColorStop(1, tod.skyBot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, 64, 512);
}

function buildCar(color, { player = false } = {}) {
  const g = new THREE.Group();
  // §4 material table: paint 0.35/0.15, rubber 0.95/0.0 env 0.05, glass env 1.0.
  // r7: paint rough 0.28 env 0.95 — the body read as matte plastic with no
  // specular/env response (critic r7; still within the spec's ≈0.35/0.15)
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.15, envMapIntensity: 0.95 });
  const dark = new THREE.MeshStandardMaterial({ color: '#16181d', roughness: 0.95, metalness: 0.0, envMapIntensity: 0.05 });
  const glass = new THREE.MeshStandardMaterial({ color: '#9fd8ff', roughness: 0.15, metalness: 0.6, transparent: true, opacity: 0.85, envMapIntensity: 1.3 });

  // body — wedge nose: the top front edge slopes down toward the lamps so the
  // box reads as a car silhouette, not a raw brick (critic r6, §5.1)
  const bodyGeo = new THREE.BoxGeometry(1.9, 0.55, 4.1);
  {
    const pos = bodyGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 0 && pos.getZ(i) < -1.2) {
        pos.setY(i, pos.getY(i) * 0.72);
        pos.setX(i, pos.getX(i) * 0.94);
      }
    }
    bodyGeo.computeVertexNormals();
  }
  const body = new THREE.Mesh(bodyGeo, paint);
  body.position.y = 0.55; body.castShadow = true;
  g.add(body);

  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.28, 1.3), paint);
  hood.position.set(0, 0.92, -1.2); hood.castShadow = true;
  g.add(hood);

  const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.2, 0.8), paint);
  trunk.position.set(0, 0.92, 1.55); trunk.castShadow = true;
  g.add(trunk);

  // beveled/tapered greenhouse — top verts pulled in and back (§5.1), plus a
  // paint roof cap so the glass doesn't read as a full-width glasshouse (r4)
  const cabinGeo = new THREE.BoxGeometry(1.55, 0.5, 1.9);
  {
    const pos = cabinGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 0) {
        pos.setX(i, pos.getX(i) * 0.72);
        pos.setZ(i, pos.getZ(i) * 0.78 - 0.18);
      }
    }
    cabinGeo.computeVertexNormals();
  }
  const cabin = new THREE.Mesh(cabinGeo, glass);
  cabin.position.set(0, 1.06, 0.25); cabin.castShadow = true;
  g.add(cabin);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.07, 1.5), paint);
  roof.position.set(0, 1.33, 0.07); roof.castShadow = true;
  g.add(roof);

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
  // chrome rim disc — face sits proud of the tire sidewall so the disc reads
  // from directly behind (critic r5)
  const rimGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.36, 10);
  rimGeo.rotateZ(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({ color: '#b8bcc4', roughness: 0.25, metalness: 0.9, envMapIntensity: 1.0 });
  for (const [x, z] of [[-1.03, -1.35], [1.03, -1.35], [-1.03, 1.4], [1.03, 1.4]]) {
    const w = new THREE.Mesh(wgeo, dark);
    w.position.set(x, 0.38, z);
    w.add(new THREE.Mesh(rimGeo, rimMat));
    g.add(w);
    wheels.push(w);
  }

  const hl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.06), new THREE.MeshBasicMaterial({ color: '#fff9c8' }));
  hl.position.set(-0.55, 0.62, -2.06); g.add(hl);
  const hr = hl.clone(); hr.position.x = 0.55; g.add(hr);

  // taillights — physical emissive (SPEC §2: emissive only where physical, ≤2)
  const tailMat = new THREE.MeshStandardMaterial({ color: '#2a0508', emissive: '#ff2a33', emissiveIntensity: 0.15 });
  const tl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.06), tailMat);
  tl.position.set(-0.55, 0.66, 2.08); g.add(tl);
  const tr = tl.clone(); tr.position.x = 0.55; g.add(tr);

  // only the player carries a real light (PLAN §1.2: 5 lights → 1) — a SpotLight
  // so the beam actually pools on the road ahead instead of glowing in a bubble.
  // Wide penumbra: night pool gets soft edges (critic r4)
  let light = null;
  if (player) {
    light = new THREE.SpotLight('#fff3d0', 0, 28, 0.5, 0.75, 2);
    light.position.set(0, 0.8, -2.2);
    light.target.position.set(0, 0, -14);
    light.castShadow = false;
    g.add(light, light.target);
  }

  // headlight beams — FrontSide so the bright interior is not visible through
  // the cabin glass from behind (critic r2: floating white drops).
  // Apex low at the lamp, slim radius, tilted down at the road (critic r4:
  // beams used to exit at the roof corners with a hard-edged pool)
  const coneMat = new THREE.MeshBasicMaterial({
    color: '#ffedb0', transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
  });
  const beamGeo = new THREE.ConeGeometry(0.3, 5.2, 12, 1, true);
  beamGeo.translate(0, -2.6, 0); // apex at origin, base 5.2 ahead (−Z after rotation)
  const beamL = new THREE.Mesh(beamGeo, coneMat);
  beamL.rotation.x = Math.PI / 2 - 0.14; // spread forward, tilted down at the road
  beamL.position.set(-0.55, 0.55, -2.06);
  g.add(beamL);
  const beamR = new THREE.Mesh(beamGeo, coneMat);
  beamR.rotation.x = Math.PI / 2 - 0.07;
  beamR.position.set(0.55, 0.6, -2.06);
  g.add(beamR);

  // low-beam pool — soft light lying ON the asphalt ahead of the lamps so the
  // beams read as road illumination, not floating bubbles (critic r6)
  const beamPoolMat = new THREE.MeshBasicMaterial({
    map: radialGlowTexture('#ffe9b8'), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const beamPool = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 11), beamPoolMat);
  beamPool.rotation.x = -Math.PI / 2;
  beamPool.position.set(0, 0.05, -7.5);
  g.add(beamPool);

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

  return { group: g, wheels, coneMat, beamPoolMat, flame, flameCore, light, tailMat };
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
  const groundMat = new THREE.MeshStandardMaterial({ color: '#5d9c4a', roughness: 1, envMapIntensity: 0.2 });
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 3000),
    groundMat
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = -TRACK_LENGTH / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(13.4, TRACK_LENGTH + 160),
    new THREE.MeshStandardMaterial({ color: '#3b3e46', roughness: 0.9, envMapIntensity: 0.25 })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.02, -TRACK_LENGTH / 2);
  road.receiveShadow = true;
  group.add(road);

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
  // this three build, so merged Meshes are what make tree shadows real)
  const nTrees = 130;
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 1.6, 6);
  // crown = two stacked blobs (wide skirt + narrower rotated top) so trees stop
  // reading as identical flat cones (critic r6, §5.3)
  const crownMat = new THREE.MeshStandardMaterial({ color: '#2f7d38', roughness: 1 });
  const crownBlobA = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.3, 7), crownMat);
  crownBlobA.position.y = -0.6;
  const crownBlobB = new THREE.Mesh(new THREE.ConeGeometry(1.05, 2.1, 7), crownMat);
  crownBlobB.position.y = 0.85;
  crownBlobB.rotation.y = 0.5;
  const crownGeo = mergeStaticMeshes([crownBlobA, crownBlobB]);
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
  const rockMesh = new THREE.Mesh(mergeInstancedGeometry(rocks), rocks.material);
  rockMesh.castShadow = true;
  group.add(rockMesh);
  rocks.dispose();

  // distant mountains — 12 separate Meshes merged into one (12 → 1 draw calls)
  const mountainMeshes = [];
  const mountainMat = new THREE.MeshStandardMaterial({ color: '#6f87a8', roughness: 1, flatShading: true });
  for (let i = 0; i < 12; i++) {
    const h = 40 + rng() * 70;
    const mt = new THREE.Mesh(new THREE.ConeGeometry(30 + rng() * 40, h, 5), mountainMat);
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
  // per TOD in setTimeOfDay, so the materials are collected here
  const boardMats = [];
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
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 4, 0.35), new THREE.MeshStandardMaterial({ color: '#4a4f58' }));
    post.position.set(side * 11, 2, z);
    board.position.set(side * 11, 5.4, z);
    board.rotation.y = side * -Math.PI / 5.2;
    post.castShadow = true;
    board.castShadow = true;
    group.add(post, board);
  }

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

  // low sunset sun — the visible source for the warm light (SPEC §2)
  const sunDisc = makeSunDisc('#ffc27a');
  celestial.push(sunDisc);
  group.add(sunDisc); // was never in the scene graph — the disc could not render (r4)

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
    // fog fades toward the sky's horizon band, not a generic gray
    // (GRAPHICS_PLAN §1.4); FogExp2 density replaces the old linear near/far
    world.setFog(tod.skyBot, tod.fogDensity);
    world.scene.background.set(tod.skyBot);
    world.setExposure(tod.exposure);
    world.setEnvironment(tod.skyTop, tod.skyMid, tod.skyBot, tod.ground, { x: tod.sunRig[0], y: tod.sunRig[1], z: tod.sunRig[2] }); // grass bounce by day, near-black at night (r6); sun glint on paint (r7)
    groundMat.color.set(tod.grass); // cold desaturated grass at night (critic r7)
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
      v.coneMat.opacity = tod.cones; // r7: 0 in every TOD — the milky floating
      // cones are gone; the beam pool + SpotLight carry the road light alone
      v.beamPoolMat.opacity = tod.beam * 4.5; // pool lying ON the asphalt (r6/r7)
      v.tailMat.emissiveIntensity = tod.tail;
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
