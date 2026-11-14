/* TypeRacer 3D — glue: menu → fetch a real race → 3D countdown → typing race
 * → results. The render loop and phase state machine live here.
 * Settings (typing mode, time of day, sound) persist in localStorage. */

import { API } from './api.js';
import { World, hashSeed } from './world.js';
import { THEMES } from './themes/index.js';
import { TypingEngine } from './typing.js';
import { RaceController } from './race.js';
import { HUD } from './hud.js';
import { Sound } from './sound.js';
import { MODES, SOLO_MODES, REAL_DATA_MODES, SHAREABLE_RACE_MODES } from './modes.js';
import { drillRace } from './drills.js';
import { recordRace, renderStatsPanel, resetStats, localStatsSummary } from './stats.js';
import { demoRace } from './demo-data.js';
import { getGhost, maybeSaveGhost, ghostLogFor } from './ghost.js';
import { dailyRace, dailyState, markDailyDone, todayStr } from './daily.js';
import { check as checkAchievements, renderAchievements } from './achievements.js';
import { paintFor, GARAGE_DEFAULTS, PAINTS } from './paints.js';

const $ = (id) => document.getElementById(id);

const hud = new HUD();
const sound = new Sound();
let world = null;
let typing = null;
let race = null;
let phase = 'menu'; // menu | countdown | racing | finished
let currentThemeId = 'car';
let stats = null; // loaded TypeRacer profile
let lastRaceId = null;
let lastPracticeId = null;

/* ---------------- settings ---------------- */

const SETTINGS_KEY = 'tr3d_settings_v1';
const settings = Object.assign(
  { typingMode: 'realistic', timeOfDay: 'day', soundOn: true, ghostOn: false },
  JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
);

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/* ---------------- challenge links (?race=…&theme=…&tod=…&diff=…) ----------------
 * "share / challenge" on the results screen builds one of these URLs: the friend
 * replays the EXACT same real race (same quote, same real opponents) in the same
 * theme. Pure URL params — no backend. */
const urlParams = new URLSearchParams(location.search);
const CHALLENGE = {
  raceId: urlParams.get('race'),
  theme: urlParams.get('theme'),
  tod: urlParams.get('tod'),
  diff: urlParams.get('diff'),
};
if (CHALLENGE.theme && THEMES[CHALLENGE.theme] && THEMES[CHALLENGE.theme].status !== 'soon') {
  currentThemeId = CHALLENGE.theme;
}
if (['day', 'sunset', 'night'].includes(CHALLENGE.tod)) settings.timeOfDay = CHALLENGE.tod;
if (['chill', 'normal', 'hard', 'mine', 'real'].includes(CHALLENGE.diff)) {
  $('difficulty').value = CHALLENGE.diff;
}

function applySettingsToUI() {
  $('typingMode').value = settings.typingMode;
  $('timeOfDay').value = settings.timeOfDay;
  hud.els.soundBtn.textContent = settings.soundOn ? '🔊' : '🔇';
  sound.enabled = settings.soundOn;
}

$('typingMode').addEventListener('change', (e) => {
  settings.typingMode = e.target.value;
  saveSettings();
  if (typing) typing.mode = settings.typingMode;
  hud.toast(settings.typingMode === 'realistic'
    ? '⌨️ Realistic mode — fix mistakes with BACKSPACE'
    : '🕹️ Arcade mode — wrong keys don\'t stick', 2200);
});

$('timeOfDay').addEventListener('change', (e) => {
  settings.timeOfDay = e.target.value;
  saveSettings();
  world?.theme?.setTimeOfDay?.(settings.timeOfDay);
});

hud.els.soundBtn.addEventListener('click', () => {
  settings.soundOn = sound.toggle();
  hud.els.soundBtn.textContent = settings.soundOn ? '🔊' : '🔇';
  saveSettings();
});

/* ---------------- menu ---------------- */

/* the racer list the CURRENT on-screen theme was built with — garage edits
 * repaint its player vehicle live (menu backdrop doubles as the garage view) */
let themeRacers = [{ name: 'YOU', isPlayer: true, paint: null }];

function buildThemeCards() {
  hud.els.themeCards.innerHTML = '';
  for (const t of Object.values(THEMES)) {
    const card = document.createElement('div');
    card.className = 'themeCard' + (t.status === 'soon' ? ' soon' : '') + (t.id === currentThemeId ? ' active' : '');
    card.innerHTML = `<div class="ic">${t.icon}</div><div class="nm">${t.name}</div><div class="st">${t.status === 'soon' ? 'SOON' : '3D · PLAY'}</div>`;
    card.addEventListener('click', () => {
      if (t.status === 'soon') { hud.toast(`${t.icon} ${t.name} — ${t.blurb}`); return; }
      if (currentThemeId === t.id) return;
      currentThemeId = t.id;
      themeRacers = [{ name: 'YOU', isPlayer: true, paint: null }];
      buildThemeCards();
      renderGarage();
      rebuildIdleTheme();
    });
    hud.els.themeCards.appendChild(card);
  }
}

/* ---------- garage: YOUR model + two-tone paint, per theme ---------- */

const GHOST_PAINT = { primary: '#dfe7f2', secondary: '#8fb0ff', variant: 0 }; // spectre livery

const VARIANT_INFO = {
  car: [
    { name: 'GT', desc: 'balanced coupe' },
    { name: 'Muscle', desc: 'wide, scooped, big wing' },
    { name: 'Rally', desc: 'lifted, roof light bar' },
  ],
  horse: [
    { name: 'Warmblood', desc: 'balanced trail horse' },
    { name: 'Racer', desc: 'tall, lean, leggy' },
    { name: 'Draft', desc: 'heavy, feathered legs' },
  ],
  boat: [
    { name: 'Runabout', desc: 'classic speedboat' },
    { name: 'Hydro', desc: 'wide sponson racer' },
    { name: 'Cruiser', desc: 'cabin cruiser' },
  ],
  rocket: [
    { name: 'Classic', desc: 'balanced booster' },
    { name: 'Stubby', desc: 'fat twin-booster hauler' },
    { name: 'Needle', desc: 'slender interceptor' },
  ],
};

/* the player's paint for a theme — garage overrides over curated defaults */
function playerPaint(themeId) {
  return { ...GARAGE_DEFAULTS[themeId], ...(settings.garage?.[themeId] ?? {}), variant: settings.garage?.[themeId]?.model ?? 0 };
}

function setGarage(patch) {
  settings.garage = settings.garage ?? {};
  settings.garage[currentThemeId] = {
    ...GARAGE_DEFAULTS[currentThemeId], ...(settings.garage[currentThemeId] ?? {}), ...patch,
  };
  saveSettings();
  renderGarage();
  rebuildIdleTheme(); // the menu backdrop IS the preview
}

function renderGarage() {
  const info = VARIANT_INFO[currentThemeId] ?? [];
  const themeDef = THEMES[currentThemeId];
  $('garageThemeName').textContent = themeDef ? themeDef.name : '';
  const g = settings.garage?.[currentThemeId] ?? {};
  const model = g.model ?? 0;
  $('garageModels').innerHTML = info.map((v, i) =>
    `<button class="garageModel${i === model ? ' active' : ''}" data-i="${i}"><b>${v.name}</b><small>${v.desc}</small></button>`
  ).join('');
  const list = (PAINTS[currentThemeId] ?? PAINTS.car).list;
  const primaries = [...new Set(list.map((p) => p.primary))];
  const secondaries = [...new Set(list.map((p) => p.secondary))];
  const sw = (colors, cur) => colors.map((c) =>
    `<button class="swatch${c.toLowerCase() === (cur ?? '').toLowerCase() ? ' active' : ''}" data-c="${c}" style="background:${c}"></button>`
  ).join('');
  $('garagePrimary').innerHTML = sw(primaries, g.primary ?? GARAGE_DEFAULTS[currentThemeId].primary);
  $('garageSecondary').innerHTML = sw(secondaries, g.secondary ?? GARAGE_DEFAULTS[currentThemeId].secondary);
  // compact strip on the menu: name + two paint dots
  $('garageMiniLabel').textContent = `${themeDef ? themeDef.name : ''} · ${info[model]?.name ?? 'stock'}`;
  $('garageMiniDots').innerHTML =
    `<i style="background:${g.primary ?? GARAGE_DEFAULTS[currentThemeId].primary}"></i>` +
    `<i style="background:${g.secondary ?? GARAGE_DEFAULTS[currentThemeId].secondary}"></i>`;
}

$('garageModels').addEventListener('click', (e) => {
  const b = e.target.closest('.garageModel');
  if (b) setGarage({ model: Number(b.dataset.i) });
});
$('garagePrimary').addEventListener('click', (e) => {
  const b = e.target.closest('.swatch');
  if (b) setGarage({ primary: b.dataset.c });
});
$('garageSecondary').addEventListener('click', (e) => {
  const b = e.target.closest('.swatch');
  if (b) setGarage({ secondary: b.dataset.c });
});
$('garageRandom').addEventListener('click', () => {
  const list = (PAINTS[currentThemeId] ?? PAINTS.car).list;
  const p = list[Math.floor(Math.random() * list.length)];
  setGarage({ ...p, model: Math.floor(Math.random() * (VARIANT_INFO[currentThemeId]?.length ?? 3)) });
});

/* full-screen garage showroom — a separate page: just YOUR ride on the track
 * under a slow beauty orbit, controls in a glass sheet at the bottom */
let garageOpen = false;
let garageSavedLineup = null;

function openGarage() {
  if (phase !== 'menu' || garageOpen) return;
  garageOpen = true;
  garageSavedLineup = themeRacers;
  themeRacers = [{ name: 'YOU', isPlayer: true, paint: null }];
  hud.els.menu.classList.add('hidden');
  $('garageView').classList.remove('hidden');
  world.showcase = true;
  world.orbitT = Math.PI * 0.65; // open facing the nose, not the tail
  renderGarage();
  rebuildIdleTheme();
}

function closeGarage() {
  if (!garageOpen) return;
  garageOpen = false;
  $('garageView').classList.add('hidden');
  world.showcase = false;
  themeRacers = garageSavedLineup ?? [{ name: 'YOU', isPlayer: true, paint: null }];
  garageSavedLineup = null;
  hud.els.menu.classList.remove('hidden');
  rebuildIdleTheme(); // back to the parked menu lineup
}

$('garageOpenBtn').addEventListener('click', openGarage);
$('garageBackBtn').addEventListener('click', closeGarage);

/* rebuild the on-screen theme with the current paints (same scenery seed —
 * only the vehicles change, so garage edits feel instant) */
function rebuildIdleTheme() {
  if (!THEMES[currentThemeId] || THEMES[currentThemeId].status === 'soon') return;
  if (!world) world = new World($('scene'));
  world.finishMode = false;
  world.focusIdx = 0;
  const racers = themeRacers.map((r) =>
    r.isPlayer ? { ...r, paint: playerPaint(currentThemeId) }
      : r.isGhost ? { ...r, paint: GHOST_PAINT }
      : r
  );
  const theme = THEMES[currentThemeId].create(world, {
    racers, seed: hashSeed('idle:' + currentThemeId), timeOfDay: settings.timeOfDay,
  });
  world.setTheme(theme);
}

/* ---------------- game mode cards (7 modes) ---------------- */

const BOT_NAMES = ['Nova', 'Blitz', 'Comet', 'Vega', 'Echo', 'Turbo', 'Pixel', 'Onyx', 'Zephyr', 'Quark', 'Jolt', 'Rune'];

function buildModeCards() {
  const wrap = $('modeCards');
  if (!wrap) return;
  wrap.innerHTML = '';
  const cur = $('gameMode').value;
  for (const [id, m] of Object.entries(MODES)) {
    const card = document.createElement('div');
    card.className = 'modeCard' + (id === cur ? ' active' : '');
    card.innerHTML = `<div class="ic">${m.icon}</div><div class="nm">${m.name}</div><div class="ds">${m.desc}</div>`;
    card.addEventListener('click', () => setMode(id));
    wrap.appendChild(card);
  }
}

function setMode(mode) {
  if (!MODES[mode] && mode !== 'daily') return; // daily lives on the banner, not a card
  $('gameMode').value = mode;
  settings.mode = mode;
  saveSettings();
  buildModeCards();
  syncModeRows();
}

/* only the rows relevant to the picked mode stay visible */
function syncModeRows() {
  const mode = $('gameMode').value;
  const realRace = REAL_DATA_MODES.includes(mode);
  $('usernameRow').hidden = !realRace;
  $('difficultyRow').hidden = !realRace;
  $('botRow').hidden = mode !== 'bot';
  $('drillRow').hidden = mode !== 'drill';
  $('customRow').hidden = mode !== 'custom';
  // the ghost toggle appears in every mode you personally type in, once a
  // ghost exists (bot battle included — race your pace against your bots)
  $('ghostRow').hidden = !getGhost() || mode === 'daily';
  $('ghostToggle').setAttribute('aria-pressed', String(settings.ghostOn));
  $('ghostLabel').textContent = settings.ghostOn
    ? `on — ${getGhost().wpm} wpm ghost on track`
    : 'off';
}

/* personal ghost — injected as an extra racer that replays your best run */
function ghostRacer(textLen) {
  if (!settings.ghostOn) return null;
  const g = getGhost();
  if (!g) return null;
  return { name: '👻 your best', isGhost: true, wpm: g.wpm, acc: g.acc, log: ghostLogFor(textLen) };
}

/* ---------------- daily challenge banner ---------------- */

function renderDaily() {
  const s = dailyState();
  $('dailyDate').textContent = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  $('dailyStreak').textContent = `🔥 ${s.streak}`;
  $('dailyState').textContent = s.doneToday
    ? `✓ done today — ${s.todayWpm} wpm · best streak ${s.best}`
    : `not done today — one seeded race, same for everyone · best streak ${s.best}`;
}
$('dailyBanner').addEventListener('click', () => {
  setMode('daily');
  startRaceFlow();
});

$('resetStats').addEventListener('click', () => {
  if (confirm('Clear your local race history?')) { resetStats(); renderStatsPanel(); }
});

$('ghostToggle').addEventListener('click', () => {
  settings.ghostOn = !settings.ghostOn;
  saveSettings();
  syncModeRows();
  const g = getGhost();
  if (settings.ghostOn && g) hud.toast(`👻 your ${g.wpm} wpm ghost joins the next race`, 2200);
});

$('loadStats').addEventListener('click', async () => {
  const user = $('userInput').value.trim();
  const line = hud.els.statsLine;
  if (!user) { line.textContent = 'type a username first'; line.className = 'statsLine bad'; return; }
  line.textContent = 'loading real stats…'; line.className = 'statsLine';
  try {
    stats = await API.profile(user);
    line.textContent = `✓ real stats: avg ${stats.avgWpm ?? '?'} wpm · best ${stats.bestWpm ?? '?'} wpm · ${stats.races?.toLocaleString() ?? '?'} races`;
    line.className = 'statsLine good';
  } catch (e) {
    stats = null;
    line.textContent = `✗ ${e.message} — check the username`;
    line.className = 'statsLine bad';
  }
});

$('startBtn').addEventListener('click', () => startRaceFlow());
$('againBtn').addEventListener('click', () => { hud.els.results.classList.add('hidden'); startRaceFlow(); });
$('menuBtn').addEventListener('click', () => backToMenu());

function backToMenu() {
  if (swUpdatePending) { location.reload(); return; } // mid-race update: apply now that we're idle
  if (race) { race.dispose(); race = null; }
  if (sound) sound.stopEngine();
  if (typing) { typing.disable(); }
  phase = 'menu';
  world && (world.finishMode = false);
  world && (world.mirrorEnabled = false);
  hud.showMenu();
  hud.setStartBusy(false);
  hud.centerMsg('');
  hud.setPaused(false);
  hud.showMirror(false);
  hud.updateCombo(0);
  hud.setSpeedGlow(0);
}

window.addEventListener('keydown', (e) => {
  const inTyping = e.target && e.target.id === 'typeInput';
  if (e.key === 'Escape') {
    if (garageOpen) closeGarage();
    else if (phase === 'racing' || phase === 'countdown') backToMenu();
  }
  // live day/night toggle (never while typing the race text!)
  if ((e.key === 'n' || e.key === 'N') && !inTyping && world?.theme?.setTimeOfDay) {
    const order = ['day', 'sunset', 'night'];
    const next = order[(order.indexOf(settings.timeOfDay) + 1) % order.length];
    settings.timeOfDay = next;
    saveSettings();
    $('timeOfDay').value = next;
    world.theme.setTimeOfDay(next);
    hud.toast(next === 'day' ? '☀️ Day' : next === 'sunset' ? '🌇 Sunset' : '🌙 Night', 1200);
  }
});

/* ---------------- race flow ---------------- */

async function startRaceFlow() {
  if (phase === 'countdown' || phase === 'racing' || phase === 'loading') return;
  phase = 'loading';
  hud.setStartBusy(true);

  const mode = $('gameMode').value;
  const solo = SOLO_MODES.includes(mode);
  $('difficulty').disabled = solo || mode === 'bot';
  hud.setStartBusy(true, mode === 'bot' ? '⏳ spinning up bots…'
    : mode === 'drill' || mode === 'custom' ? '⏳ preparing the track…'
    : '⏳ fetching a real race…');
  hud.menuBadge('connecting…');

  let raceData;
  const challengeAttempt = CHALLENGE.raceId;
  try {
    if (mode === 'practice') {
      hud.menuBadge('🧘 loading a Monkeytype quote…');
      raceData = await API.practice(lastPracticeId);
    } else if (mode === 'daily') {
      hud.setStartBusy(true, '⏳ setting up today’s challenge…');
      hud.menuBadge('📅 rolling today’s seeded race…');
      raceData = await dailyRace();
    } else if (mode === 'drill') {
      hud.menuBadge(`🎯 ${$('drillType').value} drill — generating…`);
      raceData = drillRace($('drillType').value);
    } else if (mode === 'custom') {
      const raw = ($('customText').value || '').replace(/\s+/g, ' ').trim();
      if (raw.length < 20) {
        hud.menuBadge('✗ write at least 20 characters of text first (custom mode)', true);
        hud.setStartBusy(false);
        phase = 'menu';
        return;
      }
      raceData = { id: 'custom', custom: true, live: false, text: raw.slice(0, 600), source: 'your own text', note: 'custom text practice', racers: [] };
    } else if (mode === 'bot') {
      hud.menuBadge('🤖 spinning up the bots…');
      const d = demoRace(lastRaceId); // bundled quote as the battlefield
      const n = Math.max(1, Math.min(4, parseInt($('botCount').value, 10) || 2));
      const target = Math.max(20, Math.min(200, parseFloat($('botWpm').value) || 70));
      const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
      raceData = {
        ...d, bot: true,
        racers: Array.from({ length: n }, (_, i) => ({
          name: names[i % names.length], wpm: target,
          acc: 92 + Math.floor(Math.random() * 6),
        })),
      };
    } else if (challengeAttempt) {
      hud.menuBadge('⚔️ loading the challenged race…');
      raceData = await API.race({ id: challengeAttempt }); // throws if it no longer exists
    } else {
      raceData = await API.race(lastRaceId);
    }
    if (REAL_DATA_MODES.includes(mode)) CHALLENGE.raceId = null; // one-shot — "race again" picks a fresh race
  } catch (e) {
    if (challengeAttempt) {
      // the shared race is gone from TypeRacer — degrade gracefully
      hud.menuBadge('⚔️ that race is no longer available — picking a fresh one instead');
      try { raceData = await API.race(lastRaceId); }
      catch (e2) { hud.menuBadge(`✗ could not fetch a race: ${e2.message}`, true); hud.setStartBusy(false); phase = 'menu'; return; }
    } else {
      hud.menuBadge(`✗ could not fetch a race: ${e.message}`, true);
      hud.setStartBusy(false);
      phase = 'menu';
      return;
    }
  }
  lastRaceId = raceData.id;
  if (mode === 'practice') lastPracticeId = raceData.id;
  if (solo) raceData = { ...raceData, racers: [], solo: true, kind: mode }; // solo — nobody else on the grid
  if (raceData.demo && mode !== 'bot') {
    hud.menuBadge('🧪 demo race — start the local server (node server.js) to race real TypeRacer data');
  }

  // personal ghost — one extra racer replaying your best run's exact pace
  // (bots capped at 3 so the 5-lane track fits: you + 3 bots + ghost)
  ghostWasRacing = false; ghostWpmAtStart = 0;
  const gR = ghostRacer(raceData.text.length);
  if (gR) {
    raceData = { ...raceData, racers: [...raceData.racers.slice(0, 3), gR] };
    ghostWasRacing = true;
    ghostWpmAtStart = gR.wpm;
  }

  const difficulty = mode === 'bot' ? 'real' : $('difficulty').value; // bots run at YOUR configured pace
  const myName = stats ? stats.user : null;
  const myWpm = stats ? (stats.avgWpm || 70) : null;

  // --- world + theme ---
  if (!world) world = new World($('scene'));
  world.finishMode = false;
  world.focusIdx = 0;

  const racers = [{ name: 'YOU', isPlayer: true, paint: playerPaint(currentThemeId) }];
  // bots from the real race (same order the controller derives) — each rolls a
  // random model + livery, seeded by THIS race id so replays look identical
  const replaced = myName ? raceData.racers.find((r) => r.name.toLowerCase() === myName.toLowerCase()) : null;
  for (const r of raceData.racers) {
    if (racers.length >= 5) break;
    if (replaced && r.name === replaced.name) continue;
    racers.push({
      name: r.name, isPlayer: false,
      paint: r.isGhost ? GHOST_PAINT : paintFor(currentThemeId, (raceData.id || '') + '|' + r.name),
    });
  }
  themeRacers = racers; // garage edits repaint this lineup live on the menu

  const themeDef = THEMES[currentThemeId];
  const theme = themeDef.create(world, {
    racers,
    seed: hashSeed(raceData.id || 'fallback'),
    timeOfDay: settings.timeOfDay,
  });
  world.setTheme(theme);

  // --- typing engine ---
  if (!typing) typing = new TypingEngine(hud.els.typingText, $('typeInput'), {
    onKey: () => sound.key(),
    onBackspace: () => sound.key(),
    onError: () => { sound.error(); hud.errorFlash(); race && race.notifyError(); hud.updateCombo(typing.combo); },
    onMilestone: (n) => {
      sound.finish(); // little fanfare
      hud.toast(`🔥 ${n} combo — on fire!`, 1600);
    },
    onFinish: () => { hud.updateCombo(0); },
  });
  typing.mode = settings.typingMode;
  typing.setText(raceData.text);
  typing.disable();

  // --- controller ---
  if (race) race.dispose();
  race = new RaceController({ race: raceData, difficulty, myWpm, myName, world, sound, hud, typing, mode });

  // --- hud ---
  const colors = racers.map((r, i) => theme.vehicles[i]?.color ?? '#2e86ff');
  const lanes = racers.map((r, i) => theme.vehicles[i]?.baseX ?? 0);
  hud.showHud();
  hud.setDataBadge(raceData);
  hud.buildBoard(racers, colors, lanes);
  hud.setPaused(false);
  hud.setCaps(false); // stale state from a previous run must not linger
  hud.showMirror(true);
  world.mirrorEnabled = true;
  sound.startEngine(currentThemeId); // propulsion sound of the chosen theme

  phase = 'countdown';
  await countdown();

  if (phase !== 'countdown') return; // left mid-countdown
  phase = 'racing';
  race.begin();
  typing.enable();
  typing.focus();
  hud.centerMsg('');
}

async function countdown() {
  const steps = [['Get Ready…', 'small'], ['3', ''], ['2', ''], ['1', ''], ['GO!', 'go']];
  const durs = [1000, 700, 700, 700, 450];
  for (let i = 0; i < steps.length; i++) {
    if (phase !== 'countdown') return;
    hud.centerMsg(steps[i][0], steps[i][1]);
    if (i > 0 && i < 4) sound.tick();
    if (steps[i][0] === 'GO!') sound.go();
    await new Promise((r) => setTimeout(r, durs[i]));
  }
}

/* ---------------- pause / focus ---------------- */

function setPaused(p) {
  if (!race || race.phase !== 'racing') return;
  race.setPaused(p);
  hud.setPaused(p);
  // freeze/unfreeze the typing clock too — a paused gap must never leak into
  // the keystroke log (ghost replays, PB, wpm display all depend on it)
  if (p) { typing.disable(); typing.pause(); }
  else { typing.enable(); typing.resume(); typing.focus(); }
}

$('pauseOverlay').addEventListener('click', () => setPaused(false));
window.addEventListener('blur', () => { if (phase === 'racing') setPaused(true); });
hud.els.typingPanel.addEventListener('click', () => typing && typing.focus());

/* caps lock watchdog — with caps on, every letter mismatches and the run dies
 * (death mode) or drowns in backspaces; surface it loudly on every keystroke */
for (const evt of ['keydown', 'keyup']) {
  $('typeInput').addEventListener(evt, (e) => {
    if (e.getModifierState) hud.setCaps(e.getModifierState('CapsLock'));
  });
}

/* ---------------- results + personal best ---------------- */

const PB_KEY = 'tr3d_best_v1';
let lastResults = null;
let ghostWasRacing = false;
let ghostWpmAtStart = 0;
const origOnResults = hud.onResults.bind(hud);
hud.onResults = (results) => {
  // ghost bookkeeping — save a new ghost, detect a slayed ghost (BEFORE the
  // hud renders, so the results head can carry the streak)
  const meRow = results.rows.find((r) => r.isPlayer);
  let ghostBeaten = false;
  if (meRow && meRow.progress01 >= 1) {
    ghostBeaten = ghostWasRacing && meRow.wpm > ghostWpmAtStart;
    if (maybeSaveGhost({ hits: typing.hits, startedAt: typing.startedAt, wpm: meRow.wpm, acc: meRow.acc, mode: results.mode }) && ghostWasRacing) {
      setTimeout(() => hud.toast(`👻 your ghost just got faster — ${Math.round(meRow.wpm)} wpm`, 2400), 2600);
    }
  }

  // daily streak
  let streak = dailyState().streak;
  if (results.mode === 'daily' && meRow && meRow.progress01 >= 1) {
    streak = markDailyDone(meRow.wpm);
    renderDaily();
    results.dailyStreak = streak;
  }

  origOnResults(results);
  recordRace(results); // local stats — every run counts, even a death run

  // achievements — toast each unlock
  const fresh = checkAchievements(results, {
    maxCombo: typing.maxCombo,
    ghostWasRacing, ghostBeaten, streak,
    ...localStatsSummary(),
  });
  fresh.forEach((def, i) => setTimeout(() => hud.toast(`🏅 unlocked — ${def.icon} ${def.name}`, 2200), 400 + i * 2300));
  if (fresh.length) renderAchievements();

  renderStatsPanel();
  lastResults = results;
  phase = 'finished';
  hud.showMirror(false);
  world.mirrorEnabled = false;
  hud.updateCombo(0);
  hud.setSpeedGlow(0);

  const me = results.rows.find((r) => r.isPlayer);
  if (me && me.progress01 >= 1) {
    let pb = null;
    try { pb = JSON.parse(localStorage.getItem(PB_KEY) || 'null'); } catch {}
    if (!pb || me.wpm > pb.wpm) {
      localStorage.setItem(PB_KEY, JSON.stringify({ wpm: me.wpm, acc: me.acc }));
      hud.showPB(true);
    } else hud.showPB(false);
  } else hud.showPB(false);
};

/* ---------------- share / challenge ---------------- */

const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

$('shareBtn').addEventListener('click', async () => {
  const me = lastResults && lastResults.rows.find((r) => r.isPlayer);
  if (!me) return;

  // challenge link: replays this exact real race, in this theme & time of day
  const url = new URL(location.href);
  url.search = '';
  const q = new URLSearchParams();
  const shareMode = $('gameMode').value;
  if (lastResults.raceId && SHAREABLE_RACE_MODES.includes(shareMode)) q.set('race', lastResults.raceId);
  if (shareMode !== 'classic') q.set('mode', shareMode);
  if (shareMode === 'bot') { // friends replay the same bot setup
    q.set('bots', $('botCount').value);
    q.set('bwpm', $('botWpm').value);
  }
  if (shareMode === 'drill') q.set('drill', $('drillType').value);
  if (shareMode === 'custom') q.set('text', $('customText').value.trim().slice(0, 600));
  q.set('theme', currentThemeId);
  q.set('tod', settings.timeOfDay);
  const diff = $('difficulty').value;
  if (diff !== 'normal' && REAL_DATA_MODES.includes(shareMode)) q.set('diff', diff);
  url.search = q.toString();

  const place = ORD[me.place - 1] ?? `${me.place}th`;
  const wpm = Math.round(me.wpm * 10) / 10;
  const flex = me.place === 1 ? `🏆 ${place} place` : `🏁 ${place} place`;
  const text = `${flex} · ${wpm} WPM · ${Math.round(me.acc)}% acc — think you can beat me? 🏎️💨`;

  try {
    if (navigator.share) {
      await navigator.share({ title: 'TypeRacer 3D', text, url: url.toString() });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return; // user closed the share sheet
  }
  const full = `${text}\n${url}`;
  try {
    await navigator.clipboard.writeText(full);
    hud.toast('📋 copied — paste it to a friend and race them!', 2800);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = full; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); hud.toast('📋 copied — paste it to a friend and race them!', 2800); }
    catch { hud.toast('couldn\'t copy — long-press the address bar instead', 2800); }
    ta.remove();
  }
});

/* ---------------- render loop ---------------- */

let lastT = performance.now();
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  if (!world) return;

  if (race) {
    race.update(dt);
    world.speed01 = race.state[0].speed01;
    sound.engineSpeed(world.smoothSpeed01);
    world.update(dt, race.state);
    hud.drawMinimap(race.state);
    hud.setSpeedGlow(world.smoothSpeed01 * 0.75);
    if (phase === 'racing') {
      hud.updateBoard(race.state);
      hud.updateStats(race.state, typing, race.playerRank(), race.state.length);
      hud.updateCombo(typing.combo);
    }
  } else if (world.theme) {
    world.update(dt, world.theme.vehicles.map((v) => ({ progress01: 0, speed01: 0, wpm: 0, hideLabel: true })));
  }

  world.render();
}

applySettingsToUI();
buildThemeCards();
renderStatsPanel();
renderAchievements();
renderDaily();
rebuildIdleTheme(); // menu backdrop = a live parked view of YOUR garage ride
renderGarage();
requestAnimationFrame(loop);

/* debug/test handle (also handy in devtools) */
window.__tr3d = {
  get race() { return race; }, get typing() { return typing; }, get world() { return world; },
  get settings() { return settings; }, get sound() { return sound; },
  setPaused, startRaceFlow, backToMenu,
};

/* installable / offline (PWA) — https or localhost only. The SW revalidates
 * assets after every deploy and messages us when bytes changed; we reload once,
 * on our own terms (immediately on the menu, after the race otherwise) so a
 * fresh build appears without any hard refresh. */
let swUpdatePending = false;
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {}));
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data !== 'TR3D_UPDATED') return;
    swUpdatePending = true;
    if (phase === 'menu') location.reload();
    else hud.toast('🔄 new version ready — applies when you return to the menu', 3200);
  });
}

/* challenge links carry the mode (+ its params) — preselect before START.
 * Otherwise restore the mode the player left off on. */
const pm = urlParams.get('mode');
if (pm === 'daily') setMode('daily');
else if (pm && MODES[pm]) setMode(pm);
else if (settings.mode && (MODES[settings.mode] || settings.mode === 'daily')) setMode(settings.mode);
else { buildModeCards(); syncModeRows(); }
if (urlParams.get('bots')) $('botCount').value = String(Math.max(1, Math.min(4, parseInt(urlParams.get('bots'), 10) || 2)));
if (urlParams.get('bwpm')) $('botWpm').value = String(Math.max(20, Math.min(200, parseFloat(urlParams.get('bwpm')) || 70)));
if (['words', 'numbers', 'code'].includes(urlParams.get('drill'))) $('drillType').value = urlParams.get('drill');
if (urlParams.get('text')) $('customText').value = urlParams.get('text').slice(0, 600);

/* menu badge: autoshot harness > challenge link > touch device > default hint */
if (urlParams.get('autoshot')) {
  /* dev harness (graphics QA loop): /?autoshot=theme-tod&race=<id>&freeze=<sec>
   * boots one race, freezes it N wall-clock seconds after GO, then signals READY —
   * a headless browser (--screenshot --virtual-time-budget) captures the frozen view. */
  const [shotTheme, shotTod] = (urlParams.get('autoshot') || '').split('-');
  const freezeSec = parseFloat(urlParams.get('freeze') || '10') || 10;
  if (THEMES[shotTheme]) currentThemeId = shotTheme;
  if (['day', 'sunset', 'night'].includes(shotTod || '')) settings.timeOfDay = shotTod;
  (async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await sleep(300);
    try { await startRaceFlow(); } catch (e) { document.title = 'AUTOSHOT:ERROR:' + e.message; return; }
    const t0 = performance.now();
    while (!(race && race.phase === 'racing') && performance.now() - t0 < 20000) await sleep(100);
    if (!(race && race.phase === 'racing')) { document.title = 'AUTOSHOT:ERROR:no race'; return; }
    // advance the race deterministically: simulate exactly freezeSec of race
    // time in fixed 50ms steps (synchronous — no rAF can interleave), so every
    // run of the QA loop photographs bots at identical positions.
    const steps = Math.round((freezeSec * 1000) / 50);
    for (let i = 0; i < steps; i++) race.update(0.05);
    world.update(0.05, race.state);
    race.setPaused(true);
    document.title = 'AUTOSHOT:READY';
  })();
} else if (CHALLENGE.raceId) {
  hud.menuBadge('⚔️ you\'ve been challenged — press START RACE to replay this exact race!');
} else if (matchMedia('(pointer: coarse)').matches) {
  hud.menuBadge('📱 touch detected — this game plays best with a physical keyboard');
} else {
  hud.menuBadge('🌐 each race is a real TypeRacer race — real text, real racers, real keystroke timing');
}
