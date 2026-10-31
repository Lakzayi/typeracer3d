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

/* ---------------- settings ---------------- */

const SETTINGS_KEY = 'tr3d_settings_v1';
const settings = Object.assign(
  { typingMode: 'realistic', timeOfDay: 'day', soundOn: true },
  JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
);

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
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

function buildThemeCards() {
  hud.els.themeCards.innerHTML = '';
  for (const t of Object.values(THEMES)) {
    const card = document.createElement('div');
    card.className = 'themeCard' + (t.status === 'soon' ? ' soon' : '') + (t.id === currentThemeId ? ' active' : '');
    card.innerHTML = `<div class="ic">${t.icon}</div><div class="nm">${t.name}</div><div class="st">${t.status === 'soon' ? 'SOON' : '3D · PLAY'}</div>`;
    card.addEventListener('click', () => {
      if (t.status === 'soon') { hud.toast(`${t.icon} ${t.name} — ${t.blurb}`); return; }
      currentThemeId = t.id;
      buildThemeCards();
    });
    hud.els.themeCards.appendChild(card);
  }
}

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
  if (e.key === 'Escape' && (phase === 'racing' || phase === 'countdown')) backToMenu();
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
  hud.setStartBusy(true, '⏳ fetching a real race…');
  hud.menuBadge('connecting to play.typeracer.com…');

  let raceData;
  try {
    raceData = await API.race(lastRaceId);
  } catch (e) {
    hud.menuBadge(`✗ could not fetch a race: ${e.message}`, true);
    hud.setStartBusy(false);
    phase = 'menu';
    return;
  }
  lastRaceId = raceData.id;
  if (raceData.demo) {
    hud.menuBadge('🧪 demo race — start the local server (node server.js) to race real TypeRacer data');
  }

  const difficulty = $('difficulty').value;
  const myName = stats ? stats.user : null;
  const myWpm = stats ? (stats.avgWpm || 70) : null;

  // --- world + theme ---
  if (!world) world = new World($('scene'));
  world.finishMode = false;
  world.focusIdx = 0;

  const racers = [{ name: 'YOU', isPlayer: true }];
  // bots from the real race (same order the controller derives)
  const replaced = myName ? raceData.racers.find((r) => r.name.toLowerCase() === myName.toLowerCase()) : null;
  for (const r of raceData.racers) {
    if (racers.length >= 5) break;
    if (replaced && r.name === replaced.name) continue;
    racers.push({ name: r.name, isPlayer: false });
  }

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
  race = new RaceController({ race: raceData, difficulty, myWpm, myName, world, sound, hud, typing });

  // --- hud ---
  const colors = racers.map((r, i) => theme.vehicles[i]?.color ?? '#2e86ff');
  const lanes = racers.map((r, i) => theme.vehicles[i]?.baseX ?? 0);
  hud.showHud();
  hud.setDataBadge(raceData);
  hud.buildBoard(racers, colors, lanes);
  hud.setPaused(false);
  hud.showMirror(true);
  world.mirrorEnabled = true;
  sound.startEngine();

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
  if (p) typing.disable(); else { typing.enable(); typing.focus(); }
}

$('pauseOverlay').addEventListener('click', () => setPaused(false));
window.addEventListener('blur', () => { if (phase === 'racing') setPaused(true); });
hud.els.typingPanel.addEventListener('click', () => typing && typing.focus());

/* ---------------- results + personal best ---------------- */

const PB_KEY = 'tr3d_best_v1';
const origOnResults = hud.onResults.bind(hud);
hud.onResults = (results) => {
  origOnResults(results);
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
    world.update(dt, world.theme.vehicles.map((v) => ({ progress01: 0, speed01: 0, wpm: 0 })));
  }

  world.render();
}

applySettingsToUI();
buildThemeCards();
requestAnimationFrame(loop);

/* debug/test handle (also handy in devtools) */
window.__tr3d = {
  get race() { return race; }, get typing() { return typing; }, get world() { return world; },
  get settings() { return settings; },
  setPaused, startRaceFlow, backToMenu,
};

/* menu badge: initial hint */
hud.menuBadge('🌐 each race is a real TypeRacer race — real text, real racers, real keystroke timing');
