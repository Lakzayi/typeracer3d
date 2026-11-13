/* Personal local stats — every finished run (any mode) lands here, stored in
 * localStorage. No accounts, no network: races, best WPM, recent average and
 * win rate, plus a small "recent runs" feed on the menu. */

import { MODE_ICONS } from './modes.js';

const KEY = 'tr3d_stats_v1';
const MAX_HIST = 30;

const DEFAULTS = () => ({ races: 0, finished: 0, wins: 0, bestWpm: 0, hist: [] });

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && typeof s.races === 'number') return Object.assign(DEFAULTS(), s);
  } catch (e) { /* corrupt/private-mode — start over */ }
  return DEFAULTS();
}

function ago(ts) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 90) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 90) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 36) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function recordRace(results) {
  const me = results.rows.find((r) => r.isPlayer);
  if (!me) return;
  const s = load();
  s.races += 1;
  const entry = {
    t: Date.now(),
    mode: results.mode || 'classic',
    wpm: Math.round(me.wpm),
    acc: Math.round(me.acc * 10) / 10,
    place: me.place,
    died: !!results.died,
    done: me.progress01 >= 1,
  };
  if (entry.done) {
    s.finished += 1;
    if (me.place === 1) s.wins += 1;
    if (entry.wpm > s.bestWpm) s.bestWpm = entry.wpm;
  }
  s.hist.push(entry);
  s.hist = s.hist.slice(-MAX_HIST);
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
}

export function resetStats() {
  try { localStorage.removeItem(KEY); } catch (e) {}
}

export function renderStatsPanel() {
  const cards = document.getElementById('statsCards');
  const recent = document.getElementById('recentRuns');
  if (!cards || !recent) return;
  const s = load();

  if (!s.races) {
    cards.innerHTML = `<div class="statsEmpty">no races yet — your history shows up here after the first run 🏁</div>`;
    recent.innerHTML = '';
    return;
  }

  const last10 = s.hist.filter((e) => e.done).slice(-10);
  const avg = last10.length
    ? Math.round(last10.reduce((a, e) => a + e.wpm, 0) / last10.length)
    : 0;
  const winRate = s.finished ? Math.round((s.wins / s.finished) * 100) : 0;

  cards.innerHTML = `
    <div class="statCard"><b>${s.races.toLocaleString()}</b><label>races</label></div>
    <div class="statCard"><b>${s.bestWpm || '—'}</b><label>best wpm</label></div>
    <div class="statCard"><b>${avg || '—'}<small>${last10.length ? ' · last ' + last10.length : ''}</small></b><label>avg wpm</label></div>
    <div class="statCard"><b>${winRate}%</b><label>win rate</label></div>`;

  recent.innerHTML = s.hist.slice(-6).reverse().map((e) => {
    const icon = e.died ? '💀' : (MODE_ICONS[e.mode] || '🏁');
    const place = e.done ? (['1st', '2nd', '3rd'][e.place - 1] ?? `${e.place}th`) : 'dnf';
    return `<div class="runRow">
      <span class="rIc">${icon}</span>
      <span class="rWpm"><b>${e.wpm}</b> wpm</span>
      <span class="rAcc">${e.acc}%</span>
      <span class="rPlace">${place}</span>
      <span class="ago">${ago(e.t)}</span>
    </div>`;
  }).join('');
}
