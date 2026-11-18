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
