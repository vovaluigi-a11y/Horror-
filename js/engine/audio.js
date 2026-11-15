// Программный звуковой дизайн. Все звуки синтезируются кодом (никаких чужих записей):
// низкий гул, ленточное шипение, радиопомехи, электрические щелчки, цифровые сбои,
// тревожные акценты, моменты тишины. Каждая дорожка — отдельный буфер, поэтому
// громкость и отключение дорожек применяются мгновенно без пересинтеза.

import { rng } from './timeline.js';

export const SR = 48000;

class Biquad {
  constructor(type, f, q = 0.707) { this.set(type, f, q); this.x1 = this.x2 = this.y1 = this.y2 = 0; }
  set(type, f, q) {
    const w = 2 * Math.PI * f / SR, c = Math.cos(w), s = Math.sin(w), a = s / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; a0 = 1 + a; a1 = -2 * c; a2 = 1 - a; }
    else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; a0 = 1 + a; a1 = -2 * c; a2 = 1 - a; }
    else { b0 = a; b1 = 0; b2 = -a; a0 = 1 + a; a1 = -2 * c; a2 = 1 - a; } // bp
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  p(x) { const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2; this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; }
}

function track(n) { return [new Float32Array(n), new Float32Array(n)]; }
const S = t => Math.round(t * SR);

// ---------- Дорожки ----------
function genDrone(edl, n, r) {
  const [L, R] = track(n);
  const f0 = 36 + r() * 12; // фундамент 36–48 Гц
  const ratios = [1, 1.498, 2.01, 2.996, 1.06];
  const ph = ratios.map(() => r() * 6.28);
  const lp = new Biquad('lp', 180, 0.8), lp2 = new Biquad('lp', 180, 0.8);
  const nlp = new Biquad('lp', 90, 0.9);
  const nr = rng(edl.seed + 5);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const ten = edl.tension(t);
    let v = 0;
    for (let k = 0; k < ratios.length; k++) {
      const f = f0 * ratios[k] * (1 + 0.003 * Math.sin(t * (0.07 + k * 0.03) * 6.28));
      const amp = k === 0 ? 0.5 : k === 4 ? 0.22 * ten : 0.2 / k;
      v += Math.sin(6.2832 * f * t + ph[k] + 0.4 * Math.sin(t * 0.21 * 6.28 + k)) * amp;
    }
    // «рокот» — отфильтрованный шум
    v += nlp.p(nr() * 2 - 1) * 0.9;
    const swell = 0.55 + 0.45 * ten + 0.12 * Math.sin(t * 0.13 * 6.28);
    const fadeIn = Math.min(1, t / 1.5);
    const o = v * swell * fadeIn * 0.55;
    L[i] = lp.p(o); R[i] = lp2.p(o * 0.97 + 0.03 * Math.sin(t * 6.28 * f0 * 0.5));
  }
  return [L, R];
}

function genHiss(edl, n, r) {
  const [L, R] = track(n);
  const hpL = new Biquad('hp', 2800, 0.6), hpR = new Biquad('hp', 2800, 0.6);
  const lpL = new Biquad('lp', 11000, 0.6), lpR = new Biquad('lp', 11000, 0.6);
  const hum = new Biquad('lp', 400, 0.7);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const wow = 0.8 + 0.2 * Math.sin(t * 0.7 * 6.28) + 0.08 * Math.sin(t * 6.1 * 6.28);
    const a = lpL.p(hpL.p(r() * 2 - 1)) * wow, b = lpR.p(hpR.p(r() * 2 - 1)) * wow;
    // сетевой фон 50 Гц и гармоники — очень тихо
    const h = hum.p(Math.sin(6.2832 * 50 * t) * 0.5 + Math.sin(6.2832 * 150 * t) * 0.25) * 0.05;
    L[i] = (a * 0.3 + h); R[i] = (b * 0.3 + h);
  }
  return [L, R];
}

function genRadio(edl, n, r) {
  const [L, R] = track(n);
  const bp = new Biquad('bp', 1200, 2.5), bp2 = new Biquad('bp', 2400, 4);
  // окна активности радиопомех (по сегментам, с вероятностью)
  const windows = [];
  for (const s of edl.segments) if (r() < 0.55) { const st = s.start + r() * (s.end - s.start) * 0.5; windows.push([st, Math.min(s.end, st + 1 + r() * 2.5)]); }
  const tone = 700 + r() * 900;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let w = 0;
    for (const [a, b] of windows) if (t > a && t < b) w = Math.max(w, Math.min(1, (t - a) * 4, (b - t) * 4));
    const base = 0.08 + w * 0.9;
    if (base < 0.02) continue;
    // настройка: сканирующая полоса, амплитудная модуляция, свист гетеродина
    const f = 900 + 700 * Math.sin(t * 0.37 * 6.28) + 300 * Math.sin(t * 2.3 * 6.28);
    if (i % 256 === 0) bp.set('bp', Math.max(200, f), 2.5);
    const am = 0.5 + 0.5 * Math.sin(t * 6.28 * (3 + 4 * Math.sin(t * 0.5)));
    let v = bp.p(r() * 2 - 1) * am * 1.6;
    v += bp2.p(r() * 2 - 1) * 0.4;
    v += Math.sin(6.2832 * (tone + 40 * Math.sin(t * 1.3)) * t) * 0.06 * w;
    v *= base;
    L[i] = v * 0.8; R[i] = v * 0.6;
  }
  return [L, R];
}

function addClick(L, R, at, amp, r, len = 0.012, pan = 0) {
  const i0 = S(at), m = S(len);
  const f = 800 + r() * 3000;
  for (let i = 0; i < m && i0 + i < L.length; i++) {
    if (i0 + i < 0) continue;
    const e = Math.exp(-i / (m * 0.18));
    const v = ((r() * 2 - 1) * 0.6 + Math.sin(6.2832 * f * i / SR) * 0.4) * e * amp;
    L[i0 + i] += v * (1 - pan * 0.5); R[i0 + i] += v * (1 + pan * 0.5);
  }
}

function genClicks(edl, n, r) {
  const [L, R] = track(n);
  // случайные электрические щелчки и реле
  let t = 0.3;
  while (t < edl.duration - 0.2) {
    const ten = edl.tension(t);
    t += 0.4 + r() * (2.6 - ten * 1.6);
    addClick(L, R, t, 0.15 + r() * 0.35, r, 0.004 + r() * 0.01, r() * 2 - 1);
    if (r() < 0.2) addClick(L, R, t + 0.03 + r() * 0.05, 0.2, r, 0.006);
  }
  // щелчок на каждой склейке
  for (const s of edl.segments) addClick(L, R, s.start, 0.45, r, 0.01);
  return [L, R];
}

// Синхронные с изображением сбои
function genDigital(edl, n, r) {
  const [L, R] = track(n);
  for (const ev of edl.soundEvents) {
    const i0 = S(ev.t), m = Math.max(S(0.02), S(ev.dur));
    const a = Math.min(1.2, ev.amt);
    const f = 300 + r() * 2200;
    let hold = 0, holdV = 0;
    const lp = new Biquad('lp', 1500 + r() * 3000, 0.9);
    for (let i = 0; i < m && i0 + i < n; i++) {
      if (i0 + i < 0) continue;
      const u = i / m;
      const env = Math.min(1, u * 40) * (u > 0.85 ? (1 - u) / 0.15 : 1);
      const tt = i / SR;
      let v = 0;
      switch (ev.kind) {
        case 'hum_buzz': v = (Math.sign(Math.sin(6.2832 * 60 * tt)) * 0.4 + Math.sin(6.2832 * 180 * tt) * 0.3 + (r() - 0.5) * 0.3) * 0.7; break;
        case 'digital_chirp': v = Math.sign(Math.sin(6.2832 * (f + 3000 * u) * tt)) * 0.45; break;
        case 'tape_crunch': { if (hold-- <= 0) { holdV = r() * 2 - 1; hold = 4 + Math.floor(r() * 30); } v = holdV * 0.7; break; }
        case 'mute_click': v = u < 0.08 ? (r() * 2 - 1) * 0.5 : 0; break;
        case 'digital_grind': { if (hold-- <= 0) { holdV = Math.round((r() * 2 - 1) * 3) / 3; hold = 20 + Math.floor(r() * 120); } v = holdV * 0.5 + Math.sign(Math.sin(6.2832 * 1000 * tt)) * 0.12; break; }
        case 'warble': v = lp.p(r() * 2 - 1) * (0.5 + 0.5 * Math.sin(6.2832 * 9 * tt)) * 0.9; break;
        case 'stutter': v = ((Math.floor(tt / 0.045) % 2) ? 0.0 : (r() * 2 - 1) * 0.45); break;
        case 'click': v = u < 0.1 ? (r() * 2 - 1) * 0.6 : 0; break;
        case 'cut_click': v = u < 0.25 ? (r() * 2 - 1) * 0.35 * (1 - u * 4) : 0; break;
        case 'noise_burst': v = (r() * 2 - 1) * 0.85; break;
        case 'thump': v = Math.sin(6.2832 * (70 - 40 * u) * tt) * Math.exp(-u * 4) * 1.1; break;
        case 'radio_sweep': v = lp.p(r() * 2 - 1) * 0.6 + Math.sin(6.2832 * (500 + 1500 * u) * tt) * 0.15; break;
        case 'signal_loss': v = u < 0.3 ? Math.sign(Math.sin(6.2832 * 1000 * tt)) * 0.3 * (1 - u / 0.3) + (r() - 0.5) * 0.4 : (r() - 0.5) * 0.04; break;
        default: v = (r() * 2 - 1) * 0.3;
      }
      v *= env * a;
      L[i0 + i] += v; R[i0 + i] += v * (0.85 + 0.15 * Math.sin(i));
    }
  }
  return [L, R];
}

function genStingers(edl, n, r) {
  const [L, R] = track(n);
  for (const st of edl.stingers) {
    const i0 = S(st.t);
    if (st.type === 'impact' || st.type === 'final') {
      // низкий удар с падением высоты + металлический призвук
      const m = S(st.type === 'final' ? 3.2 : 2.4);
      const fm = 90 + r() * 80;
      for (let i = 0; i < m && i0 + i < n; i++) {
        const tt = i / SR, u = i / m;
        const boom = Math.sin(6.2832 * (55 * Math.exp(-tt * 1.2) + 28) * tt) * Math.exp(-tt * 1.6) * 0.95;
        const metal = Math.sin(6.2832 * 311 * tt + 2.2 * Math.sin(6.2832 * fm * tt)) * Math.exp(-tt * 1.1) * 0.18;
        const nz = (r() * 2 - 1) * Math.exp(-tt * 9) * 0.35;
        const v = (boom + metal + nz) * (1 - u * 0.2);
        L[i0 + i] += v; R[i0 + i] += v * 0.96;
      }
      // реверсивный нарастающий «вдох» перед ударом
      const pre = S(1.1);
      const lp = new Biquad('lp', 600, 0.9);
      for (let i = 0; i < pre; i++) {
        const k = i0 - pre + i; if (k < 0 || k >= n) continue;
        const u = i / pre;
        const v = lp.p(r() * 2 - 1) * Math.pow(u, 3) * 0.5 + Math.sin(6.2832 * 220 * (1 + u * 0.06) * i / SR) * Math.pow(u, 4) * 0.08;
        L[k] += v; R[k] += v;
      }
    } else if (st.type === 'thump') {
      const m = S(0.6);
      for (let i = 0; i < m && i0 + i < n; i++) { const tt = i / SR; const v = Math.sin(6.2832 * (60 - 25 * tt) * tt) * Math.exp(-tt * 7) * 0.8; L[i0 + i] += v; R[i0 + i] += v; }
    } else if (st.type === 'swell_low') {
      const m = S(3.0);
      for (let i = 0; i < m && i0 + i < n; i++) {
        const tt = i / SR, u = i / m;
        const env = Math.sin(Math.PI * u) ** 2;
        const v = (Math.sin(6.2832 * 41 * tt) + 0.6 * Math.sin(6.2832 * 43.3 * tt) + 0.3 * Math.sin(6.2832 * 87 * tt)) * env * 0.35;
        L[i0 + i] += v; R[i0 + i] += v;
      }
    }
  }
  return [L, R];
}

// Огибающая тишины (общая для всех дорожек, кроме акцентов, звучащих после неё)
function duckEnvelope(edl, n) {
  const env = new Float32Array(n).fill(1);
  // во вступлении — только помехи
  const introN = S(edl.introDur);
  for (let i = 0; i < introN && i < n; i++) env[i] = 0.6 + 0.4 * (i / introN);
  for (const s of edl.silences) {
    const a = S(s.t), b = S(s.t + s.dur), ramp = S(0.06);
    for (let i = Math.max(0, a - ramp); i < Math.min(n, b + ramp); i++) {
      let g = 0.02;
      if (i < a) g = 1 - (i - (a - ramp)) / ramp * 0.98;
      else if (i > b) g = 0.02 + (i - b) / ramp * 0.98;
      env[i] = Math.min(env[i], g);
    }
  }
  // глитч «провал» — полная тишина на долю секунды
  for (const g of edl.glitches) if (g.type === 'dropout') { for (let i = S(g.t); i < Math.min(n, S(g.t + g.dur)); i++) env[i] = Math.min(env[i], 0.05); }
  // финальное затухание
  const fo = S(0.4);
  for (let i = n - fo; i < n; i++) if (i >= 0) env[i] *= (n - i) / fo;
  return env;
}

export function synthesizeTracks(edl) {
  const n = Math.ceil(edl.duration * SR);
  const base = edl.seed;
  const tracks = {
    drone: genDrone(edl, n, rng(base + 101)),
    hiss: genHiss(edl, n, rng(base + 202)),
    radio: genRadio(edl, n, rng(base + 303)),
    clicks: genClicks(edl, n, rng(base + 404)),
    digital: genDigital(edl, n, rng(base + 505)),
    stingers: genStingers(edl, n, rng(base + 606)),
  };
  const duck = duckEnvelope(edl, n);
  return { n, tracks, duck };
}

// Сведение с учётом громкостей/отключений, мягкий лимитер и нормализация
export function mixTracks(synth, trackCfg, master = 0.9) {
  const { n, tracks, duck } = synth;
  const L = new Float32Array(n), R = new Float32Array(n);
  const gains = { drone: 0.9, hiss: 0.5, radio: 0.45, clicks: 0.6, digital: 0.55, stingers: 0.85 };
  for (const [id, [tl, tr]] of Object.entries(tracks)) {
    const cfg = trackCfg[id] || { on: true, vol: 0.6 };
    if (!cfg.on || cfg.vol <= 0) continue;
    const g = gains[id] * cfg.vol;
    const ducked = id !== 'stingers' && id !== 'digital';
    for (let i = 0; i < n; i++) { const d = ducked ? duck[i] : (id === 'digital' ? Math.max(duck[i], 0.5) : 1); L[i] += tl[i] * g * d; R[i] += tr[i] * g * d; }
  }
  // мягкий лимитер + защита от NaN
  let peak = 0;
  for (let i = 0; i < n; i++) {
    let a = L[i], b = R[i];
    if (!Number.isFinite(a)) a = 0; if (!Number.isFinite(b)) b = 0;
    a = Math.tanh(a * 1.1); b = Math.tanh(b * 1.1);
    L[i] = a; R[i] = b;
    peak = Math.max(peak, Math.abs(a), Math.abs(b));
  }
  const target = 0.89 * master; // ≈ −1 dBFS при master = 1
  const k = peak > 0 ? target / peak : 1;
  for (let i = 0; i < n; i++) { L[i] *= k; R[i] *= k; }
  return [L, R];
}

// Технический анализ звуковой дорожки (для контроля качества)
export function analyzeAudio([L, R], edl) {
  const n = L.length;
  let peak = 0, sum2 = 0, nan = 0, clip = 0, dc = 0;
  for (let i = 0; i < n; i++) {
    const a = L[i], b = R[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) { nan++; continue; }
    peak = Math.max(peak, Math.abs(a), Math.abs(b));
    sum2 += a * a + b * b; dc += a + b;
    if (Math.abs(a) >= 0.999 || Math.abs(b) >= 0.999) clip++;
  }
  const rms = Math.sqrt(sum2 / (2 * n));
  // длинные непреднамеренные провалы тишины
  const win = S(0.05);
  let silentRun = 0, longest = 0, longestAt = 0;
  for (let i = 0; i < n; i += win) {
    let e = 0; for (let j = i; j < Math.min(n, i + win); j++) e += L[j] * L[j];
    const isSil = Math.sqrt(e / win) < 0.002;
    if (isSil) { silentRun += 0.05; if (silentRun > longest) { longest = silentRun; longestAt = i / SR; } } else silentRun = 0;
  }
  // проверка синхронизации: энергия цифровых событий в окне ±1 кадр
  return { peak, rms, rmsDb: 20 * Math.log10(rms + 1e-9), peakDb: 20 * Math.log10(peak + 1e-9), nan, clip, dc: dc / (2 * n), longestSilence: longest, longestSilenceAt: longestAt - longest, duration: n / SR };
}

// Проверка синхронизации на уровне сигнала: в момент каждого визуального сбоя дорожка
// цифровых сбоев должна резко вырасти по энергии (сравнение с фоном перед событием)
export function verifySync(synth, edl) {
  const [dl] = synth.tracks.digital;
  const res = [];
  const fr = 1 / edl.fps;
  const energy = (a, b) => { let e = 0, c = 0; for (let i = Math.max(0, S(a)); i < Math.min(dl.length, S(b)); i++) { e += dl[i] * dl[i]; c++; } return c ? Math.sqrt(e / c) : 0; };
  for (const g of edl.glitches) {
    const during = energy(g.t, g.t + Math.max(fr, Math.min(g.dur, 0.1)));
    const before = energy(g.t - 0.12, g.t - 0.02);
    res.push({ t: g.t, type: g.type, ok: during > Math.max(0.01, before * 2), during, before });
  }
  return res;
}

export function toAudioBuffer(ctx, [L, R]) {
  const b = ctx.createBuffer(2, L.length, SR);
  b.copyToChannel(L, 0); b.copyToChannel(R, 1);
  return b;
}

export function encodeWAV([L, R]) {
  const n = L.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, SR, true);
  v.setUint32(28, SR * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 4, true);
  let o = 44;
  for (let i = 0; i < n; i++) { v.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true); v.setInt16(o + 2, Math.max(-1, Math.min(1, R[i])) * 32767, true); o += 4; }
  return new Blob([buf], { type: 'audio/wav' });
}
