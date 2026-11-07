/* Tiny WebAudio sound engine: per-theme propulsion sound (car hum, boat putter
 * + water, horse gallop + wind, rocket thruster), key clicks, error thud,
 * countdown, finish. */

export class Sound {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.engine = null; // { profile, update(s01), stop() } while a race runs
    this._noiseBuf = null;
  }

  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) this.stopEngine();
    return this.enabled;
  }

  _noise(ctx) {
    if (!this._noiseBuf) {
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._noiseBuf = buf;
    }
    return this._noiseBuf;
  }

  /* propulsion sound of the CURRENT theme; profile = theme id */
  startEngine(profile) {
    const ctx = this._ensure();
    if (!ctx || this.engine) return;
    const builders = {
      car: this._engine_car, boat: this._engine_boat,
      horse: this._engine_horse, rocket: this._engine_rocket,
    };
    const build = builders[profile] || this._engine_car;
    this.engine = build.call(this, ctx, profile);
  }

  engineSpeed(s01) {
    if (!this.engine) return;
    this.engine.update(s01);
  }

  stopEngine() {
    if (!this.engine) return;
    const e = this.engine;
    this.engine = null;
    try { e.stop(); } catch {}
  }

  /* ── car: low sawtooth + sub-square hum through a lowpass ── */
  _engine_car(ctx, profile) {
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = 'sawtooth'; osc.frequency.value = 55;
    osc2.type = 'square'; osc2.frequency.value = 27;
    filter.type = 'lowpass'; filter.frequency.value = 320;
    gain.gain.value = 0.028;
    osc.connect(filter); osc2.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc2.start();
    return {
      profile,
      update(s01) {
        osc.frequency.value = 55 + s01 * 95;
        osc2.frequency.value = 27 + s01 * 50;
        filter.frequency.value = 320 + s01 * 1100;
      },
      stop() {
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
        setTimeout(() => { try { osc.stop(); osc2.stop(); } catch {} }, 300);
      },
    };
  }

  /* ── boat: chugging low motor + water wash that opens with speed ── */
  _engine_boat(ctx, profile) {
    const out = ctx.createGain(); out.gain.value = 1; out.connect(ctx.destination);
    const put = ctx.createOscillator();
    const putF = ctx.createBiquadFilter();
    const putG = ctx.createGain();
    put.type = 'square'; put.frequency.value = 38;
    putF.type = 'lowpass'; putF.frequency.value = 240;
    putG.gain.value = 0.014;
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.type = 'sine'; lfo.frequency.value = 8;
    lfoG.gain.value = 0.011;
    lfo.connect(lfoG); lfoG.connect(putG.gain); // amplitude wobble = chug
    const wat = ctx.createBufferSource();
    wat.buffer = this._noise(ctx); wat.loop = true;
    const watF = ctx.createBiquadFilter();
    watF.type = 'bandpass'; watF.frequency.value = 650; watF.Q.value = 0.8;
    const watG = ctx.createGain(); watG.gain.value = 0.008;
    put.connect(putF); putF.connect(putG); putG.connect(out);
    wat.connect(watF); watF.connect(watG); watG.connect(out);
    put.start(); lfo.start(); wat.start();
    return {
      profile,
      update(s01) {
        put.frequency.value = 36 + s01 * 26;
        lfo.frequency.value = 7 + s01 * 9;
        putF.frequency.value = 220 + s01 * 520;
        putG.gain.value = 0.013 + s01 * 0.011;
        watF.frequency.value = 550 + s01 * 1300;
        watG.gain.value = 0.006 + s01 * 0.022;
      },
      stop() {
        out.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        setTimeout(() => { try { put.stop(); lfo.stop(); wat.stop(); } catch {} }, 400);
      },
    };
  }

  /* ── horse: no motor — gallop thumps (3-beat stride, tempo follows speed) + wind ── */
  _engine_horse(ctx, profile) {
    const out = ctx.createGain(); out.gain.value = 1; out.connect(ctx.destination);
    const wind = ctx.createBufferSource();
    wind.buffer = this._noise(ctx); wind.loop = true;
    const windF = ctx.createBiquadFilter();
    windF.type = 'bandpass'; windF.frequency.value = 320; windF.Q.value = 0.6;
    const windG = ctx.createGain(); windG.gain.value = 0.004;
    wind.connect(windF); windF.connect(windG); windG.connect(out);
    wind.start();
    let s01 = 0;
    let chain = null;
    let dead = false;
    const thump = () => {
      if (dead) return;
      const src = ctx.createBufferSource();
      src.buffer = this._noise(ctx);
      src.playbackRate.value = 0.5 + Math.random() * 0.3;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 150 + s01 * 120;
      const g = ctx.createGain();
      const t = ctx.currentTime;
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(0.032 + s01 * 0.05, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      src.connect(f); f.connect(g); g.connect(out);
      src.start(t, Math.random() * 1.5); src.stop(t + 0.15);
    };
    const stride = () => {
      thump();                                   // lead hoof
      setTimeout(() => { if (!dead) thump(); }, 90 + (1 - s01) * 60);   // pair
      setTimeout(() => { if (!dead) thump(); }, 190 + (1 - s01) * 110); // push-off
    };
    const schedule = () => {
      if (dead) return;
      stride();
      chain = setTimeout(schedule, 260 + (1 - s01) * 340); // gallop ↔ walk
    };
    schedule();
    return {
      profile,
      update(v) { s01 = v; },
      stop() {
        dead = true;
        if (chain) clearTimeout(chain);
        windG.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        setTimeout(() => { try { wind.stop(); } catch {} }, 400);
      },
    };
  }

  /* ── rocket: sub rumble + thruster roar + high hiss, all swelling with speed ── */
  _engine_rocket(ctx, profile) {
    const out = ctx.createGain(); out.gain.value = 1; out.connect(ctx.destination);
    const rum = ctx.createOscillator();
    const rumG = ctx.createGain();
    rum.type = 'sine'; rum.frequency.value = 30;
    rumG.gain.value = 0.016;
    const thr = ctx.createBufferSource();
    thr.buffer = this._noise(ctx); thr.loop = true;
    const thrF = ctx.createBiquadFilter();
    thrF.type = 'lowpass'; thrF.frequency.value = 420;
    const thrG = ctx.createGain(); thrG.gain.value = 0.014;
    const hiss = ctx.createBufferSource();
    hiss.buffer = this._noise(ctx); hiss.loop = true; hiss.playbackRate.value = 0.94;
    const hissF = ctx.createBiquadFilter();
    hissF.type = 'bandpass'; hissF.frequency.value = 2400; hissF.Q.value = 0.5;
    const hissG = ctx.createGain(); hissG.gain.value = 0.002;
    rum.connect(rumG); rumG.connect(out);
    thr.connect(thrF); thrF.connect(thrG); thrG.connect(out);
    hiss.connect(hissF); hissF.connect(hissG); hissG.connect(out);
    rum.start(); thr.start(); hiss.start();
    return {
      profile,
      update(s01) {
        rum.frequency.value = 28 + s01 * 16;
        rumG.gain.value = 0.014 + s01 * 0.02;
        thrF.frequency.value = 380 + s01 * 2400;
        thrG.gain.value = 0.012 + s01 * 0.034;
        hissG.gain.value = 0.002 + s01 * 0.01;
      },
      stop() {
        out.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        setTimeout(() => { try { rum.stop(); thr.stop(); hiss.stop(); } catch {} }, 400);
      },
    };
  }

  _blip(freq, dur, type, vol, slideTo) {
    const ctx = this._ensure();
    if (!ctx || !this.enabled) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + dur + 0.02);
  }

  key() { this._blip(620 + Math.random() * 160, 0.035, 'square', 0.016); }
  error() { this._blip(130, 0.16, 'sawtooth', 0.05, 70); }
  tick() { this._blip(440, 0.09, 'square', 0.04); }
  go() { this._blip(660, 0.25, 'square', 0.05, 880); }
  finish() {
    [523, 659, 784, 1046].forEach((f, i) =>
      setTimeout(() => this._blip(f, 0.22, 'triangle', 0.05), i * 110));
  }
}
