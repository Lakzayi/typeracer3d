/* net.js — multiplayer rooms over WebRTC via PeerJS (vendored). The core game
 * stays dependency-free: vendor/peerjs.min.js is only <script>-injected the
 * moment the lobby opens, and the free PeerJS cloud server is only used for
 * signaling — game data flows peer-to-peer.
 *
 * Star topology: the host's browser is the room. Clients stream their typing
 * progress to the host (~150 ms), the host merges everything (its own row
 * included) and rebroadcasts a snapshot (~120 ms). Each client feeds those
 * rows into RaceController.applyRemote — no simulation, just live truth.
 *
 * Events (via on()):
 *   'room'    { code, host }            — joined/created
 *   'players' [{ id, name }]            — lobby roster (incl. host)
 *   'status'  { msg, error? }           — human-readable connection updates
 *   'start'   { text, source, raceId }  — host launched the race
 *   'snap'    [{ id, pos, wpm, finished, time, acc }]
 *   'left'    { id }                    — a peer left mid-session
 */

const ID_PREFIX = 'tr3d-';
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/i/l lookalikes
const SELF_SNAP_MS = 150;  // how often a client streams its progress
const BROADCAST_MS = 120;  // how often the host rebroadcasts the merged snapshot

let peer = null;
let conns = [];        // host: every client connection
let myConn = null;     // client: the connection to the host
let isHost = false;
let code = null;
let myName = 'YOU';
let selfId = null;
let roster = new Map(); // id -> name (host's source of truth)
let lastProgress = new Map(); // id -> { pos, wpm, finished, time, acc }
let selfState = { pos: 0, wpm: 0, finished: false, time: null, acc: 95 };
let racing = false;
let timers = [];
let stats = { sent: 0, recv: 0, lastRecvAt: 0, lastSentAt: 0 };
let selfProvider = null; // fresh typing state at SEND time — the render loop
// may be throttled (background tab), but the wire must never go stale

const handlers = {};
export function on(evt, fn) { handlers[evt] = fn; }
function emit(evt, data) { handlers[evt]?.(data); }

export function mpConnected() { return !!peer; }
export function mpHost() { return isHost; }
export function mpCode() { return code; }
export function mpSelfId() { return selfId; }
export function mpPlayers() {
  return [...roster.entries()].map(([id, name]) => ({ id, name }));
}

function loadPeer() {
  return new Promise((resolve, reject) => {
    if (window.Peer) return resolve(window.Peer);
    const s = document.createElement('script');
    s.src = './vendor/peerjs.min.js';
    s.onload = () => resolve(window.Peer);
    s.onerror = () => reject(new Error('could not load the network library — check your connection'));
    document.head.appendChild(s);
  });
}

function makeCode() {
  let c = '';
  for (let i = 0; i < 5; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return c;
}

function stopTimers() {
  timers.forEach(clearInterval);
  timers = [];
}

/* id MUST be the first positional argument — inside the options object the
 * client silently ignores it and the server hands out a random uuid */
function newPeer(id, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = id ? new Peer(id, opts) : new Peer(opts);
    let settled = false;
    p.on('open', () => { if (!settled) { settled = true; resolve(p); } });
    p.on('error', (err) => {
      if (!settled) { settled = true; reject(err); }
      else emit('status', { msg: `network hiccup: ${err.type ?? 'unknown'}` });
    });
  });
}

/* signaling server override — ?peerserver=host:port (or localStorage) points
 * at a self-hosted PeerServer (npx peer). Default: the free PeerJS cloud. */
function peerServerCfg() {
  const src = new URLSearchParams(location.search).get('peerserver')
    ?? localStorage.getItem('tr3d_peerserver');
  if (!src) return {};
  const [host, port] = src.split(':');
  return { host, port: Number(port) || 9000, path: '/', secure: false };
}

/* ---------- host side ---------- */

function hostBroadcast(msg) {
  for (const c of conns) { if (c.open) c.send(msg); }
}

function hostSnapshot() {
  if (!racing) return;
  if (selfProvider) { const s = selfProvider(); if (s) selfState = s; }
  const rows = [{ id: selfId, name: myName, ...selfState }];
  for (const c of conns) {
    const p = lastProgress.get(c.peer);
    if (p) rows.push({ id: c.peer, name: roster.get(c.peer) ?? 'guest', ...p });
  }
  hostBroadcast({ t: 'snap', rows });
  emit('snap', rows); // the host's own race consumes the same merged snapshot
}

function wireHost() {
  peer.on('connection', (conn) => {
    conns.push(conn);
    conn.on('data', (msg) => {
      stats.recv++;
      stats.lastRecvAt = Date.now();
      if (msg?.t === 'hello') {
        roster.set(conn.peer, String(msg.name || 'guest').slice(0, 14) || 'guest');
        hostBroadcast({ t: 'players', players: mpPlayers() });
        emit('players', mpPlayers());
        emit('status', { msg: `${roster.get(conn.peer)} joined` });
      } else if (msg?.t === 'progress') {
        lastProgress.set(conn.peer, {
          pos: msg.pos ?? 0, wpm: msg.wpm ?? 0,
          finished: !!msg.finished, time: msg.time ?? null, acc: msg.acc ?? 95,
        });
      } else if (msg?.t === 'finish') {
        lastProgress.set(conn.peer, {
          pos: msg.pos ?? 0, wpm: msg.wpm ?? 0,
          finished: true, time: msg.time ?? null, acc: msg.acc ?? 95,
        });
      }
    });
    conn.on('close', () => {
      conns = conns.filter((c) => c !== conn);
      const name = roster.get(conn.peer);
      roster.delete(conn.peer);
      lastProgress.delete(conn.peer);
      hostBroadcast({ t: 'left', id: conn.peer });
      emit('players', mpPlayers());
      emit('left', { id: conn.peer });
      if (name) emit('status', { msg: `${name} left` });
    });
  });
}

export async function createRoom(name) {
  await teardown();
  isHost = true;
  myName = name;
  conns = [];
  roster = new Map();
  lastProgress = new Map();
  const Peer = await loadPeer();
  const cfg = peerServerCfg();
  for (let attempt = 0; attempt < 4; attempt++) {
    const c = makeCode();
    try {
      peer = await newPeer(ID_PREFIX + c, cfg);
      code = c;
      break;
    } catch (err) {
      try { peer?.destroy(); } catch {}
      peer = null;
      if (attempt === 3 || String(err?.type) !== 'unavailable-id') {
        throw new Error(err?.type === 'unavailable-id'
          ? 'could not allocate a room code' : `signaling failed: ${err?.type ?? err?.message ?? 'offline'}`);
      }
    }
  }
  selfId = peer.id;
  roster.set(selfId, myName);
  wireHost();
  timers.push(setInterval(hostSnapshot, BROADCAST_MS));
  emit('room', { code, host: true });
  emit('players', mpPlayers());
  return { code, host: true };
}

/* ---------- client side ---------- */

/* connect with typed failures. A real 'peer-unavailable' means the room is
 * genuinely absent (host left the lobby / wrong code); a silent timeout is
 * usually transient signaling — worth exactly one retry before giving up. */
function connectToHost(peer, roomCode) {
  const ROOM_MSG = 'room not found — the host may have left the lobby. Ask for a fresh invite link';
  const attempt = () => new Promise((resolve, reject) => {
    const conn = peer.connect(ID_PREFIX + roomCode, { reliable: true });
    let settled = false;
    const fail = setTimeout(() => { if (!settled) { settled = true; reject({ type: 'timeout' }); } }, 7000);
    peer.on('error', (err) => {
      if (settled || err.type !== 'peer-unavailable') return;
      settled = true; clearTimeout(fail); reject({ type: 'peer-unavailable' });
    });
    conn.on('open', () => { if (!settled) { settled = true; clearTimeout(fail); resolve(conn); } });
  });
  return attempt().catch((e) => {
    if (e.type === 'peer-unavailable') throw new Error(ROOM_MSG);
    return attempt().catch((e2) => {
      if (e2.type === 'peer-unavailable') throw new Error(ROOM_MSG);
      throw new Error("couldn't reach the room — check your connection; the host's lobby may have closed");
    });
  });
}

export async function joinRoom(roomCode, name) {
  await teardown();
  isHost = false;
  myName = name;
  const Peer = await loadPeer();
  peer = await newPeer(null, peerServerCfg()); // random peer id from the server
  selfId = peer.id;
  code = roomCode;
  myConn = await connectToHost(peer, roomCode);
  myConn.on('data', (msg) => {
    stats.recv++;
    stats.lastRecvAt = Date.now();
    if (msg?.t === 'players') {
      roster = new Map(msg.players.map((p) => [p.id, p.name]));
      emit('players', mpPlayers());
    } else if (msg?.t === 'start') {
      emit('start', { text: msg.text, source: msg.source, raceId: msg.raceId });
    } else if (msg?.t === 'snap') {
      emit('snap', msg.rows ?? []);
    } else if (msg?.t === 'left') {
      emit('left', msg);
    }
  });
  myConn.on('close', () => {
    emit('status', { msg: 'host closed the room', error: true });
    emit('roomClosed');
  });
  myConn.send({ t: 'hello', name });
  timers.push(setInterval(clientSelfSnap, SELF_SNAP_MS));
  emit('room', { code, host: false });
  return { code, host: false };
}

function clientSelfSnap() {
  if (!racing || !myConn?.open) return;
  if (selfProvider) { const s = selfProvider(); if (s) selfState = s; }
  stats.sent++;
  stats.lastSentAt = Date.now();
  myConn.send({
    t: selfState.finished ? 'finish' : 'progress',
    pos: selfState.pos, wpm: selfState.wpm,
    time: selfState.time, acc: selfState.acc,
  });
}

/* ---------- shared controls (called by main.js) ---------- */

/* host: launch the same race on every connected browser */
export function startRace(text, source, raceId) {
  if (!isHost) return;
  hostBroadcast({ t: 'start', text, source, raceId });
}

/* main.js hands in a () => {pos, wpm, finished, time, acc} | null getter */
export function setSelfProvider(fn) { selfProvider = fn; }

export function setSelfState(pos, wpm, finished, time = null, acc = 95) {
  const wasFinished = selfState.finished;
  selfState = { pos, wpm, finished, time, acc };
  // the finish row goes out immediately, not on the next interval tick —
  // snapshots stop shortly after results, so this is everyone's last word
  if (finished && !wasFinished) { if (isHost) hostSnapshot(); else clientSelfSnap(); }
}

export function setRacing(v) {
  racing = v;
  if (!v) lastProgress = new Map();
}

export async function teardown() {
  stopTimers();
  racing = false;
  for (const c of conns) { try { c.close(); } catch {} }
  conns = [];
  try { myConn?.close(); } catch {}
  myConn = null;
  try { peer?.destroy(); } catch {}
  peer = null;
  isHost = false;
  code = null;
  selfId = null;
  roster = new Map();
  lastProgress = new Map();
}

/* debug handle (devtools / test harness) */
if (typeof window !== 'undefined') {
  window.__tr3dNet = {
    get peer() { return peer; },
    get conns() { return conns; },
    get myConn() { return myConn; },
    get selfId() { return selfId; },
    get isHost() { return isHost; },
    get roster() { return roster; },
    snapshot() {
      const p = peer;
      return p ? {
        id: p.id, open: p.open, disconnected: p.disconnected,
        conns: conns.map((c) => ({ peer: c.peer, open: c.open })),
        myConn: myConn ? { peer: myConn.peer, open: myConn.open } : null,
        racing, stats,
        lastProgress: [...lastProgress.entries()],
      } : null;
    },
  };
}
