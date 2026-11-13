/* Offline demo races — used when the local data server isn't running
 * (e.g. on a static GitHub Pages deploy). The full game works exactly the
 * same, but quotes are bundled and opponents are synthetic racers instead of
 * real TypeRacer humans. Start the local server (`node server.js`) to race
 * real historical races with real keystroke timing. */

import { mulberry32 } from './world.js';

const QUOTES = [
  {
    text: 'Two roads diverged in a wood, and I took the one less traveled by, and that has made all the difference.',
    source: 'The Road Not Taken — Robert Frost',
    bots: [['typingturtle', 63], ['keystorm', 88], ['nimble_nine', 74]],
  },
  {
    text: 'The greatest glory in living lies not in never falling, but in rising every time we fall.',
    source: 'attributed to Nelson Mandela',
    bots: [['qwerty_kate', 92], ['slowpoke_sam', 48]],
  },
  {
    text: 'Success is not final, failure is not fatal: it is the courage to continue that counts.',
    source: 'commonly attributed to Winston Churchill',
    bots: [['TheKeyboarder', 105], ['type_and_skip', 71], ['dvz_racer', 84], ['lila_types', 59]],
  },
  {
    text: 'It is not the strongest of the species that survives, nor the most intelligent, but the one most responsive to change.',
    source: 'popularly attributed to Charles Darwin',
    bots: [['gamma_rate', 97], ['mechanical_hand', 66]],
  },
  {
    text: 'Be yourself; everyone else is already taken. And honestly, that is the best typing advice anyone has ever given me.',
    source: 'attributed to Oscar Wilde (extended)',
    bots: [['zero_delay', 116], ['hunt_and_peck_hank', 41], ['azerty_amber', 78]],
  },
  {
    text: 'In the end, it is not the years in your life that count. It is the life in your years — so type like every keystroke matters.',
    source: 'attributed to Abraham Lincoln (extended)',
    bots: [['carbon_keycap', 82], ['streak_runner', 69], ['velo_city', 101]],
  },
];

/* synthetic cumulative keystroke timestamps (ms) for `chars` chars at `wpm` */
export function synthLog(chars, wpm, rng) {
  const base = 60000 / (wpm * 5); // ms per character
  let t = 0;
  const log = [];
  for (let i = 0; i < chars; i++) {
    let d = base * (0.55 + rng() * 1.1);
    if (rng() < 0.02) d += base * (2 + rng() * 3); // human hesitation
    t += d;
    log.push(Math.round(t));
  }
  return log;
}

let lastIdx = -1;

export function demoRace(avoidId, exactId) {
  let idx = (lastIdx + 1) % QUOTES.length;
  if (exactId?.startsWith('demo-')) {
    // challenge link (?race=demo-N): everyone replays the SAME bundled race
    const want = Number(exactId.slice(5));
    if (!Number.isNaN(want) && want >= 0 && want < QUOTES.length) idx = want;
  } else if (avoidId?.startsWith('demo-')) {
    const prev = Number(avoidId.slice(5));
    if (!Number.isNaN(prev)) idx = (prev + 1) % QUOTES.length;
  }
  lastIdx = idx;
  const q = QUOTES[idx];
  const id = `demo-${idx}`;
  const rng = mulberry32(9000 + idx);
  return {
    id,
    demo: true,
    live: false,
    text: q.text,
    source: q.source,
    note: `demo race · bundled quote — run "node server.js" locally for live TypeRacer data`,
    racers: q.bots.map(([name, wpm]) => ({
      name,
      wpm,
      acc: 93 + Math.floor(rng() * 6),
      log: synthLog(q.text.length, wpm, rng),
    })),
  };
}
