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
      el.innerHTML = `🧘 <b>practice</b> · ${race.source || 'Monkeytype'} · no opponents, no stakes`;
    } else if (race.solo) {
      el.classList.remove('orange');
      el.innerHTML = `🕹️ <b>single</b> · time trial · quote from a real TypeRacer race${race.id ? ` ${race.id}` : ''} — no opponents`;
    } else if (race.live) {
      const src = race.source ? ` · ${race.source.medium}${race.source.author ? ' — ' + race.source.author : ''}` : '';
      el.classList.remove('orange');
      el.innerHTML = `🟢 <b>live data</b> · real TypeRacer race ${race.id || ''} · ${race.racers.length} real racer(s)${src}`;
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
    if (combo >= 10) {
      el.classList.remove('hidden');
      el.textContent = `🔥 ${combo} combo`;
      el.classList.toggle('hot', combo >= 50);
    } else {
      el.classList.add('hidden');
    }
  }

  setSpeedGlow(v01) {
    this.els.vignette.style.opacity = (v01 * 0.75).toFixed(3);
  }

  showMirror(show) {
    this.els.mirrorFrame.classList.toggle('hidden', !show);
  }

  showPB(show) { this.els.pbLine.classList.toggle('hidden', !show); }

  updateBoard(state) {
    state.forEach((s, i) => {
      const row = this.boardRows[i];
      if (!row) return;
      row.bar.style.width = (s.progress01 * 100).toFixed(1) + '%';
      row.wm.textContent = `${Math.round(s.wpm)} wpm`;
      row.row.classList.toggle('done', !!s.finished);
    });
  }

  updateStats(racersState, typing, rank, outOf) {
    const s = racersState[0];
    this.els.rankBig.textContent = ORD[rank - 1] ?? `${rank}th`;
    this.els.rankOf.textContent = `of ${outOf} racers`;
    this.els.wpmVal.textContent = Math.round(s.wpm);
    this.els.accVal.textContent = typing.accuracy().toFixed(1);
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

  /* ---------- results ---------- */
  onResults(results) {
    const { rows } = results;
    const me = rows.find((r) => r.isPlayer);
    let head;
    if (results.died) {
      head = `💀 died at ${Math.round(results.died.progress01 * 100)}%<small>death mode — one mistake ends the run</small>`;
    } else if (results.mode === 'practice') {
      head = `🧘 practice complete<small>${results.raceId && results.raceId.startsWith('mt-') ? 'quote from Monkeytype' : 'bundled quote (offline)'} — no stakes</small>`;
    } else if (results.mode === 'single') {
      head = `🏁 solo run complete<small>time trial — you were the only one on track</small>`;
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
      (results.mode === 'single' || results.mode === 'practice'
        ? ''
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
