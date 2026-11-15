// Анализ изображений: яркость, контраст, точки интереса, направленность линий,
// технические дефекты (низкое разрешение, рамки/леттербокс, пересвет/недосвет)
// и псевдо-карта глубины для параллакса. Всё считается по реальным пикселям.

export async function loadBitmap(blob) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(blob); } catch (e) { /* fallback ниже */ }
  }
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Не удалось прочитать изображение'));
    img.src = URL.createObjectURL(blob);
  });
}

function getPixels(src, w, h, crop) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (crop) g.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
  else g.drawImage(src, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

function boxBlur(a, w, h, r, passes = 3) {
  let src = a, dst = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    // горизонтально
    for (let y = 0; y < h; y++) {
      let acc = 0, n = 0;
      for (let x = -r; x <= r; x++) { const xx = Math.min(w - 1, Math.max(0, x)); acc += src[y * w + xx]; n++; }
      for (let x = 0; x < w; x++) {
        dst[y * w + x] = acc / n;
        const xo = Math.max(0, x - r), xi = Math.min(w - 1, x + r + 1);
        acc += src[y * w + xi] - src[y * w + xo];
      }
    }
    [src, dst] = [dst, src];
    // вертикально
    for (let x = 0; x < w; x++) {
      let acc = 0, n = 0;
      for (let y = -r; y <= r; y++) { const yy = Math.min(h - 1, Math.max(0, y)); acc += src[yy * w + x]; n++; }
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = acc / n;
        const yo = Math.max(0, y - r), yi = Math.min(h - 1, y + r + 1);
        acc += src[yi * w + x] - src[yo * w + x];
      }
    }
    [src, dst] = [dst, src];
  }
  return src;
}

// Обнаружение чёрных/однотонных полос по краям исходника (леттербокс)
function detectBars(src) {
  const W = 200, H = Math.max(2, Math.round(200 * src.height / src.width));
  const d = getPixels(src, W, H);
  const rowStat = y => { let s = 0, s2 = 0; for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; const l = (d[i] + d[i + 1] + d[i + 2]) / 3; s += l; s2 += l * l; } const m = s / W; return { m, sd: Math.sqrt(Math.max(0, s2 / W - m * m)) }; };
  const colStat = x => { let s = 0, s2 = 0; for (let y = 0; y < H; y++) { const i = (y * W + x) * 4; const l = (d[i] + d[i + 1] + d[i + 2]) / 3; s += l; s2 += l * l; } const m = s / H; return { m, sd: Math.sqrt(Math.max(0, s2 / H - m * m)) }; };
  const flat = st => st.sd < 3 && (st.m < 14 || st.m > 245);
  let top = 0; while (top < H * 0.3 && flat(rowStat(top))) top++;
  let bot = 0; while (bot < H * 0.3 && flat(rowStat(H - 1 - bot))) bot++;
  let left = 0; while (left < W * 0.3 && flat(colStat(left))) left++;
  let right = 0; while (right < W * 0.3 && flat(colStat(W - 1 - right))) right++;
  const fx = src.width / W, fy = src.height / H;
  const pad = 1;
  const t = top ? (top + pad) * fy : 0, b = bot ? (bot + pad) * fy : 0, l = left ? (left + pad) * fx : 0, r = right ? (right + pad) * fx : 0;
  if (!t && !b && !l && !r) return null;
  return { x: Math.round(l), y: Math.round(t), w: Math.round(src.width - l - r), h: Math.round(src.height - t - b) };
}

export async function analyzeImage(blob) {
  const bmp = await loadBitmap(blob);
  const iw = bmp.width, ih = bmp.height;
  const crop = detectBars(bmp);
  const cw = crop ? crop.w : iw, ch = crop ? crop.h : ih;
  const W = 128, H = Math.max(8, Math.round(128 * ch / cw));
  const d = getPixels(bmp, W, H, crop);
  const N = W * H;
  const lum = new Float32Array(N);
  let sum = 0, sum2 = 0, clipHi = 0, clipLo = 0, satSum = 0, rS = 0, gS = 0, bS = 0;
  for (let i = 0; i < N; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    lum[i] = l; sum += l; sum2 += l * l;
    if (l > 0.97) clipHi++; if (l < 0.02) clipLo++;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    satSum += mx ? (mx - mn) / mx : 0;
    rS += r; gS += g; bS += b;
  }
  const mean = sum / N, std = Math.sqrt(Math.max(0, sum2 / N - mean * mean));

  // градиенты и резкость
  const sharp = new Float32Array(N);
  let ex = 0, ey = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const gx = lum[i + 1] - lum[i - 1], gy = lum[i + W] - lum[i - W];
    ex += Math.abs(gx); ey += Math.abs(gy);
    const lap = Math.abs(4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - W] - lum[i + W]);
    sharp[i] = lap;
  }
  const sharpB = boxBlur(sharp, W, H, 3, 2);
  let smax = 1e-6; for (let i = 0; i < N; i++) smax = Math.max(smax, sharpB[i]);

  // карта заметности: локальный контраст + отличие от средней яркости, с ослаблением у краёв
  const lumB = boxBlur(lum, W, H, 6, 2);
  const sal = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const edgeW = Math.min(1, Math.min(x, W - 1 - x) / (W * 0.08)) * Math.min(1, Math.min(y, H - 1 - y) / (H * 0.06));
    sal[i] = (0.6 * sharpB[i] / smax + 0.4 * Math.abs(lum[i] - lumB[i]) * 4 + 0.25 * Math.abs(lum[i] - mean) * 2) * edgeW;
  }
  const salB = boxBlur(sal, W, H, 4, 2);
  // центр интереса и до трёх локальных максимумов
  let cxs = 0, cys = 0, ws = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = salB[y * W + x] ** 2; cxs += v * x; cys += v * y; ws += v; }
  const focus = ws > 0 ? { x: (cxs / ws + 0.5) / W, y: (cys / ws + 0.5) / H } : { x: 0.5, y: 0.5 };
  const peaks = [];
  const copy = Float32Array.from(salB);
  for (let k = 0; k < 3; k++) {
    let bi = 0, bv = -1; for (let i = 0; i < N; i++) if (copy[i] > bv) { bv = copy[i]; bi = i; }
    if (bv <= 0) break;
    const px = bi % W, py = Math.floor(bi / W);
    peaks.push({ x: (px + 0.5) / W, y: (py + 0.5) / H, v: bv });
    const rr = Math.round(W * 0.18);
    for (let y = Math.max(0, py - rr); y < Math.min(H, py + rr); y++) for (let x = Math.max(0, px - rr); x < Math.min(W, px + rr); x++) copy[y * W + x] = 0;
  }

  // псевдо-глубина (1 = близко): вертикальный приоритет + резкость + темнота = даль
  const depth = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const vert = y / (H - 1);
    const dv = 0.45 * vert + 0.35 * (sharpB[i] / smax) + 0.25 * Math.min(1, lumB[i] / Math.max(0.05, mean * 1.6)) - 0.1;
    depth[i] = dv;
  }
  const depthB = boxBlur(depth, W, H, 7, 3);
  let dmin = 1e9, dmax = -1e9; for (let i = 0; i < N; i++) { dmin = Math.min(dmin, depthB[i]); dmax = Math.max(dmax, depthB[i]); }
  const depthBytes = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    const v = Math.round(255 * (depthB[i] - dmin) / Math.max(1e-6, dmax - dmin));
    depthBytes[i * 4] = depthBytes[i * 4 + 1] = depthBytes[i * 4 + 2] = v; depthBytes[i * 4 + 3] = 255;
  }
  const dc = document.createElement('canvas'); dc.width = W; dc.height = H;
  dc.getContext('2d').putImageData(new ImageData(depthBytes, W, H), 0, 0);
  const depthURL = dc.toDataURL('image/png');

  // технические проблемы
  const issues = [];
  const effW = cw, effH = ch;
  const aspect = effW / effH;
  const keepFrac = aspect > 0.5625 ? 0.5625 / aspect : aspect / 0.5625;
  if (effH < 1000 && effW < 1000) issues.push({ level: 'warn', text: `Низкое разрешение (${effW}×${effH}). Будет заметна мягкость — зерно и помехи частично скроют её.` });
  if (keepFrac < 0.5) issues.push({ level: 'warn', text: `Пропорции ${aspect.toFixed(2)}: при кадрировании в 9:16 остаётся ${(keepFrac * 100).toFixed(0)}% ширины. Лучше вертикальное изображение.` });
  if (clipHi / N > 0.12) issues.push({ level: 'warn', text: `Пересвет: ${(clipHi / N * 100).toFixed(0)}% пикселей выбиты в белое.` });
  if (clipLo / N > 0.55) issues.push({ level: 'warn', text: `Очень тёмный кадр: ${(clipLo / N * 100).toFixed(0)}% пикселей почти чёрные — детали потеряются.` });
  if (std < 0.05) issues.push({ level: 'warn', text: 'Очень низкий контраст — кадр будет выглядеть плоским.' });
  if (crop) issues.push({ level: 'fix', text: `Обнаружены рамки по краям — автоматически обрезаны (${iw}×${ih} → ${cw}×${ch}).` });

  const orientation = ex > ey * 1.25 ? 'vertical-lines' : ey > ex * 1.25 ? 'horizontal-lines' : 'balanced';
  return {
    width: iw, height: ih, crop, aspect,
    mean, std, saturation: satSum / N,
    tint: { r: rS / N / 255, g: gS / N / 255, b: bS / N / 255 },
    focus, peaks, orientation,
    edgeX: ex / N, edgeY: ey / N,
    darkness: clipLo / N, highlights: clipHi / N,
    depthURL, depthW: W, depthH: H,
    issues,
    analyzedAt: Date.now(),
  };
}

// Краткое описание анализа для интерфейса
export function describeAnalysis(a) {
  if (!a) return 'не проанализировано';
  const parts = [];
  parts.push(`${a.width}×${a.height}`);
  parts.push(a.mean < 0.18 ? 'тёмный' : a.mean > 0.6 ? 'светлый' : 'средний тон');
  parts.push(a.std < 0.12 ? 'мягкий контраст' : a.std > 0.25 ? 'жёсткий контраст' : 'норм. контраст');
  parts.push(a.orientation === 'vertical-lines' ? 'вертикальные линии' : a.orientation === 'horizontal-lines' ? 'горизонтальные линии' : 'сбалансированная композиция');
  parts.push(`фокус ${(a.focus.x * 100).toFixed(0)}%/${(a.focus.y * 100).toFixed(0)}%`);
  return parts.join(' · ');
}
