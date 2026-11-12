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
  profile: (user) => jfetch(`api/profile?user=${encodeURIComponent(user)}`),
};
