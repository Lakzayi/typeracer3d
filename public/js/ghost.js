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
    if (g && Array.isArray(g.log) && g.log.length > 4 && g.wpm > 0) {
      // a gap > 15s inside the log means the run was recorded across a pause
      // (pre-virtual-clock builds baked paused time in) — the replay would
      // stall mid-race at that point, so don't trust it
      if (g.log[0] > 15000) return null;
      for (let i = 1; i < g.log.length; i++) {
        if (g.log[i] - g.log[i - 1] > 15000) return null;
      }
      return g;
    }
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

/* pace curve of the ghost scaled onto the current text length. Enforces a
 * minimum 40ms interval (monotonic) so heavy compression (fast ghost, much
 * shorter text) can never collapse timestamps into an instant teleport. */
export function ghostLogFor(textLen) {
  const g = getGhost();
  if (!g) return null;
  const k = textLen / g.len;
  let prev = 0;
  return g.log.map((t) => {
    const v = Math.max(prev + 40, Math.round(t * k));
    prev = v;
    return v;
  });
}
