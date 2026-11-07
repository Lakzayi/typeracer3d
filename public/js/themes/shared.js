/* Shared helpers for all 3D themes (labels, textures, vehicle motion). */

import * as THREE from 'three';
import { TRACK_LENGTH } from '../world.js';

export const expK = (k, dt) => 1 - Math.exp(-k * dt);

export function canvasTexture(draw, w = 256, h = 128) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function radialGlowTexture(color = '#ffd9a0') {
  return canvasTexture((ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, color + 'cc');
    g.addColorStop(0.45, color + '33');
    g.addColorStop(1, color + '00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, 128, 128);
}

/* Low sun disc for sunset skies — the visible source behind the warm light
 * (SPEC §2: light must come from a visible source). Position it along the
 * theme's sunRig direction, fade opacity to 0 outside sunset.
 * A camera-facing Mesh plane (PlaneGeometry already faces the chase camera):
 * Sprites proved unreliable to rasterize in this environment (r4), Meshes
 * render deterministically. Normal-blended hot core + soft corona — pure
 * additive glow washes out against a bright sunset sky (critic r4). */
export function makeSunDisc(color = '#ffd9a0') {
  const tex = canvasTexture((ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, '#fff8ec');      // hot core — reads as the disc itself
    g.addColorStop(0.09, '#fff2d8');
    g.addColorStop(0.16, color + 'e6'); // warm corona
    g.addColorStop(0.38, color + '55');
    g.addColorStop(0.6, color + '18');
    g.addColorStop(1, color + '00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, 256, 256);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90),
    new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0,
      depthWrite: false, fog: false,
    })
  );
  mesh.renderOrder = 5; // after the sky dome, before HUD-ish overlays
  return mesh;
}

/* ---- static scenery merging ----------------------------------------------
 * This vendored three build never renders InstancedMesh into the shadow depth
 * pass (a regular Mesh at the same spot casts fine — verified in r4), so all
 * shadow-casting scenery is merged into single regular Meshes. Merging also
 * keeps each scenery family at one draw call (GRAPHICS_PLAN §6). */

const _mgV = new THREE.Vector3();
const _mgN = new THREE.Vector3();
const _mgM = new THREE.Matrix4();
const _mgNM = new THREE.Matrix3();

/* parts: [{ geo, matrix }] — emits one non-indexed BufferGeometry with
 * position/normal/uv, every part pre-transformed by its matrix. */
function mergeParts(parts) {
  let total = 0;
  for (const { geo } of parts) {
    const vc = geo.attributes.position.count;
    total += geo.index ? geo.index.count : vc;
  }
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uvs = new Float32Array(total * 2);
  let o = 0;
  for (const { geo, matrix } of parts) {
    const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
    const idx = geo.index;
    const count = idx ? idx.count : p.count;
    _mgNM.getNormalMatrix(matrix);
    for (let k = 0; k < count; k++) {
      const vi = idx ? idx.getX(k) : k;
      _mgV.fromBufferAttribute(p, vi).applyMatrix4(matrix);
      pos[(o + k) * 3] = _mgV.x; pos[(o + k) * 3 + 1] = _mgV.y; pos[(o + k) * 3 + 2] = _mgV.z;
      _mgN.fromBufferAttribute(n, vi).applyMatrix3(_mgNM).normalize();
      nor[(o + k) * 3] = _mgN.x; nor[(o + k) * 3 + 1] = _mgN.y; nor[(o + k) * 3 + 2] = _mgN.z;
      if (uv) { uvs[(o + k) * 2] = uv.getX(vi); uvs[(o + k) * 2 + 1] = uv.getY(vi); }
    }
    o += count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return g;
}

/* InstancedMesh → one merged geometry (instances baked in local space). */
export function mergeInstancedGeometry(im) {
  const parts = [];
  for (let i = 0; i < im.count; i++) {
    im.getMatrixAt(i, _mgM);
    parts.push({ geo: im.geometry, matrix: _mgM.clone() });
  }
  return mergeParts(parts);
}

/* Separate static Meshes → one merged geometry, meshes removed from parent.
 * Returns the geometry; caller wraps it in a Mesh with the shared material. */
export function mergeStaticMeshes(meshes) {
  const parts = [];
  for (const mesh of meshes) {
    mesh.updateMatrix();
    parts.push({ geo: mesh.geometry, matrix: mesh.matrix.clone() });
  }
  const g = mergeParts(parts);
  for (const mesh of meshes) {
    mesh.parent?.remove(mesh);
    mesh.geometry.dispose();
  }
  return g;
}

/* name + live wpm label above a vehicle */
export function makeLabel(name, colorCss) {
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

/* Generic per-frame vehicle motion: smooth z, bob, error wobble, labels.
 * Theme-specific animation (flames, legs, spray…) happens in the theme. */
export function stepVehicle(v, rs, dt, now, opts = {}) {
  const targetZ = -rs.progress01 * TRACK_LENGTH;
  v.visZ = (v.visZ ?? 0) + (targetZ - (v.visZ ?? 0)) * expK(9, dt);
  v.group.position.z = v.visZ;

  const s01 = rs.speed01 ?? 0;
  if (v.baseY === undefined) v.baseY = v.group.position.y;
  const bobAmp = opts.bobAmp ?? 0.05;
  const bobFreq = opts.bobFreq ?? 90;
  v.group.position.y = v.baseY + Math.abs(Math.sin(now / bobFreq + v.wobble)) * bobAmp * s01;
  v.group.rotation.z = Math.sin(now / 240 + v.wobble) * 0.015 * s01;
  if (rs.errorT > 0) {
    v.group.rotation.z += (Math.random() - 0.5) * 0.12;
    rs.errorT -= dt;
  }

  v.labelTimer = (v.labelTimer ?? 1) + dt;
  if (v.labelTimer > 0.35) {
    v.labelTimer = 0;
    v.updateLabel?.(
      `${Math.round(rs.wpm ?? 0)} wpm`,
      rs.finished ? 'finished' : `${Math.round(rs.progress01 * 100)}%`
    );
  }
  return { s01, spin: (s01 * 14 + 2) * dt };
}

/* Standard finish gate with custom banner text/color */
export function buildFinishGate(group, TRACK_LENGTH, { text = '🏁 FINISH 🏁', color = '#ffd75e', bg = '#0e1420' } = {}) {
  const gateZ = -TRACK_LENGTH;
  const pillarMat = new THREE.MeshStandardMaterial({ color: '#22262e', roughness: 0.7 });
  const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8, 0.7), pillarMat);
  p1.position.set(-7, 4, gateZ); p1.castShadow = true;
  const p2 = p1.clone(); p2.position.x = 7;
  group.add(p1, p2);
  const bannerTex = canvasTexture((ctx, w, h) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = color; ctx.font = '900 64px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);
  }, 512, 96);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(14.5, 2.4), new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide }));
  banner.position.set(0, 6.6, gateZ);
  group.add(banner);
  return gateZ;
}

/* Sky elements (dome, stars, moon, nebulas…) must ride along with the player —
 * the track is ~900 units long, so a skybox centered on the world origin would
 * be left behind around mid-track. Each object keeps its original z-offset
 * relative to the player, so it behaves like an infinitely-far backdrop. */
export function followPlayerSky(objects, anchorZ) {
  for (const o of objects) {
    if (!o) continue;
    if (o.userData.skyZ0 === undefined) o.userData.skyZ0 = o.position.z;
    o.position.z = anchorZ + o.userData.skyZ0;
  }
}
