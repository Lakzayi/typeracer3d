/* Graphics quality config — bloom presets + quality levels (r17).
 *
 * The composer chain is RenderPass → UnrealBloomPass → OutputPass (vendored
 * jsm, see sw.js ASSETS). Bloom is SELECTIVE by threshold: the pass only
 * picks pixels whose linear-HDR luminance exceeds `threshold`, so the numbers
 * here are tuned per time-of-day against each theme's brightest emissives —
 * day scenes keep flat paint flat (threshold 1.0 ≈ nothing but real HDR
 * glints), night scenes let windows/lanterns/flames/nav-lights bloom.
 *
 * Rules (tr3d-graphics-docs/13): an effect must explain physics or reinforce
 * the mood — no "effect for effect's sake".
 */
export const GFX = {
  enabled: true, // master switch (the fps auto-gate also writes this)
  auto: true,    // measured fps gate runs unless the user picks a level
  bloomAllowed: true, // gate level control — setBloom() ANDs this in
  dprCap: 2,          // gate level control — world.setDPRCap() consumes it

  /* bloom { strength, radius, threshold } per time-of-day; DEFAULT is used
   * unless a theme overrides (rocket: the space race owns real HDR sources —
   * stars, earth city lights, jets — so it glows a touch harder at night) */
  bloom: {
    DEFAULT: {
      day:    { strength: 0.30, radius: 0.40, threshold: 1.00 },
      sunset: { strength: 0.50, radius: 0.50, threshold: 0.85 },
      night:  { strength: 0.90, radius: 0.55, threshold: 0.68 },
    },
    rocket: {
      day:    { strength: 0.35, radius: 0.45, threshold: 0.95 },
      sunset: { strength: 0.55, radius: 0.50, threshold: 0.80 },
      night:  { strength: 1.05, radius: 0.60, threshold: 0.65 },
    },
    boat: {
      day:    { strength: 0.30, radius: 0.40, threshold: 1.00 },
      sunset: { strength: 0.50, radius: 0.50, threshold: 0.85 },
      // night: the white hull + its headlight pool on the water sit at luma
      // ≈1.0 — a night threshold that low washes the whole river out
      // (measured in the r17 verify tour: 0.68 blew the frame white)
      night:  { strength: 0.50, radius: 0.50, threshold: 0.92 },
    },
  },

  for(themeKey, todName) {
    const t = this.bloom[themeKey] ?? this.bloom.DEFAULT;
    return t[todName] ?? this.bloom.DEFAULT[todName] ?? this.bloom.DEFAULT.day;
  },
};

/* ---------------- quality auto-gate (r17, tr3d-graphics-docs/16) ------------
 * Measured INSIDE the existing loop — no timers (SPEC §1.3). A 2s window of
 * rAF deltas decides: <42fps sustained → drop bloom, then the DPR cap;
 * >58fps sustained → step back up. ±hysteresis + a 6s cooldown keep the gate
 * from yoyo-ing; a manual settings.gfx choice overrides everything. */
export const QualityGate = {
  state: 'high', // high → med (bloom off) → low (dpr 1.5)
  acc: 0,
  frames: 0,
  cooldown: 0,
  update(world, dt) {
    if (!GFX.auto || !world) return;
    this.acc += dt;
    this.frames++;
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.acc < 2.0) return;
    const fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    if (this.cooldown > 0) return; // settle before judging again
    const prev = this.state;
    if (fps < 42 && this.state === 'high') this.state = 'med';
    else if (fps < 42 && this.state === 'med') this.state = 'low';
    else if (fps > 58 && this.state === 'med') this.state = 'high';
    else if (fps > 58 && this.state === 'low') this.state = 'med';
    if (this.state !== prev) {
      applyQuality(world, this.state);
      this.cooldown = 6;
      window.dispatchEvent(new CustomEvent('tr3d-gfx', { detail: this.state }));
    }
  },
};

export function applyQuality(world, state) {
  GFX.level = state;
  GFX.bloomAllowed = state === 'high';
  GFX.dprCap = state === 'low' ? 1.5 : 2;
  if (world) {
    // re-apply the theme's parked bloom preset under the new gate level
    if (world._pendingBloom) world.setBloom(world._pendingBloom[0], world._pendingBloom[1]);
    else if (world.bloomPass) world.bloomPass.enabled = GFX.bloomAllowed;
    world.setDPRCap(GFX.dprCap);
  }
}
