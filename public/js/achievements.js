/* Achievements — 12 medals checked after every finished run, stored locally.
 * check() diffs against what's already unlocked and returns the NEW ones so
 * the caller can toast them. The menu renders the full grid. */

const KEY = 'tr3d_achv_v1';
const MODE_COUNT = 7;

export const ACHIEVEMENTS = [
  { id: 'first-win', icon: '🥇', name: 'First Blood', desc: 'finish 1st in any race' },
  { id: 'speed-80', icon: '⚡', name: 'Quick Hands', desc: 'complete a run at 80+ wpm' },
  { id: 'speed-100', icon: '🚀', name: 'Triple Digits', desc: 'complete a run at 100+ wpm' },
  { id: 'flawless', icon: '💎', name: 'Flawless', desc: 'complete a run with ~100% accuracy' },
  { id: 'combo-30', icon: '🔥', name: 'On Fire', desc: 'hit a 30 combo in one race' },
  { id: 'death-survivor', icon: '💀', name: 'Untouchable', desc: 'finish a death-mode race without a single mistake' },
  { id: 'near-death', icon: '🪦', name: 'So Close', desc: 'die past 60% in death mode' },
  { id: 'ghost-slayer', icon: '👻', name: 'Ghost Slayer', desc: 'beat your own personal-best ghost' },
  { id: 'streak-3', icon: '📅', name: 'Habit Forming', desc: '3-day daily challenge streak' },
  { id: 'streak-7', icon: '🗓️', name: 'Weekly Warrior', desc: '7-day daily challenge streak' },
  { id: 'explorer', icon: '🧭', name: 'Explorer', desc: 'try all 7 game modes' },
  { id: 'racer-25', icon: '🏁', name: 'Regular', desc: 'finish 25 races on this device' },
];

function load() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY));
    if (a && a.unlocked) return a;
  } catch (e) {}
  return { unlocked: {} };
}

function save(a) {
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {}
}

export function isUnlocked(id) {
  return !!load().unlocked[id];
}

/* results — RaceController results · ctx — { maxCombo, ghostWasRacing,
 * ghostBeaten, streak, totalRaces, modesPlayed:Set } */
export function check(results, ctx = {}) {
  const a = load();
  const me = results.rows.find((r) => r.isPlayer);
  if (!me) return [];
  const done = me.progress01 >= 1;
  const cond = {
    'first-win': done && me.place === 1,
    'speed-80': done && me.wpm >= 80,
    'speed-100': done && me.wpm >= 100,
    'flawless': done && me.acc >= 99.5,
    'combo-30': (ctx.maxCombo ?? 0) >= 30,
    'death-survivor': done && results.mode === 'death' && !results.died,
    'near-death': results.died && results.died.progress01 >= 0.6,
    'ghost-slayer': ctx.ghostWasRacing && ctx.ghostBeaten,
    'streak-3': (ctx.streak ?? 0) >= 3,
    'streak-7': (ctx.streak ?? 0) >= 7,
    'explorer': (ctx.modesPlayed?.size ?? 0) >= MODE_COUNT,
    'racer-25': (ctx.totalRaces ?? 0) >= 25,
  };
  const fresh = [];
  for (const def of ACHIEVEMENTS) {
    if (!a.unlocked[def.id] && cond[def.id]) {
      a.unlocked[def.id] = Date.now();
      fresh.push(def);
    }
  }
  if (fresh.length) save(a);
  return fresh;
}

export function renderAchievements() {
  const grid = document.getElementById('achvGrid');
  if (!grid) return;
  const a = load();
  const count = Object.keys(a.unlocked).length;
  const head = document.getElementById('achvCount');
  if (head) head.textContent = `${count}/${ACHIEVEMENTS.length}`;
  grid.innerHTML = ACHIEVEMENTS.map((def) => {
    const got = !!a.unlocked[def.id];
    return `<div class="achv ${got ? 'got' : ''}" title="${def.desc}">
      <span class="aIc">${got ? def.icon : '🔒'}</span>
      <span class="aTx"><b>${def.name}</b><small>${got ? def.desc : '???'}</small></span>
    </div>`;
  }).join('');
}
