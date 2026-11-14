/* Vehicle paints & variants — curated primary/secondary combos per theme plus
 * a deterministic picker for bots (seeded by race id + racer name, so the same
 * race always shows the same liveries, but every race looks different).
 * The player's own combo comes from the garage (settings.garage). */

import { hashSeed, mulberry32 } from './world.js';

/* ---- car liveries: primary = body, secondary = roof/spoiler/scoop/stripes */
export const CAR_PAINTS = [
  { primary: '#e0342e', secondary: '#15181e' }, // rosso on graphite
  { primary: '#1b6fe8', secondary: '#f2f4f8' }, // racing blue, white roof
  { primary: '#f2b705', secondary: '#111114' }, // taxi-gold, black top
  { primary: '#18a97a', secondary: '#101815' }, // british green
  { primary: '#e8e6e0', secondary: '#c42b2b' }, // white, red accents
  { primary: '#7a55ff', secondary: '#14121c' }, // violet on ink
  { primary: '#23262d', secondary: '#d8b64a' }, // matte black, gold trim
  { primary: '#ff7a2f', secondary: '#1a120c' }, // sunset orange
  { primary: '#c22b52', secondary: '#efe9dd' }, // magenta, cream top
  { primary: '#3fd0c9', secondary: '#0e1a1c' }, // teal on deep slate
];

/* ---- horse: primary = coat, secondary = blanket/rider shirt */
export const HORSE_COATS = [
  { primary: '#7a4a26', secondary: '#ffd75e' }, // bay, gold blanket
  { primary: '#23201d', secondary: '#e0342e' }, // black, red blanket
  { primary: '#ddd8cd', secondary: '#1b6fe8' }, // grey, blue blanket
  { primary: '#8f3d20', secondary: '#f2e6cf' }, // chestnut, cream
  { primary: '#b98a4a', secondary: '#18a97a' }, // palomino, green
  { primary: '#5a3620', secondary: '#c9a2ff' }, // dark bay, lilac
  { primary: '#9a9aa2', secondary: '#2b2f38' }, // dapple grey, charcoal
  { primary: '#a3763f', secondary: '#e05a3a' }, // dun, orange
];

/* ---- boat: primary = hull, secondary = racing stripe / sponsons */
export const BOAT_PAINTS = [
  { primary: '#e0342e', secondary: '#f2e6cf' },
  { primary: '#1b6fe8', secondary: '#ffd75e' },
  { primary: '#f2b705', secondary: '#111114' },
  { primary: '#e8e6e0', secondary: '#c42b2b' },
  { primary: '#18a97a', secondary: '#eef3ff' },
  { primary: '#23262d', secondary: '#3fd0c9' },
  { primary: '#ff7a2f', secondary: '#efe9dd' },
  { primary: '#7a55ff', secondary: '#d8e6f2' },
];

/* ---- rocket: primary = fins/bands, secondary = nose cap + tail band */
export const ROCKET_PAINTS = [
  { primary: '#c42b2b', secondary: '#e8e6e0' }, // classic red/white
  { primary: '#1b6fe8', secondary: '#ffd75e' },
  { primary: '#18a97a', secondary: '#f2e6cf' },
  { primary: '#ff7a2f', secondary: '#23262d' },
  { primary: '#7a55ff', secondary: '#d8e6f2' },
  { primary: '#d8b64a', secondary: '#111114' },
  { primary: '#3fd0c9', secondary: '#c42b2b' },
  { primary: '#e8e6e0', secondary: '#e0342e' },
];

export const PAINTS = {
  car: { list: CAR_PAINTS, label: 'car' },
  horse: { list: HORSE_COATS, label: 'horse' },
  boat: { list: BOAT_PAINTS, label: 'boat' },
  rocket: { list: ROCKET_PAINTS, label: 'rocket' },
};

/* deterministic paint for a bot — same race always shows the same livery */
const VARIANT_COUNTS = { car: 3, horse: 3, boat: 3, rocket: 3 };
export function paintFor(kind, seedStr) {
  const list = (PAINTS[kind] ?? PAINTS.car).list;
  const rng = mulberry32(hashSeed('paint:' + seedStr));
  return { ...list[Math.floor(rng() * list.length)], variant: Math.floor(rng() * (VARIANT_COUNTS[kind] ?? 3)) };
}

/* defaults for the player when the garage hasn't been touched yet */
export const GARAGE_DEFAULTS = {
  car: { primary: '#e0342e', secondary: '#15181e', model: 0 },
  horse: { primary: '#7a4a26', secondary: '#ffd75e', model: 0 },
  boat: { primary: '#e0342e', secondary: '#f2e6cf', model: 0 },
  rocket: { primary: '#c42b2b', secondary: '#e8e6e0', model: 0 },
};
