/* Personal ghost — your fastest completed run, stored locally, replayed as a
 * translucent rival vehicle in any later race. The typing engine already logs
 * per-keystroke timestamps (typing.hits), and the race controller already
 * replays such logs for bots — the ghost is just your own log fed back in.
 * A log recorded on one text replays on any other by scaling timestamps
 * proportionally to text length (it's a pace curve, not a keystroke-for-
 * keystroke copy). */

const KEY = 'tr3d_ghost_v1';

export function getGhost() {
  try {
    const g = JSON.parse(localStorage.getItem(KEY));
    if (g && Array.isArray(g.log) && g.log.length > 4 && g.wpm > 0) return g;
  } catch (e) { /* corrupt — ignore */ }
  return null;
}

/* called after a race with a fully-typed text; ctx = { hits, startedAt, wpm, acc, mode } */
export function maybeSaveGhost({ hits, startedAt, wpm, acc, mode }) {
  if (!startedAt || !hits?.length) return false;
  const cur = getGhost();
  if (cur && wpm <= cur.wpm) return false;
  const log = hits.map((h) => Math.round(h.t - startedAt));
  localStorage.setItem(KEY, JSON.stringify({
    log, wpm: Math.round(wpm * 10) / 10, acc: Math.round(acc * 10) / 10,
    len: log.length, mode, date: Date.now(),
  }));
  return true; // new ghost set
}

/* pace curve of the ghost scaled onto the current text length */
export function ghostLogFor(textLen) {
  const g = getGhost();
  if (!g) return null;
  const k = textLen / g.len;
  return g.log.map((t) => Math.max(80, Math.round(t * k)));
}
