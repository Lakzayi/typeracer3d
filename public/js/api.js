/* Data access. With the local server (`node server.js`) these hit real
 * TypeRacer data proxies; on a static host (GitHub Pages) the race call
 * falls back to bundled demo races so the game stays fully playable.
 * Practice mode pulls quotes from Monkeytype's public quote dump directly
 * (CORS-open on raw.githubusercontent) — cached in localStorage for a week
 * so one visit pays the ~2 MB and the rest of the week is free. */

import { demoRace } from './demo-data.js';

async function jfetch(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

const MT_QUOTES_URL = 'https://raw.githubusercontent.com/monkeytypegame/monkeytype/master/frontend/static/quotes/english.json';
const MT_CACHE_KEY = 'tr3d-mt-quotes';
const MT_TTL = 7 * 24 * 3600 * 1000; // one week

async function monkeytypeQuotes() {
  try {
    const raw = localStorage.getItem(MT_CACHE_KEY);
    if (raw) {
      const hit = JSON.parse(raw);
      if (Date.now() - hit.t < MT_TTL && hit.quotes?.length) return hit.quotes;
    }
  } catch (e) { /* private mode / quota — just refetch */ }
  const body = await jfetch(MT_QUOTES_URL);
  const quotes = (body.quotes || [])
    .filter((q) => q.text && q.length >= 60 && q.length <= 240)
    .map((q) => ({ text: q.text, source: q.source || 'unknown' }));
  if (!quotes.length) throw new Error('no race-sized quotes in the dump');
  try { localStorage.setItem(MT_CACHE_KEY, JSON.stringify({ t: Date.now(), quotes })); } catch (e) {}
  return quotes;
}

export const API = {
  // race('lastId') -> fresh race avoiding lastId · race({ id }) -> exact challenge race
  async race(opts) {
    const q = new URLSearchParams();
    if (typeof opts === 'string') q.set('avoidId', opts);
    else if (opts && opts.id) q.set('id', opts.id);
    else if (opts && opts.avoidId) q.set('avoidId', opts.avoidId);
    const qs = q.toString();
    try {
      return await jfetch('api/race' + (qs ? `?${qs}` : ''));
    } catch (e) {
      const id = opts && opts.id;
      // a challenge race must be that race — surface the error, UNLESS it is a
      // bundled demo id, which any host (even a static one) can serve exactly
      if (id && !String(id).startsWith('demo-')) throw e;
      const demo = demoRace(typeof opts === 'string' ? opts : opts?.avoidId, id);
      demo.fallbackError = e.message;
      return demo;
    }
  },

  // practice(): one random Monkeytype quote (60-240 chars), no opponents.
  // Falls back to a bundled demo quote when offline or blocked.
  async practice(lastId) {
    try {
      const quotes = await monkeytypeQuotes();
      let idx = Math.floor(Math.random() * quotes.length);
      if (lastId != null && String(lastId).startsWith('mt-')) {
        const prev = Number(lastId.slice(3));
        if (!Number.isNaN(prev) && quotes[idx] && quotes[prev] && quotes[idx].text === quotes[prev].text) {
          idx = (idx + 1) % quotes.length; // "again" shouldn't repeat the same quote
        }
      }
      const q = quotes[idx];
      return {
        id: `mt-${idx}`, demo: false, live: false, practice: true,
        text: q.text, source: 'Monkeytype · ' + q.source,
        note: 'practice quote from Monkeytype',
        racers: [], // solo — the theme builds only your vehicle
      };
    } catch (e) {
      const d = demoRace(typeof lastId === 'string' && lastId.startsWith('demo-') ? lastId : undefined);
      return {
        id: d.id, demo: true, live: false, practice: true,
        text: d.text, source: 'bundled demo — Monkeytype unreachable',
        note: d.note, racers: [],
      };
    }
  },

  profile: (user) => jfetch(`api/profile?user=${encodeURIComponent(user)}`),
};
