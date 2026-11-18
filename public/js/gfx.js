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
 * Measured INSIDE the existing loop — no timers (SPEC §1.3). A 1.5s WALL-CLOCK
 * window decides: <42fps sustained → drop bloom, then the DPR cap + composer
 * bypass; >58fps sustained → step back up (menu only — see inRace).
 *
 * The window MUST be wall time, not the loop's clamped dt: dt is capped at
 * 0.05s, so on a GPU that takes seconds per frame the clamped sum filled the
 * window only after MINUTES of real time — the gate looked blind while the
 * picture was frozen (r17 live report). Hidden tabs discard samples; but a
 * VISIBLE gap > 0.5s is stall evidence — one gap discards the window (one-off
 * hitch), THREE consecutive gaps mean the cadence itself is seconds-per-frame
 * and the window would never fill → jump straight to the floor. A filled
 * window below 20fps also jumps. */
export const QualityGate = {
  state: 'high', // high → med (bloom off) → low (composer bypass + dpr 1.5)
  acc: 0,
  frames: 0,
  cooldown: 0,
  last: 0,
  started: false,
  stall: 0,
  update(world, dt, inRace) {
    if (!GFX.auto || !world) return;
    const now = performance.now();
    if (!this.started) { this.started = true; this.last = now; return; }
    const realDt = (now - this.last) / 1000;
    this.last = now;
    if (document.hidden) { this.acc = 0; this.frames = 0; this.stall = 0; return; }
    if (realDt > 0.5) {
      this.acc = 0;
      this.frames = 0;
      this.stall++;
      if (this.stall >= 3 && this.cooldown <= 0 && this.state !== 'low') {
        this.state = 'low';
        applyQuality(world, this.state);
        this.cooldown = 6;
        window.dispatchEvent(new CustomEvent('tr3d-gfx', { detail: this.state }));
      }
      return;
    }
    this.stall = 0;
    this.acc += realDt;
    this.frames++;
    if (this.cooldown > 0) this.cooldown -= realDt;
    if (this.acc < 1.5) return;
    const fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    if (this.cooldown > 0) return; // settle before judging again
    const prev = this.state;
    if (fps < 20) this.state = 'low'; // near-frozen: skip the ladder
    else if (fps < 42 && this.state === 'high') this.state = 'med';
    else if (fps < 42 && this.state === 'med') this.state = 'low';
    // Stepping UP mid-race reallocs every render target in the chain (bloom
    // mips + composer RTs) — a visible hitch — and on machines sitting
    // between the two thresholds it yoyos low↔high forever (r17 live
    // report). doc 90 §3: mid-race only ever DEGRADES; upgrades wait for
    // the menu.
    else if (!inRace && fps > 58 && this.state === 'med') this.state = 'high';
    else if (!inRace && fps > 58 && this.state === 'low') this.state = 'med';
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
    // 'low' bypasses the composer entirely: RenderPass→OutputPass into an
    // MSAA HalfFloat target costs real GPU time even with bloom disabled —
    // the plain renderer path (the canvas keeps its own antialias) is the
    // floor of this ladder on weak GPUs
    world.usePost = state !== 'low';
    // re-apply the theme's parked bloom preset under the new gate level
    if (world._pendingBloom) world.setBloom(world._pendingBloom[0], world._pendingBloom[1]);
    else if (world.bloomPass) world.bloomPass.enabled = GFX.bloomAllowed;
    world.setDPRCap(GFX.dprCap);
  }
}
