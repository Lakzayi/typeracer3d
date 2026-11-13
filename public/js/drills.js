/* Aim-drill text generators — 100% offline, generated locally so the drill
 * modes cost zero bytes of network. Three trainers:
 *   words   — the most common English words (muscle memory for real prose)
 *   numbers — digits, decimals, dates, times, money, punctuation
 *   code    — real JavaScript one-liners (symbols-heavy) */

const COMMON_WORDS = (
  'the be to of and a in that have it for not on with he as you do at this but his by from ' +
  'they we say her she or an will my one all would there their what so up out if about who ' +
  'get which go me when make can like time no just him know take people into year your good ' +
  'some could them see other than then now look only come its over think also back after use ' +
  'two how our work first well way even new want because any these give day most us is are'
).split(' ');

const CODE_SNIPPETS = [
  'const sum = (a, b) => a + b;',
  'if (x > 0 && y < 10) { console.log("in range"); }',
  'for (let i = 0; i < items.length; i++) total += items[i].price;',
  'const { name, age } = JSON.parse(localStorage.getItem("user"));',
  'document.querySelector("#btn").addEventListener("click", start);',
  'return arr.filter((n) => n % 2 === 0).map((n) => n * n).reduce((a, b) => a + b, 0);',
  'setTimeout(() => clearInterval(timer), 5000);',
  'const cache = new Map(); cache.set(key, value);',
  'try { data = await fetch(url).then((r) => r.json()); } catch (e) { warn(e); }',
  'let [first, second, ...rest] = list.split(",");',
  'items.sort((a, b) => b.score - a.score).slice(0, 10);',
  'const isSafe = (v) => v !== null && typeof v !== "undefined";',
];

const d = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function words() {
  const out = [];
  let len = 0;
  while (len < 190) {
    const w = pick(COMMON_WORDS);
    out.push(w);
    len += w.length + 1;
  }
  return { text: out.join(' '), label: 'common words' };
}

function numbers() {
  const tokens = [];
  for (let i = 0; i < 18; i++) {
    switch (d(1, 8)) {
      case 1: tokens.push(String(d(0, 999))); break;
      case 2: { const n = d(1000, 99999); tokens.push(n.toLocaleString('en-US')); break; }
      case 3: tokens.push((d(1, 999) / 10).toFixed(1)); break;
      case 4: tokens.push(`${d(0, 23)}:${String(d(0, 59)).padStart(2, '0')}`); break;
      case 5: tokens.push(`202${d(4, 6)}-${String(d(1, 12)).padStart(2, '0')}-${String(d(1, 28)).padStart(2, '0')}`); break;
      case 6: tokens.push(`${d(2, 99)}%`); break;
      case 7: tokens.push(`$${d(4, 899)}${Math.random() < 0.4 ? '.' + String(d(10, 99)) : ''}`); break;
      case 8: tokens.push(`555-${String(d(100, 9999)).padStart(4, '0')}`); break;
    }
  }
  return { text: tokens.join(' '), label: 'numbers & symbols' };
}

function code() {
  let text = pick(CODE_SNIPPETS);
  while (text.length < 110 && text.length + 1 < 240) {
    const next = pick(CODE_SNIPPETS);
    if (next !== text) text += ' ' + next;
    else break;
  }
  return { text, label: 'JavaScript code' };
}

const GENERATORS = { words, numbers, code };

export function drillRace(type) {
  const gen = GENERATORS[type] || words;
  const { text, label } = gen();
  return {
    id: `drill-${(GENERATORS[type] ? type : 'words')}-${Date.now() % 100000}`,
    drill: true, live: false,
    text,
    source: label,
    note: `aim drill — ${label}`,
    racers: [], // solo — the theme builds only your vehicle
  };
}
