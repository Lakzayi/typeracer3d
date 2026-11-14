/* Race controller: builds racers (you + real TypeRacer racers as bots),
 * scales their pace to the chosen difficulty, simulates bot progress —
 * bots with a real typing-log literally replay that human's keystroke
 * timing — computes live standings and final results. */

import { mulberry32 } from './world.js';
import { SOLO_MODES } from './modes.js';

const TARGETS = { chill: 45, normal: 70, hard: 95 };
const MAX_BOTS = 4;

function upperBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] <= x) lo = mid + 1; else hi = mid; }
  return lo;
}

/* instantaneous pace of a keystroke-log racer (ghost, real-keystroke bots),
 * measured over the last `windowS` seconds of log time — a constant display
 * of the saved/nominal wpm would hide the real rhythm of the replay */
function liveLogWpm(log, raceTime, windowS = 8) {
  const end = (log[log.length - 1] + 100) / 1000;
  const t2 = Math.min(raceTime, end) * 1000;
  const t1 = Math.max(0, t2 - windowS * 1000);
  if (t2 - t1 < 500) return 0;
  const c2 = upperBound(log, t2);
  const c1 = upperBound(log, t1);
  return (c2 - c1) / 5 / ((t2 - t1) / 60000);
}

export class RaceController {
  constructor({ race, difficulty, myWpm, myName, world, sound, hud, typing, mode = 'classic' }) {
    this.race = race;
    this.world = world;
    this.sound = sound;
    this.hud = hud;
    this.typing = typing;
    this.mode = mode;
    this.deadly = mode === 'death';   // one mistake ends the run
    this.solo = SOLO_MODES.includes(mode); // no opponents on track
    this.died = false;
    this.textLen = race.text.length;
    this.phase = 'ready'; // ready -> racing -> finished
    this.paused = false;
    this.raceTime = 0;
    this.results = null;
    this.endTimer = null;
    this.comboHeat = 0;
    this._prevRank = null;

    const rng = mulberry32(12345); // per-race bot variation (not scenery)

    // difficulty factor from the median real speed of this race
    const realWpms = race.racers.map((r) => r.wpm || 60).sort((a, b) => a - b);
    const median = realWpms[Math.floor(realWpms.length / 2)] || 70;
    let target = TARGETS[difficulty] ?? 70;
    if (difficulty === 'mine') target = myWpm || 70;
    const factor = difficulty === 'real' ? 1 : Math.min(3, Math.max(0.2, target / median));
    this.factor = factor;

    // who races: real racers become bots; if your username matches one of
    // them, you take their slot (that bot is not created).
    const replaced = myName
      ? race.racers.find((r) => r.name.toLowerCase() === myName.toLowerCase())
      : null;

    this.racers = [];
    this.racers.push({
      name: 'YOU', isPlayer: true, color: '#ff4757',
      racingAs: replaced ? replaced.name : null,
    });
    for (const r of race.racers) {
      if (this.racers.length > MAX_BOTS && !r.isGhost) break;
      if (replaced && r.name === replaced.name) continue;
      const isGhost = !!r.isGhost;
      const jitter = isGhost ? 1 : 0.94 + rng() * 0.12;
      const wpm = isGhost ? (r.wpm || 60) : Math.max(8, (r.wpm || 60) * factor * jitter);
      this.racers.push({
        name: r.name, isPlayer: false, color: '#888',
        isGhost,
        realWpm: r.wpm, realAcc: r.acc, log: r.log || null,
        rate: isGhost ? 1 : factor * jitter, // the ghost replays YOUR exact timing
        wpm,
        phase: rng() * 10, phase2: rng() * 10,
        stumbles: isGhost ? [] : Array.from({ length: 1 + Math.floor(rng() * 2) }, () => ({
          at: 0.2 + rng() * 0.6, dur: 0.3 + rng() * 0.6,
        })),
        estDur: this.textLen / (wpm * 5 / 60),
        progressChars: 0, finished: false, finishTime: null, errorT: 0,
      });
    }

    // colors for bots (board + labels) — assigned by main via theme
    this.state = this.racers.map((r) => ({
      progress01: 0, wpm: 0, speed01: 0, finished: false, errorT: 0,
      isPlayer: r.isPlayer, name: r.name,
    }));
  }

  begin() {
    this.phase = 'racing';
    this.t0 = performance.now();
  }

  setPaused(p) { this.paused = p; }

  notifyError() {
    const s = this.state[0];
    s.errorT = 0.3;
    this.world.shake(this.deadly ? 2.4 : 0.8);
    if (this.deadly && this.phase === 'racing' && !this.racers[0].finished) this._playerDied();
  }

  /* death mode — the first mistake is fatal: the car coasts to a stop and the
   * results drop in almost immediately (bots keep racing without you) */
  _playerDied() {
    this.died = true;
    const p = this.racers[0];
    p.finished = true;
    p.finishTime = this.raceTime;
    this.state[0].finishT = this.raceTime;
    this.typing.disable();
    this.sound.stopEngine();
    this.sound.die();
    this.world.shake(2.4);
    clearTimeout(this.endTimer);
    this.endTimer = setTimeout(() => this._finalize(), 1100);
  }

  update(dt) {
    if (this.phase === 'finished') { this._refreshState(dt); return; }
    if (this.phase !== 'racing' || this.paused) return;

    this.raceTime += dt;

    // bots
    for (const b of this.racers) {
      if (b.isPlayer || b.finished) continue;
      let chars;
      if (b.log) {
        chars = upperBound(b.log, this.raceTime * 1000 * b.rate);
      } else {
        let eff = this.raceTime;
        for (const st of b.stumbles) if (st.at * b.estDur <= this.raceTime) eff -= st.dur;
        eff = Math.max(0, eff);
        const wobble = 1 + 0.07 * Math.sin(this.raceTime * 1.1 + b.phase) + 0.04 * Math.sin(this.raceTime * 2.7 + b.phase2);
        chars = (b.wpm * 5 / 60) * eff * wobble;
      }
      b.progressChars = Math.min(this.textLen, chars);
      if (b.progressChars >= this.textLen) {
        b.finished = true;
        b.finishTime = this.raceTime;
      }
    }

    // player
    const p = this.racers[0];
    p.progressChars = this.typing.pos;
    if (this.typing.finishedAt && !p.finished) {
      p.finished = true;
      p.finishTime = this.raceTime;
      this.state[0].finishT = this.typing.elapsedSec();
      this._onPlayerFinish();
    }

    // everyone done? wrap up immediately (solo modes celebrate a moment first)
    if (!this.solo && p.finished && this.racers.every((r) => r.isPlayer || r.finished)) this._finalize();

    this._refreshState(dt);
  }

  _onPlayerFinish() {
    this.sound.stopEngine();
    this.sound.finish();
    this.world.finishMode = true;
    this.world.focusIdx = 0;
    this.world.confettiBurst(this.world.theme.vehicles[0].group.position);
    // let stragglers finish (or cut it short — solo has nobody to wait for)
    this.endTimer = setTimeout(() => this._finalize(), this.solo ? 2600 : 6000);
  }

  _finalize() {
    if (this.phase === 'finished') return;
    this.phase = 'finished';
    const rows = this.racers.map((r, i) => {
      const st = this.state[i];
      const chars = r.isPlayer ? this.typing.pos : r.progressChars;
      const wpm = r.isPlayer ? this.typing.overallWpm() : (r.wpm ?? 60);
      const acc = r.isPlayer ? this.typing.accuracy() : (r.realAcc ?? 95);
      const time = r.isPlayer ? this.typing.elapsedSec() : (r.finishTime ?? null);
      return { name: r.name, isPlayer: r.isPlayer, progress01: chars / this.textLen, wpm, acc, time, finished: r.finished, racingAs: r.racingAs || null };
    });
    rows.sort((a, b) => {
      if (a.progress01 >= 1 && b.progress01 >= 1) return (a.time ?? 1e9) - (b.time ?? 1e9);
      if (a.progress01 >= 1) return -1;
      if (b.progress01 >= 1) return 1;
      return b.progress01 - a.progress01;
    });
    rows.forEach((r, i) => { r.place = i + 1; });
    this.results = {
      rows, factor: this.factor, raceId: this.race.id, live: this.race.live,
      mode: this.mode,
      died: this.died ? { progress01: rows.find((r) => r.isPlayer).progress01 } : null,
    };
    this.hud.onResults(this.results);
  }

  _refreshState(dt) {
    // combo heat: rises while you string correct chars, cools when idle/errors
    const combo = this.typing.combo ?? 0;
    const lastHit = this.typing.hits.length ? this.typing.hits[this.typing.hits.length - 1].t : 0;
    const idle = !this.typing.startedAt || performance.now() - lastHit > 1500;
    const heatTarget = (idle || this.typing.finishedAt) ? 0 : (combo >= 3 ? Math.min(1, combo / 50) : 0);
    const k = heatTarget > this.comboHeat ? 3.2 : 1.1;
    this.comboHeat = (this.comboHeat ?? 0) + (heatTarget - (this.comboHeat ?? 0)) * Math.min(1, k * dt);

    for (let i = 0; i < this.racers.length; i++) {
      const r = this.racers[i], s = this.state[i];
      const chars = r.isPlayer ? this.typing.pos : r.progressChars;
      s.progress01 = Math.min(1, chars / this.textLen);
      s.finished = r.finished || s.progress01 >= 1;
      if (r.isPlayer) {
        s.wpm = this.typing.recentWpm();
        s.speed01 = this.died ? 0 : Math.min(1, s.wpm / 130); // dead car coasts to a stop
        s.comboHeat = this.comboHeat;
        if (s.finished && s.finishT == null) s.finishT = this.typing.elapsedSec();
      } else if (r.log) {
        // replayed keystroke logs (ghost + real-timing bots) — show their live
        // pace instead of a frozen nominal number
        s.wpm = r.finished ? (r.wpm ?? 60) : liveLogWpm(r.log, this.raceTime);
        s.speed01 = Math.min(1, s.wpm / 130);
        if (s.finished && s.finishT == null) s.finishT = r.finishTime ?? this.raceTime;
      } else {
        s.wpm = r.wpm ?? 60;
        s.speed01 = Math.min(1, (r.wpm ?? 60) / 130);
        if (s.finished && s.finishT == null) s.finishT = r.finishTime ?? this.raceTime;
      }
      if (s.errorT > 0) s.errorT -= dt;
      if (r.errorT) { s.errorT = r.errorT; r.errorT = 0; }
    }
    // live standings
    const order = this.state.map((s, i) => ({ i, s }))
      .sort((a, b) => {
        if (a.s.finished && b.s.finished) return (a.s.finishT ?? 0) - (b.s.finishT ?? 0);
        return b.s.progress01 - a.s.progress01;
      });
    order.forEach((o, idx) => { o.s.rank = idx + 1; });

    // overtake / lost-position notifications
    const rank = this.state[0].rank;
    if (this.phase === 'racing' && this._prevRank && rank !== this._prevRank && this.typing.startedAt) {
      this.hud.rankToast(rank, rank < this._prevRank);
    }
    this._prevRank = rank;
  }

  playerRank() { return this.state[0].rank ?? 1; }

  dispose() { if (this.endTimer) clearTimeout(this.endTimer); }
}
