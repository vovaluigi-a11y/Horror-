// Процедурные ТЕСТОВЫЕ кадры. Нужны только для проверки монтажного движка без своих изображений.
// Это простые рисунки кодом (коридор, дверь, лестница, окно, силуэт) — не «нейросетевые фото»
// и не готовый результат. В интерфейсе они всегда помечены как тестовые.

function noiseFill(g, w, h, amt, seed) {
  const id = g.getImageData(0, 0, w, h); const d = id.data;
  let s = seed;
  for (let i = 0; i < d.length; i += 4) { s = (s * 16807) % 2147483647; const n = (s / 2147483647 - 0.5) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(id, 0, 0);
}

function corridor(g, w, h, opt = {}) {
  const vx = w * (opt.vx ?? 0.5), vy = h * (opt.vy ?? 0.45);
  const wall = opt.wall || '#5d6248', floor = opt.floor || '#3b3326', ceil = opt.ceil || '#8b8d78';
  g.fillStyle = ceil; g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(vx + w * 0.08, vy - h * 0.05); g.lineTo(vx - w * 0.08, vy - h * 0.05); g.fill();
  g.fillStyle = floor; g.beginPath(); g.moveTo(0, h); g.lineTo(w, h); g.lineTo(vx + w * 0.08, vy + h * 0.05); g.lineTo(vx - w * 0.08, vy + h * 0.05); g.fill();
  g.fillStyle = wall; g.beginPath(); g.moveTo(0, 0); g.lineTo(vx - w * 0.08, vy - h * 0.05); g.lineTo(vx - w * 0.08, vy + h * 0.05); g.lineTo(0, h); g.fill();
  g.fillStyle = shade(wall, -18); g.beginPath(); g.moveTo(w, 0); g.lineTo(vx + w * 0.08, vy - h * 0.05); g.lineTo(vx + w * 0.08, vy + h * 0.05); g.lineTo(w, h); g.fill();
  g.fillStyle = '#0b0b09'; g.fillRect(vx - w * 0.08, vy - h * 0.05, w * 0.16, h * 0.1);
  // лампы
  for (let k = 0; k < 6; k++) {
    const t = Math.pow(k / 6, 1.6);
    const x = vx + (w * 0.5 - vx) * (1 - t) * 0.0, y = lerp(h * 0.03, vy - h * 0.05, t);
    const lw = lerp(w * 0.28, w * 0.02, t);
    const on = opt.lampsOn ? opt.lampsOn(k) : true;
    const grd = g.createRadialGradient(x, y, 1, x, y, lw * 1.6);
    grd.addColorStop(0, on ? 'rgba(235,255,215,0.9)' : 'rgba(40,40,30,0.6)'); grd.addColorStop(1, 'rgba(235,255,215,0)');
    g.fillStyle = grd; g.fillRect(x - lw * 2, y - lw, lw * 4, lw * 2);
  }
  // двери по стенам
  for (let k = 1; k < 5; k++) {
    const t = Math.pow(k / 5, 1.4);
    const xl = lerp(0, vx - w * 0.08, t), xr = lerp(w, vx + w * 0.08, t);
    const top = lerp(h * 0.18, vy - h * 0.04, t), bot = lerp(h * 0.92, vy + h * 0.045, t);
    const dw = lerp(w * 0.13, w * 0.01, t);
    g.fillStyle = '#2a2219'; g.fillRect(xl, top, dw, bot - top); g.fillRect(xr - dw, top, dw, bot - top);
  }
}

function silhouette(g, x, y, s, color = '#050505') {
  g.fillStyle = color;
  g.beginPath(); g.ellipse(x, y - s * 0.86, s * 0.07, s * 0.09, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(x - s * 0.13, y - s * 0.74); g.lineTo(x + s * 0.13, y - s * 0.74); g.lineTo(x + s * 0.17, y); g.lineTo(x - s * 0.17, y); g.fill();
  g.fillRect(x - s * 0.2, y - s * 0.72, s * 0.05, s * 0.5); g.fillRect(x + s * 0.15, y - s * 0.72, s * 0.05, s * 0.5);
}

function shade(hex, d) { const n = parseInt(hex.slice(1), 16); const c = v => Math.max(0, Math.min(255, v + d)); return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`; }
const lerp = (a, b, t) => a + (b - a) * t;

function vignette(g, w, h, k = 0.75) {
  const grd = g.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.75);
  grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, `rgba(0,0,0,${k})`);
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
}

const SCENES = [
  (g, w, h) => { corridor(g, w, h); vignette(g, w, h, 0.6); },
  (g, w, h) => { corridor(g, w, h, { vx: 0.42, wall: '#4d5a52', floor: '#2d2a22' }); g.fillStyle = '#e8e2c8'; g.fillRect(w * 0.07, h * 0.4, w * 0.12, h * 0.16); g.fillStyle = '#222'; for (let i = 0; i < 6; i++) g.fillRect(w * 0.085, h * 0.42 + i * h * 0.022, w * 0.09, 3); vignette(g, w, h, 0.7); },
  (g, w, h) => { corridor(g, w, h, { lampsOn: k => k % 2 === 0 }); vignette(g, w, h, 0.8); },
  (g, w, h) => { g.fillStyle = '#3a3226'; g.fillRect(0, 0, w, h); g.fillStyle = '#d9d2b6'; g.beginPath(); g.ellipse(w * 0.5, h * 0.5, w * 0.3, w * 0.3, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#111'; g.lineWidth = 8; g.stroke(); g.lineWidth = 10; g.beginPath(); g.moveTo(w * 0.5, h * 0.5); g.lineTo(w * 0.5 + w * 0.13, h * 0.5 + w * 0.07); g.moveTo(w * 0.5, h * 0.5); g.lineTo(w * 0.5 - w * 0.02, h * 0.5 - w * 0.22); g.stroke(); for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.fillStyle = '#111'; g.fillRect(w * 0.5 + Math.cos(a) * w * 0.26 - 4, h * 0.5 + Math.sin(a) * w * 0.26 - 4, 8, 8); } vignette(g, w, h, 0.85); },
  (g, w, h) => { corridor(g, w, h, { wall: '#3c4038', floor: '#201c16', ceil: '#55574a' }); silhouette(g, w * 0.5, h * 0.5, h * 0.12); vignette(g, w, h, 0.85); },
  (g, w, h) => { corridor(g, w, h, { wall: '#3c4038', floor: '#201c16', ceil: '#55574a', lampsOn: k => k < 2 }); silhouette(g, w * 0.52, h * 0.86, h * 0.55); const grd = g.createRadialGradient(w * 0.5, h * 0.45, 10, w * 0.5, h * 0.45, h * 0.4); grd.addColorStop(0, 'rgba(255,250,220,0.35)'); grd.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grd; g.fillRect(0, 0, w, h); vignette(g, w, h, 0.9); },
  (g, w, h) => { g.fillStyle = '#16140f'; g.fillRect(0, 0, w, h); for (let i = 0; i < 9; i++) { const y = h * 0.15 + i * h * 0.09; g.fillStyle = shade('#6b6250', -i * 6); g.fillRect(w * 0.1 + i * w * 0.03, y, w * 0.8 - i * w * 0.06, h * 0.03); } silhouette(g, w * 0.5, h * 0.95, h * 0.2, '#000'); vignette(g, w, h, 0.9); },
  (g, w, h) => { g.fillStyle = '#0d1016'; g.fillRect(0, 0, w, h); g.fillStyle = '#c6cfd8'; g.fillRect(w * 0.3, h * 0.25, w * 0.4, h * 0.35); g.fillStyle = '#0d1016'; g.fillRect(w * 0.49, h * 0.25, w * 0.02, h * 0.35); g.fillRect(w * 0.3, h * 0.42, w * 0.4, h * 0.015); silhouette(g, w * 0.6, h * 0.58, h * 0.28, '#05070a'); vignette(g, w, h, 0.85); },
];

export async function makeTestPlates(n = 8) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 1536;
    const g = c.getContext('2d');
    SCENES[i % SCENES.length](g, c.width, c.height);
    noiseFill(g, c.width, c.height, 18, 1234 + i * 77);
    g.fillStyle = 'rgba(255,255,255,0.0)';
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    out.push(new File([blob], `test_shot_${String(i + 1).padStart(2, '0')}.png`, { type: 'image/png' }));
  }
  return out;
}
