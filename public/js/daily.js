/* Daily challenge — one deterministic race per calendar day: same quote, same
 * bots, same speeds for every player worldwide (no backend — the date itself
 * is the seed). Completing it keeps your streak alive. */

import { monkeytypeQuotes } from './api.js';
import { demoRace, synthLog } from './demo-data.js';
import { mulberry32 } from './world.js';
import { getLanguage, pickPoolText } from './languages.js';

const KEY = 'tr3d_daily_v1';

/* local calendar date — the daily is anchored to the player's own timezone */
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function yesterdayStr() {
  const d = new Date(Date.now() - 24 * 3600 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function seedFrom(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* build today's deterministic race — same text, same bots for everyone who
 * picked the same language. Falls back to the bundled demo pool when
 * Monkeytype is unreachable — still deterministic for the day on this device. */
export async function dailyRace(language = 'en') {
  const date = todayStr();
  // non-English: a seeded pick from that language's bundled pool — everyone
  // racing the same language gets the exact same text and bot field
  if (language !== 'en') {
    const lang = getLanguage(language);
    const rng = mulberry32(seedFrom('tr3d-' + date + '-' + language));
    const pick = pickPoolText(language, 'tr3d-' + date + '-' + language);
    const names = ['Sable', 'Misty', 'Drift', 'Kilo', 'Ember', 'Flint'];
    const pool = [...names].sort(() => rng() - 0.5);
    const racers = pool.slice(0, 3).map((name) => {
      const wpm = Math.round(52 + rng() * 42);
      return { name, wpm, acc: 92 + Math.floor(rng() * 6), log: synthLog(pick.text.length, wpm, rng) };
    });
    return {
      id: `daily-${date}`, daily: true, live: false,
      text: pick.text, source: `${lang.name} · ${pick.source}`, racers,
      langPool: lang.name,
      note: `daily challenge ${date} (${lang.name}) — same text, same bots for everyone`,
    };
  }
  const rng = mulberry32(seedFrom('tr3d-' + date));
  let text, source;
  try {
    const quotes = await monkeytypeQuotes();
    const q = quotes[Math.floor(rng() * quotes.length)];
    text = q.text; source = 'Monkeytype · ' + q.source;
  } catch (e) {
    const d = demoRace();
    text = d.text; source = d.source + ' (offline fallback)';
  }
  // three bots with fixed speeds derived from the same seed — everyone races
  // the exact same field
  const names = ['Sable', 'Misty', 'Drift', 'Kilo', 'Ember', 'Flint'];
  const pool = [...names].sort(() => rng() - 0.5);
  const racers = pool.slice(0, 3).map((name) => {
    const wpm = Math.round(52 + rng() * 42); // 52-94 wpm
    return { name, wpm, acc: 92 + Math.floor(rng() * 6), log: synthLog(text.length, wpm, rng) };
  });
  return {
    id: `daily-${date}`, daily: true, live: false,
    text, source, racers,
    note: `daily challenge ${date} — same quote, same bots for everyone`,
  };
}

/* ---------- streak bookkeeping ---------- */

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && typeof s.streak === 'number') return s;
  } catch (e) {}
  return { streak: 0, best: 0, lastDone: null, done: {} };
}

function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
}

export function dailyState() {
  const s = load();
  return { streak: s.streak, best: s.best, doneToday: s.lastDone === todayStr(), todayWpm: s.done?.[s.lastDone] ?? null };
}

/* called when a daily race is COMPLETED (text fully typed) */
export function markDailyDone(wpm) {
  const s = load();
  const today = todayStr();
  if (s.lastDone !== today) {
    s.streak = s.lastDone === yesterdayStr() ? s.streak + 1 : 1;
    s.best = Math.max(s.best, s.streak);
    s.lastDone = today;
  }
  const prev = s.done[today];
  if (!prev || wpm > prev) s.done[today] = Math.round(wpm);
  // keep only the last 60 days of results
  const keys = Object.keys(s.done).sort();
  while (keys.length > 60) delete s.done[keys.shift()];
  save(s);
  return s.streak;
}
