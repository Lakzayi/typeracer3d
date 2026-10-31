/* Typing engine — two modes:
 *
 *  "realistic" (TypeRacer-style): wrong chars stick into an error buffer shown
 *    in red; you must backspace them out before you can continue. Backspace
 *    pops the buffer (the wrong char already counted as an error).
 *  "arcade": wrong chars don't advance and don't stick — just keep typing.
 *
 * Also tracks a combo (consecutive correct chars) for game feel, and rolling
 * + overall WPM.
 */

const MILESTONES = [25, 50, 100, 200, 300, 500];

export class TypingEngine {
  constructor(textEl, inputEl, hooks = {}) {
    this.textEl = textEl;
    this.inputEl = inputEl;
    this.hooks = hooks;
    this.mode = 'realistic';
    this.text = '';
    this.pos = 0;
    this.correct = 0;
    this.errors = 0;
    this.buffer = [];     // erroneous chars pending backspace (realistic mode)
    this.bufferEls = [];  // span overlays for the buffer
    this.combo = 0;
    this.maxCombo = 0;
    this._nextMilestone = 0;
    this.startedAt = null;
    this.finishedAt = null;
    this.enabled = false;
    this.hits = []; // {t, c} keystroke log for rolling WPM
    this.spans = [];

    inputEl.addEventListener('keydown', (e) => this._keydown(e));
  }

  setText(text) {
    this.text = text;
    this.pos = 0; this.correct = 0; this.errors = 0;
    this.buffer = []; this.bufferEls = [];
    this.combo = 0; this.maxCombo = 0; this._nextMilestone = 0;
    this.startedAt = null; this.finishedAt = null; this.hits = [];
    this.textEl.innerHTML = '';
    this.spans = [];
    const frag = document.createDocumentFragment();
    for (let i = 0; i < text.length; i++) {
      const s = document.createElement('span');
      s.textContent = text[i];
      s.className = i === 0 ? 'caret' : 'todo';
      frag.appendChild(s);
      this.spans.push(s);
    }
    this.textEl.appendChild(frag);
    this.textEl.scrollTop = 0;
  }

  enable() { this.enabled = true; }
  disable() { this.enabled = false; }

  get blocked() { return this.mode === 'realistic' && this.buffer.length > 0; }

  _keydown(e) {
    if (!this.enabled) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key;

    if (key === 'Backspace') {
      if (this.mode !== 'realistic' || this.buffer.length === 0) return;
      e.preventDefault();
      this.buffer.pop();
      const el = this.bufferEls.pop();
      if (el) el.remove();
      this._paintCaret();
      this.hooks.onBackspace && this.hooks.onBackspace();
      return;
    }

    if (key.length !== 1) return; // ignore Shift, arrows, etc.
    e.preventDefault(); // keep space from scrolling, ' from quick-find
    if (this.finishedAt) return;

    if (!this.startedAt) {
      this.startedAt = performance.now();
      this.hooks.onStart && this.hooks.onStart();
    }

    const ch = key;
    const expected = this.text[this.pos];

    if (!this.blocked && ch === expected) {
      this.spans[this.pos].className = 'done';
      this.pos++; this.correct++; this.combo++;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      if (this._nextMilestone < MILESTONES.length && this.combo >= MILESTONES[this._nextMilestone]) {
        this.hooks.onMilestone && this.hooks.onMilestone(MILESTONES[this._nextMilestone]);
        this._nextMilestone++;
      }
      this.hits.push({ t: performance.now(), c: this.correct });
      if (this.pos < this.text.length) {
        this._paintCaret();
        this._scrollToCaret();
      } else {
        this.finishedAt = performance.now();
        this.enabled = false;
        this.hooks.onFinish && this.hooks.onFinish();
      }
      this.hooks.onKey && this.hooks.onKey();
    } else if (this.mode === 'realistic') {
      // wrong char sticks into the buffer — backspace to fix it
      this.errors++;
      this.combo = 0;
      this.buffer.push(ch);
      const el = document.createElement('span');
      el.textContent = ch;
      el.className = 'bufferChar';
      this.spans[this.pos].insertAdjacentElement('beforebegin', el);
      this.bufferEls.push(el);
      this._paintCaret();
      this._scrollToCaret();
      this.hooks.onError && this.hooks.onError(ch);
    } else {
      // arcade: error, no stick
      this.errors++;
      this.combo = 0;
      this.hooks.onError && this.hooks.onError(ch);
    }
  }

  _paintCaret() {
    for (const s of this.spans) if (s.className === 'caret') s.className = 'todo';
    if (this.bufferEls.length) {
      const last = this.bufferEls[this.bufferEls.length - 1];
      last.style.boxShadow = '0 0 8px rgba(255,77,94,0.9)';
    }
    if (!this.blocked && this.pos < this.text.length) {
      this.spans[this.pos].className = 'caret';
    }
  }

  _scrollToCaret() {
    const s = this.bufferEls.length
      ? this.bufferEls[this.bufferEls.length - 1]
      : this.spans[this.pos];
    if (!s) return;
    const el = this.textEl;
    const top = s.offsetTop, bot = s.offsetTop + s.offsetHeight;
    if (top < el.scrollTop + 8) el.scrollTop = top - 30;
    else if (bot > el.scrollTop + el.clientHeight - 8) el.scrollTop = bot - el.clientHeight + 30;
  }

  focus() { this.inputEl.focus({ preventScroll: true }); }

  /* rolling WPM over the last `windowMs` of typing */
  recentWpm(windowMs = 4000) {
    const now = performance.now();
    const cutoff = now - windowMs;
    let past = { t: this.startedAt ?? now, c: 0 };
    for (let i = this.hits.length - 1; i >= 0; i--) {
      if (this.hits[i].t <= cutoff) { past = this.hits[i]; break; }
    }
    const mins = (now - past.t) / 60000;
    if (mins <= 0.02) return 0;
    return Math.max(0, (this.correct - past.c) / 5 / mins);
  }

  overallWpm() {
    if (!this.startedAt) return 0;
    const end = this.finishedAt ?? performance.now();
    const mins = (end - this.startedAt) / 60000;
    if (mins <= 0) return 0;
    return (this.correct / 5) / mins;
  }

  accuracy() {
    const total = this.correct + this.errors;
    return total === 0 ? 100 : (this.correct / total) * 100;
  }

  elapsedSec() {
    if (!this.startedAt) return 0;
    return ((this.finishedAt ?? performance.now()) - this.startedAt) / 1000;
  }
}
