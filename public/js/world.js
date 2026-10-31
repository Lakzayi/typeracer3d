/* Three.js world: renderer, lights, chase camera + rearview mirror, effects
 * (speed streaks, error shake, finish confetti). Themes plug in via create()
 * and provide vehicles + scenery; the world owns the cameras and rendering. */

import * as THREE from 'three';

export const TRACK_LENGTH = 900;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const expK = (k, dt) => 1 - Math.exp(-k * dt); // framerate-independent smoothing

export class World {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#8fc3ea');
    this.scene.fog = new THREE.Fog('#8fc3ea', 140, 560);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1200);
    this.camera.position.set(0, 5, 12);

    // rearview mirror camera
    this.rearCam = new THREE.PerspectiveCamera(56, 4, 0.1, 500);
    this.mirrorEnabled = true;

    const hemi = new THREE.HemisphereLight('#cfe8ff', '#5a7050', 0.9);
    this.scene.add(hemi);
    this.ambient = new THREE.AmbientLight('#ffffff', 0.0);
    this.scene.add(this.ambient);
    const sun = new THREE.DirectionalLight('#fff4d6', 1.6);
    sun.position.set(30, 60, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
    sun.shadow.camera.far = 220;
    this.scene.add(sun);
    this.sun = sun;
    this.hemi = hemi;

    this.themeGroup = null;
    this.theme = null;
    this.focusIdx = 0;
    this.speed01 = 0;          // raw target speed
    this.smoothSpeed01 = 0;    // eased, drives FOV/vignette/streaks/sound
    this.shakeT = 0;
    this.camPos = new THREE.Vector3(0, 5, 12);
    this.camLook = new THREE.Vector3(0, 1, -10);
    this.orbitT = 0;
    this.finishMode = false;
    this.confetti = null;

    this._streaks = this._makeStreaks();
    this.scene.add(this._streaks);

    window.addEventListener('resize', () => this._resize());
    this._resize();
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setTheme(theme) {
    if (this.themeGroup) {
      this.scene.remove(this.themeGroup);
      this.themeGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
            if (m.map) m.map.dispose();
            m.dispose();
          });
        }
      });
    }
    this.theme = theme;
    this.themeGroup = theme.group;
    this.scene.add(theme.group);
  }

  shake(power = 1) { this.shakeT = Math.min(0.45, 0.22 * power); }

  confettiBurst(pos) {
    const N = 160;
    const geo = new THREE.BoxGeometry(0.16, 0.16, 0.02);
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    const colors = ['#ff4d5e', '#ffd75e', '#22d3a7', '#4f8cff', '#c084fc', '#ff9f43'];
    const c = new THREE.Color();
    const items = [];
    for (let i = 0; i < N; i++) {
      c.set(colors[i % colors.length]);
      mesh.setColorAt(i, c);
      items.push({
        p: new THREE.Vector3(pos.x + (Math.random() - 0.5) * 6, pos.y + 3 + Math.random() * 5, pos.z + (Math.random() - 0.5) * 4),
        v: new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 4, (Math.random() - 0.5) * 3),
        r: new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3),
        rv: (Math.random() - 0.5) * 8,
      });
    }
    mesh.instanceColor.needsUpdate = true;
    this.confetti = { mesh, items, t: 0 };
    this.scene.add(mesh);
  }

  _makeStreaks() {
    const N = 220;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 30;
      pos[i * 3 + 1] = Math.random() * 7 + 0.3;
      pos[i * 3 + 2] = -Math.random() * 120;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: '#ffffff', size: 0.14, transparent: true, opacity: 0 });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  /* per-frame */
  update(dt, racersState) {
    const focus = this.theme?.vehicles?.[this.focusIdx];
    if (!focus) return;
    const carPos = focus.group.position;

    // eased speed for all visual reactions (FOV, streaks, vignette, sound)
    this.smoothSpeed01 += (this.speed01 - this.smoothSpeed01) * expK(3.2, dt);
    const s01 = this.smoothSpeed01;

    // streak particles
    const sMat = this._streaks.material;
    sMat.opacity += ((s01 > 0.4 ? (s01 - 0.4) * 1.5 : 0) - sMat.opacity) * expK(4, dt);
    if (sMat.opacity > 0.01) {
      const arr = this._streaks.geometry.attributes.position.array;
      const dz = (30 + s01 * 160) * dt;
      for (let i = 0; i < arr.length / 3; i++) {
        arr[i * 3 + 2] += dz;
        if (arr[i * 3 + 2] > 12) {
          arr[i * 3] = carPos.x + (Math.random() - 0.5) * 30;
          arr[i * 3 + 2] = carPos.z - 130 - Math.random() * 20;
        }
      }
      this._streaks.geometry.attributes.position.needsUpdate = true;
    }

    // confetti physics
    if (this.confetti) {
      this.confetti.t += dt;
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
      this.confetti.items.forEach((it, i) => {
        it.v.y -= 6 * dt;
        it.p.addScaledVector(it.v, dt);
        it.r.x += it.rv * dt; it.r.z += it.rv * 0.7 * dt;
        q.setFromEuler(it.r);
        m.compose(it.p, q, sc);
        this.confetti.mesh.setMatrixAt(i, m);
      });
      this.confetti.mesh.instanceMatrix.needsUpdate = true;
      if (this.confetti.t > 6) { this.scene.remove(this.confetti.mesh); this.confetti = null; }
    }

    // camera
    if (this.finishMode) {
      this.orbitT += dt * 0.55;
      const r = 9.5;
      const tx = carPos.x + Math.cos(this.orbitT) * r;
      const tz = carPos.z + Math.sin(this.orbitT) * r;
      this.camPos.lerp(new THREE.Vector3(tx, 4.2, tz), expK(2.4, dt));
      this.camLook.lerp(new THREE.Vector3(carPos.x, 1.1, carPos.z), expK(3.5, dt));
    } else {
      const desired = new THREE.Vector3(
        carPos.x * 0.86,
        4.25 + s01 * 0.55,
        carPos.z + 10.4 - s01 * 1.9
      );
      this.camPos.lerp(desired, expK(5.5, dt));
      this.camLook.lerp(new THREE.Vector3(carPos.x * 0.92, 1.2, carPos.z - 17), expK(7.5, dt));
    }

    const p = this.camPos, l = this.camLook;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const k = Math.max(0, this.shakeT) * 0.5;
      this.camera.position.set(p.x + (Math.random() - 0.5) * k, p.y + (Math.random() - 0.5) * k, p.z + (Math.random() - 0.5) * k * 0.5);
    } else {
      this.camera.position.copy(p);
    }
    this.camera.lookAt(l);

    const targetFov = 62 + s01 * 13;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * expK(3, dt);
      this.camera.updateProjectionMatrix();
    }

    // keep the shadow frustum near the player
    this.sun.position.set(carPos.x + 30, 60, carPos.z + 20);
    this.sun.target.position.set(carPos.x, 0, carPos.z - 10);
    this.sun.target.updateMatrixWorld();

    // rearview mirror camera: hover behind & above the car, looking back
    this.rearCam.position.set(carPos.x, 3.4, carPos.z + 6.5);
    this.rearCam.lookAt(carPos.x, 1.2, carPos.z + 60);

    this.theme?.update?.(dt, racersState);
  }

  render() {
    const r = this.renderer;
    r.render(this.scene, this.camera);

    // rearview mirror pass
    if (this.mirrorEnabled && this.theme?.vehicles?.[this.focusIdx]) {
      const w = r.domElement.clientWidth, h = r.domElement.clientHeight;
      const mw = Math.min(372, w * 0.42), mh = 94;
      const mx = (w - mw) / 2, my = 58;
      r.autoClear = false;
      r.setScissorTest(true);
      r.setScissor(mx, h - my - mh, mw, mh);
      r.setViewport(mx, h - my - mh, mw, mh);
      r.clearDepth();
      this.rearCam.aspect = mw / mh;
      this.rearCam.updateProjectionMatrix();
      r.render(this.scene, this.rearCam);
      r.setScissorTest(false);
      r.setViewport(0, 0, w, h);
      r.autoClear = true;
    }
  }
}
