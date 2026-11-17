/* HUD + menu + results DOM management. */

const $ = (id) => document.getElementById(id);

const ORD = ['1st', '2nd', '3rd', '4th', '5th'];

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class HUD {
  constructor() {
    this.els = {
      hud: $('hud'), menu: $('menu'), results: $('results'),
      rankBig: $('rankBig'), rankOf: $('rankOf'), wpmVal: $('wpmVal'), accVal: $('accVal'),
      board: $('board'), dataBadge: $('dataBadge'), centerMsg: $('centerMsg'),
      typingPanel: $('typingPanel'), typingText: $('typingText'),
      capsBadge: $('capsBadge'),
      hpHearts: $('hpHearts'), mistakePanel: $('mistakePanel'), mistakeBars: $('mistakeBars'),
      speedBlur: $('speedBlur'),
      spectateBar: $('spectateBar'), spRacers: $('spRacers'), spCam: $('spCam'),
      keySoundBtn: $('keySoundBtn'),
      pauseOverlay: $('pauseOverlay'), soundBtn: $('soundBtn'),
      themeCards: $('themeCards'), statsLine: $('statsLine'), menuBadge: $('menuBadge'),
      resPlace: $('resPlace'), resStats: $('resStats'), resBoard: $('resBoard'),
      toast: $('toast'), startBtn: $('startBtn'),
      minimap: $('minimap'), mirrorFrame: $('mirrorFrame'),
      comboBadge: $('comboBadge'), vignette: $('vignette'), pbLine: $('pbLine'),
    };
    this.boardRows = [];
    this.toastTimer = null;
    this.mm = this.els.minimap ? this.els.minimap.getContext('2d') : null;
    this.mmLanes = [];
    this.mmColors = [];
    this._mmDot = { x: 0, y: 0 }; // smoothed player dot
  }

  /* ---------- phase switches ---------- */
  showMenu() { this.els.menu.classList.remove('hidden'); this.els.hud.classList.add('hidden'); this.els.results.classList.add('hidden'); }
  showHud() { this.els.menu.classList.add('hidden'); this.els.results.classList.add('hidden'); this.els.hud.classList.remove('hidden'); }
  showResults() { this.els.results.classList.remove('hidden'); }

  setStartBusy(busy, label) {
    this.els.startBtn.disabled = busy;
    this.els.startBtn.innerHTML = label ?? '🏁 &nbsp;START RACE';
  }

  menuBadge(html, isErr = false) {
    this.els.menuBadge.innerHTML = html;
    this.els.menuBadge.classList.toggle('err', isErr);
  }

  setDataBadge(race) {
    const el = this.els.dataBadge;
    if (race.practice) {
      el.classList.remove('orange');
      el.innerHTML = `🧘 <b>practice</b> · ${race.langPool ? race.langSource : race.source || 'Monkeytype'} · no opponents, no stakes`;
    } else if (race.drill) {
      el.classList.remove('orange');
      el.innerHTML = `🎯 <b>drill</b> · ${race.source || 'aim trainer'} · solo, works offline`;
    } else if (race.custom) {
      el.classList.remove('orange');
      el.innerHTML = `📝 <b>custom text</b> · your own words · solo run`;
    } else if (race.mp) {
      el.classList.remove('orange');
      el.innerHTML = `🎮 <b>multiplayer</b> · ${race.source || 'live'} · ${race.racers.length + 1} human${race.racers.length ? 's' : ''} · peer-to-peer`;
    } else if (race.bot) {
      const wpms = race.racers.map((r) => r.wpm || 60).sort((a, b) => a - b);
      const mid = wpms[Math.floor(wpms.length / 2)] || 70;
      el.classList.remove('orange');
      el.innerHTML = `🤖 <b>bot battle</b> · ${race.racers.length} bot${race.racers.length > 1 ? 's' : ''} @ ~${Math.round(mid)} wpm · your pace, your fight${race.langPool ? ` · text: ${race.langPool}` : ''}`;
    } else if (race.daily) {
      el.classList.remove('orange');
      el.innerHTML = `📅 <b>daily challenge</b> · ${race.id.replace('daily-', '')} · same quote, same bots for everyone today`;
    } else if (race.solo) {
      el.classList.remove('orange');
      el.innerHTML = `🕹️ <b>single</b> · time trial · quote from a real TypeRacer race${race.id ? ` ${race.id}` : ''} — no opponents`;
    } else if (race.live) {
      const src = race.source ? ` · ${race.source.medium}${race.source.author ? ' — ' + race.source.author : ''}` : '';
      const langNote = race.langPool ? ` · text: ${race.langPool}` : '';
      el.classList.remove('orange');
      el.innerHTML = `🟢 <b>live data</b> · real TypeRacer race ${race.id || ''} · ${race.racers.length} real racer(s)${src}${langNote}`;
    } else {
      el.classList.add('orange');
      el.innerHTML = `🟠 <b>offline fallback</b> · ${race.note || 'TypeRacer unreachable'}`;
    }
  }

  /* ---------- race hud ---------- */
  buildBoard(racers, colors, lanes = []) {
    this.els.board.innerHTML = '';
    this.boardRows = racers.map((r, i) => {
      const row = document.createElement('div');
      row.className = 'boardRow';
      row.innerHTML = `
        <span class="dot" style="background:${colors[i]}"></span>
        <span class="nm ${r.isPlayer ? 'you' : ''}">${r.isPlayer ? 'YOU' : r.name}</span>
        <span class="wm">0 wpm</span>
        <span class="bar"><i style="background:${colors[i]};width:0%"></i></span>`;
      this.els.board.appendChild(row);
      return { row, nm: row.querySelector('.nm'), wm: row.querySelector('.wm'), bar: row.querySelector('.bar i') };
    });
    this.mmLanes = lanes;
    this.mmColors = colors;
    this._mmDot = null; // snap on first frame after (re)build
  }

  /* precise top-down minimap: whole track, start at bottom, finish on top */
  drawMinimap(state) {
    if (!this.mm) return;
    const ctx = this.mm;
    const W = this.els.minimap.width, H = this.els.minimap.height;
    ctx.clearRect(0, 0, W, H);

    const roadW = 64, roadX = (W - roadW) / 2;
    const padT = 14, padB = 14;
    const trackTop = padT, trackBot = H - padB;
    const zToY = (p01) => trackBot - p01 * (trackBot - trackTop);

    // road
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    roundRect(ctx, roadX, trackTop - 6, roadW, trackBot - trackTop + 12, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    roundRect(ctx, roadX, trackTop - 6, roadW, trackBot - trackTop + 12, 8);
    ctx.stroke();

    // lane dividers
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.setLineDash([3, 4]);
    for (const lx of [-2.2, 0, 2.2]) {
      const x = roadX + roadW / 2 + (lx / 4.4) * (roadW / 2 - 5);
      ctx.beginPath(); ctx.moveTo(x, trackTop); ctx.lineTo(x, trackBot); ctx.stroke();
    }
    ctx.setLineDash([]);

    // start (bottom, checker) + finish (top, banner)
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#cfd6e4' : '#39404e';
      ctx.fillRect(roadX + 4 + i * 7, trackBot - 3, 7, 3);
    }
    ctx.fillStyle = '#ffd75e';
    ctx.fillRect(roadX + 2, trackTop - 3, roadW - 4, 4);

    // racer dots (smoothed player)
    state.forEach((s, i) => {
      const laneX = this.mmLanes[i] ?? 0;
      const x = roadX + roadW / 2 + (laneX / 4.4) * (roadW / 2 - 5);
      const y = zToY(s.progress01);
      const col = this.mmColors[i] ?? '#888';
      if (s.isPlayer) {
        if (!this._mmDot) this._mmDot = { x, y };
        this._mmDot.x += (x - this._mmDot.x) * 0.35;
        this._mmDot.y += (y - this._mmDot.y) * 0.35;
      }
      const dx = s.isPlayer ? this._mmDot.x : x;
      const dy = s.isPlayer ? this._mmDot.y : y;
      ctx.beginPath();
      ctx.arc(dx, dy, s.isPlayer ? 5 : 3.6, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      if (s.isPlayer) {
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      } else {
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.stroke();
      }
      if (s.finished) {
        ctx.beginPath();
        ctx.arc(dx, dy, 6.6, 0, Math.PI * 2);
        ctx.strokeStyle = '#57d9a3';
        ctx.stroke();
      }
    });
  }

  /* ---------- game feel ---------- */
  rankToast(rank, improved) {
    if (improved) this.toast(`⚡ You took ${ORD[rank - 1] ?? rank + 'th'} place!`, 1700);
    else this.toast(`${ORD[rank - 1] ?? rank + 'th'} place — push!`, 1400);
  }

  updateCombo(combo) {
    const el = this.els.comboBadge;
    // dirty-checked: identical writes were landing 60×/s (layout churn)
    const on = combo >= 10;
    if (this._cComboOn !== on) { this._cComboOn = on; el.classList.toggle('hidden', !on); }
    if (!on) return;
    if (this._cCombo !== combo) { this._cCombo = combo; el.textContent = `🔥 ${combo} combo`; }
    const hot = combo >= 50;
    if (this._cComboHot !== hot) { this._cComboHot = hot; el.classList.toggle('hot', hot); }
  }

  setSpeedGlow(v01) {
    const op = (v01 * 0.75).toFixed(3);
    if (this._cGlow !== op) { this._cGlow = op; this.els.vignette.style.opacity = op; }
  }

  /* speed blur — GPU backdrop blur on the screen edges only; the center of
   * the frame and the typing panel stay razor sharp. Style writes are
   * deduped through a dataset stamp so idle frames cost nothing. */
  setSpeedBlur(v01) {
    const el = this.els.speedBlur;
    if (!el) return;
    if (v01 <= 0.03) {
      if (el.dataset.on === '1') { el.dataset.on = '0'; el.style.opacity = '0'; el.style.backdropFilter = 'blur(0px)'; el.style.webkitBackdropFilter = 'blur(0px)'; }
      return;
    }
    el.dataset.on = '1';
    const px = (v01 * 4.5).toFixed(2), op = (v01 * 0.9).toFixed(3);
    if (el.dataset.px !== px) {
      el.dataset.px = px;
      el.style.backdropFilter = `blur(${px}px)`;
      el.style.webkitBackdropFilter = `blur(${px}px)`;
    }
    if (el.dataset.op !== op) { el.dataset.op = op; el.style.opacity = op; }
  }

  showMirror(show) {
    this.els.mirrorFrame.classList.toggle('hidden', !show);
  }

  showPB(show) { this.els.pbLine.classList.toggle('hidden', !show); }

  updateBoard(state) {
    state.forEach((s, i) => {
      const row = this.boardRows[i];
      if (!row) return;
      // per-row dirty checks — the board was writing identical text/styles 60×/s
      const width = (s.progress01 * 100).toFixed(1) + '%';
      if (row._w !== width) { row._w = width; row.bar.style.width = width; }
      const wm = `${Math.round(s.wpm)} wpm`;
      if (row._wm !== wm) { row._wm = wm; row.wm.textContent = wm; }
      const done = !!s.finished;
      if (row._done !== done) { row._done = done; row.row.classList.toggle('done', done); }
    });
  }

  updateStats(racersState, typing, rank, outOf) {
    const s = racersState[0];
    // every field cached — only changed text hits the DOM (rankOf never
    // changes mid-race, yet was written every frame)
    const rankTxt = ORD[rank - 1] ?? `${rank}th`;
    if (this._cRank !== rankTxt) { this._cRank = rankTxt; this.els.rankBig.textContent = rankTxt; }
    const ofTxt = `of ${outOf} racers`;
    if (this._cOf !== ofTxt) { this._cOf = ofTxt; this.els.rankOf.textContent = ofTxt; }
    const wpmTxt = Math.round(s.wpm);
    if (this._cWpm !== wpmTxt) { this._cWpm = wpmTxt; this.els.wpmVal.textContent = wpmTxt; }
    const accTxt = typing.accuracy().toFixed(1);
    if (this._cAcc !== accTxt) { this._cAcc = accTxt; this.els.accVal.textContent = accTxt; }
  }

  centerMsg(text, cls = '') {
    const el = this.els.centerMsg;
    if (!text) { el.textContent = ''; el.className = ''; return; }
    el.textContent = text;
    el.className = cls;
  }

  errorFlash() {
    const el = $('errorFlash');
    el.classList.add('on');
    this.els.typingPanel.classList.add('err');
    setTimeout(() => { el.classList.remove('on'); this.els.typingPanel.classList.remove('err'); }, 120);
  }

  setPaused(show) { this.els.pauseOverlay.classList.toggle('hidden', !show); }

  /* caps lock warning — lives above the typing panel, only visible while on */
  setCaps(on) { this.els.capsBadge.classList.toggle('hidden', !on); }

  /* ❤️ hp hearts — shown only in hp races; hurt=true pulses the just-lost one */
  setHearts(left, max, hurt = false) {
    const el = this.els.hpHearts;
    if (!el) return;
    if (!max) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    let html = '';
    for (let i = 0; i < max; i++) {
      const alive = i < left;
      const justLost = !alive && hurt && i === left;
      html += `<span class="hpHeart${alive ? '' : ' lost'}${justLost ? ' hurt' : ''}">${alive ? '❤' : '♡'}</span>`;
    }
    el.innerHTML = html;
    el.classList.remove('hidden');
  }

  /* the mistake popup: the char you SHOULD have typed slides in green from the
   * right, the char you DID type rises red from the left-bottom — anchored at
   * the caret's screen position so the player sees it exactly where it bit */
  mistakeFlash(expected, typed, rect = null) {
    const r = rect || this.els.typingPanel?.getBoundingClientRect();
    if (!r) return;
    const vis = (ch) => (ch === ' ' || ch === undefined || ch === null) ? '␣' : ch === '\n' ? '⏎' : ch;
    const wrap = document.createElement('div');
    wrap.className = 'mistakePop';
    const exp = document.createElement('span'); exp.className = 'exp'; exp.textContent = vis(expected);
    const got = document.createElement('span'); got.className = 'got'; got.textContent = vis(typed);
    wrap.append(exp, got);
    wrap.style.left = Math.round(r.left + r.width / 2 - 18) + 'px';
    wrap.style.top = Math.round(r.top - 12) + 'px';
    document.body.appendChild(wrap);
    setTimeout(() => wrap.remove(), 950);
  }

  /* 💀 worst-keys panel (death/hp races): top-5 mistake pairs as a sorted
   * column chart — count on top, bar in the middle, expected→typed below */
  showMistakes(show) {
    const el = this.els.mistakePanel;
    if (!el) return;
    el.classList.toggle('hidden', !show);
    if (!show && this.els.mistakeBars) this.els.mistakeBars.innerHTML = '';
  }

  /* 👻 spectate bar — racer chips (click to watch) + camera cycler */
  showSpectateBar(show, names = null, activeIdx = 0) {
    const bar = this.els.spectateBar;
    if (!bar) return;
    bar.classList.toggle('hidden', !show);
    if (!show) return;
    const wrap = this.els.spRacers;
    if (!wrap) return;
    wrap.innerHTML = '';
    (names ?? []).forEach((n, i) => {
      const b = document.createElement('button');
      b.className = 'spRacerBtn' + (i === activeIdx ? ' active' : '');
      b.dataset.idx = String(i);
      b.textContent = n;
      wrap.appendChild(b);
    });
  }

  setSpectateRacer(idx) {
    [...(this.els.spRacers?.querySelectorAll('.spRacerBtn') ?? [])]
      .forEach((b) => b.classList.toggle('active', Number(b.dataset.idx) === idx));
  }

  setSpectateCam(label) { if (this.els.spCam) this.els.spCam.textContent = '🎥 ' + label; }

  renderMistakes(map) {
    const bars = this.els.mistakeBars;
    if (!bars || !map?.size) return;
    const rows = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const max = rows[0][1];
    const vis = (ch) => (ch === ' ' || ch === undefined) ? '␣' : ch === '\n' ? '⏎' : ch;
    bars.innerHTML = '';
    for (const [key, count] of rows) {
      const [exp, got] = key.split('|');
      const col = document.createElement('div'); col.className = 'mCol';
      const cnt = document.createElement('div'); cnt.className = 'mCount'; cnt.textContent = count;
      const bar = document.createElement('div'); bar.className = 'mBar';
      bar.style.height = Math.max(10, Math.round((count / max) * 44)) + 'px';
      const lbl = document.createElement('div'); lbl.className = 'mKey';
      const e1 = document.createElement('b'); e1.className = 'mExp'; e1.textContent = vis(exp);
      const ar = document.createElement('span'); ar.textContent = '→';
      const e2 = document.createElement('b'); e2.className = 'mGot'; e2.textContent = vis(got);
      lbl.append(e1, ar, e2);
      col.append(cnt, bar, lbl);
      bars.appendChild(col);
    }
  }

  /* ---------- results ---------- */
  onResults(results) {
    const { rows } = results;
    const me = rows.find((r) => r.isPlayer);
    // multiplayer results exit into the room lobby — relabel the buttons so
    // 'race again' (a solo flow that would strand the room) is not offered
    $('menuBtn').textContent = results.mode === 'mp' ? '↩ lobby' : 'menu';
    $('againBtn').classList.toggle('hidden', results.mode === 'mp');
    // 👻 spectate is offered only while others are still out on the track
    $('spectateBtn').classList.toggle('hidden',
      !(results.mode === 'mp' && results.rows.some((r) => !r.isPlayer && !r.finished)));
    let head;
    if (results.died) {
      head = `💀 died at ${Math.round(results.died.progress01 * 100)}%<small>death mode — one mistake ends the run</small>`;
    } else if (results.mode === 'practice') {
      head = `🧘 practice complete<small>${results.raceId && results.raceId.startsWith('mt-') ? 'quote from Monkeytype' : 'bundled quote (offline)'} — no stakes</small>`;
    } else if (results.mode === 'drill') {
      const t = results.raceId && results.raceId.startsWith('drill-numbers') ? 'numbers & symbols'
        : results.raceId && results.raceId.startsWith('drill-code') ? 'code' : 'common words';
      head = `🎯 drill complete<small>${t} — solo practice, no stakes</small>`;
    } else if (results.mode === 'custom') {
      head = `📝 custom run complete<small>your own text — solo practice</small>`;
    } else if (results.mode === 'single') {
      head = `🏁 solo run complete<small>time trial — you were the only one on track</small>`;
    } else if (results.mode === 'daily') {
      const streak = results.dailyStreak ?? 1;
      head = `📅 daily complete<small>🔥 ${streak}-day streak · everyone raced this exact race today</small>`;
    } else {
      const medal = ['🥇', '🥈', '🥉'][me.place - 1] ?? '🏁';
      head = `${medal} ${ORD[me.place - 1] ?? me.place + 'th'}<small>${me.place === 1 ? 'you won the race!' : 'race complete'}</small>`;
    }
    this.els.resPlace.innerHTML = head;
    this.els.resStats.innerHTML = `
      <div><b>${Math.round(me.wpm)}</b><label>wpm</label></div>
      <div><b>${me.acc.toFixed(1)}%</b><label>accuracy</label></div>
      <div><b>${me.time ? me.time.toFixed(1) + 's' : '—'}</b><label>time</label></div>`;
    this.els.resBoard.innerHTML = rows.map((r) => `
      <div class="resRow ${r.isPlayer ? 'me' : ''}">
        <span class="pl">${ORD[r.place - 1] ?? r.place}</span>
        <span class="rnm">${r.isPlayer ? (r.racingAs ? `you · as ${r.racingAs}` : 'YOU') : r.name}</span>
        <span class="rwm">${Math.round(r.wpm)} wpm</span>
        <span class="rac">${r.acc.toFixed(1)}%</span>
      </div>`).join('') +
      (['single', 'practice', 'drill', 'custom'].includes(results.mode)
        ? ''
        : results.mode === 'mp'
          ? `<div class="real">🎮 live multiplayer — each of you typed this on your own screen${results.mpDeath && results.resets ? ` · 💀 death mode: ${results.resets} reset${results.resets > 1 ? 's' : ''} back to the start line` : ''}${results.mpDeath && !results.resets ? ' · 💀 death mode — flawless, no resets' : ''}${results.hpMax ? ` · ❤️ hp: ${results.hpMax} heart${results.hpMax > 1 ? 's' : ''} — ${results.hpLost} mistake${results.hpLost === 1 ? '' : 's'} absorbed` : ''}</div>`
          : results.mode === 'bot'
          ? `<div class="real">synthetic bots — at the pace you configured</div>`
          : results.mode === 'daily'
            ? `<div class="real">seeded bots — identical for every player today</div>`
            : (results.factor && Math.abs(results.factor - 1) > 0.03
              ? `<div class="real">bot speeds scaled ×${results.factor.toFixed(2)} from the real race (difficulty)</div>`
              : `<div class="real">bots ran at the real race speeds</div>`));
    this.showResults();
  }

  /* ---------- misc ---------- */
  toast(msg, ms = 2600) {
    const el = this.els.toast;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }
}
