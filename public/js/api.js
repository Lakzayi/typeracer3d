/* Data access. With the local server (`node server.js`) these hit real
 * TypeRacer data proxies; on a static host (GitHub Pages) the race call
 * falls back to bundled demo races so the game stays fully playable. */

import { demoRace } from './demo-data.js';

async function jfetch(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export const API = {
  async race(avoidId) {
    try {
      return await jfetch('api/race' + (avoidId ? `?avoidId=${encodeURIComponent(avoidId)}` : ''));
    } catch (e) {
      const demo = demoRace(avoidId);
      demo.fallbackError = e.message;
      return demo;
    }
  },
  profile: (user) => jfetch(`api/profile?user=${encodeURIComponent(user)}`),
};
