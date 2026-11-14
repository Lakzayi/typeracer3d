/* 🐎 Wild West Ride theme — a dusty desert trail: galloping horses with
 * riders, cacti, mesas, fences, campfires at night, lantern poles. */

import * as THREE from 'three';
import { TRACK_LENGTH, mulberry32 } from '../world.js';
import { expK, canvasTexture, radialGlowTexture, makeLabel, stepVehicle, buildFinishGate, followPlayerSky, mergeInstancedGeometry, mergeStaticMeshes, createSkyDome, setSkyDome, makeGroundPBR, rampHex, makeDunes, displaceGroundPlane, loftSections, loftTube, jitterRock } from './shared.js';

const LANES = [-4.4, -2.2, 0, 2.2, 4.4];

// r12 modeling pass — real horse legs: the upper segment is a tapered loft
// (wider gaskin/forearm → slimmer knee) with a joint ball merged at the knee
// so the bend never shows a gap; the lower segment lofts cannon → fetlock and
// carries a dark hoof. Lower+hoof stay ONE geometry (pivot at the knee) —
// 4 legs × 2 draws per horse (SPEC §1.3 draw-call budget).
const UPPER_FRONT_GEO = loftTube([[0, 0, 0], [0, -0.46, 0.02]], [0.125, 0.085], 8);
const UPPER_HIND_GEO = loftTube([[0, 0, 0], [0, -0.46, 0.02]], [0.155, 0.09], 8);
{
  // knee ball caps the upper segment (inside coat material)
  for (const geo of [UPPER_FRONT_GEO, UPPER_HIND_GEO]) {
    const ball = new THREE.SphereGeometry(0.078, 8, 6);
    ball.translate(0, -0.45, 0.02);
    const merged = mergeStaticMeshes([new THREE.Mesh(geo), new THREE.Mesh(ball)]);
    geo.copy(merged);
    merged.dispose();
  }
}
const LOWER_GEO = loftTube([[0, -0.03, 0], [0, -0.3, 0.008], [0, -0.43, 0.024]], [0.062, 0.048, 0.042], 8);
const HOOF_GEO_T = new THREE.BoxGeometry(0.115, 0.1, 0.16);
HOOF_GEO_T.translate(0, -0.475, 0.028); // knee-local: hoof under the fetlock
const LEG_LOWER_GEO = mergeStaticMeshes([new THREE.Mesh(LOWER_GEO), new THREE.Mesh(HOOF_GEO_T)]);

/* cylinder strut between two points (reins, straps) — build-time helper */
function cylBetween(a, b, r) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 5));
  cyl.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  cyl.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize()
  );
  return cyl;
}

const TOD = {
  day: {
    // r10 #3: real blue up top (was washed pale gray) while the dusty warm
    // horizon band stays — high-desert look, fog thinned so midground keeps color
    skyTop: '#2e63b8', skyMid: '#6fa3d8', skyBot: '#ecd9b4',
    fogDensity: 0.0017, exposure: 1.0, sunRig: [32, 60, 20], sunDisc: 1.0, envSun: 1.0,
    sunColor: '#fff2e0', sunIntensity: 2.7,
    // r11: hemi 0.6→0.72 — the backlit horses (sun behind) went near-black
    // against the bright sand; a real backlit photo keeps shadow-side detail
    // from the sky dome
    hemiSky: '#d8e8ff', hemiGround: '#b08055', hemiIntensity: 0.72,
    ambient: 0.0, lanterns: 0.0, fires: 0.0, stars: 0.0, lanternLight: 0, fireLight: 0,
  },
  sunset: {
    skyTop: '#3a2468', skyMid: '#c25a4e', skyBot: '#ffb05a',
    fogDensity: 0.0026, exposure: 0.85, sunRig: [72, 9, 4], sunDisc: 0.9, sunCore: 2.6, sunTint: '#ffb06a', envSun: 0.7,
    sunColor: '#ff8a3d', sunIntensity: 1.75,
    hemiSky: '#f0a878', hemiGround: '#7a5238', hemiIntensity: 0.38,
    ambient: 0.0, lanterns: 0.6, fires: 0.7, stars: 0.25, lanternLight: 2.5, fireLight: 7,
  },
  night: {
    // near-black sky + near-black desert; pools live on the fixed lantern
    // poles and campfires only (critic r6: ground luma 41 vs refs 4–23)
    skyTop: '#03050c', skyMid: '#081020', skyBot: '#101f38',
    fogDensity: 0.0032, exposure: 0.78, sunRig: [-24, 46, 32], sunDisc: 0, envSun: 0.12,
    sunColor: '#8fb0ff', sunIntensity: 0.5,
    hemiSky: '#2a3f60', hemiGround: '#16130e', hemiIntensity: 0.55,
    // r12 (critic r11 LOW #11: lantern glowed but lit nothing): the player's
    // lantern now carries a real PointLight — it IS an emissive source, so a
    // small warm pool on the horse's flank + ground beneath is physical
    ambient: 0.04, lanterns: 1.0, fires: 1.0, stars: 1.0, lanternLight: 5, fireLight: 12,
  },
};

/* paint = { primary: coat color, secondary: blanket/shirt, variant } —
 * variant 0 warmblood · 1 racer (tall & lean) · 2 draft (heavy, feathered) */
function buildHorse(paint, { player = false } = {}) {
  const P = typeof paint === 'string' ? { primary: paint, secondary: null, variant: 0 } : (paint ?? {});
  const color = P.primary ?? '#7a4a26';
  const variant = P.variant ?? 0;
  const g = new THREE.Group();
  // variant wrapper — the whole horse rescales without touching the name
  // label sprite (which rides on g, not on model)
  const model = new THREE.Group();
  g.add(model);
  const add = (m) => model.add(m); // everything below lands inside the wrapper
  const coat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, envMapIntensity: 0.05 });
  const maneMat = new THREE.MeshStandardMaterial({ color: '#2a2019', roughness: 1, envMapIntensity: 0.05 });
  const skin = new THREE.MeshStandardMaterial({ color: '#e6b98f', roughness: 0.9 });
  const leather = new THREE.MeshStandardMaterial({ color: '#4a3120', roughness: 0.75, envMapIntensity: 0.1 });

  /* ---- barrel + masses (r12): a lathe with a real belly curve — deep chest,
   * slight belly drop, tucked flank — squashed width<depth like a real horse.
   * Shoulder and haunch masses are merged ellipsoids; neck is a lofted arc
   * (thick at the base, tapering to the poll) blending into a skull+muzzle
   * head. ALL coat parts merge into ONE mesh (§1.3). */
  const barrelProfile = [
    [0.30, -1.18], [0.40, -1.05], [0.455, -0.75], [0.435, -0.35],
    [0.46, 0.05], [0.50, 0.45], [0.465, 0.85], [0.30, 1.18],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const barrel = new THREE.Mesh(new THREE.LatheGeometry(barrelProfile, 14), coat);
  barrel.rotation.x = Math.PI / 2; // lathe axis Y → length axis Z (profile -y = chest → -z)
  barrel.scale.set(0.80, 1.12, 1); // narrower than deep — real equine cross-section
  barrel.position.y = 1.25;
  const chest = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), coat);
  chest.scale.set(0.32, 0.42, 0.40);
  chest.position.set(0, 1.28, -0.82);
  const haunch = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), coat);
  haunch.scale.set(0.35, 0.46, 0.52);
  haunch.position.set(0, 1.30, 0.85);
  // neck: arched loft tube — withers → crest → poll
  const neckGeo = loftTube(
    [[0, 1.5, -0.95], [0, 1.98, -1.32], [0, 2.44, -1.5], [0, 2.78, -1.46]],
    [0.30, 0.26, 0.19, 0.145], 10
  );
  // head: skull ellipsoid + tapered muzzle loft + ears, riding high & forward
  const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), coat);
  skull.scale.set(0.155, 0.175, 0.25);
  skull.position.set(0, 2.9, -1.58);
  skull.rotation.x = -0.25;
  const muzzleGeo = loftTube([[0, 2.88, -1.72], [0, 2.8, -1.98]], [0.115, 0.08], 8);
  const earGeo = new THREE.ConeGeometry(0.055, 0.17, 5);
  const earL = new THREE.Mesh(earGeo, coat);
  earL.position.set(-0.085, 3.08, -1.4);
  earL.rotation.set(-0.25, 0, 0.3);
  const earR = earL.clone(); earR.position.x = 0.085; earR.rotation.z = -0.3;
  const coatMesh = new THREE.Mesh(
    mergeStaticMeshes([barrel, chest, haunch, new THREE.Mesh(neckGeo), skull,
      new THREE.Mesh(muzzleGeo), earL, earR]),
    coat
  );
  coatMesh.castShadow = true;
  add(coatMesh);

  // eyes — two dark beads (read at chase-cam distance, give the head a face)
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.026, 6, 4), maneMat);
  eyeL.position.set(-0.13, 2.93, -1.66);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.13;

  /* ---- mane: layered strands along the crest (alternating offsets break the
   * comb-strip look) + forelock between the ears + eyes merged in (dark) */
  const maneParts = [eyeL, eyeR];
  const strand = [[0, 1.72, -1.1], [0, 2.02, -1.3], [0, 2.28, -1.42], [0, 2.52, -1.47], [0, 2.72, -1.46]];
  strand.forEach(([x, y, z], i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.36, 0.15), maneMat);
    m.position.set(x, y, z);
    m.rotation.x = 0.9;
    m.rotation.z = (i % 2 ? 1 : -1) * 0.06;
    m.position.z += (i % 2 ? 1 : -1) * 0.015;
    maneParts.push(m);
  });
  const forelock = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.2, 0.09), maneMat);
  forelock.position.set(0, 2.98, -1.5);
  forelock.rotation.x = -0.5;
  maneParts.push(forelock);
  const maneMesh = new THREE.Mesh(mergeStaticMeshes(maneParts), maneMat);
  maneMesh.castShadow = true;
  add(maneMesh);

  /* ---- tail: docked bone (coat-less, dark) + three layered hair slabs that
   * fall with a slight rearward arc; hangs from the dock and swishes gently */
  const tail = new THREE.Group();
  const tailBone = loftTube([[0, 0, 0], [0, -0.18, 0.06]], [0.085, 0.055], 8);
  const hairA = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.62, 0.12), maneMat);
  hairA.position.set(0, -0.4, 0.06); hairA.rotation.x = 0.18;
  const hairB = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.8, 0.10), maneMat);
  hairB.position.set(0, -0.5, 0.11); hairB.rotation.x = 0.32;
  const hairC = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.66, 0.08), maneMat);
  hairC.position.set(0.03, -0.42, 0.16); hairC.rotation.x = 0.46;
  tail.add(new THREE.Mesh(mergeStaticMeshes([new THREE.Mesh(tailBone), hairA, hairB, hairC]), maneMat));
  tail.position.set(0, 1.6, 1.1);
  tail.rotation.x = 0.2;
  add(tail);

  /* ---- legs: tapered upper (with knee ball) + dark lower+hoof, two-segment
   * gait as before (§5.3) */
  const legs = [];
  const lowers = [];
  const legDefs = [
    [-0.26, -0.78, UPPER_FRONT_GEO], [0.26, -0.78, UPPER_FRONT_GEO],
    [-0.26, 0.88, UPPER_HIND_GEO], [0.26, 0.88, UPPER_HIND_GEO],
  ];
  for (const [x, z, uGeo] of legDefs) {
    const leg = new THREE.Mesh(uGeo, coat);
    leg.position.set(x, 1.04, z);
    leg.rotation.z = x < 0 ? -0.05 : 0.05; // slight outward splay — vertical pillars read as sticks (r9)
    const lower = new THREE.Mesh(LEG_LOWER_GEO, maneMat); // dark lower = visible joint
    lower.position.set(0, -0.47, 0.02);
    lower.rotation.x = 0.3; // standing knee bend so the joint breaks the leg line (r9)
    leg.add(lower);
    leg.castShadow = true;
    add(leg);
    legs.push(leg);
    lowers.push(lower);
  }

  /* ---- tack: blanket (rider shirt material — dims with the TOD together),
   * saddle seat + pommel + cantle + girth ring + stirrups + reins.
   * The blanket/shirt carries the livery's SECONDARY color. */
  const shirtMat = new THREE.MeshStandardMaterial({ color: P.secondary ?? (player ? '#ffd75e' : '#3a4a6b'), roughness: 0.9, envMapIntensity: 0.15 });
  shirtMat.userData.base = shirtMat.color.clone(); // per-TOD dim (night fill below)
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.05, 0.66), shirtMat);
  blanket.position.set(0, 1.77, 0.12);
  blanket.castShadow = true;
  add(blanket); // own draw (shirtMat is TOD-dimmed, so it can't join leather)
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.09, 0.5), leather);
  seat.position.set(0, 1.84, 0.14);
  const pommel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.09), leather);
  pommel.position.set(0, 1.89, -0.09);
  const cantle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.07), leather);
  cantle.position.set(0, 1.88, 0.42);
  const girth = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.024, 6, 20), leather);
  girth.position.set(0, 1.25, 0.18);
  girth.scale.set(0.82, 1.18, 1); // hugs the barrel cross-section
  const stirrupParts = [seat, pommel, cantle, girth];
  for (const sx of [-0.32, 0.32]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.34, 0.03), leather);
    strap.position.set(sx, 1.66, 0.16);
    const stirrup = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.05), leather);
    stirrup.position.set(sx, 1.45, 0.16);
    stirrupParts.push(strap, stirrup);
  }
  // reins: bit → rider hands (rider sits at (0, 1.86, 0.16), hands forward)
  stirrupParts.push(
    cylBetween([0, 2.78, -1.52], [-0.09, 2.28, -0.02], 0.012),
    cylBetween([0, 2.78, -1.52], [0.09, 2.28, -0.02], 0.012),
  );
  const leatherMesh = new THREE.Mesh(mergeStaticMeshes(stirrupParts), leather);
  leatherMesh.castShadow = true;
  add(leatherMesh);

  // rider (tiny cowboy) — sits ON the saddle now; arms reach the reins
  const rider = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.55, 0.26), shirtMat);
  torso.position.y = 0.28;
  const headR = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), skin);
  skin.userData.base = skin.color.clone();
  headR.position.y = 0.68;
  const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 10), maneMat);
  hatBrim.position.y = 0.78;
  const hatTop = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.16, 10), maneMat);
  hatTop.position.y = 0.87;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.07), maneMat);
  armL.position.set(-0.16, 0.38, -0.12);
  armL.rotation.x = -0.9;
  const armR = armL.clone(); armR.position.x = 0.16;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.15), maneMat);
  legL.position.set(-0.13, 0.05, 0.05);
  const legR = legL.clone(); legR.position.x = 0.13;
  rider.add(torso, headR,
    new THREE.Mesh(mergeStaticMeshes([hatBrim, hatTop, armL, armR, legL, legR]), maneMat));
  rider.position.set(0, 1.86, 0.16);
  add(rider);

  // player lantern — real light that lights the trail at night
  const lantern = new THREE.Group();
  // dark lantern housing with a TOD-tied emissive core — a Basic yellow box
  // stayed sun-bright even at noon, reading as a floating yellow quad beside
  // the flank (r9 critic)
  const cage = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.14),
    new THREE.MeshStandardMaterial({ color: '#4a3d2e', roughness: 0.7, emissive: '#ffb84d', emissiveIntensity: 0 }));
  const lanternLight = new THREE.PointLight('#ffbb55', 0, 9, 2);
  lantern.add(cage, lanternLight);
  lantern.position.set(-0.45, 2.12, 0.2);
  add(lantern);

  // dust puff behind hooves (speed) — grows with combo heat
  const dustTex = radialGlowTexture('#c9a76a');
  const dustMat = new THREE.SpriteMaterial({ map: dustTex, transparent: true, opacity: 0, depthWrite: false });
  const dust = new THREE.Sprite(dustMat);
  dust.scale.set(2.4, 1.4, 1);
  dust.position.set(0, 0.5, 1.9);
  add(dust);

  /* ---- breed variant: rescale the whole model (label on g stays 1:1).
   * racer — tall, lean, leggy · draft — heavy body + feathered lower legs */
  if (variant === 1) {
    model.scale.set(0.90, 1.06, 1.04);
  } else if (variant === 2) {
    model.scale.set(1.12, 0.98, 1.06);
    for (const leg of legs) { // feather tufts above the hooves
      const tuft = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.2, 0.13), maneMat);
      tuft.position.set(0, -0.72, 0.02);
      leg.add(tuft);
    }
  }

  return { group: g, legs, lowers, tail, dust, dustMat, lanternLight, cage, riderMats: [shirtMat, skin] };
}

export function create(world, { racers, seed, timeOfDay = 'day' }) {
  const rng = mulberry32(seed);
  const group = new THREE.Group();
  let tod = TOD[timeOfDay] ?? TOD.day;

  /* ---------- desert ---------- */
  // desert sand — seeded fbm albedo with anisotropic (track-direction) ripple
  // normal map: real dune micro-relief + tonal breakup instead of painted
  // blotches (critic r6: uniform luma-185 floor; r10 realism pass). r11:
  // macro dry-grass patches + ±2.4m dune VERTEX DISPLACEMENT beyond the
  // corridor — the r10 render's perfectly straight ground/sky horizon was the
  // single biggest "not a photo" tell left in this theme.
  const sandPBR = makeGroundPBR({
    seed: 77, octaves: 5, firstLattice: 4, gain: 0.55, stretch: 2.5, normalStrength: 3.5,
    color: rampHex(['#c39a5e', '#d9b070', '#e3c184', '#caa268']),
    rough: (h) => 0.88 + h * 0.1,
    macro: {
      seed: 773, firstLattice: 2, amount: 0.34,
      color: rampHex(['#a8884e', '#d8bc7c', '#c2a260']),
    },
  });
  sandPBR.map.repeat.set(110, 480);      // ~6.4m tile → 1.6m ripples → 20cm grains
  sandPBR.normalMap.repeat.set(110, 480);
  sandPBR.roughMap.repeat.set(110, 480);
  const dunes = makeDunes(9150, { cell: 130, octaves: 3, gain: 0.55 });
  const duneFade = (x) => { // 0 across the play corridor + prop band, full beyond 43
    const t = Math.min(1, Math.max(0, (Math.abs(x) - 13) / 30));
    return t * t * (3 - 2 * t);
  };
  const duneY = (x, z) => (dunes(x, z) - 0.5) * 2 * 2.4 * duneFade(x);
  const sandGeo = new THREE.PlaneGeometry(700, 3000, 48, 160);
  displaceGroundPlane(sandGeo, dunes, { amp: 2.4, fadeFn: duneFade });
  const sand = new THREE.Mesh(
    sandGeo,
    new THREE.MeshStandardMaterial({
      color: '#ffffff', map: sandPBR.map, normalMap: sandPBR.normalMap,
      roughnessMap: sandPBR.roughMap, roughness: 1, envMapIntensity: 0.15,
    })
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.z = -TRACK_LENGTH / 2;
  sand.receiveShadow = true;
  group.add(sand);

  // the trail — packed-earth variant: darker, redder, slightly smoother than
  // loose sand, so the corridor reads as a worn track (r10 realism pass).
  // r11: macro patches of darker compressed dirt
  const trailPBR = makeGroundPBR({
    seed: 31, octaves: 5, firstLattice: 4, gain: 0.55, normalStrength: 2.5,
    color: rampHex(['#9a7140', '#b58a55', '#c49a62', '#a87e4c']),
    rough: (h) => 0.82 + h * 0.12,
    macro: {
      seed: 313, firstLattice: 3, amount: 0.3,
      color: rampHex(['#8a6438', '#c09a60', '#a8824e']),
    },
  });
  trailPBR.map.repeat.set(7, 480);       // ~1.9m tile
  trailPBR.normalMap.repeat.set(7, 480);
  trailPBR.roughMap.repeat.set(7, 480);
  const trail = new THREE.Mesh(
    new THREE.PlaneGeometry(13.4, TRACK_LENGTH + 160),
    new THREE.MeshStandardMaterial({
      color: '#ffffff', map: trailPBR.map, normalMap: trailPBR.normalMap,
      roughnessMap: trailPBR.roughMap, roughness: 1, envMapIntensity: 0.15,
    })
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
  // r12: VERTICAL RIBS — the flutes are in the cross-section (radius modulated
  // by cos 7θ), which breaks the smooth-plastic cylinder shading that made
  // props read flat (critic r11 LOW #10). Every part is merged into ONE mesh.
  // r11: each cactus is GROUNDED on the dune field (duneY at its x,z).
  const cactusMat = new THREE.MeshStandardMaterial({ color: '#497a4a', roughness: 1 });
  const cactusMatB = new THREE.MeshStandardMaterial({ color: '#5c8a50', roughness: 1 }); // r13: two-tone
  // rings wind CW seen from +Y (=-sin a) so wall normals face outward for a
  // +Y loft (see loftSections note)
  const ribbedTube = (h, r0, r1) => {
    const rings = [];
    for (const [t, r] of [[0, r0], [0.55, Math.max(r0, r1)], [0.88, r1], [1, r1 * 0.45]]) {
      const ring = [];
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const rr = r * (1 + 0.085 * Math.cos(a * 7));
        ring.push([Math.cos(a) * rr, t * h - h / 2, -Math.sin(a) * rr]);
      }
      rings.push(ring);
    }
    return loftSections(rings, { capStart: true, capEnd: true });
  };
  const cactusParts = [[], []]; // r13: two material groups → 2 draws
  for (let i = 0; i < 70; i++) {
    const side = rng() > 0.5 ? 1 : -1;
    const x = side * (12 + rng() * 40);
    const z = 16 - rng() * (TRACK_LENGTH + 30);
    const h = 1.6 + rng() * 2.2;
    const dY = duneY(x, z);
    const g = i % 2; // alternate the two greens for natural variety
    const trunk = new THREE.Mesh(ribbedTube(h, 0.28, 0.21), g ? cactusMatB : cactusMat);
    trunk.position.set(x, h / 2 + dY, z);
    cactusParts[g].push(trunk);
    const nArms = rng() > 0.5 ? 2 : 1;
    for (let a = 0; a < nArms; a++) {
      const armSide = a === 0 ? 1 : -1;
      const armY = h * (0.45 + rng() * 0.25);
      // horizontal elbow, then vertical forearm (saguaro silhouette)
      const elbow = new THREE.Mesh(ribbedTube(0.44, 0.15, 0.13), g ? cactusMatB : cactusMat);
      elbow.rotation.z = armSide * Math.PI / 2;
      elbow.position.set(x + armSide * 0.42, armY + dY, z);
      const fore = new THREE.Mesh(ribbedTube(h * 0.32, 0.14, 0.12), g ? cactusMatB : cactusMat);
      fore.position.set(x + armSide * 0.6, armY + h * 0.16 + dY, z);
      cactusParts[g].push(elbow, fore);
    }
  }
  for (const parts of cactusParts) {
    const mesh = new THREE.Mesh(mergeStaticMeshes(parts), parts === cactusParts[0] ? cactusMat : cactusMatB);
    mesh.castShadow = true;
    group.add(mesh);
  }

  // r13 desert rocks — noise-jittered boulders grounded on the dune field
  // (props shaded flat, critic LOW #10: broken silhouettes + real shadows)
  const desertRockMat = new THREE.MeshStandardMaterial({ color: '#8a6f52', roughness: 1, flatShading: true });
  const desertRockParts = [];
  for (let i = 0; i < 18; i++) {
    const side = rng() > 0.5 ? 1 : -1;
    const bx = side * (9.5 + rng() * 26);
    const bz = 10 - rng() * (TRACK_LENGTH + 30);
    const s = 0.4 + rng() * 1.3;
    const rock = new THREE.Mesh(jitterRock(new THREE.DodecahedronGeometry(s, 0), { amp: 0.3, seed: 610 + i, freq: 2.8 }), desertRockMat);
    rock.position.set(bx, duneY(bx, bz) + s * 0.5, bz);
    rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    desertRockParts.push(rock);
  }
  const desertRocks = new THREE.Mesh(mergeStaticMeshes(desertRockParts), desertRockMat);
  desertRocks.castShadow = true;
  group.add(desertRocks);

  // mesas on the horizon — r12: real butte profiles via a lofted ring stack
  // (steep skirt → bench → flat cap) with a per-angle plan wobble, replacing
  // the stacked-box look (props read flat, critic r11 LOW #10). All 10 merge
  // into 2 meshes by material (10 → 2 draws, §1.3).
  const mesaMats = [];
  const mesaBase = ['#b5714a', '#a3654a'];
  const mesaParts = [[], []];
  const mesaWobble = [];
  for (let i = 0; i < 10; i++) {
    const side = i % 2 ? 1 : -1;
    const w = 30 + rng() * 40, h = 18 + rng() * 26, d = 20 + rng() * 30;
    const rings = [];
    const prof = [[0.0, 1.1], [0.4, 1.0], [0.68, 0.86], [0.78, 0.64], [1.0, 0.6]];
    mesaWobble.length = 0;
    for (let k = 0; k < 16; k++) mesaWobble.push(0.85 + rng() * 0.32); // shared plan wobble
    for (const [t, s] of prof) {
      const ring = [];
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const wb = mesaWobble[k];
        ring.push([Math.cos(a) * (w / 2) * s * wb, t * h, -Math.sin(a) * (d / 2) * s * wb]);
      }
      rings.push(ring);
    }
    const mesh = new THREE.Mesh(loftSections(rings, { capStart: true, capEnd: true }));
    const mx = side * (120 + rng() * 160), mz = -rng() * TRACK_LENGTH;
    mesh.position.set(mx, duneY(mx, mz), mz); // grounded on the dune field (r11)
    mesh.rotation.y = rng() * 3;
    mesaParts[i % 2].push(mesh);
  }
  for (let mi = 0; mi < 2; mi++) {
    const mat = new THREE.MeshStandardMaterial({ color: mesaBase[mi], roughness: 1, flatShading: true });
    mesaMats.push(mat);
    group.add(new THREE.Mesh(mergeStaticMeshes(mesaParts[mi]), mat));
  }

  // telegraph poles — all 12 poles+crossbars merge into ONE mesh (24 → 1)
  const teleMat = new THREE.MeshStandardMaterial({ color: '#4f3a26', roughness: 1, envMapIntensity: 0.15 });
  const teleParts = [];
  for (let i = 0; i < 12; i++) {
    const side = i % 2 ? 1 : -1;
    const z = -30 - i * (TRACK_LENGTH / 12);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 6, 6), teleMat);
    pole.position.set(side * 12, 3, z);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.1), teleMat);
    bar.position.set(side * 12, 5.4, z);
    pole.castShadow = bar.castShadow = true;
    teleParts.push(pole, bar);
  }
  const telegraph = new THREE.Mesh(mergeStaticMeshes(teleParts), teleMat);
  telegraph.castShadow = true;
  group.add(telegraph);

  // wooden roadside signs
  const slogans = ['GIDDY UP!', '🐎 no saddle, no glory', 'Wild West Ride', '🚤 boats SOON', '🚀 rockets SOON', 'yeehaw = wpm'];
  const signPostMat = postMat;
  const signPostParts = [];
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
    group.add(board);
    signPostParts.push(post);
  }
  const signPosts = new THREE.Mesh(mergeStaticMeshes(signPostParts), signPostMat);
  signPosts.castShadow = true;
  group.add(signPosts);

  /* ---------- campfires (night soul of the desert) ---------- */
  // logs merge into one mesh and glow discs share one material + one mesh.
  // r11: the 8 flame cones merge into ONE mesh too (they were 8 draws with
  // identical opacity; never two fires in frame at once, so a shared flicker
  // via the material reads the same) — §1.3 budget.
  const fireGlowTex = radialGlowTexture('#ff9b3d');
  const fires = [];
  const logMat = new THREE.MeshStandardMaterial({ color: '#4a3320', roughness: 1 });
  const flameMat = new THREE.MeshBasicMaterial({ color: '#ff9b3d', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const fireGlowMat = new THREE.MeshBasicMaterial({ map: fireGlowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const logParts = [], glowParts = [], flameParts = [];
  for (let i = 0; i < 8; i++) {
    const side = i % 2 ? 1 : -1;
    const z = -60 - i * (TRACK_LENGTH / 8) - rng() * 30;
    const fx = side * 10.5;
    for (let j = 0; j < 3; j++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 5), logMat);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = (j * Math.PI) / 3;
      log.position.set(fx, 0.12, z);
      log.castShadow = true;
      logParts.push(log);
    }
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), fireGlowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(fx, 0.05, z);
    glowParts.push(glow);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.1, 7), flameMat);
    flame.position.set(fx, 0.65, z);
    flameParts.push(flame);
    fires.push({ position: new THREE.Vector3(fx, 0, z), phase: rng() * 10 });
  }
  const fireLogs = new THREE.Mesh(mergeStaticMeshes(logParts), logMat);
  const fireGlows = new THREE.Mesh(mergeStaticMeshes(glowParts), fireGlowMat);
  const fireFlames = new THREE.Mesh(mergeStaticMeshes(flameParts), flameMat);
  group.add(fireLogs, fireGlows, fireFlames);

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
  // shader dome (shared.js): real blue zenith + dusty warm horizon band
  const sky = createSkyDome(620);
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
  // Standard, not Basic — a self-lit checkerboard was the brightest ground
  // element at night (r11: matches car.js' lit start line)
  const startLine = new THREE.Mesh(new THREE.PlaneGeometry(13.4, 1.6), new THREE.MeshStandardMaterial({ map: startTex, roughness: 0.9 }));
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
    const paint = r.paint ?? { primary: isPlayer ? '#7a4a26' : botColors[(i - 1 + botColors.length) % botColors.length], secondary: null, variant: 0 };
    const color = paint.primary ?? '#7a4a26';
    const horse = buildHorse(paint, { player: isPlayer });
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
    setSkyDome(sky, tod); // blue zenith + dusty horizon + real sun disc

    // fog fades to the horizon band of the sky (GRAPHICS_PLAN §1.4)
    world.setFog(tod.skyBot, tod.fogDensity);
    world.scene.background.set(tod.skyBot);
    world.setExposure(tod.exposure);
    world.setEnvironment(tod.skyTop, tod.skyMid, tod.skyBot, '#d9b070', { x: tod.sunRig[0], y: tod.sunRig[1], z: tod.sunRig[2] }, tod.envSun); // sand bounce
    world.sunRig.set(tod.sunRig[0], tod.sunRig[1], tod.sunRig[2]);
    world.sun.color.set(tod.sunColor);
    world.sun.intensity = tod.sunIntensity;
    world.hemi.color.set(tod.hemiSky);
    world.hemi.groundColor.set(tod.hemiGround);
    world.hemi.intensity = tod.hemiIntensity;
    world.ambient.intensity = tod.ambient;
    fireLight.userData.base = tod.fireLight;
    mesaMats.forEach((m, i) => {
      if (name === 'night') m.color.set(i % 2 ? '#241a12' : '#1e1610');
      else m.color.set(mesaBase[i % 2]);
    });
    pools.forEach((p) => (p.material.opacity = tod.lanterns * 0.55));
    lampHeadMat.color.set(tod.lanterns > 0.3 ? '#ffe6b0' : '#8b9099');
    // the lamp head is an emitting surface: let it punch through tone mapping
    // at night — brightest element of the night scene (critic r5)
    lampHeadMat.toneMapped = tod.lanterns <= 0.3;
    flameMat.opacity = tod.fires * 0.9;
    fireFlames.visible = tod.fires > 0.01; // skip the draw call entirely by day
    fireGlowMat.opacity = tod.fires * 0.5; // merged glow disc (one material)
    fireGlows.visible = tod.fires > 0.01;
    // opacity-0 objects still cost a draw call — gate them instead (§1.3)
    starMat.opacity = tod.stars;
    stars.visible = tod.stars > 0.01;
    moonGlow.material.opacity = name === 'night' ? 0.5 : 0;
    moonGlow.visible = name === 'night';
    moon.visible = name === 'night';
    vehicles.forEach((v) => {
      // r12: the lantern cage is itself an emissive source now, so the light
      // riding with it is physical (critic r11 LOW #11) — no more halo with
      // no illumination
      v.lanternLight.intensity = tod.lanternLight ?? 0;
      // the cage is invisible in full daylight (unlit lantern prop — also saves
      // 5 draw calls in the day scene, §1.3) and glows only when dark (r9)
      v.cage.visible = tod.lanterns > 0.05;
      v.cage.material.emissiveIntensity = tod.lanterns * 1.4;
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

    // campfire flicker — the merged flame mesh breathes via its material
    // (per-flame scale flicker was dropped with the r11 merge; fires are ≥60
    // units apart so never two flames share the frame)
    if (fireFlames.visible) {
      flameMat.opacity = tod.fires * 0.9 * (0.88 + Math.sin(now / 90) * 0.09 + Math.random() * 0.05);
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
        fireLight.intensity = fireLight.userData.base * (0.85 + Math.sin(now / 90 + best.phase) * 0.1);
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
      v.tail.rotation.x = 0.25 + Math.sin(now / 300 + v.wobble) * 0.12; // gentle swish (tail now hangs from the dock)

      // dust: speed + combo heat
      const heat = rs.comboHeat ?? 0;
      const puff = Math.min(1, s01 * 0.55 + heat * 0.7);
      v.dustMat.opacity = puff * 0.55;
      v.dust.scale.set(2 + puff * 2.6, 1.2 + puff * 1.6, 1);
    });
  }

  return { group, vehicles, update, finishZ: gateZ, setTimeOfDay };
}
