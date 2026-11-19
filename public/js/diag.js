/* flight recorder (r17 diag) — turns a "frozen picture but typing works" report
 * into EVIDENCE instead of guesses. It captures uncaught errors (with stacks,
 * deduped + counted), tracks loop cadence in preallocated rings (no per-frame
 * allocation — c2e95ed rules), timestamps gate/watchdog events, and shows a
 * small badge ONLY after a real error; clicking it copies a full dump the
 * player can paste back to the developer. window.__tr3dDump() always works
 * from the console, even without any error. */
import { GFX } from './gfx.js';

const GAP = new Float64Array(256); // per-frame rAF gap (ms), index-cycled
let head = 0;
let count = 0;
let lastFrameT = -1;

const errors = []; // newest first: { msg, stack, where, at, n }
const events = []; // newest first: { msg, at }
let badge = null;
let badgeText = null;
let badgeTimer = 0;
let copied = false;

function fallbackCopy(txt, done) {
  const ta = document.createElement('textarea');
  ta.value = txt;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch { /* nothing else to try */ }
  ta.remove();
}

function flushBadge() {
  badgeTimer = 0;
  if (!badge || !errors.length) return;
  const e = errors[0];
  const msg = e.msg.length > 110 ? e.msg.slice(0, 110) + '…' : e.msg;
  badgeText.textContent = copied
    ? '⚠ copied ✓ — paste it to the developer'
    : `⚠ ${msg} (×${e.n}) — click to copy report`;
}

function showBadge() {
  if (!badge) {
    badge = document.createElement('div');
    badge.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:99999;'
      + 'max-width:46vw;font:11px/1.4 ui-monospace,Menlo,Consolas,monospace;color:#ffe1e1;'
      + 'background:rgba(132,18,18,.93);border:1px solid #b54444;border-radius:8px;'
      + 'padding:7px 10px;cursor:pointer;user-select:none;display:none;'
      + 'box-shadow:0 4px 14px rgba(0,0,0,.4)';
    badge.title = 'click to copy a diagnostic report';
    badge.addEventListener('click', () => {
      const txt = dumpText();
      const done = () => { copied = true; flushBadge(); };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(txt).then(done, () => fallbackCopy(txt, done));
      else fallbackCopy(txt, done);
    });
    document.body.appendChild(badge);
    badgeText = document.createElement('div');
    badge.appendChild(badgeText);
    badge.style.display = 'block';
  }
  if (!badgeTimer) badgeTimer = setTimeout(flushBadge, 400); // throttle DOM churn on error floods
}

function recordError(msg, stack, where) {
  const e0 = errors[0];
  if (e0 && e0.msg === msg && e0.where === where) e0.n++;
  else errors.unshift({ msg, stack: stack || '', where, at: new Date().toISOString(), n: 1 });
  if (errors.length > 6) errors.pop();
  showBadge();
}

window.addEventListener('error', (e) => {
  recordError(String(e.message ?? e.error ?? 'unknown error'),
    e.error?.stack || '', e.filename ? `${e.filename.split('/').pop()}:${e.lineno}:${e.colno}` : '');
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  recordError(String(r?.message ?? r), r?.stack || '', 'promise');
});

export function diagFrame(t) {
  if (lastFrameT >= 0) {
    GAP[head] = t - lastFrameT;
    head = (head + 1) & 255;
    count++;
  }
  lastFrameT = t;
}

export function diagEvent(msg) {
  events.unshift({ msg, at: new Date().toISOString() });
  if (events.length > 12) events.pop();
}

function frameStats() {
  const n = Math.min(count, 256);
  let max = 0, over500 = 0, over2000 = 0;
  for (let i = 0; i < n; i++) {
    const g = GAP[i];
    if (g > max) max = g;
    if (g > 500) over500++;
    if (g > 2000) over2000++;
  }
  return { sampled: n, maxGapMs: Math.round(max), gapsOver500ms: over500, gapsOver2000ms: over2000 };
}

export function dumpText() {
  const t3d = window.__tr3d;
  const race = t3d?.race;
  return JSON.stringify({
    at: new Date().toISOString(),
    ua: navigator.userAgent,
    page: location.href,
    visibility: { hidden: document.hidden, state: document.visibilityState },
    loop: { lastFrameAgoMs: lastFrameT < 0 ? null : Math.round(performance.now() - lastFrameT), frames: frameStats() },
    gfx: { level: GFX.level ?? null, auto: GFX.auto, usePost: t3d?.world?.usePost ?? null,
      composer: !!t3d?.world?.composer, dpr: t3d?.world?.renderer ? t3d.world.renderer.getPixelRatio() : null },
    race: race ? { phase: race.phase, paused: !!race.paused, mode: race.mode ?? null, progress: typingProgress(race) } : null,
    errors,
    events,
  }, null, 1);
}

function typingProgress(race) {
  try {
    return race.textLen ? Math.round(100 * (window.__tr3d.typing?.pos ?? 0) / race.textLen) : null;
  } catch { return null; }
}
