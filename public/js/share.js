/* Share card — renders race results into a 1200×630 PNG (og-image ratio) that
 * posts straight into Twitter/WhatsApp/Discord chats. Web Share with files when
 * the platform supports it, plain download as the fallback. */

const FONT = '"InterVar", "Segoe UI", system-ui, sans-serif';

function rr(x, rx, ry, rw, rh, r) {
  if (x.roundRect) { x.beginPath(); x.roundRect(rx, ry, rw, rh, r); return; }
  x.beginPath(); x.rect(rx, ry, rw, rh); // old engine fallback
}

/* data: { wpm, acc, time, place ('1st'|null), medal (emoji|''), modeLabel,
 *         themeLabel, streak, diedPct } */
export function drawShareCard(data) {
  const W = 1200, H = 630;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');

  // night gradient + two aurora glows + a dashed-track motif
  const bg = x.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#070b18'); bg.addColorStop(0.55, '#0b1122'); bg.addColorStop(1, '#111a33');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  let g = x.createRadialGradient(W - 160, 40, 30, W - 160, 40, 520);
  g.addColorStop(0, 'rgba(90,209,255,0.20)'); g.addColorStop(1, 'rgba(90,209,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  g = x.createRadialGradient(110, H - 30, 20, 110, H - 30, 430);
  g.addColorStop(0, 'rgba(139,123,255,0.18)'); g.addColorStop(1, 'rgba(139,123,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(255,255,255,0.045)'; x.lineWidth = 16; x.setLineDash([70, 90]);
  x.beginPath(); x.moveTo(-40, H - 44);
  x.bezierCurveTo(W * 0.3, H - 16, W * 0.7, H - 92, W + 40, H - 58);
  x.stroke(); x.setLineDash([]);

  // header
  x.textBaseline = 'alphabetic';
  x.textAlign = 'left';
  x.fillStyle = '#5ad1ff';
  x.font = `900 30px ${FONT}`;
  x.fillText('TYPERACER 3D', 70, 88);
  x.fillStyle = 'rgba(255,255,255,0.55)';
  x.font = `600 21px ${FONT}`;
  x.fillText(data.modeLabel, 72, 124);

  // theme badge (top-right)
  x.textAlign = 'right';
  x.fillStyle = 'rgba(255,255,255,0.8)';
  x.font = `700 23px ${FONT}`;
  x.fillText(data.themeLabel, W - 70, 92);

  // giant wpm with the game's cyan→violet gradient
  const grad = x.createLinearGradient(64, 180, 470, 330);
  grad.addColorStop(0, '#5ad1ff'); grad.addColorStop(1, '#8b7bff');
  x.fillStyle = grad;
  x.textAlign = 'left';
  x.font = `900 148px ${FONT}`;
  x.fillText(String(data.wpm), 64, 316);
  x.fillStyle = 'rgba(255,255,255,0.5)';
  x.font = `800 24px ${FONT}`;
  x.fillText('WORDS PER MINUTE', 72, 360);

  // stat tiles — accuracy / time / place (or death %)
  const tiles = [
    { label: 'accuracy', value: `${Math.round(data.acc)}%` },
    { label: 'time', value: data.time ? `${data.time.toFixed(1)}s` : '—' },
    data.diedPct != null
      ? { label: 'died at', value: `${data.diedPct}%`, danger: true }
      : { label: 'place', value: data.place ?? '1st' },
  ];
  const tw = 172, tg = 20, ty = 428;
  tiles.forEach((t, i) => {
    const tx = 70 + i * (tw + tg);
    x.fillStyle = 'rgba(255,255,255,0.07)';
    rr(x, tx, ty, tw, 96, 16); x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.13)'; x.lineWidth = 1.5;
    rr(x, tx, ty, tw, 96, 16); x.stroke();
    x.fillStyle = t.danger ? '#ff6b81' : '#ffffff';
    x.textAlign = 'left';
    x.font = `900 40px ${FONT}`;
    x.fillText(t.value, tx + 22, ty + 52);
    x.fillStyle = 'rgba(255,255,255,0.45)';
    x.font = `700 17px ${FONT}`;
    x.fillText(t.label.toUpperCase(), tx + 22, ty + 78);
  });

  // badges row: medal / streak / died-flavor
  x.font = `800 30px ${FONT}`;
  const badges = [];
  if (data.medal) badges.push(`${data.medal} ${data.place ?? 'finish'}`);
  if (data.streak) badges.push(`🔥 ${data.streak}-day streak`);
  if (data.diedPct != null) badges.push('💀 death run');
  let bx = 70;
  for (const b of badges) {
    const wpx = x.measureText(b).width + 44;
    x.fillStyle = 'rgba(90,209,255,0.12)';
    rr(x, bx, 538, wpx, 46, 23); x.fill();
    x.strokeStyle = 'rgba(90,209,255,0.3)'; x.lineWidth = 1.5;
    rr(x, bx, 538, wpx, 46, 23); x.stroke();
    x.fillStyle = '#bfe6ff';
    x.fillText(b, bx + 22, 569);
    bx += wpx + 14;
  }

  // footer
  x.textAlign = 'left';
  x.fillStyle = 'rgba(255,255,255,0.38)';
  x.font = `700 21px ${FONT}`;
  x.fillText('lakzayi.github.io/typeracer3d', 70, H - 22);
  x.textAlign = 'right';
  x.fillText('can you beat me? 🏎️💨', W - 70, H - 22);
  return c;
}

/* native share sheet with the PNG attached, else download it */
export async function shareCard(canvas, filename) {
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'TypeRacer 3D' });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled'; // sheet closed
      // some engines throw on share-with-file despite canShare — fall through
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'downloaded';
}
