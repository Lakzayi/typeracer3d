/* 🚤 River Rapids theme — a canyon river sprint: boats, animated water,
 * buoys as lane markers, cliffs, docks with lanterns. */

import * as THREE from 'three';
import { TRACK_LENGTH, mulberry32 } from '../world.js';
import { expK, canvasTexture, radialGlowTexture, makeLabel, stepVehicle, buildFinishGate, followPlayerSky, mergeStaticMeshes, createSkyDome, setSkyDome, makeGroundPBR, rampHex, applyFresnelEnv, jitterRock, superRing, loftSections, makeDunes, displaceGroundPlane } from './shared.js';

const LANES = [-4.4, -2.2, 0, 2.2, 4.4];

const TOD = {
  day: {
    // r11: sun moved INTO the frame. The chase cam looks 6.4° DOWN, so the
    // visible sky tops out near +24° elevation — a 29° sun (first attempt)
    // left the disc just off-frame. ~16° puts the disc in open sky below the
    // HUD bar; with the sun behind, no disc was ever visible in the main sky
    // while the mirror pass saw one — the r10 critic's #6 "consistency"
    // complaint; a forward sun also lights the canyon the way the photo shows.
    skyTop: '#3f7fd9', skyMid: '#7fb4e4', skyBot: '#b9d6ee',
    fogDensity: 0.0022, exposure: 1.0, sunRig: [-26, 16, -52], sunDisc: 1.0, envSun: 1.0,
    sunColor: '#fff2e0', sunIntensity: 2.5,
    hemiSky: '#cfe8ff', hemiGround: '#3c5a52', hemiIntensity: 0.5,
    // r11 water tint: PALE slate + metalness 0.9 — the specular F0 of a metal
    // is the albedo itself, so a dark blue albedo painted every grazing-angle
    // mirror dark blue (the r10 render's saturated far river). A pale tint
    // keeps the near-field slate and lets the far river mirror the SKY color.
    ambient: 0.0, lanterns: 0.0, stars: 0.0, water: '#8fb3c4', waterEnv: 1.35, navLights: 0.35,
    headlight: 0,
  },
  sunset: {
    // r11 DE-MARS pass: the r10 render read as one saturated orange filter —
    // sky mid #e8874a + fog #e09a66 + waterEnv 1.25 mirrored the orange env
    // over the WHOLE river (canyon, water, banks all went red-brown). A real
    // dusk river photo: slate-blue sky above, warm band ONLY at the horizon,
    // dark water, warm land in shade. Saturation down everywhere; the golden
    // path lives in the glitter stripe + env glint near the sun.
    // r13 (MED #1 again: the r12 disc still floated ~4° above the horizon and
    // its core still clipped toward cream): elevation 2.3° — the disc sits IN
    // the haze band at the waterline — uSunCore 1.7 with a deeper '#ff9c4a'
    // tint keeps the core AMBER (ACES maps 1.7×tint well below white), and the
    // upper sky drops to twilight values so the whole frame agrees.
    skyTop: '#1c2340', skyMid: '#a86a52', skyBot: '#f2b878', skyLow: '#ffd9a0',
    fog: '#c08a62', fogDensity: 0.0017, exposure: 0.85,
    sunRig: [-32, 2.6, -56], sunDisc: 0.9, sunCore: 1.7, sunTint: '#ff9c4a', envSun: 0.6,
    sunColor: '#ffb271', sunIntensity: 1.35,
    hemiSky: '#8f8090', hemiGround: '#33302e', hemiIntensity: 0.34,
    ambient: 0.0, lanterns: 0.6, stars: 0.3, water: '#6d8598', waterEnv: 0.8, navLights: 0.8,
    headlight: 14,
  },
  night: {
    skyTop: '#04060f', skyMid: '#0b1530', skyBot: '#1b3a66',
    fogDensity: 0.0030, exposure: 0.85, sunRig: [-22, 44, 30], sunDisc: 0, envSun: 0.12,
    sunColor: '#8fb0ff', sunIntensity: 0.65,
    hemiSky: '#35507c', hemiGround: '#152028', hemiIntensity: 0.9,
    ambient: 0.05, lanterns: 1.0, stars: 1.0, water: '#3d5a70', waterEnv: 1.3, navLights: 1.0,
    headlight: 160,
  },
};

/* paint = { primary: hull, secondary: racing stripe/sponsons/cabin roof, variant } —
 * variant 0 runabout · 1 hydro (wide sponson racer) · 2 cruiser (cabin) */
function buildBoat(paint, { player = false } = {}) {
  const P = typeof paint === 'string' ? { primary: paint, secondary: null, variant: 0 } : (paint ?? {});
  const color = P.primary ?? '#ff4757';
  const variant = P.variant ?? 0;
  const g = new THREE.Group();
  // variant wrapper — label sprite rides on g, unscaled
  const model = new THREE.Group();
  g.add(model);
  const add = (m) => model.add(m);
  const hullMat = new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.12, envMapIntensity: 0.7 });
  const stripeMat = P.secondary ? new THREE.MeshStandardMaterial({ color: P.secondary, roughness: 0.35, metalness: 0.15, envMapIntensity: 0.6 }) : null;
  const deckMat = new THREE.MeshStandardMaterial({ color: '#e8dcc4', roughness: 0.9 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#20242c', roughness: 0.8 });

  /* ---- hull: a real runabout loft (r12 modeling pass). Eight stations from
   * stem to transom; each ring runs keel → bilge → CHINE (hard turn, visible
   * strake line) → flared topside → gunwale, then mirrors. The gunwale heights
   * carry the SHEER LINE: highest at the bow, dipping amidships, sweeping
   * down to the stern — the silhouette that separates "boat" from "box". */
  const ST = [ // [z, halfWidth@gunwale, halfWidth@chine, yGun, yChine, yKeel]
    [-2.65, 0.03, 0.02, 0.78, 0.44, 0.42], // stem tip
    [-2.30, 0.30, 0.22, 0.74, 0.38, 0.28],
    [-1.80, 0.55, 0.44, 0.70, 0.34, 0.16],
    [-1.20, 0.72, 0.60, 0.70, 0.33, 0.10],
    [-0.50, 0.83, 0.72, 0.71, 0.33, 0.08],
    [0.30, 0.85, 0.75, 0.71, 0.33, 0.08],
    [1.00, 0.80, 0.71, 0.68, 0.34, 0.10],
    [1.75, 0.72, 0.64, 0.64, 0.36, 0.14],  // transom
  ];
  const hullRing = ([z, hg, hc, yg, yc, yk]) => {
    const fx = (hg + hc) / 2 + 0.03, fy = (yg + yc) / 2 + 0.02; // topside flare
    const bx = hc * 0.45, by = (yc + yk) / 2;                   // bilge
    return [
      [0, yk, z], [bx, by, z], [hc, yc, z], [fx, fy, z], [hg, yg, z],
      [-hg, yg, z], [-fx, fy, z], [-hc, yc, z], [-bx, by, z],
    ];
  };
  const hullMesh = new THREE.Mesh(
    loftSections(ST.map(hullRing), { capStart: true, capEnd: true }),
    hullMat
  );
  hullMesh.castShadow = true;
  add(hullMesh);

  // deck follows the sheer (crowned strips between the gunwales) — indexed
  // strip builder, one geometry, deckMat
  const deckPos = [], deckIdx = [];
  const DCOL = 5; // columns across (-1..1)
  for (let s = 0; s < ST.length; s++) {
    const [z, hg, , yg] = ST[s];
    for (let c = 0; c <= DCOL; c++) {
      const t = c / DCOL * 2 - 1; // -1 port … +1 starboard
      deckPos.push(t * (hg - 0.02), yg + 0.012 + (1 - Math.abs(t)) * 0.035, z);
    }
  }
  for (let s = 0; s < ST.length - 1; s++) {
    for (let c = 0; c < DCOL; c++) {
      const a = s * (DCOL + 1) + c, b = (s + 1) * (DCOL + 1) + c;
      deckIdx.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  const deckGeo = new THREE.BufferGeometry();
  deckGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(deckPos), 3));
  deckGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(deckPos.length / 3 * 2).fill(0.5), 2));
  deckGeo.setIndex(deckIdx);
  deckGeo.computeVertexNormals();
  const deckMesh = new THREE.Mesh(deckGeo, deckMat);
  deckMesh.castShadow = true;
  add(deckMesh);

  /* ---- dark trim: rub-rail tube along the sheer (both sides), outboard
   * motor (cowling + lower unit + tiller), windscreen frame, cleats — ONE
   * merged mesh (1 draw) */
  const trimParts = [];
  for (const side of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3(
      ST.map(([z, hg, , yg]) => new THREE.Vector3(side * (hg + 0.015), yg - 0.015, z))
    );
    trimParts.push(new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.032, 6), darkMat));
  }
  // outboard on the transom: cowling (rounded loft) + lower unit + tiller arm
  const cowl = new THREE.Mesh(loftSections([
    superRing(0, 1.0, 1.88, 0.17, 0.15, 2.5, 10),
    superRing(0, 1.06, 1.97, 0.20, 0.17, 2.5, 10),
    superRing(0, 1.08, 2.06, 0.18, 0.14, 2.5, 10),
  ], { capStart: true, capEnd: true }), darkMat);
  trimParts.push(cowl);
  const lowerUnit = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.55, 0.11), darkMat);
  lowerUnit.position.set(0, 0.72, 2.02);
  const skeg = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 0.16), darkMat);
  skeg.position.set(0, 0.42, 2.06);
  trimParts.push(lowerUnit, skeg);
  const tiller = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.4), darkMat);
  tiller.position.set(0.17, 1.02, 2.2);
  tiller.rotation.x = -0.5;
  trimParts.push(tiller);
  // framed windscreen: glass panel + top rail + side posts
  const frameBar = (w, h, d, x, y, z, rx = 0) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), darkMat);
    b.position.set(x, y, z); b.rotation.x = rx;
    return b;
  };
  trimParts.push(
    frameBar(0.98, 0.035, 0.035, 0, 1.075, -0.62, -0.18), // top rail
    frameBar(0.035, 0.34, 0.035, -0.5, 0.92, -0.585, -0.18), // port post
    frameBar(0.035, 0.34, 0.035, 0.5, 0.92, -0.585, -0.18),  // starboard post
    frameBar(0.9, 0.03, 0.05, 0, 0.76, -0.2), // console top edge
  );
  // bow cleats
  for (const cz of [-1.35]) {
    for (const cx of [-0.34, 0.34]) {
      const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.035), darkMat);
      cleat.position.set(cx, ST[2][3] + 0.05, cz);
      trimParts.push(cleat);
    }
  }
  const trimMesh = new THREE.Mesh(mergeStaticMeshes(trimParts), darkMat);
  trimMesh.castShadow = true;
  add(trimMesh);

  // windscreen glass — tilted panel inside the frame
  const shield = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.30, 0.025), new THREE.MeshStandardMaterial({ color: '#9fd8ff', roughness: 0.1, transparent: true, opacity: 0.85, envMapIntensity: 1.2 }));
  shield.position.set(0, 0.95, -0.6);
  shield.rotation.x = -0.18;
  add(shield);

  // console + bench seats on the deck (fore-aft cockpit layout)
  const seats = [];
  const bench1 = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.09, 0.34), deckMat);
  bench1.position.set(0, 0.80, 0.55);
  const bench2 = bench1.clone(); bench2.position.set(0, 0.79, 1.25);
  const benchBack = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.3, 0.07), deckMat);
  benchBack.position.set(0, 0.95, 1.42);
  const consoleBox = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.26, 0.36), deckMat);
  consoleBox.position.set(0, 0.87, -0.22);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.014, 6, 14), darkMat);
  wheel.position.set(0, 1.0, -0.4);
  wheel.rotation.x = 1.15;
  seats.push(bench1, bench2, benchBack, consoleBox);
  const seatsMesh = new THREE.Mesh(mergeStaticMeshes(seats), deckMat);
  seatsMesh.castShadow = true;
  add(seatsMesh); add(wheel);

  // tiny driver seated on the aft bench
  const driver = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.46, 0.26), new THREE.MeshStandardMaterial({ color: player ? '#ff4757' : '#2b3242', roughness: 0.9 }));
  torso.position.y = 0.25;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshStandardMaterial({ color: '#e6b98f', roughness: 0.9 }));
  head.position.y = 0.6;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: player ? '#ffffff' : '#39404e', roughness: 0.6 }));
  helmet.position.y = 0.64;
  driver.add(torso, head, helmet);
  driver.position.set(0, 0.88, 0.62);
  add(driver);

  // navigation lights (port red / starboard green) — shine at dusk/night
  const navMat = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.3 });
  const navL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), navMat('#ff5252'));
  navL.position.set(-0.62, 0.72, -1.55);
  const navR = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), navMat('#3ddc84'));
  navR.position.set(0.62, 0.72, -1.55);
  add(navL); add(navR);

  // only the player carries a real light (PLAN §1.2) — same contract as the
  // car. Rides ABOVE the deck so it reads as deck-lantern light; at deck
  // height it lit the water through the hull = "glowing from below" (r4)
  let light = null;
  if (player) {
    light = new THREE.PointLight('#ffeeb0', 0, 9, 2);
    light.position.set(0, 1.7, -1.6);
    add(light);
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
  wake.position.set(0, 0.455, 4.4);
  add(wake);

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
    new THREE.PlaneGeometry(2.6, 5.6),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.85, depthWrite: false })
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.set(0, 0.44, 0.3);
  add(contact);

  // r12 waterline foam ring (critic r11 LOW #9: idle hull read pasted onto
  // the surface) — a soft elliptical BAND hugging the hull sides, always on.
  // Band (not a filled disc) so it never washes out the contact shadow.
  const foamTex = canvasTexture((ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const nx = (x - w / 2) / (w / 2), ny = (y - h / 2) / (h / 2);
      const d = Math.hypot(nx, ny);
      const band = Math.max(0, 1 - Math.abs(d - 0.72) / 0.24); // soft ring
      const speck = Math.random() < 0.3 ? 0.55 + Math.random() * 0.45 : 0.85; // foam breakup
      const a = Math.pow(band, 1.6) * speck;
      const i = (y * w + x) * 4;
      img.data[i] = 242; img.data[i + 1] = 250; img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 210);
    }
    ctx.putImageData(img, 0, 0);
  }, 128, 128);
  const foamMat = new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 5.9), foamMat);
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(0, 0.428, 0.1);
  add(foam);

  // combo spray: burst cone behind the boat
  const sprayMat = new THREE.MeshBasicMaterial({ color: '#bfeaff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const spray = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.4, 8), sprayMat);
  spray.rotation.x = Math.PI / 2;
  spray.position.set(0, 0.6, 3.0);
  add(spray);

  /* ---- livery stripe: a tube hugging the sheer below the rub-rail, both
   * sides, in the SECONDARY color (runs the full length like real race boats) */
  if (stripeMat) {
    const stripeParts = [];
    for (const side of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3(
        ST.map(([z, hg, , yg]) => new THREE.Vector3(side * (hg - 0.03), yg - 0.085, z))
      );
      stripeParts.push(new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.045, 6), stripeMat));
    }
    const stripeMesh = new THREE.Mesh(mergeStaticMeshes(stripeParts), stripeMat);
    stripeMesh.castShadow = true;
    add(stripeMesh);
  }

  /* ---- hull variant ---- */
  if (variant === 1) { // hydro — widened race hull with bow sponsons
    model.scale.x = 1.12;
    const podParts = [];
    for (const sx of [-0.72, 0.72]) {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.20, 1.3), stripeMat ?? hullMat);
      pod.position.set(sx, 0.30, -1.35);
      const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.30, 10), stripeMat ?? hullMat);
      nose.rotation.z = Math.PI / 2;
      nose.position.set(sx, 0.30, -2.0);
      podParts.push(pod, nose);
    }
    const pods = new THREE.Mesh(mergeStaticMeshes(podParts), stripeMat ?? hullMat);
    pods.castShadow = true;
    add(pods);
  } else if (variant === 2) { // cruiser — pillhouse cabin amidships
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.5, 1.15), stripeMat ?? deckMat);
    cabin.position.set(0, 1.02, 0.3);
    cabin.castShadow = true;
    const cabinGlass = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.16, 0.92), darkMat);
    cabinGlass.position.set(0, 1.14, 0.05);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.05, 1.2), deckMat);
    roof.position.set(0, 1.28, 0.3);
    add(cabin);
    add(cabinGlass);
    add(roof);
  }

  return { group: g, wake, wakeMat, foamMat, spray, sprayMat, navL, navR, navMats: [navL.material, navR.material], light };
}

export function create(world, { racers, seed, timeOfDay = 'day' }) {
  const rng = mulberry32(seed);
  const group = new THREE.Group();
  let tod = TOD[timeOfDay] ?? TOD.day;

  /* ---------- banks & canyon ---------- */
  // sandy banks — seeded fbm albedo + normal relief (r10 realism pass; was one
  // flat #a68a5e plane). r11: macro patches (pale dry vs darker damp sand) so
  // the banks stop reading as one uniform tint
  const bankPBR = makeGroundPBR({
    seed: 61, octaves: 5, firstLattice: 4, gain: 0.55, normalStrength: 2.6,
    color: rampHex(['#8a7148', '#a68a5e', '#b59a6c', '#93794f']),
    rough: (h) => 0.9 + h * 0.08,
    macro: {
      seed: 613, firstLattice: 2, amount: 0.3,
      color: rampHex(['#7a6440', '#b09568', '#c2a878']),
    },
  });
  bankPBR.map.repeat.set(85, 360);
  bankPBR.normalMap.repeat.set(85, 360);
  bankPBR.roughMap.repeat.set(85, 360);
  // r13: GENTLE BANK UNDULATION — the r12 critic's "rocks' grounding relies on
  // symmetric dark base patches" was half a flat-plane problem: perfectly flat
  // sand makes every rock read as pasted on. ±1.3m dunes fading in from the
  // waterline (corridor + wet-sand strips stay flat); cliffs/poles ground via
  // the same bankY sampler
  const bankDunes = makeDunes(5170, { cell: 120, octaves: 3, gain: 0.55 });
  const bankFade = (x) => { // 0 at the waterline, full from |x|≈24
    const t = Math.min(1, Math.max(0, (Math.abs(x) - 7.5) / 16));
    return t * t * (3 - 2 * t);
  };
  const bankY = (x, z) => (bankDunes(x, z) - 0.5) * 2 * 1.3 * bankFade(x);
  const bankGeo = new THREE.PlaneGeometry(700, 3000, 72, 200);
  displaceGroundPlane(bankGeo, bankDunes, { amp: 1.3, fadeFn: bankFade });
  const banks = new THREE.Mesh(
    bankGeo,
    new THREE.MeshStandardMaterial({
      color: '#ffffff', map: bankPBR.map, normalMap: bankPBR.normalMap,
      roughnessMap: bankPBR.roughMap, roughness: 1, envMapIntensity: 0.2,
    })
  );
  banks.rotation.x = -Math.PI / 2;
  banks.position.set(0, 0.35, -TRACK_LENGTH / 2);
  banks.receiveShadow = true;
  group.add(banks);

  // the river — finer, subtler ripple ellipses: the old big dark blobs read
  // as paint stains (critic r5); r11: contrast halved again — with the
  // Fresnel env mirror carrying the realism, the stain layer must whisper
  const waterTex = canvasTexture((ctx, w, h) => {
    // opaque white base so the map multiplies to the water color instead of black
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 110; i++) {
      ctx.fillStyle = i % 3 ? 'rgba(255,255,255,0.07)' : 'rgba(18,58,68,0.03)';
      ctx.beginPath();
      ctx.ellipse(Math.random() * w, Math.random() * h, 5 + Math.random() * 14, 0.8 + Math.random() * 1.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 256, 256);
  waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
  waterTex.repeat.set(3, 60);
  // r11 water — Fresnel env rework (critic r10 #1 "too matte"):
  // • applyFresnelEnv (shared.js): specular IBL scaled by (1−N·V)^3.2 — the
  //   far river goes full sky-mirror while the near field keeps the dense
  //   water color; a uniform envMapIntensity cannot do both
  // • calmer baked ripples (strength 6.0→3.2, normalScale 0.6): the r10
  //   speckle read as noisy plastic; real river chop is subtle at this distance
  // • roughnessMap 0.05–0.15: tighter gloss band so glints stay crisp
  // r12 (critic r11 LOW #8: glints broke into salt-sprinkle blotches):
  // stretch 6 anisotropizes the fbm cells ALONG the river (texture v → world
  // z), so the roughness/ripple streaks — and therefore the sun glints —
  // elongate toward the viewer like a real glitter path instead of sprinkling
  const waterPBR = makeGroundPBR({
    seed: 9, octaves: 5, firstLattice: 3, gain: 0.6, stretch: 9, normalStrength: 3.2,
    color: () => [255, 255, 255], // albedo unused — metal tint comes from color
    rough: (h) => 0.05 + h * 0.1,
  });
  waterPBR.normalMap.repeat.set(7, 420);  // ~2.1m × 2.6m ripple tiles
  waterPBR.roughMap.repeat.set(7, 420);
  const waterMat = applyFresnelEnv(new THREE.MeshStandardMaterial({
    color: tod.water, roughness: 1, metalness: 0.9,
    map: waterTex, normalMap: waterPBR.normalMap, roughnessMap: waterPBR.roughMap,
    envMapIntensity: tod.waterEnv,
  }), { base: 0.32, rim: 0.68, exp: 4.0 });
  waterMat.normalScale.set(0.6, 0.6);
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

  // canyon cliffs — 90 rocks merged into ONE mesh (90 → 1 draw calls).
  // r11: base dropped toward gray-brown — under the orange sunset sun the old
  // #8a6f56 went full mars-red (part of the r10 "everything orange" failure).
  // Vertices jittered so the clean dodecahedra read as weathered rock.
  // r13: every cliff GROUNDED on the displaced bank (bankY at its x,z) so the
  // undulating sand genuinely wraps their bases
  const cliffMat = new THREE.MeshStandardMaterial({ color: '#77624e', roughness: 1, flatShading: true });
  const cliffMeshes = [];
  for (let i = 0; i < 90; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * (13 + rng() * 22);
    const z = 16 - rng() * (TRACK_LENGTH + 40);
    const s = 2.5 + rng() * 6;
    const rockGeo = jitterRock(new THREE.DodecahedronGeometry(s, 0), { amp: 0.22, seed: 40 + i });
    const rock = new THREE.Mesh(rockGeo, cliffMat);
    rock.position.set(x, 0.35 + bankY(x, z) + s * 0.55, z);
    rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    cliffMeshes.push(rock);
  }
  const cliffs = new THREE.Mesh(mergeStaticMeshes(cliffMeshes), cliffMat);
  cliffs.castShadow = true;
  group.add(cliffs);

  // r13 shore poles — mooring stakes driven into the sand near the waterline
  // on BOTH banks (MED #2: "the shoreline lacks directional cast shadows where
  // the eye expects long thin ones"). The near dock posts cast onto the METAL
  // water where a shadow is invisible (metalness 0.9 ≈ no diffuse), but these
  // stand on DIFFUSE sand: under the 13° sun a 2m pole lays a ~8m thin shadow.
  // One merged mesh (1 draw call, §1.3).
  const shorePoleMat = new THREE.MeshStandardMaterial({ color: '#5d4a33', roughness: 1 });
  const shorePoleParts = [];
  for (let i = 0; i < 16; i++) {
    const side = i % 2 ? 1 : -1;
    const px = side * (7.7 + rng() * 1.8);
    const pz = 8 - rng() * 260 - (i > 7 ? 260 : 0);
    const ph = 1.1 + rng() * 1.3;
    const pr = 0.16 + rng() * 0.08;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(pr * 0.75, pr, ph, 6), shorePoleMat);
    pole.position.set(px, 0.35 + bankY(px, pz) + ph / 2 - 0.12, pz);
    pole.rotation.z = side * (rng() * 0.09); // slight lean
    shorePoleParts.push(pole);
  }
  const shorePoles = new THREE.Mesh(mergeStaticMeshes(shorePoleParts), shorePoleMat);
  shorePoles.castShadow = true; // flags on the source parts do NOT survive the merge
  group.add(shorePoles);

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

  // buoys as lane dividers — TWO InstancedMeshes (bodies with per-instance
  // red/white color + poles). 152 buoys were 304 draw calls as Groups (3.6× the
  // §1.3 budget); instanced they are 2. Bobbing is re-composed per frame with
  // reused temporaries — no allocations (SPEC §1.3).
  const buoyGeo = new THREE.SphereGeometry(0.26, 8, 6);
  const buoyPoleGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.5, 4);
  const buoyMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 });
  const buoyPoleMat = new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.6 });
  const BUOY_N = 4 * Math.ceil((10 + TRACK_LENGTH) / 24);
  const buoyBodies = new THREE.InstancedMesh(buoyGeo, buoyMat, BUOY_N);
  const buoyPoles = new THREE.InstancedMesh(buoyPoleGeo, buoyPoleMat, BUOY_N);
  buoyBodies.frustumCulled = buoyPoles.frustumCulled = false; // spread over the whole track
  const buoyX = new Float32Array(BUOY_N), buoyZ = new Float32Array(BUOY_N);
  const buoyPhase = new Float32Array(BUOY_N);
  {
    const _bc = new THREE.Color();
    let bi = 0;
    for (const lx of [-3.3, -1.1, 1.1, 3.3]) {
      for (let z = 10; z > -TRACK_LENGTH; z -= 24) {
        buoyX[bi] = lx; buoyZ[bi] = z;
        buoyPhase[bi] = rng() * 10;
        _bc.set((Math.round(z / 24) % 2) ? '#e04848' : '#f2f2f2');
        buoyBodies.setColorAt(bi, _bc);
        bi++;
      }
    }
    buoyBodies.instanceColor.needsUpdate = true;
  }
  group.add(buoyBodies, buoyPoles);

  // docks with lanterns — static parts merged into 4 meshes total (was 40)
  const lampGlowTex = radialGlowTexture('#ffcf8a');
  const dockMat = new THREE.MeshStandardMaterial({ color: '#8a6a45', roughness: 1 });
  const poleMat = new THREE.MeshStandardMaterial({ color: '#5d4630', roughness: 1 });
  const lampHeadMat = new THREE.MeshBasicMaterial({ color: '#8b9099' });
  const poolMat = new THREE.MeshBasicMaterial({ map: lampGlowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const dockParts = [], postParts = [], headParts = [], poolParts = [];
  for (let i = 0; i < 10; i++) {
    const side = i % 2 ? 1 : -1;
    const z = -40 - i * (TRACK_LENGTH / 10) - rng() * 20;
    const dock = new THREE.Mesh(new THREE.BoxGeometry(5, 0.25, 3), dockMat);
    dock.position.set(side * 8.6, 0.5, z);
    dock.castShadow = true;
    // r13: post moved to the LAND side of the dock — on the water side its
    // shadow fell on the metal river plane where a shadow is invisible
    // (metalness 0.9 has ~no diffuse); on sand it lays a long thin shadow
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 4.2, 8), poleMat);
    post.position.set(side * 10.2, 2.45, z);
    post.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), lampHeadMat);
    head.position.set(side * 10.2, 4.7, z);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(10, 14), poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(side * 8.4, 0.46, z);
    dockParts.push(dock); postParts.push(post); headParts.push(head); poolParts.push(pool);
  }
  const docks = new THREE.Mesh(mergeStaticMeshes(dockParts), dockMat); docks.castShadow = true;
  const dockPosts = new THREE.Mesh(mergeStaticMeshes(postParts), poleMat); dockPosts.castShadow = true;
  const dockHeads = new THREE.Mesh(mergeStaticMeshes(headParts), lampHeadMat);
  const dockPools = new THREE.Mesh(mergeStaticMeshes(poolParts), poolMat);
  group.add(docks, dockPosts, dockHeads, dockPools);

  /* ---------- sky + stars + moon ---------- */
  // shader dome (shared.js) — skyLow carries the warm band just over the
  // horizon at sunset
  const sky = createSkyDome(620);
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
    const paint = r.paint ?? { primary: isPlayer ? '#ff4757' : botColors[i % botColors.length], secondary: null, variant: 0 };
    const color = paint.primary ?? '#ff4757';
    const boat = buildBoat(paint, { player: isPlayer });
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
    setSkyDome(sky, tod); // gradient + real sun disc at the sunRig azimuth

    // fog fades to the horizon band of the sky (GRAPHICS_PLAN §1.4)
    // fog can sit deeper than the sky's horizon band: a pastel-bright horizon
    // color AS fog veils the whole midground uniformly (r9 critic: sunset read
    // as one global orange filter) — themes may override with tod.fog
    world.setFog(tod.fog ?? tod.skyBot, tod.fogDensity);
    world.scene.background.set(tod.skyBot);
    world.setExposure(tod.exposure);
    // env gets the sun blob so the water shows a real specular glint at the
    // sun azimuth (r7) — envSun scales it (dim moon glint at night, r10 #5)
    world.setEnvironment(tod.skyTop, tod.skyMid, tod.skyBot, '#a68a5e', { x: tod.sunRig[0], y: tod.sunRig[1], z: tod.sunRig[2] }, tod.envSun); // bank bounce
    world.sunRig.set(tod.sunRig[0], tod.sunRig[1], tod.sunRig[2]);
    world.sun.color.set(tod.sunColor);
    world.sun.intensity = tod.sunIntensity;
    world.hemi.color.set(tod.hemiSky);
    world.hemi.groundColor.set(tod.hemiGround);
    world.hemi.intensity = tod.hemiIntensity;
    world.ambient.intensity = tod.ambient;
    // glitter stripe toward the sun azimuth, laid from the player outwards
    glitterDir.x = tod.sunRig[0] / Math.hypot(tod.sunRig[0], tod.sunRig[2]);
    glitterDir.z = tod.sunRig[2] / Math.hypot(tod.sunRig[0], tod.sunRig[2]);
    glitter.rotation.z = Math.atan2(glitterDir.x, glitterDir.z);
    glitter.material.opacity = name === 'sunset' ? 0.42 : 0; // focal glint path — on the darker r11 water it reads as THE sun path (critic r7)
    starMat.opacity = tod.stars;
    moonGlow.material.opacity = name === 'night' ? 0.5 : 0;
    moon.visible = name === 'night';
    waterMat.color.set(tod.water);
    waterMat.envMapIntensity = tod.waterEnv; // warm sky path on the water at sunset
    // reeds take the ambient tint: orange sunset warms them off pure green
    // (critic r5: reeds kept their day green under orange light)
    reedMat.color.set(name === 'sunset' ? '#5c5638' : name === 'night' ? '#2c3a2a' : '#4d7d3a');
    poolMat.opacity = tod.lanterns * 0.55;
    lampHeadMat.color.set(tod.lanterns > 0.3 ? '#ffe6b0' : '#8b9099');
    vehicles.forEach((v) => {
      v.navMats.forEach((m) => (m.opacity = tod.navLights));
      if (v.light) v.light.intensity = tod.headlight; // player only
    });
  }
  setTimeOfDay(timeOfDay);

  /* ---------- per-frame ---------- */
  // reused temporaries — update() must not allocate (SPEC §1.3)
  const _buoyM = new THREE.Matrix4();
  const _buoyQ = new THREE.Quaternion();
  const _buoyV = new THREE.Vector3();
  const _UNIT = new THREE.Vector3(1, 1, 1);
  const _ZAXIS = new THREE.Vector3(0, 0, 1);
  function update(dt, state) {
    if (!state) return;
    const now = performance.now();

    // sky rides along with the player (see followPlayerSky)
    followPlayerSky(celestial, vehicles[0]?.visZ ?? 0);

    // the glitter stripe leads from the boat toward the sun azimuth
    const p0 = vehicles[0]?.group.position;
    if (p0) glitter.position.set(p0.x + glitterDir.x * 145, 0.47, p0.z + glitterDir.z * 145);

    // flowing water + bobbing buoys — three layers scroll at different speeds
    // so the ripple normals shimmer against the stain albedo (r10 water pass)
    waterTex.offset.y -= dt * 0.06;
    waterMat.normalMap.offset.y -= dt * 0.11;
    waterMat.normalMap.offset.x += dt * 0.014;
    waterMat.roughnessMap.offset.y -= dt * 0.09;
    // bobbing buoys: one reused matrix per buoy, written into both instanced
    // meshes (body +0.22, pole +0.6 — the old Group offsets)
    for (let bi = 0; bi < BUOY_N; bi++) {
      const ph = buoyPhase[bi];
      const bobY = 0.42 + Math.sin(now / 500 + ph) * 0.09;
      _buoyQ.setFromAxisAngle(_ZAXIS, Math.sin(now / 650 + ph) * 0.12);
      _buoyM.compose(_buoyV.set(buoyX[bi], bobY + 0.22, buoyZ[bi]), _buoyQ, _UNIT);
      buoyBodies.setMatrixAt(bi, _buoyM);
      _buoyM.compose(_buoyV.set(buoyX[bi], bobY + 0.6, buoyZ[bi]), _buoyQ, _UNIT);
      buoyPoles.setMatrixAt(bi, _buoyM);
    }
    buoyBodies.instanceMatrix.needsUpdate = true;
    buoyPoles.instanceMatrix.needsUpdate = true;

    state.forEach((rs, i) => {
      const v = vehicles[i];
      if (!v) return;
      const { s01 } = stepVehicle(v, rs, dt, now, { bobAmp: 0.1, bobFreq: 55 });

      // wake grows with speed; a real boat idles with a visible wash even
      // stopped (0.16 floor so a stationary boat still reads as IN water)
      v.wakeMat.opacity = Math.max(0.16, Math.min(0.42, s01 * 0.42));
      v.wake.scale.set(0.8 + s01 * 0.6, 0.6 + s01 * 1.1, 1);
      // waterline foam ring breathes with the bob (idle hull stays IN the water)
      v.foamMat.opacity = 0.62 + Math.sin(now / 700 + v.wobble) * 0.12 + s01 * 0.15;
      const heat = rs.comboHeat ?? 0;
      const flicker = 0.8 + Math.random() * 0.35;
      v.spray.scale.set(0.5 + heat * 1.1, heat * flicker, 0.5 + heat * 1.1);
      v.sprayMat.opacity = Math.min(0.85, heat * 0.9);
    });
  }

  return { group, vehicles, update, finishZ: gateZ, setTimeOfDay };
}
