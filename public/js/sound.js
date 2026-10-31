/* Tiny WebAudio sound engine: engine hum, key clicks, error thud, countdown, finish. */

export class Sound {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.engine = null;
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

  /* continuous engine hum whose pitch follows typing speed */
  startEngine() {
    const ctx = this._ensure();
    if (!ctx || this.engine) return;
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
    this.engine = { osc, osc2, gain, filter };
  }

  engineSpeed(s01) {
    if (!this.engine) return;
    const { osc, osc2, filter } = this.engine;
    osc.frequency.value = 55 + s01 * 95;
    osc2.frequency.value = 27 + s01 * 50;
    filter.frequency.value = 320 + s01 * 1100;
  }

  stopEngine() {
    if (!this.engine) return;
    try {
      this.engine.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      const e = this.engine;
      setTimeout(() => { try { e.osc.stop(); e.osc2.stop(); } catch {} }, 300);
    } catch {}
    this.engine = null;
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
