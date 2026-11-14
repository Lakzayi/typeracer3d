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
    // ACES filmic + per-TOD exposure: highlights keep their color instead of
    // clipping to white, and night stays night by dropping exposure, not by
    // flooding the scene with light (GRAPHICS_PLAN §1.1)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    // environment map generator (r160 core has PMREMGenerator.fromScene)
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this._envRT = null;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#8fc3ea');
    // exponential fog reads as atmosphere (GRAPHICS_PLAN §1.4); density and
    // color are set per time-of-day by the themes via world.setFog()
    this.scene.fog = new THREE.FogExp2('#8fc3ea', 0.0020);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1200);
    this.camera.position.set(0, 5, 12);

    // rearview mirror camera — far plane must reach the 620-radius sky dome
    // (500 cut it off, so the mirror showed a flat background band instead of
    // the same sky the main camera sees; critic r10 brief #6)
    this.rearCam = new THREE.PerspectiveCamera(56, 4, 0.1, 700);
    this.mirrorEnabled = true;

    const hemi = new THREE.HemisphereLight('#cfe8ff', '#5a7050', 0.9);
    this.scene.add(hemi);
    this.ambient = new THREE.AmbientLight('#ffffff', 0.0);
    this.scene.add(this.ambient);
    const sun = new THREE.DirectionalLight('#fff4d6', 1.6);
    sun.position.set(30, 60, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    // ortho box around the play corridor + the near scenery band
    // (GRAPHICS_PLAN §1.3) — ±48 keeps ~22 texels/m of 2048² on the action AND
    // covers the near-mid scenery band the chase camera actually sees (the r7
    // critic's "day scenes have no env-object shadows" was frustum coverage)
    sun.shadow.camera.left = -48; sun.shadow.camera.right = 48;
    sun.shadow.camera.top = 48; sun.shadow.camera.bottom = -48;
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 220;
    sun.shadow.camera.updateProjectionMatrix(); // frustum edits need this or they never apply
    sun.shadow.bias = -0.0002;    // anti shadow-acne
    sun.shadow.normalBias = 0.03; // anti peter-panning on the flat ground
    this.scene.add(sun);
    this.sun = sun;
    // sun/moon offset relative to the player — themes rewrite this in
    // setTimeOfDay (low sun at sunset = long shadows, moon opposite at night)
    this.sunRig = new THREE.Vector3(30, 60, 20);
    this.hemi = hemi;

    this.themeGroup = null;
    this.theme = null;
    this.focusIdx = 0;
    this.speed01 = 0;          // raw target speed
    this.smoothSpeed01 = 0;    // eased, drives FOV/vignette/streaks/sound
    this.shakeT = 0;
    this.camPos = new THREE.Vector3(0, 5, 12);
    this.camLook = new THREE.Vector3(0, 1, -10);
    // preallocated temporaries — update() must not allocate per frame
    // (GRAPHICS_PLAN §1.6, SPEC §1.3)
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._sc = new THREE.Vector3(1, 1, 1);
    this.orbitT = 0;
    this.finishMode = false;
    this.showcase = false; // garage: slow beauty orbit around a lone vehicle
    this.confetti = null;

    this._streaks = this._makeStreaks();
    this.scene.add(this._streaks);
    this._sparks = this._makeSparks();
    this.scene.add(this._sparks);

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

  /* additive API for the themes' setTimeOfDay (GRAPHICS_PLAN §1.1, §1.4) */
  setExposure(v) { this.renderer.toneMappingExposure = v; }
  setFog(colorHex, density) {
    this.scene.fog.color.set(colorHex);
    this.scene.fog.density = density;
  }

  /* tiny gradient sky + ground patch rendered through PMREM (GRAPHICS_PLAN §1.5,
   * core PMREMGenerator.fromScene — no addons). Runs only on theme/TOD change,
   * never per frame. Metals/glass/water then reflect a believable sky.
   * sunDir (optional {x,y,z}): adds an HDR sun blob to the capture so glossy
   * surfaces get a real specular glint that moves with the sun — a smooth
   * gradient env alone reflects back ≈ the base color and water reads as
   * matte paint (critic r7). */
  setEnvironment(skyTop, skyMid, skyBot, groundColor, sunDir, sunStrength = 1) {
    if (!this._envScene) {
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 256;
      this._envCanvas = canvas;
      this._envTex = new THREE.CanvasTexture(canvas);
      this._envTex.colorSpace = THREE.SRGBColorSpace;
      this._envScene = new THREE.Scene();
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(50, 16, 12),
        new THREE.MeshBasicMaterial({ map: this._envTex, side: THREE.BackSide })
      );
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(140, 140),
        new THREE.MeshBasicMaterial({ color: '#888888' })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -1;
      this._envScene.add(dome, ground);
      this._envGroundMat = ground.material;
      // HDR hot spot — overbright color (RGB > 1) survives PMREM capture, so
      // low-roughness materials show a true sun highlight (SPEC §2). Smaller
      // sphere (was 4.5): a tight glint reads as the sun on paint/water; a
      // wide one smeared a cream highlight over whole panels (r7 note).
      this._envSunMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8.2, 7.0) });
      this._envSun = new THREE.Mesh(new THREE.SphereGeometry(3.2, 12, 8), this._envSunMat);
      this._envSun.visible = false;
      this._envScene.add(this._envSun);
    }
    // sphere UVs put canvas-bottom at the zenith — same bottom-up draw as the sky domes
    const ctx = this._envCanvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, skyBot); g.addColorStop(0.42, skyMid); g.addColorStop(1, skyTop);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 256);
    this._envTex.needsUpdate = true;
    this._envGroundMat.color.set(groundColor);
    if (sunDir) {
      const len = Math.hypot(sunDir.x, sunDir.y, sunDir.z) || 1;
      this._envSun.position.set(sunDir.x / len * 42, Math.max(6, sunDir.y / len * 42), sunDir.z / len * 42);
      // sunStrength scales the HDR blob: 1.0 by day, ~0.12 at night so the
      // "moon glint" on paint/fins stays physically dim (critic r10 brief #5)
      const k = Math.max(0, sunStrength);
      this._envSunMat.color.setRGB(9 * k, 8.2 * k, 7.0 * k);
      this._envSun.visible = k > 0.001;
    } else {
      this._envSun.visible = false;
    }
    const rt = this.pmrem.fromScene(this._envScene, 0.04); // sigma=0.04 → soft
    if (this._envRT) this._envRT.dispose();
    this._envRT = rt;
    this.scene.environment = rt.texture;
  }

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

  _makeSparks() {
    const N = 56;
    this._sparkP = [];
    for (let i = 0; i < N; i++) {
      this._sparkP.push({ vx: 0, vy: 0, vz: 0, life: 0, r: 0, g: 0, b: 0 });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const mat = new THREE.PointsMaterial({
      size: 0.17, vertexColors: true, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this._sparkCursor = 0;
    return pts;
  }

  /* spark burst at a vehicle — wrong keystroke / death. Additive material, so
   * particles fade to black (invisible) as their life drains */
  impact(vehIdx = 0, power = 1) {
    const v = this.theme?.vehicles?.[vehIdx];
    if (!v) return;
    const pos = this._sparks.geometry.attributes.position.array;
    const col = this._sparks.geometry.attributes.color.array;
    const p = v.group.position;
    const n = Math.min(Math.round(12 * power), this._sparkP.length);
    for (let k = 0; k < n; k++) {
      const i = (this._sparkCursor = (this._sparkCursor + 1) % this._sparkP.length);
      const s = this._sparkP[i];
      const a = Math.random() * Math.PI * 2;
      s.vx = Math.cos(a) * (0.8 + Math.random() * 3.2 * power);
      s.vy = 1.5 + Math.random() * 3.4 * power;
      s.vz = Math.sin(a) * (0.8 + Math.random() * 3.2 * power);
      s.life = 0.4 + Math.random() * 0.3;
      // hot white-yellow → deep orange mix, kept for the fade pass
      const hot = Math.random();
      s.r = 1;
      s.g = 0.55 + hot * 0.4;
      s.b = 0.15 + hot * 0.45;
      pos[i * 3] = p.x + (Math.random() - 0.5) * 0.9;
      pos[i * 3 + 1] = (p.y ?? 0) + 0.4 + Math.random() * 0.6;
      pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 1.2;
    }
    this._sparks.geometry.attributes.position.needsUpdate = true;
    this._sparks.geometry.attributes.color.needsUpdate = true;
  }

  /* per-frame */
  update(dt, racersState) {
    this._lastDt = dt; // for the 1Hz draw-call probe (see render)
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

    // spark bursts — gravity, floor bounce, additive fade-to-black
    {
      const sp = this._sparks.geometry.attributes.position.array;
      const sc = this._sparks.geometry.attributes.color.array;
      let alive = false;
      for (let i = 0; i < this._sparkP.length; i++) {
        const s = this._sparkP[i];
        if (s.life <= 0) continue;
        alive = true;
        s.life -= dt;
        s.vy -= 9.5 * dt;
        sp[i * 3] += s.vx * dt;
        sp[i * 3 + 1] += s.vy * dt;
        sp[i * 3 + 2] += s.vz * dt;
        if (sp[i * 3 + 1] < 0.06) { // bounce off the road, lose energy
          sp[i * 3 + 1] = 0.06;
          s.vy *= -0.35; s.vx *= 0.6; s.vz *= 0.6;
        }
        const f = Math.max(0, Math.min(1, s.life * 2.4));
        sc[i * 3] = s.r * f;
        sc[i * 3 + 1] = s.g * f;
        sc[i * 3 + 2] = s.b * f;
      }
      if (alive) {
        this._sparks.geometry.attributes.position.needsUpdate = true;
        this._sparks.geometry.attributes.color.needsUpdate = true;
      }
    }

    // confetti physics
    if (this.confetti) {
      this.confetti.t += dt;
      const m = this._m4, q = this._q, sc = this._sc; // reused — no per-frame alloc
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

    // camera (targets written into reused vectors — no per-frame alloc)
    if (this.finishMode || this.showcase) {
      const showcase = this.showcase;
      this.orbitT += dt * (showcase ? 0.3 : 0.55);
      const r = showcase ? 6.4 : 9.5;
      const tx = carPos.x + Math.cos(this.orbitT) * r;
      const tz = carPos.z + Math.sin(this.orbitT) * r;
      this._v1.set(tx, showcase ? 2.5 : 4.2, tz);
      this._v2.set(carPos.x, 1.0, carPos.z);
      this.camPos.lerp(this._v1, expK(2.4, dt));
      this.camLook.lerp(this._v2, expK(3.5, dt));
    } else {
      this._v1.set(
        carPos.x * 0.86,
        4.25 + s01 * 0.55,
        carPos.z + 10.4 - s01 * 1.9
      );
      this.camPos.lerp(this._v1, expK(5.5, dt));
      this._v2.set(carPos.x * 0.92, 1.2, carPos.z - 17);
      this.camLook.lerp(this._v2, expK(7.5, dt));
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

    // keep the shadow frustum near the player; the offset comes from the
    // theme's sunRig (sun height/dir per time of day — GRAPHICS_PLAN §1.3)
    const rig = this.sunRig;
    this.sun.position.set(carPos.x + rig.x, rig.y, carPos.z + rig.z);
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
    // draw-call budget probe (SPEC §1.3: "measured, not promised") — samples
    // 1×/s, only when the QA autoshot harness drives the page. info resets at
    // each render() call, so the main-pass counts are captured here and the
    // mirror pass's counts are added after its render below.
    if (this._probeDC === undefined) this._probeDC = location.search.includes('autoshot');
    const _mainCalls = this._probeDC ? r.info.render.calls : 0;
    const _mainTris = this._probeDC ? r.info.render.triangles : 0;

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
      if (this._probeDC) {
        this._probeT = (this._probeT || 0) + (this._lastDt || 0);
        if (this._probeT > 1) {
          this._probeT = 0;
          console.log('DRAW_CALLS', _mainCalls + r.info.render.calls, 'TRIS', _mainTris + r.info.render.triangles);
        }
      }
    }
  }
}
