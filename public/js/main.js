/* TypeRacer 3D — glue: menu → fetch a real race → 3D countdown → typing race
 * → results. The render loop and phase state machine live here.
 * Settings (typing mode, time of day, sound) persist in localStorage. */

import { API } from './api.js';
import { World, hashSeed, setTrackLength, BASE_TRACK } from './world.js';
import { THEMES } from './themes/index.js';
import { TypingEngine } from './typing.js';
import { RaceController } from './race.js';
import { HUD } from './hud.js';
import { Sound } from './sound.js';
import { MODES, SOLO_MODES, REAL_DATA_MODES, SHAREABLE_RACE_MODES } from './modes.js';
import { drillRace, COMMON_WORDS } from './drills.js';
import { recordRace, renderStatsPanel, resetStats, localStatsSummary } from './stats.js';
import { demoRace } from './demo-data.js';
import { getGhost, maybeSaveGhost, ghostLogFor } from './ghost.js';
import { dailyRace, dailyState, markDailyDone, todayStr } from './daily.js';
import { check as checkAchievements, renderAchievements } from './achievements.js';
import { paintFor, GARAGE_DEFAULTS, PAINTS } from './paints.js';
import { drawShareCard, shareCard } from './share.js';
import { getLanguage, pickPoolText } from './languages.js';
import {
  on as mpOn, createRoom as mpCreateRoom, joinRoom as mpJoinRoom,
  teardown as mpTeardown, startRace as mpNetStart, setSelfState, setSelfProvider, setRacing,
  mpConnected, mpHost, mpCode, mpSelfId, mpPlayers, sendEnv as mpSendEnv, setMyGarage as mpSetMyGarage,
} from './net.js';

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
  { typingMode: 'realistic', timeOfDay: 'day', soundOn: true, keySound: true, ghostOn: false, language: 'en' },
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

/* RTL languages (Persian, Arabic) flip the typing flow right-to-left */
function applyLanguageDir() {
  const lang = getLanguage(settings.language);
  document.body.classList.toggle('lang-rtl', lang.dir === 'rtl');
}

function applySettingsToUI() {
  $('typingMode').value = settings.typingMode;
  $('timeOfDay').value = settings.timeOfDay;
  $('language').value = settings.language;
  applyLanguageDir();
  hud.els.soundBtn.textContent = settings.soundOn ? '🔊' : '🔇';
  sound.enabled = settings.soundOn;
  syncKeySoundUI();
}

/* ⌨️ mechanical typing clicks — independent of the master mute */
function syncKeySoundUI() {
  const on = settings.keySound ?? true;
  sound.keySound = on;
  $('keySound').value = on ? 'on' : 'off';
  hud.els.keySoundBtn.textContent = on ? '⌨️' : '⌨';
  hud.els.keySoundBtn.classList.toggle('muted', !on);
  hud.els.keySoundBtn.title = on ? 'typing key sounds: ON' : 'typing key sounds: OFF';
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

$('language').addEventListener('change', (e) => {
  settings.language = e.target.value;
  saveSettings();
  applyLanguageDir();
  const lang = getLanguage(settings.language);
  hud.toast(lang.dir === 'rtl'
    ? `${lang.flag} ${lang.name} — RTL typing flow · texts from the bundled pool`
    : settings.language === 'en'
      ? `${lang.flag} English — live TypeRacer data`
      : `${lang.flag} ${lang.name} — texts from the bundled pool`, 2600);
});

hud.els.soundBtn.addEventListener('click', () => {
  settings.soundOn = sound.toggle();
  hud.els.soundBtn.textContent = settings.soundOn ? '🔊' : '🔇';
  saveSettings();
});

$('keySound').addEventListener('change', (e) => {
  settings.keySound = e.target.value === 'on';
  syncKeySoundUI();
  saveSettings();
});
hud.els.keySoundBtn.addEventListener('click', () => {
  settings.keySound = !(settings.keySound ?? true);
  syncKeySoundUI();
  saveSettings();
  hud.toast(settings.keySound ? '⌨️ key sounds on' : '🔇 key sounds off', 1300);
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
    { name: 'Muscle', desc: 'side pipes, splitter, diffuser' },
    { name: 'Rally', desc: 'light bar, big wing, mud flaps' },
  ],
  horse: [
    { name: 'Warmblood', desc: 'balanced trail horse' },
    { name: 'Racer', desc: 'jockey in a race crouch' },
    { name: 'Draft', desc: 'work collar, anchor hooves' },
  ],
  boat: [
    { name: 'Runabout', desc: 'classic speedboat' },
    { name: 'Hydro', desc: 'canopy, fin, raked stacks' },
    { name: 'Cruiser', desc: 'railing, radar arch, platform' },
  ],
  rocket: [
    { name: 'Classic', desc: 'balanced booster' },
    { name: 'Lifter', desc: 'twin boosters + tail fins' },
    { name: 'Fighter', desc: 'delta wings, twin engines' },
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
  if (mpConnected()) mpSetMyGarage(settings.garage); // everyone in the room repaints you
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
  if (mpOpen) $('mpView').classList.add('hidden'); // garage overlays the room lobby
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
  if (mpOpen) {
    $('mpView').classList.remove('hidden'); // back to the room, not the menu
  } else {
    hud.els.menu.classList.remove('hidden');
  }
  rebuildIdleTheme(); // parked lineup (room lineup if inside a lobby)
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
  const ghost = getGhost();
  $('ghostRow').hidden = !ghost || mode === 'daily';
  $('ghostToggle').setAttribute('aria-pressed', String(settings.ghostOn));
  $('ghostLabel').textContent = settings.ghostOn && ghost
    ? `on — ${ghost.wpm} wpm ghost on track`
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
$('againBtn').addEventListener('click', () => {
  hud.els.results.classList.add('hidden');
  if (mpConnected()) { backToMenu(); return; } // mp 'again' = the room lobby, never a stray solo race
  startRaceFlow();
});
$('menuBtn').addEventListener('click', () => backToMenu());

function backToMenu() {
  if (swUpdatePending) { location.reload(); return; } // mid-race update: apply now that we're idle
  // leaving a CONNECTED mp race keeps the room alive: the results' exit
  // returns to the lobby so the host can start the next race (teardown used
  // to fire here and killed the room for everyone the instant a finisher
  // — host above all — hit menu while others were still mid-race)
  // ANY race exit while connected to a room lands in the lobby — solo
  // practice rides included (ghost practice must never tear the room down)
  const backToLobby = !!race && mpConnected();
  if (race) { race.dispose(); race = null; }
  if (backToLobby) setRacing(false);
  else if (mpConnected()) { setRacing(false); mpTeardown(); }
  if (sound) sound.stopEngine();
  if (typing) { typing.disable(); }
  phase = 'menu';
  world && (world.finishMode = false);
  world && (world.mirrorEnabled = false);
  world && setTrackLength(BASE_TRACK); // menu idle theme rebuilds at the standard road
  world && (world.combo01 = 0);
  hud.showMenu();
  hud.setStartBusy(false);
  hud.centerMsg('');
  hud.setPaused(false);
  hud.setHearts(0, 0);
  hud.showMistakes(false);
  hud.showMirror(false);
  hud.updateCombo(0);
  hud.setSpeedGlow(0);
  hud.setSpeedBlur(0);
  ghost = null;
  hud.showSpectateBar(false);
  world && world.setSpectate(null);
  hud.els.typingPanel.classList.remove('hidden');
  if (backToLobby) reopenRoomLobby();
}

/* 👻 spectate — stay in the finished race and watch the rest cinematically */
function enterSpectate() {
  if (!race || race.mode !== 'mp') return;
  ghost = 'spectate';
  race.spectating = true;
  hud.els.results.classList.add('hidden');
  hud.els.typingPanel.classList.add('hidden');
  hud.showMirror(false);
  world.finishMode = false;
  world.mirrorEnabled = false;
  world.setSpectate('cinematic');
  // land on the first racer still out on the track (fall back to a remote)
  const stillIn = race.racers.findIndex((r) => !r.isPlayer && !r.finished);
  world.focusIdx = stillIn >= 0 ? stillIn : (race.racers.length > 1 ? 1 : 0);
  hud.showSpectateBar(true, race.racers.map((r) => r.name), world.focusIdx);
  hud.setSpectateCam('cinematic');
}

/* ⌨️ ghost practice — an endless word stream keeps the fingers warm while the
 * room finishes; the moment every racer is done, the lobby pulls you back */
function enterGhostPractice() {
  if (!mpConnected() || !race) return;
  ghost = 'practice';
  hud.showSpectateBar(false);
  world.setSpectate(null);
  hud.els.typingPanel.classList.remove('hidden');
  setRacing(false); // my progress stream is done — practice stays local
  const parts = [];
  let len = 0;
  while (len < 1400) { const t = drillRace('words').text; parts.push(t); len += t.length + 1; }
  launchRace({ id: 'ghost-words-' + Date.now(), drill: true, live: false,
    text: parts.join(' '), source: 'ghost practice — endless words', racers: [] },
    { mode: 'drill', difficulty: 'real' });
}

function endGhost(reason) {
  const was = ghost;
  ghost = null;
  if (!was) return;
  hud.showSpectateBar(false);
  world && world.setSpectate(null);
  if (reason === 'finished') hud.toast('🏁 the race is over — back to the lobby', 2400);
  backToMenu(); // mpConnected -> lands in the room lobby
}

/* an mp race ended — return to the SAME room lobby. The room only closes
 * when someone leaves the lobby explicitly (host leaving = room closed). */
function reopenRoomLobby() {
  if (!mpConnected()) return;
  mpOpen = true;
  hud.els.menu.classList.add('hidden');
  $('mpView').classList.remove('hidden');
  rebuildRoomLineup(); // lobby backdrop = the live room lineup
  showMpWait();
  if (!mpHost()) mpAcked = true; // already in the roster — skip the 12s 'never confirmed' warning
  setMpStatus(mpHost()
    ? '🏁 race over — start the next one when everyone is back'
    : '🏁 race over — waiting for the host to start the next one');
}

window.addEventListener('keydown', (e) => {
  const inTyping = e.target && e.target.id === 'typeInput';
  /* space resumes a paused race — after alt-tab people reach for the
   * keyboard, not the mouse; harmless while typing because the engine is
   * disabled and the input never sees it (window handler runs on bubble) */
  if (race && race.paused && (e.key === ' ' || e.code === 'Space')) {
    e.preventDefault();
    setPaused(false);
    return;
  }
  /* 👻 spectating: ←/→ switch the watched racer, V cycles the camera */
  if (ghost === 'spectate' && race) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const n = race.racers.length;
      const d = e.key === 'ArrowRight' ? 1 : -1;
      for (let i = 1; i <= n; i++) {
        const idx = (((world.focusIdx + d * i) % n) + n) % n;
        if (world.theme?.vehicles?.[idx]) { world.focusIdx = idx; hud.setSpectateRacer(idx); break; }
      }
      return;
    }
    if (e.key === 'v' || e.key === 'V') { $('spCam').click(); return; }
  }
  if (e.key === 'Escape') {
    if (garageOpen) closeGarage(); // garage may sit on top of the room lobby
    else if (mpOpen) closeMpLobby();
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

/* non-English languages: swap the race TEXT for a bundled pool text. The
 * fetched bot field stays — bots replay keystroke TIMING, which is text-
 * independent, so a Persian race still runs against real TypeRacer pace. */
function applyLanguageToRace(raceData) {
  if (settings.language === 'en') return raceData;
  const lang = getLanguage(settings.language);
  const pick = pickPoolText(settings.language);
  if (!pick) return raceData;
  return { ...raceData, text: pick.text, langPool: lang.name, langSource: pick.source };
}

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
      if (settings.language !== 'en') {
        const lang = getLanguage(settings.language);
        const pick = pickPoolText(settings.language);
        raceData = { id: 'pool-' + Date.now(), live: false, practice: true,
          text: pick.text, source: `${lang.name} · ${pick.source}`,
          note: 'practice text from the bundled pool', racers: [] };
      } else {
        hud.menuBadge('🧘 loading a Monkeytype quote…');
        raceData = await API.practice(lastPracticeId);
      }
    } else if (mode === 'daily') {
      hud.setStartBusy(true, '⏳ setting up today’s challenge…');
      hud.menuBadge('📅 rolling today’s seeded race…');
      raceData = await dailyRace(settings.language);
    } else if (mode === 'drill') {
      hud.menuBadge(`🎯 ${$('drillType').value} drill — generating…`);
      raceData = drillRace($('drillType').value);
    } else if (mode === 'custom') {
      // keep line breaks! paragraphs are typed with Enter — only collapse
      // space runs and dead space around the breaks
      const raw = ($('customText').value || '')
        .replace(/[ \t]+/g, ' ')
        .split('\n').map((l) => l.trim()).join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (raw.length < 20) {
        hud.menuBadge('✗ write at least 20 characters of text first (custom mode)', true);
        hud.setStartBusy(false);
        phase = 'menu';
        return;
      }
      raceData = { id: 'custom', custom: true, live: false, text: raw.slice(0, 600), source: 'your own text', note: 'custom text practice', racers: [] };
    } else if (mode === 'bot') {
      hud.menuBadge('🤖 spinning up the bots…');
      const d = applyLanguageToRace(demoRace(lastRaceId)); // pool text on the battlefield
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
      raceData = applyLanguageToRace(await API.race(lastRaceId));
    }
    if (REAL_DATA_MODES.includes(mode)) CHALLENGE.raceId = null; // one-shot — "race again" picks a fresh race
  } catch (e) {
    if (challengeAttempt) {
      // the shared race is gone from TypeRacer — degrade gracefully
      hud.menuBadge('⚔️ that race is no longer available — picking a fresh one instead');
      try { raceData = applyLanguageToRace(await API.race(lastRaceId)); }
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
  await launchRace(raceData, { mode, difficulty, myName, myWpm });
}

/* shared tail of every race path (solo / bot / challenge / multiplayer):
 * world + theme lineup, typing engine, controller, HUD, countdown, GO */
async function launchRace(raceData, { mode, difficulty, myName = null, myWpm = null, mpDeath = false, hpMax = 0 }) {
  // --- world + theme ---
  if (!world) world = new World($('scene'));
  world.finishMode = false;
  world.focusIdx = 0;
  world.setSpectate((settings.view ?? 'chase') === 'cockpit' ? 'cockpit' : null); // remember your camera
  $('viewBtn').textContent = world.spectateStyle === 'cockpit' ? '🪖' : '🎥';
  // the road scales with the text: perceived speed then tracks wpm only —
  // a 600-char custom run is a LONGER road, not a slow crawl (same wpm =
  // same world-units/second). REF = 200 chars → base 900 units; clamps keep
  // tiny drills from feeling cramped and 600-char customs from being absurd.
  setTrackLength(Math.round(Math.max(420, Math.min(2900, BASE_TRACK * (raceData.text || '').length / 200))));

  const racers = [{ name: 'YOU', isPlayer: true, paint: playerPaint(currentThemeId) }];
  // opponents in race order (same order the controller derives) — each rolls a
  // random model + livery, seeded by THIS race id so replays look identical,
  // unless they brought their own garage livery (multiplayer guests/host)
  const replaced = myName ? raceData.racers.find((r) => r.name.toLowerCase() === myName.toLowerCase()) : null;
  for (const r of raceData.racers) {
    if (racers.length >= 5) break;
    if (replaced && r.name === replaced.name) continue;
    racers.push({
      name: r.name, isPlayer: false,
      paint: r.isGhost ? GHOST_PAINT
        : r.paint ?? paintFor(currentThemeId, (raceData.id || '') + '|' + r.name),
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
    onError: (expected, typed) => { sound.error(); hud.errorFlash(); race && race.notifyError(expected, typed); hud.updateCombo(typing.combo); },
    onMilestone: (n) => {
      sound.finish(); // little fanfare
      world.pulse(0.7); // FOV kick + streak burst — progress feels like speed
      hud.toast(`🔥 ${n} combo — on fire!`, 1600);
    },
    onFinish: () => { hud.updateCombo(0); },
  });
  typing.mode = settings.typingMode;
  // one normalization at the source: race.textLen and the typing engine must
  // see the SAME string (CRLF paste would otherwise inflate the track length)
  raceData.text = String(raceData.text ?? '').replace(/\r\n?/g, '\n');
  typing.setText(raceData.text);
  typing.disable();

  // --- controller ---
  if (race) race.dispose();
  race = new RaceController({ race: raceData, difficulty, myWpm, myName, world, sound, hud, typing, mode, mpDeath, hpMax, wordsMode: raceData.wordsMode });

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
  if (results.mode === 'mp') {
    // keep the snapshot stream alive for a moment — peers on slower paths
    // still need the final finish rows to build their own results board
    setTimeout(() => setRacing(false), 800);
  }
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

/* share card — a 1200×630 PNG of the result for chats/social */
$('shareCardBtn').addEventListener('click', async () => {
  const results = lastResults;
  const me = results && results.rows.find((r) => r.isPlayer);
  if (!me) return;
  const themeDef = THEMES[currentThemeId];
  const modeDef = MODES[results.mode] ?? MODES.classic;
  const died = !!results.died;
  const solo = SOLO_MODES.includes(results.mode);
  const card = drawShareCard({
    wpm: Math.round(me.wpm),
    acc: me.acc,
    time: me.time,
    place: died || solo ? null : (ORD[me.place - 1] ?? `${me.place}th`),
    medal: died ? '' : solo ? '🏁'
      : (['🥇', '🥈', '🥉'][me.place - 1] ?? '🏁'),
    modeLabel: `${modeDef.icon} ${modeDef.name} · ${died ? 'death run' : solo ? 'solo run' : 'race'} — ${new Date().toLocaleDateString()}`,
    themeLabel: `${themeDef ? themeDef.icon + ' ' + themeDef.name : ''}`,
    streak: results.mode === 'daily' ? results.dailyStreak : null,
    diedPct: died ? Math.round(results.died.progress01 * 100) : null,
  });
  const res = await shareCard(card, `typeracer3d-${Math.round(me.wpm)}wpm.png`);
  if (res === 'shared') hud.toast('📣 card sent — show them who types faster!', 2400);
  else if (res === 'downloaded') hud.toast('📸 PNG saved — post it anywhere!', 2800);
});

/* ---------------- multiplayer lobby (peer-to-peer via PeerJS) ---------------- */

let mpOpen = false;
let mpBusy = false;
let mpAcked = false; // client: the host's roster broadcast confirmed our hello
let mpDeathOn = false; // 💀 death mode: a mistake throws you back to the start line
let mpHpHearts = 0; // ❤️ hp mode: N mistakes forgiven before the start-line reset (mp)
let ghost = null; // 👻 post-finish state: null | 'spectate' | 'practice'

/* host picks (or a 'start' carries) an environment — everyone rebuilds the
 * same world, so the lobby preview AND the race look identical everywhere */
function applyMpEnv(theme, tod, death, hp) {
  // one select drives both: hp>0 = hearts, 'death' = strict reset on 1st mistake
  if (hp !== undefined && hp > 0) { mpHpHearts = Math.min(3, hp); mpDeathOn = false; }
  else if (death !== undefined || hp !== undefined) { mpHpHearts = 0; mpDeathOn = !!death; }
  const sel = $('mpHpMode');
  if (sel && (death !== undefined || hp !== undefined))
    sel.value = mpHpHearts ? String(mpHpHearts) : (mpDeathOn ? 'death' : 'off');
  if (race || phase !== 'menu') return; // never re-theme mid-race
  let changed = false;
  if (theme && THEMES[theme]?.status === 'live' && theme !== currentThemeId) {
    currentThemeId = theme;
    changed = true;
  }
  if (tod && ['day', 'sunset', 'night'].includes(tod) && tod !== settings.timeOfDay) {
    settings.timeOfDay = tod;
    const sel = $('timeOfDay');
    if (sel) sel.value = tod;
    changed = true;
  }
  if (changed) {
    buildThemeCards();
    renderGarage();
    rebuildIdleTheme();
    updateMpEnvLine();
  }
}

/* the lobby backdrop shows the ROOM lineup with everyone's chosen livery —
 * garage edits anywhere repaint every screen in the room, live */
function rebuildRoomLineup() {
  if (!mpOpen || race || phase !== 'menu') return;
  themeRacers = mpPlayers().map((p) => ({
    name: p.name,
    isPlayer: p.id === mpSelfId(),
    paint: p.id === mpSelfId() ? null
      : p.garage?.[currentThemeId]
        ? { ...GARAGE_DEFAULTS[currentThemeId], ...p.garage[currentThemeId], variant: p.garage[currentThemeId].model ?? 0 }
        : null,
  }));
  rebuildIdleTheme();
}

function updateMpEnvLine() {
  const el = $('mpEnvLine');
  if (!el) return;
  const show = mpOpen && !mpHost();
  el.classList.toggle('hidden', !show);
  if (show) {
    const t = THEMES[currentThemeId];
    el.textContent = `🗺 environment: ${t?.icon ?? ''} ${t?.name ?? currentThemeId} · ${settings.timeOfDay} — the host's choice`
      + (mpHpHearts ? ` · ❤️ hp: ${mpHpHearts} heart${mpHpHearts > 1 ? 's' : ''}` : '')
      + (mpDeathOn ? ' · 💀 death mode ON' : '');
  }
}

const escHtml = (s) => s.replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function setMpStatus(msg, err = false) {
  const el = $('mpStatus');
  if (!el) return;
  el.textContent = msg ?? '';
  el.classList.toggle('err', !!err);
}

function renderMpPlayers() {
  const players = mpPlayers();
  const self = mpSelfId();
  $('mpPlayerList').innerHTML = players.map((p) => {
    const tag = p.id === self
      ? `<small>you${mpHost() ? ' · host' : ''}</small>`
      : mpHost() ? '' : '<small>host</small>';
    return `<div class="mpPl"><span class="dot"></span>${escHtml(p.name)}${tag}</div>`;
  }).join('');
  $('mpHostCtrls').classList.toggle('hidden', !mpHost());
  $('mpGuestHint').classList.toggle('hidden', mpHost());
}

function showMpHome() {
  $('mpHome').classList.remove('hidden');
  $('mpWait').classList.add('hidden');
  for (const id of ['mpCreateBtn', 'mpJoinBtn', 'mpCode']) $(id).disabled = false;
  mpBusy = false;
  setMpStatus('');
}

function showMpWait() {
  $('mpHome').classList.add('hidden');
  $('mpWait').classList.remove('hidden');
  mpBusy = false; // create/join finished — unblock the start button
  const host = mpHost();
  $('mpRoomLine').innerHTML = host
    ? `send this code to your friend — or click it to copy the invite link<b id="mpCodeBig">${mpCode()}</b>`
    : `room <b style="font-size:22px">${escHtml(mpCode())}</b> — you are in!`;
  if (host) {
    $('mpCodeBig')?.addEventListener('click', async () => {
      const url = new URL(location.href);
      url.search = '?room=' + mpCode();
      try { await navigator.clipboard.writeText(url.toString()); hud.toast('📋 invite link copied', 2200); } catch {}
    });
  }
  renderMpPlayers();
  setMpStatus('');
  if (host) {
    // env controls start from the host's CURRENT world — the lobby backdrop
    // is already showing it, so guests joining see exactly this
    $('mpEnvTheme').value = currentThemeId;
    $('mpEnvTod').value = settings.timeOfDay;
    $('mpLang').value = settings.language;
    $('mpHpMode').value = mpHpHearts ? String(mpHpHearts) : (mpDeathOn ? 'death' : 'off');
  } else {
    updateMpEnvLine();
  }
  if (!host) {
    // "you are in" must be honest: it only counts once the host's roster
    // broadcast confirms our hello actually landed. Until then, say so.
    mpAcked = false;
    setMpStatus('waiting for the host to confirm the connection…');
    setTimeout(() => {
      if (mpOpen && !mpHost() && !mpAcked)
        setMpStatus('⚠ never confirmed by the host — it may be offline, or your network blocks the connection; leave and try again', true);
    }, 12000);
  }
}

function openMpLobby(autoCode = null) {
  if (phase !== 'menu' || mpOpen) return;
  mpOpen = true;
  hud.els.menu.classList.add('hidden');
  $('mpView').classList.remove('hidden');
  $('mpName').value = settings.name ?? '';
  showMpHome();
  if (autoCode) { $('mpCode').value = autoCode; joinWithCode(); }
}

function closeMpLobby() {
  if (!mpOpen) return;
  if (garageOpen) closeGarage(); // garage over the room closes with it
  mpOpen = false;
  $('mpView').classList.add('hidden');
  hud.els.menu.classList.remove('hidden');
  mpTeardown();
}

async function joinWithCode() {
  const c = ($('mpCode').value || '').trim().toLowerCase();
  if (!c || mpBusy) return;
  mpBusy = true;
  $('mpJoinBtn').disabled = true;
  $('mpCreateBtn').disabled = true;
  setMpStatus('connecting…');
  const name = ($('mpName').value || '').trim() || 'YOU';
  settings.name = name; saveSettings();
  try {
    await mpJoinRoom(c, name, settings.garage ?? {});
    showMpWait();
  } catch (e) {
    setMpStatus(e.message, true);
    $('mpJoinBtn').disabled = false;
    $('mpCreateBtn').disabled = false;
    mpBusy = false;
  }
}

/* 🔤 word race pool — the language's own words (fa pool texts), English
 * common words otherwise; independent words joined by spaces, 10ff style */
function mpWordPool(langId) {
  if (langId !== 'en') {
    const lang = getLanguage(langId);
    if (lang.pool.length) {
      const bag = new Set();
      for (const p of lang.pool) {
        for (const w of p.text.split(/\s+/)) {
          const clean = w.replace(/[.,;:!?«»"'()\-]/g, '');
          if (clean.length >= 1) bag.add(clean);
        }
      }
      if (bag.size >= 12) return [...bag];
    }
  }
  return COMMON_WORDS;
}

function generateWordText(langId, count) {
  const pool = mpWordPool(langId);
  const out = [];
  for (let i = 0; i < count; i++) out.push(pool[Math.floor(Math.random() * pool.length)]);
  return out.join(' ');
}

/* host pressed START — fetch (or take) the text, tell everyone, race */
async function mpHostStart() {
  if (!mpHost() || mpBusy) return;
  mpBusy = true;
  $('mpStartBtn').disabled = true;
  try {
    const type = $('mpRaceType').value;
    let text, source, raceId, words = false;
    if (type === 'custom') {
      text = $('mpCustomText').value.trim();
      if (!text) { setMpStatus('paste a text first', true); return; }
      source = 'custom text';
      raceId = 'mp-' + Date.now().toString(36);
    } else if (type === 'words') {
      /* host's own words (dot-separated: سلام.خوبی.وای) win over the random
       * generator — empty box falls back to the language word pool */
      const custom = $('mpCustomWords').value.split('.').map((w) => w.trim()).filter(Boolean).slice(0, 300);
      if (custom.length) {
        text = custom.join(' ');
        source = `${custom.length} custom words`;
      } else {
        const count = Math.max(5, Math.min(300, Number($('mpWordCount').value) || 25));
        const lang = getLanguage(settings.language);
        text = generateWordText(settings.language, count);
        source = `${count} random words · ${lang.flag} ${lang.name}`;
      }
      raceId = 'mp-words-' + Date.now().toString(36);
      words = true;
    } else {
      setMpStatus('fetching a real race…');
      const rd = applyLanguageToRace(await API.race());
      text = rd.text; source = rd.source; raceId = rd.id;
    }
    setMpStatus('');
    // the host's environment travels with the start (late joiners included)
    mpNetStart(text, source, raceId, { theme: currentThemeId, tod: settings.timeOfDay, death: mpDeathOn, hp: mpHpHearts, words });
    await mpLaunch({ text, source, raceId, words });
  } catch (e) {
    setMpStatus('could not start: ' + e.message, true);
  } finally {
    mpBusy = false;
    $('mpStartBtn').disabled = false;
  }
}

/* both sides land here: hide the lobby and put everyone on the grid */
async function mpLaunch({ text, source, raceId, words }) {
  if (phase !== 'menu') return;
  mpOpen = false;
  $('mpView').classList.add('hidden');
  setRacing(true);
  await launchRace({
    id: raceId, text, source, mp: true, wordsMode: !!words,
    racers: mpPlayers().filter((p) => p.id !== mpSelfId())
      .map((p) => ({
        name: p.name, isRemote: true, remoteId: p.id,
        // everyone races with THEIR garage livery (host's env theme)
        paint: p.garage?.[currentThemeId]
          ? { ...GARAGE_DEFAULTS[currentThemeId], ...p.garage[currentThemeId], variant: p.garage[currentThemeId].model ?? 0 }
          : null,
      })),
  }, { mode: 'mp', difficulty: 'real', myName: null, myWpm: null, mpDeath: mpDeathOn, hpMax: mpHpHearts });
}

/* fresh self state read at SEND time (background tabs throttle rAF — the
 * wire must never carry stale progress). On finish the FINAL overall wpm. */
setSelfProvider(() => race && race.mode === 'mp' && typing ? {
  pos: typing.pos,
  wpm: typing.finishedAt ? typing.overallWpm() : typing.recentWpm(),
  finished: !!typing.finishedAt,
  time: typing.finishedAt ? typing.elapsedSec() : null,
  acc: typing.accuracy(),
} : null);

/* net events */
mpOn('room', () => showMpWait());
mpOn('players', () => {
  if (!mpOpen) return;
  renderMpPlayers();
  if (!mpHost() && !mpAcked) {
    mpAcked = true;
    setMpStatus('✓ connected — waiting for the host to start');
  }
  rebuildRoomLineup(); // lobby backdrop = the live room lineup
});
mpOn('env', ({ theme, tod, death, hp }) => {
  applyMpEnv(theme, tod, death, hp);
  updateMpEnvLine();
});
mpOn('start', (msg) => {
  applyMpEnv(msg.theme, msg.tod, msg.death, msg.hp); // belt-and-braces: late joiners still match
  mpLaunch(msg);
});
mpOn('status', ({ msg, error }) => { if (mpOpen) setMpStatus(msg, error); });
mpOn('snap', (rows) => {
  if (race?.mode === 'mp' && (race.phase === 'racing' || race.spectating)) race.applyRemote(rows);
  // 👻 ghost auto-exit: every racer in the snapshot has finished — lobby time
  if (ghost && rows.length && rows.every((r) => r.finished)) endGhost('finished');
});
mpOn('left', ({ id }) => {
  if (race?.mode === 'mp') race.remoteLeft(id);
  if (race?.mode === 'mp' && race.phase === 'racing') hud.toast('📴 a player left the race', 2000);
});
mpOn('roomClosed', () => {
  if (race?.mode === 'mp') backToMenu();
  closeMpLobby();
  hud.toast('📴 the host closed the room', 2600);
});

$('mpOpenBtn').addEventListener('click', () => openMpLobby());
$('mpBackBtn').addEventListener('click', closeMpLobby);
$('mpCreateBtn').addEventListener('click', async () => {
  if (mpBusy) return;
  mpBusy = true;
  $('mpCreateBtn').disabled = true;
  $('mpJoinBtn').disabled = true;
  setMpStatus('creating the room…');
  const name = ($('mpName').value || '').trim() || 'YOU';
  settings.name = name; saveSettings();
  try {
    await mpCreateRoom(name, settings.garage ?? {});
    showMpWait();
  } catch (e) {
    showMpHome(); // reset the buttons, then surface the real error on top
    setMpStatus(e.message, true);
  }
});
$('mpJoinBtn').addEventListener('click', joinWithCode);
$('mpCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinWithCode(); });
$('mpRaceType').addEventListener('change', () => {
  const type = $('mpRaceType').value;
  $('mpCustomText').classList.toggle('hidden', type !== 'custom');
  $('mpWordCount').classList.toggle('hidden', type !== 'words');
  $('mpCustomWords').classList.toggle('hidden', type !== 'words');
});
$('mpLang').addEventListener('change', (e) => {
  settings.language = e.target.value;
  saveSettings();
  applyLanguageDir();
  const lang = getLanguage(settings.language);
  hud.toast(`${lang.flag} texts: ${lang.name}`, 1600);
});
$('mpStartBtn').addEventListener('click', mpHostStart);

/* host reshapes the world mid-lobby: both selects broadcast together and the
 * change applies locally through the SAME 'env' path guests use */
const mpPushEnv = () => {
  const theme = $('mpEnvTheme').value, tod = $('mpEnvTod').value;
  const v = $('mpHpMode').value;
  const death = v === 'death', hearts = ['1', '2', '3'].includes(v) ? Number(v) : 0;
  applyMpEnv(theme, tod, death, hearts);
  mpSendEnv(theme, tod, death, hearts);
  updateMpEnvLine();
};
$('mpEnvTheme').addEventListener('change', mpPushEnv);
$('mpEnvTod').addEventListener('change', mpPushEnv);
$('mpHpMode').addEventListener('change', mpPushEnv);

/* 👻 spectate controls — racer chips, camera cycler, practice escape */
$('spectateBtn').addEventListener('click', () => { if (race) enterSpectate(); });
$('spRacers').addEventListener('click', (e) => {
  const b = e.target.closest('.spRacerBtn');
  if (!b || !race || ghost !== 'spectate') return;
  const idx = Number(b.dataset.idx);
  if (world.theme?.vehicles?.[idx]) { world.focusIdx = idx; hud.setSpectateRacer(idx); }
});
const SP_CAMS = [['cinematic', 'cinematic'], ['top', 'top-down'], ['chase', 'chase'], ['cockpit', 'cockpit']];
$('spCam').addEventListener('click', () => {
  const i = Math.max(0, SP_CAMS.findIndex(([s]) => s === world.spectateStyle));
  const [style, label] = SP_CAMS[(i + 1) % SP_CAMS.length];
  world.setSpectate(style);
  hud.setSpectateCam(label);
});
$('spPractice').addEventListener('click', enterGhostPractice);

/* 🪖 first-person toggle — chase <-> cockpit, remembered across races */
$('viewBtn').addEventListener('click', () => {
  if (ghost) return; // spectate has its own camera cycler
  settings.view = (settings.view ?? 'chase') === 'cockpit' ? 'chase' : 'cockpit';
  saveSettings();
  world.setSpectate(settings.view === 'cockpit' ? 'cockpit' : null);
  $('viewBtn').textContent = settings.view === 'cockpit' ? '🪖' : '🎥';
  hud.toast(settings.view === 'cockpit' ? '🪖 first-person view' : '🎥 chase view', 1400);
});
/* garage inside the room — same showroom, closing returns to the lobby */
$('mpGarageBtn').addEventListener('click', openGarage);

/* ---------------- render loop ---------------- */

let lastT = performance.now();
let menuState = null; // parked-menu racer states — reused, never reallocated
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  if (!world) return;

  if (race) {
    race.update(dt);
    // multiplayer: stream my progress into the room every frame — net.js
    // throttles the wire traffic, this just keeps the latest state available
    if (race.mode === 'mp' && race.phase !== 'ready') {
      setSelfState(typing.pos, typing.recentWpm(), !!typing.finishedAt,
        typing.finishedAt ? typing.elapsedSec() : null, typing.accuracy());
    }
    world.speed01 = ghost ? (race.state[world.focusIdx]?.speed01 ?? 0) : race.state[0].speed01;
    world.combo01 = ghost ? 0 : Math.min(1, (typing?.combo ?? 0) / 45); // 45-combo = full glow
    sound.engineSpeed(world.smoothSpeed01);
    world.update(dt, race.state);
    hud.drawMinimap(race.state);
    hud.setSpeedGlow(Math.min(1, world.smoothSpeed01 * 0.75 + world.comboGlow * 0.3));
    hud.setSpeedBlur(Math.min(1, world.smoothSpeed01 * 0.95 + world.comboGlow * 0.3));
    if (phase === 'racing') {
      hud.updateBoard(race.state);
      hud.updateStats(race.state, typing, race.playerRank(), race.state.length);
      hud.updateCombo(typing.combo);
    }
  } else if (world.theme) {
    // parked menu backdrop — one zero-state array reused per vehicle count
    // (this line used to allocate N objects every frame, forever)
    const n = world.theme.vehicles.length;
    if (!menuState || menuState.length !== n) {
      menuState = Array.from({ length: n }, () => ({ progress01: 0, speed01: 0, wpm: 0, hideLabel: true }));
    }
    world.update(dt, menuState);
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

/* an invite link (?room=code) opens straight into the lobby and joins */
{
  const roomParam = new URLSearchParams(location.search).get('room');
  if (roomParam) openMpLobby(roomParam.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5));
}

/* debug/test handle (also handy in devtools) */
window.__tr3d = {
  get race() { return race; }, get typing() { return typing; }, get world() { return world; },
  get settings() { return settings; }, get sound() { return sound; },
  get themeId() { return currentThemeId; },
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
    // an open multiplayer lobby IS an active room — a reload here would kill
    // it for everyone trying to join ("room not found"). Defer like a race.
    if (phase === 'menu' && !mpConnected()) location.reload();
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
