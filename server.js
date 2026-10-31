/*
 * TypeRacer 3D — local server
 * Serves the static 3D client and provides read-only proxies to public
 * TypeRacer "pit" pages so the game always races with REAL site data:
 *
 *   /api/race            -> a real historical race: text, source, all real racers w/ WPM
 *   /api/profile?user=X  -> real profile stats (Full Avg / Best Race / Races)
 *
 * Data path (all public pages, read-only):
 *   pit/race_history?user=X  -> recent race ids + speeds
 *   pit/result?id=|tr:X|N    -> full quote text, source, racers table
 *
 * Races and fetched pages are cached on disk (data/cache), and the username
 * pool self-grows from real opponents seen in races (data/pool.json).
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8787;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const POOL_FILE = path.join(DATA_DIR, 'pool.json');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 TypeRacer3DFanProject/1.0';

// Seed pool: verified-active users. Grows automatically from real opponents.
const SEED_POOL = ['keegant'];
const MAX_POOL = 60;

for (const d of [DATA_DIR, CACHE_DIR]) fs.mkdirSync(d, { recursive: true });

/* ---------------------------------------------------------------- utils */

function loadPool() {
  try {
    const p = JSON.parse(fs.readFileSync(POOL_FILE, 'utf8'));
    if (Array.isArray(p) && p.length) return p;
  } catch {}
  return [...SEED_POOL];
}

function savePool(pool) {
  try {
    fs.writeFileSync(POOL_FILE, JSON.stringify([...new Set(pool)].slice(0, MAX_POOL), null, 2));
  } catch {}
}

async function fetchPage(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', rsquo: '\u2019', lsquo: '\u2018',
  ldquo: '\u201C', rdquo: '\u201D', eacute: 'é', egrave: 'è',
};

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => (ENTITIES[name.toLowerCase()] !== undefined ? ENTITIES[name.toLowerCase()] : m));
}

/* TypeRacer texts sometimes use typographic punctuation; normalize to the
 * straight ASCII forms so every char is comfortably typeable. */
function normalizeForTyping(s) {
  return decodeEntities(s.trim())
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2014/g, '—') // keep em dash (TypeRacer expects it; shown in HUD)
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ');
}

/* TypeRacer typing logs ("TLv1,lang,totalChars,<char><delayMs><char><delayMs>...")
 * capture the REAL keystroke stream of a real racer, including typos. We
 * reconstruct when each *correct* char of the text was typed (ms), so 3D bots
 * can literally replay how that human typed this exact text.
 * Returns [msPerChar] or null. */
function parseTypingLog(s, text, listedWpm) {
  if (!s || !s.startsWith('TLv1,')) return null;
  let start = -1, commas = 0;
  for (let k = 0; k < s.length; k++) {
    if (s[k] === ',') { commas++; if (commas === 3) { start = k + 1; break; } }
  }
  if (start < 0) return null;
  const body = s.slice(start);
  const pairs = [];
  let k = 0;
  while (k < body.length) {
    const c = body[k++];
    let d = '';
    while (k < body.length && body[k] >= '0' && body[k] <= '9') d += body[k++];
    pairs.push({ c, d: d ? +d : 0 });
  }
  // walk: timestamp each correct char; error keystrokes are skipped
  const times = [];
  let pointer = 0, t = 0;
  for (const p of pairs) {
    if (pointer < text.length && p.c === text[pointer]) { times.push(t); pointer++; }
    t += p.d;
  }
  if (pointer < text.length || times.length === 0) return null;
  const dur = times[times.length - 1];
  if (dur < 2000) return null;
  if (listedWpm) {
    const implied = (text.length / 5) / (dur / 60000);
    if (implied < listedWpm * 0.4 || implied > listedWpm * 2.5) return null;
  }
  return times;
}

const stripTags = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------- parsers */

function parseHistory(html, user) {
  const rows = html.split('Scores__Table__Row').slice(1);
  const out = [];
  for (const row of rows) {
    const id = (row.match(/\/pit\/result\?id=([^"&<]+)/) || [])[1];
    const wpm = (row.match(/([\d.]+)\s*WPM/) || [])[1];
    const acc = (row.match(/([\d.]+)%/) || [])[1];
    if (id && wpm) {
      out.push({ id: decodeURIComponent(id), wpm: +wpm, acc: acc ? +acc : null, user });
    }
  }
  return out;
}

function parseResult(html, raceId) {
  const textM = /class="fullTextStr">([\s\S]*?)<\/div>/.exec(html);
  const text = textM && textM[1];
  if (!text) return null;

  // Source attribution follows the text node: e.g. "— (book) by George Eliot"
  const after = html.slice(textM.index + textM[0].length, textM.index + textM[0].length + 800);
  const srcM = after.match(/&mdash;\s*\(([^)]+)\)\s*(?:by\s+([^<\n]+))?/);
  const source = srcM ? { medium: srcM[1].trim(), author: srcM[2] ? stripTags(srcM[2]).trim() : '' } : null;

  // Canonical username lives in the profile href; link text is "Display (user)"
  const racerLink = html.match(/userProfileTextLink[^>]*href="\/pit\/profile\?user=([^"&]+)"/);
  const speed = (html.match(/([\d.]+)\s*WPM\s*<\/span>/) || html.match(/([\d.]+)\s*WPM/) || [])[1];
  const acc = (html.match(/Accuracy<\/td>\s*<td>\s*([\d.]+)%/) || [])[1];
  const rankM = html.match(/(\d+)(?:st|nd|rd|th) place \(out of (\d+)\)/);

  const opponents = [];
  const oppRe = /\/pit\/result\?id=([^"]+)">([^<]+)<\/a>\s*\((\d+)(?:st|nd|rd|th) place\)/g;
  let m;
  while ((m = oppRe.exec(html))) {
    const oppUser = decodeURIComponent(m[1]).split('|').filter(Boolean)[0] || '';
    opponents.push({ raceId: decodeURIComponent(m[1]), name: oppUser.replace(/^tr:/, '').trim(), place: +m[3] });
  }

  const typingLog = (html.match(/var typingLog = "([^"]+)"/) || [])[1] || null;

  return {
    id: raceId,
    text: normalizeForTyping(text),
    source,
    racer: racerLink ? racerLink[1].trim() : null,    racerWpm: speed ? +speed : null,
    racerAcc: acc ? +acc : null,
    rank: rankM ? { place: +rankM[1], outOf: +rankM[2] } : null,
    opponents,
    typingLog,
  };
}

function parseProfile(html, user) {
  // Stat cards: "<span ...>150.9 WPM</span> <span ...>Full Avg.</span>" etc.
  const grab = (label) => {
    const i = html.indexOf(label);
    if (i < 0) return null;
    const back = html.slice(Math.max(0, i - 400), i);
    const m = [...back.matchAll(/([\d.,]+)\s*(WPM|%)?</g)].pop();
    if (!m) return null;
    const val = +m[1].replace(/,/g, '');
    return m[2] === 'WPM' ? val : val;
  };
  return {
    ok: true,
    user,
    avgWpm: grab('Full Avg.'),
    bestWpm: grab('Best Race'),
    races: grab('Races'),
  };
}

/* --------------------------------------------------------- data loaders */

const raceCache = new Map(); // raceId -> parsed race JSON (in-memory)
const pending = new Map();   // dedupe concurrent identical fetches

async function loadRaceById(raceId) {
  if (raceCache.has(raceId)) return raceCache.get(raceId);
  if (pending.has(raceId)) return pending.get(raceId);

  const file = path.join(CACHE_DIR, `race-v2-${raceId.replace(/[^\w|-]/g, '_')}.json`);
  const job = (async () => {
    try {
      if (fs.existsSync(file)) {
        const j = JSON.parse(fs.readFileSync(file, 'utf8'));
        raceCache.set(raceId, j);
        return j;
      }
      const html = await fetchPage(`https://data.typeracer.com/pit/result?id=${encodeURIComponent(raceId)}`);
      const parsed = parseResult(html, raceId);
      if (!parsed) throw new Error('could not parse race result page');
      // Opponents link to their own result pages — fetch each to get real WPMs
      // and their real typing logs.
      const racers = [{
        name: parsed.racer, wpm: parsed.racerWpm, acc: parsed.racerAcc,
        place: parsed.rank ? parsed.rank.place : 1,
        log: parseTypingLog(parsed.typingLog, parsed.text, parsed.racerWpm),
      }];
      for (const o of parsed.opponents.slice(0, 5)) {
        try {
          const oh = await fetchPage(`https://data.typeracer.com/pit/result?id=${encodeURIComponent(o.raceId)}`);
          const op = parseResult(oh, o.raceId);
          racers.push({
            name: o.name, wpm: op ? op.racerWpm : null, acc: op ? op.racerAcc : null, place: o.place,
            log: op ? parseTypingLog(op.typingLog, parsed.text, op.racerWpm) : null,
          });
        } catch {
          racers.push({ name: o.name, wpm: null, acc: null, place: o.place, log: null });
        }
      }
      racers.sort((a, b) => a.place - b.place);
      const j = { id: parsed.id, text: parsed.text, source: parsed.source, racers, fetchedAt: Date.now() };
      raceCache.set(raceId, j);
      try { fs.writeFileSync(file, JSON.stringify(j)); } catch {}
      // pool self-growth from real opponents seen in this race
      const pool = loadPool();
      for (const r of racers) if (r.name && !pool.includes(r.name)) pool.push(r.name);
      savePool(pool);
      return j;
    } finally {
      pending.delete(raceId);
    }
  })();
  pending.set(raceId, job);
  return job;
}

/* clean legacy cache files (v1) */
for (const f of fs.readdirSync(CACHE_DIR)) {
  if (f.startsWith('race-') && !f.startsWith('race-v2-')) { try { fs.unlinkSync(path.join(CACHE_DIR, f)); } catch {} }
}

const FALLBACK_TEXTS = [
  { text: 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.', source: { medium: 'book', author: 'Jane Austen' } },
  { text: 'The only way to do great work is to love what you do. If you have not found it yet, keep looking. Do not settle.', source: { medium: 'speech', author: 'Steve Jobs' } },
  { text: 'In three words I can sum up everything I have learned about life: it goes on.', source: { medium: 'poem', author: 'Robert Frost' } },
  { text: 'You must love your work, and not be always looking over the edge of it, wanting your play to begin.', source: { medium: 'book', author: 'George Eliot' } },
];

async function getRace({ avoidId } = {}) {
  const pool = loadPool();
  const errors = [];
  let lastGood = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const user = pool[Math.floor(Math.random() * pool.length)];
    try {
      const histHtml = await fetchPage(`https://data.typeracer.com/pit/race_history?user=${encodeURIComponent(user)}`);
      const rows = parseHistory(histHtml, user);
      if (!rows.length) throw new Error(`no history rows for ${user}`);
      // prefer a race we have not just shown
      const candidates = rows.filter((r) => r.id !== avoidId);
      const pick = candidates[Math.floor(Math.random() * candidates.length)] || rows[0];
      const race = await loadRaceById(pick.id);
      // Prefer races that actually had opponents (more fun to replay)
      if (race && race.text && race.racers.length >= 2) {
        return { ...race, live: true };
      }
      lastGood = race && race.text ? { ...race, live: true } : lastGood;
      throw new Error(`not enough racers for ${pick.id}`);
    } catch (e) {
      errors.push(`${user}: ${e.message}`);
      // drop broken users from the active pool rotation (keep seed)
      if (user !== SEED_POOL[0]) {
        const idx = pool.indexOf(user);
        if (idx >= 0) { pool.splice(idx, 1); savePool(pool); }
      }
    }
  }
  if (lastGood) return lastGood; // solo race is still playable
  // Offline fallback so the game still works without network
  const fb = FALLBACK_TEXTS[Math.floor(Math.random() * FALLBACK_TEXTS.length)];
  return {
    id: null,
    live: false,
    text: fb.text,
    source: fb.source,
    racers: [
      { name: 'Blaze', wpm: 68, acc: 97.2, place: 1 },
      { name: 'Nitro', wpm: 61, acc: 95.8, place: 2 },
      { name: 'Comet', wpm: 55, acc: 96.4, place: 3 },
      { name: 'Rusty', wpm: 47, acc: 93.1, place: 4 },
    ],
    note: `TypeRacer unreachable (${errors.join('; ')}) — using offline fallback text.`,
  };
}

async function getProfile(user) {
  const html = await fetchPage(`https://data.typeracer.com/pit/profile?user=${encodeURIComponent(user)}`);
  const p = parseProfile(html, user);
  if (p.avgWpm === null && p.bestWpm === null && p.races === null) {
    throw new Error('profile not found');
  }
  return p;
}

/* ------------------------------------------------------------ web server */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    if (url.pathname === '/api/race') {
      // ?id=|tr:user|N  -> replay that EXACT race (challenge links)
      const id = url.searchParams.get('id');
      if (id) {
        try {
          const race = await loadRaceById(id);
          if (!race || !race.text) throw new Error('not found');
          return sendJSON(res, 200, { ...race, live: true, challenge: true });
        } catch (e) {
          return sendJSON(res, 404, { ok: false, error: `race not available: ${e.message}` });
        }
      }
      const avoidId = url.searchParams.get('avoidId') || undefined;
      const race = await getRace({ avoidId });
      return sendJSON(res, 200, race);
    }

    if (url.pathname === '/api/profile') {
      const user = (url.searchParams.get('user') || '').trim();
      if (!/^[\w.-]{1,40}$/.test(user)) return sendJSON(res, 400, { ok: false, error: 'bad username' });
      try {
        return sendJSON(res, 200, await getProfile(user));
      } catch (e) {
        return sendJSON(res, 404, { ok: false, error: e.message });
      }
    }

    if (url.pathname === '/api/pool') {
      return sendJSON(res, 200, { pool: loadPool() });
    }

    // local clip upload (used by tooling to save gameplay captures)
    if (url.pathname === '/api/clip' && req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      if (!body.length || body.length > 200 * 1024 * 1024) { res.writeHead(400); return res.end('bad clip'); }
      const out = path.join(__dirname, 'data', `clip-${Date.now()}.webm`);
      fs.writeFileSync(out, body);
      return sendJSON(res, 200, { ok: true, path: path.basename(out), bytes: body.length });
    }

    // static files
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    p = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
    const file = path.join(PUBLIC_DIR, p);
    if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) {
    sendJSON(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n  🏁 TypeRacer 3D running at  http://localhost:${PORT}\n  (keep this window open while playing — close it to stop the game)\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`\n  ✅ TypeRacer 3D is already running at  http://localhost:${PORT}\n`);
    process.exit(0);
  }
  throw err;
});
