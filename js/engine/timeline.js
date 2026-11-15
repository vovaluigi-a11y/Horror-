// Монтажный план (EDL) и покадровое состояние.
// buildEDL() — «режиссёр монтажа»: выбирает движения камеры по композиции и драматургии,
// переходы, расставляет глитчи по кривой напряжения, синхронные звуковые события, тишину.
// stateAt() — детерминированная функция времени: одно и то же t даёт один и тот же кадр
// (предпросмотр и экспорт совпадают).

// ---------- Случайность и шум ----------
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hash(n) { let x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function vnoise(t, seed) { // гладкий шум -1..1
  const i = Math.floor(t), f = t - i;
  const a = hash(i + seed * 13.17) * 2 - 1, b = hash(i + 1 + seed * 13.17) * 2 - 1;
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
const easeInOut = t => { t = clamp(t, 0, 1); return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];

// ---------- Каталоги ----------
export const MOVES = {
  push_in: { name: 'Медленный наезд к точке интереса', motion: 0.7 },
  pull_out: { name: 'Отъезд-раскрытие', motion: 0.7 },
  pan_lr: { name: 'Панорама слева направо', motion: 0.8 },
  pan_rl: { name: 'Панорама справа налево', motion: 0.8 },
  tilt_down: { name: 'Наклон вниз', motion: 0.75 },
  tilt_up: { name: 'Наклон вверх', motion: 0.75 },
  drift: { name: 'Дрейф с лёгким наездом', motion: 0.5 },
  handheld_search: { name: 'Оператор ищет (переводы между деталями)', motion: 0.9 },
  snap_zoom: { name: 'Цифровой «вклей-зум» на деталь', motion: 0.85 },
  rack_focus: { name: 'Перевод фокуса', motion: 0.6 },
  parallax_dolly: { name: 'Боковой проезд с параллаксом', motion: 0.85 },
  breathing: { name: 'Напряжённое «дыхание» в руках', motion: 0.45 },
  locked_cctv: { name: 'Статичная камера + цифровой шаг зума', motion: 0.3 },
};

export const TRANSITIONS = {
  cut: { name: 'Жёсткая документальная склейка', pre: 0, post: 0 },
  glitch_cut: { name: 'Склейка через срыв строк', pre: 2, post: 4 },
  noise_burst: { name: 'Вспышка статики', pre: 3, post: 5 },
  black_dip: { name: 'Провал в чёрное', pre: 1, post: 9 },
  flash: { name: 'Засветка', pre: 1, post: 4 },
  vhold_roll: { name: 'Срыв кадровой синхронизации', pre: 6, post: 7 },
  freeze_drop: { name: 'Стоп-кадр и выпадение', pre: 9, post: 4 },
  tracking: { name: 'Трекинг-полосы', pre: 6, post: 5 },
  bleed: { name: 'Наложение записей (перезапись кассеты)', pre: 6, post: 6 },
  signal_loss: { name: 'Потеря сигнала', pre: 3, post: 10 },
};

export const GLITCHES = {
  green_band: { name: 'Зелёная полоса', dur: [0.12, 0.45], sound: 'hum_buzz' },
  rgb_split: { name: 'Сдвиг RGB', dur: [0.07, 0.25], sound: 'digital_chirp' },
  tear: { name: 'Разрыв строк', dur: [0.08, 0.3], sound: 'tape_crunch' },
  dropout: { name: 'Провал изображения', dur: [0.05, 0.2], sound: 'mute_click' },
  block: { name: 'Цифровые блоки', dur: [0.08, 0.3], sound: 'digital_grind' },
  jitter: { name: 'Нестабильная синхронизация', dur: [0.15, 0.5], sound: 'warble' },
  freeze: { name: 'Застывший кадр', dur: [0.15, 0.35], sound: 'stutter' },
  flicker: { name: 'Скачок яркости', dur: [0.1, 0.35], sound: 'click' },
};

const GLITCH_PARAM = { green_band: 'greenBands', rgb_split: 'rgbGlitch', tear: 'tears', dropout: 'dropouts', block: 'blocks', jitter: 'tracking', freeze: 'dropouts', flicker: 'flicker' };

// ---------- Выбор движения камеры ----------
function chooseMove(shot, an, prev, used, r, osd, ov) {
  const want = (ov && ov.move && ov.move !== 'auto') ? ov.move : shot.camera?.move;
  if (want && want !== 'auto' && MOVES[want]) return want;
  const beat = shot.beat || 'build';
  const scores = {};
  for (const k of Object.keys(MOVES)) scores[k] = 1;
  const a = an || { aspect: 0.66, orientation: 'balanced', focus: { x: 0.5, y: 0.5 }, peaks: [], mean: 0.3, std: 0.18 };
  // композиция
  if (a.aspect > 0.75) { scores.pan_lr += 2.2; scores.pan_rl += 2.2; scores.parallax_dolly += 1.5; }
  if (a.aspect < 0.6) { scores.tilt_down += 1.4; scores.tilt_up += 1.2; }
  if (a.orientation === 'vertical-lines') { scores.pan_lr += 0.8; scores.pan_rl += 0.8; scores.parallax_dolly += 0.8; }
  if (a.orientation === 'horizontal-lines') { scores.tilt_down += 0.9; scores.tilt_up += 0.7; }
  const offCenter = Math.hypot(a.focus.x - 0.5, a.focus.y - 0.5);
  if (offCenter < 0.15) { scores.push_in += 1.3; scores.breathing += 0.6; }
  else { scores.drift += 0.6; scores.handheld_search += 0.5; }
  if ((a.peaks || []).length >= 2) {
    const d = Math.hypot(a.peaks[0].x - a.peaks[1].x, a.peaks[0].y - a.peaks[1].y);
    if (d > 0.25) scores.handheld_search += 1.6;
  }
  if (a.mean < 0.2) { scores.handheld_search += 0.6; scores.breathing += 0.5; scores.rack_focus += 0.4; }
  if (a.std > 0.22) scores.parallax_dolly += 0.5;
  // драматургия
  const B = {
    open: { pull_out: 2, parallax_dolly: 1.5, pan_lr: 1, pan_rl: 1, drift: 1.2, tilt_down: 1 },
    establish: { pull_out: 1.6, parallax_dolly: 1.8, pan_lr: 1.2, pan_rl: 1.2, tilt_down: 1.2, drift: 1 },
    build: { push_in: 1.5, drift: 1.2, handheld_search: 1.2, rack_focus: 1, parallax_dolly: 0.8 },
    detail: { push_in: 2, rack_focus: 1.8, snap_zoom: 1, tilt_down: 0.6 },
    tension: { breathing: 2.2, handheld_search: 1.8, push_in: 1.0 },
    reveal: { snap_zoom: 2.2, rack_focus: 1.4, tilt_up: 1.4, push_in: 1.2 },
    climax: { handheld_search: 2, snap_zoom: 1.2, breathing: 1.2 },
    ending: { pull_out: 1.4, breathing: 1.6, push_in: 1.4, locked_cctv: 0.8 },
  }[beat] || {};
  for (const [k, v] of Object.entries(B)) scores[k] += v * 1.5;
  if (osd === 'cctv') { scores.locked_cctv += 4; scores.snap_zoom += 1; scores.handheld_search -= 1.5; scores.breathing -= 0.5; }
  else scores.locked_cctv -= 0.8;
  // разнообразие: запрет повтора подряд и штраф за частоту
  if (prev) scores[prev] = -99;
  for (const [k, n] of Object.entries(used)) scores[k] -= n * 1.6;
  if ((used.snap_zoom || 0) >= 1) scores.snap_zoom -= 3;
  let best = 'drift', bv = -1e9;
  for (const [k, v] of Object.entries(scores)) { const s = v + r() * 0.9; if (s > bv) { bv = s; best = k; } }
  return best;
}

function chooseTransition(prevShot, nextShot, prevT, used, r, i, n, ov) {
  const want = (ov && ov.transition && ov.transition !== 'auto') ? ov.transition : prevShot.transition;
  if (want && want !== 'auto' && TRANSITIONS[want]) return want;
  const nb = nextShot.beat || 'build';
  const s = {};
  for (const k of Object.keys(TRANSITIONS)) s[k] = 1;
  s.cut += 1.6; s.glitch_cut += 1.2;
  if (nb === 'reveal' || nb === 'climax') { s.black_dip += 1.8; s.noise_burst += 1.5; s.signal_loss += 1.4; s.flash += 1.2; }
  if (nb === 'tension') { s.freeze_drop += 1.2; s.tracking += 1; s.vhold_roll += 0.8; }
  if (nb === 'detail') { s.cut += 1; s.glitch_cut += 0.8; s.flash += 0.6; }
  if (nb === 'establish' || nb === 'build') { s.bleed += 0.9; s.tracking += 0.9; s.vhold_roll += 0.5; }
  if (i === n - 2) { s.signal_loss += 1; s.black_dip += 1; }
  if (prevT) s[prevT] = -99;
  for (const [k, c] of Object.entries(used)) s[k] -= c * (k === 'cut' ? 0.7 : 1.5);
  let best = 'cut', bv = -1e9;
  for (const [k, v] of Object.entries(s)) { const x = v + r() * 1.0; if (x > bv) { bv = x; best = k; } }
  return best;
}

// ---------- Построение EDL ----------
export function buildEDL(project, analyses, settings) {
  const edit = project.edit;
  const P = edit.params;
  const seed = edit.seed >>> 0;
  const r = rng(seed);
  const fps = settings.fps || 30;
  const shots = (project.storyboard?.shots || []).filter(s => s.images && s.images.length && s.enabled !== false);
  if (!shots.length) throw new Error('Нет кадров с изображениями. Загрузите изображения в Галерее.');

  const introDur = clamp(project.edit.introDur ?? 2.2, 1.2, 4);
  const outroDur = clamp(project.edit.outroDur ?? 1.8, 1.0, 4);
  let durs = shots.map(s => clamp(Number(s.duration) || 4, 1.8, 9));
  const minD = settings.minDuration || 30, maxD = settings.maxDuration || 45;
  const target = clamp(project.edit.targetDuration || settings.targetDuration || 38, minD, maxD);
  // подгонка под целевую длительность (с учётом пределов на кадр)
  for (let iter = 0; iter < 6; iter++) {
    const total = introDur + outroDur + durs.reduce((a, b) => a + b, 0);
    if (Math.abs(total - target) < 0.05) break;
    const k = (target - introDur - outroDur) / durs.reduce((a, b) => a + b, 0);
    durs = durs.map(d => clamp(d * k, 2.2, 7.5));
  }
  // квантование по кадрам
  durs = durs.map(d => Math.round(d * fps) / fps);

  const segments = [];
  let t = introDur;
  const usedMoves = {};
  let prevMove = null;
  shots.forEach((sh, i) => {
    const img = sh.images[Math.min(sh.activeImage || 0, sh.images.length - 1)];
    const an = analyses[img.imageId];
    const ov = edit.overrides?.[sh.id] || {};
    const move = chooseMove(sh, an, prevMove, usedMoves, r, edit.osd, ov);
    usedMoves[move] = (usedMoves[move] || 0) + 1; prevMove = move;
    const intensity = clamp((ov.intensity ?? sh.camera?.intensity ?? 0.6) * (0.5 + P.moveStrength), 0.15, 1.3);
    segments.push({
      i, shotId: sh.id, imageId: img.imageId, start: t, end: t + durs[i], move, intensity,
      beat: sh.beat || 'build', analysis: an || null,
      seed: Math.floor(r() * 1e6),
      dir: r() < 0.5 ? -1 : 1,
      focusStart: (P.focusBreath > 0.15 && r() < 0.35 + P.focusBreath * 0.5) ? 0.6 + r() * 0.8 : 0,
      expStart: (r() * 2 - 1) * 0.35 * P.exposureHunt,
      vfx: sh.vfxLevel ?? 1,
    });
    t += durs[i];
  });
  const showEnd = t;
  const duration = Math.round((showEnd + outroDur) * fps) / fps;

  // переходы
  const transitions = [];
  const usedT = {};
  let prevT = null;
  for (let i = 0; i < segments.length - 1; i++) {
    const type = chooseTransition(shots[i], shots[i + 1], prevT, usedT, r, i, segments.length, edit.overrides?.[shots[i].id]);
    usedT[type] = (usedT[type] || 0) + 1; prevT = type;
    const def = TRANSITIONS[type];
    transitions.push({ at: segments[i].end, type, pre: def.pre / fps, post: def.post / fps, a: i, b: i + 1 });
  }

  // кривая напряжения: рост к кульминации (~82%), спад в финале
  const climaxT = introDur + (showEnd - introDur) * 0.82;
  const tension = tt => {
    if (tt < introDur) return 0.5;
    if (tt < climaxT) return 0.2 + 0.8 * Math.pow((tt - introDur) / (climaxT - introDur), 1.4);
    return Math.max(0.4, 1 - (tt - climaxT) / (duration - climaxT) * 0.5);
  };

  // глитчи внутри кадров
  const glitches = [];
  const weights = {};
  for (const [g, p] of Object.entries(GLITCH_PARAM)) weights[g] = Math.max(0, P[p]) + 0.02;
  const isBusy = tt => transitions.some(tr => tt > tr.at - tr.pre - 0.25 && tt < tr.at + tr.post + 0.25);
  const density = 0.25 + P.glitchDensity * 1.35; // событий в секунду при напряжении 1 (до коррекции)
  let lastType = null;
  let tt = introDur + 0.6;
  while (tt < showEnd - 0.4) {
    const ten = tension(tt);
    const rate = density * (0.35 + ten * 0.9);
    tt += -Math.log(1 - r() * 0.98) / rate;
    if (tt >= showEnd - 0.4) break;
    if (isBusy(tt)) continue;
    const seg = segments.find(s => tt >= s.start && tt < s.end);
    if (!seg || seg.vfx === 0) continue;
    if (glitches.length && tt - glitches[glitches.length - 1].t < 0.55) continue;
    // взвешенный выбор типа без повтора подряд
    let tot = 0; for (const [g, w] of Object.entries(weights)) if (g !== lastType) tot += w;
    let x = r() * tot, type = 'tear';
    for (const [g, w] of Object.entries(weights)) { if (g === lastType) continue; x -= w; if (x <= 0) { type = g; break; } }
    const def = GLITCHES[type];
    const dur = lerp(def.dur[0], def.dur[1], r()) * (0.7 + ten * 0.5);
    glitches.push({ t: Math.round(tt * fps) / fps, dur: Math.max(2 / fps, Math.round(dur * fps) / fps), type, intensity: clamp((0.45 + ten * 0.6) * (0.6 + seg.vfx * 0.4), 0.2, 1.2), seed: Math.floor(r() * 1e6) });
    lastType = type;
  }
  // обязательные акценты: «вклей-зум» и шаг цифрового зума маскируются глитчем
  for (const s of segments) {
    if (s.move === 'snap_zoom' || s.move === 'locked_cctv') {
      const at = s.start + (s.end - s.start) * 0.46;
      const tq = Math.round(at * fps) / fps;
      for (let k = glitches.length - 1; k >= 0; k--) if (Math.abs(glitches[k].t - tq) < 0.5) glitches.splice(k, 1);
      glitches.push({ t: tq - 1 / fps, dur: 4 / fps, type: s.move === 'snap_zoom' ? 'tear' : 'block', intensity: 0.9, seed: Math.floor(r() * 1e6), masking: true });
    }
  }
  glitches.sort((a, b) => a.t - b.t);

  // вступление: чёрный экран, помехи, подсознательный кадр
  const intro = { dur: introDur, bursts: [], subliminal: null };
  let it = 0.15 + r() * 0.2;
  while (it < introDur - 0.5) {
    intro.bursts.push({ t: Math.round(it * fps) / fps, dur: (2 + Math.floor(r() * 4)) / fps, kind: pick(r, ['noise', 'band', 'tracking', 'noise']), amt: 0.35 + r() * 0.6 });
    it += 0.18 + r() * 0.45;
  }
  const revealSeg = segments.find(s => s.beat === 'reveal' || s.beat === 'climax') || segments[segments.length - 1];
  intro.subliminal = { t: Math.round((introDur * (0.45 + r() * 0.2)) * fps) / fps, dur: 2 / fps, seg: revealSeg.i };
  // «захват сигнала» на первом кадре
  intro.lock = { t: introDur, dur: 0.55 };

  // финал: обрыв в статику и чёрное, последний подсознательный кадр
  const outro = { start: showEnd, dur: outroDur, burst: 0.22, subliminal: { t: Math.round((showEnd + 0.45 + r() * 0.3) * fps) / fps, dur: 1 / fps, seg: revealSeg.i } };

  // тишина: перед раскрытием и после финального обрыва
  const silences = [];
  const stingers = [];
  const revealIdx = segments.findIndex(s => s.beat === 'reveal' || s.beat === 'climax');
  if (revealIdx > 0) {
    const ts = segments[revealIdx].start;
    silences.push({ t: ts - 0.75, dur: 0.75 });
    stingers.push({ t: ts, type: 'impact' });
  }
  const ending = segments.findIndex(s => s.beat === 'ending');
  if (ending > 0 && ending !== revealIdx) stingers.push({ t: segments[ending].start + 0.1, type: 'swell_low' });
  stingers.push({ t: showEnd, type: 'final' });
  silences.push({ t: showEnd + 0.25, dur: Math.max(0.3, outroDur - 0.9) });
  for (const tr of transitions) {
    if (tr.type === 'black_dip' || tr.type === 'signal_loss') silences.push({ t: tr.at, dur: tr.post * 0.8 });
    if (tr.type === 'flash') stingers.push({ t: tr.at, type: 'thump' });
  }
  // если раскрытия нет — акцент на кульминации
  if (revealIdx < 0) stingers.push({ t: climaxT, type: 'impact' });

  // звуковые события, синхронные с визуальными сбоями (одна кадровая точность)
  const soundEvents = [];
  for (const g of glitches) soundEvents.push({ t: g.t, dur: g.dur, kind: GLITCHES[g.type].sound, amt: g.intensity, src: 'glitch' });
  for (const tr of transitions) {
    const map = { cut: 'cut_click', glitch_cut: 'tape_crunch', noise_burst: 'noise_burst', black_dip: 'mute_click', flash: 'thump', vhold_roll: 'warble', freeze_drop: 'stutter', tracking: 'hum_buzz', bleed: 'radio_sweep', signal_loss: 'signal_loss' };
    soundEvents.push({ t: tr.at - tr.pre, dur: Math.max(2 / fps, tr.pre + tr.post), kind: map[tr.type], amt: 0.9, src: 'transition' });
  }
  for (const b of intro.bursts) soundEvents.push({ t: b.t, dur: b.dur, kind: b.kind === 'band' ? 'hum_buzz' : b.kind === 'tracking' ? 'warble' : 'noise_burst', amt: b.amt, src: 'intro' });
  soundEvents.push({ t: intro.subliminal.t, dur: intro.subliminal.dur, kind: 'digital_chirp', amt: 1, src: 'intro' });
  soundEvents.push({ t: showEnd, dur: outro.burst, kind: 'noise_burst', amt: 1, src: 'outro' });
  soundEvents.push({ t: outro.subliminal.t, dur: outro.subliminal.dur, kind: 'digital_chirp', amt: 1, src: 'outro' });
  soundEvents.sort((a, b) => a.t - b.t);

  return {
    fps, duration, frames: Math.round(duration * fps), introDur, outroDur, showEnd,
    segments, transitions, glitches, intro, outro, silences, stingers, soundEvents,
    params: P, osd: edit.osd, seed, climaxT,
    era: project.bible?.osdDate || null,
    tension,
  };
}

// ---------- Камера ----------
function moveCamera(seg, u, a) {
  // возвращает {fx, fy, z, r, parX, parY, parZ, blur}
  const k = seg.intensity;
  const F = a?.focus || { x: 0.5, y: 0.5 };
  const peaks = a?.peaks?.length ? a.peaks : [F];
  const e = easeInOut(u), s = smooth(u);
  const dz = 0.08 + 0.16 * k;
  let fx = 0.5, fy = 0.5, z = 1.08, r = 0, parX = 0, parY = 0, parZ = 0, blur = 0;
  const towards = (amt) => ({ x: lerp(0.5, F.x, amt), y: lerp(0.5, F.y, amt) });
  switch (seg.move) {
    case 'push_in': { const c0 = towards(0.25), c1 = towards(0.85); fx = lerp(c0.x, c1.x, e); fy = lerp(c0.y, c1.y, e); z = 1.07 + dz * e; parZ = 0.6 * e; break; }
    case 'pull_out': { const c0 = towards(0.9), c1 = towards(0.2); fx = lerp(c0.x, c1.x, s); fy = lerp(c0.y, c1.y, s); z = 1.07 + dz * 1.3 * (1 - s); parZ = -0.6 * s; break; }
    case 'pan_lr': case 'pan_rl': { const d = seg.move === 'pan_lr' ? 1 : -1; fx = 0.5 + d * lerp(-0.5, 0.5, e); fy = lerp(0.5, F.y, 0.4); z = 1.15 + 0.06 * k; parX = d * (e - 0.5) * 1.2; break; }
    case 'tilt_down': case 'tilt_up': { const d = seg.move === 'tilt_down' ? 1 : -1; fy = 0.5 + d * lerp(-0.5, 0.5, e); fx = lerp(0.5, F.x, 0.4); z = 1.15 + 0.05 * k; parY = d * (e - 0.5) * 1.2; break; }
    case 'drift': { const ang = seg.seed % 628 / 100; fx = 0.5 + Math.cos(ang) * 0.35 * (e - 0.5) * 2 * k; fy = 0.5 + Math.sin(ang) * 0.35 * (e - 0.5) * 2 * k; fx = lerp(fx, F.x, 0.3); fy = lerp(fy, F.y, 0.3); z = 1.09 + 0.06 * k * e; parX = Math.cos(ang) * (e - 0.5) * 0.8; parY = Math.sin(ang) * (e - 0.5) * 0.8; break; }
    case 'handheld_search': {
      const p1 = peaks[0], p2 = peaks[1] || { x: 1 - p1.x, y: p1.y };
      const w = u < 0.3 ? 0 : u < 0.58 ? easeInOut((u - 0.3) / 0.28) : 1;
      const back = u > 0.82 ? easeInOut((u - 0.82) / 0.18) * 0.35 : 0;
      const ww = w - back;
      fx = lerp(lerp(0.5, p1.x, 0.7), lerp(0.5, p2.x, 0.7), ww); fy = lerp(lerp(0.5, p1.y, 0.6), lerp(0.5, p2.y, 0.6), ww);
      z = 1.16 + 0.1 * k; parX = (ww - 0.5) * 0.9; break;
    }
    case 'snap_zoom': {
      const at = 0.46;
      const pre = 1.07 + 0.08 * Math.min(u, at) / at;
      if (u < at) { z = pre; fx = lerp(0.5, F.x, 0.3); fy = lerp(0.5, F.y, 0.3); }
      else { const q = (u - at) * 30; const settle = 1 - Math.exp(-q) * Math.cos(q * 1.8) * 0.15; z = lerp(pre, 1.38 + 0.18 * k, Math.min(1, settle)); fx = lerp(0.5, F.x, 0.92); fy = lerp(0.5, F.y, 0.92); z += 0.02 * (u - at); }
      parZ = 0.2 * u; break;
    }
    case 'rack_focus': { const c = towards(0.6); fx = c.x; fy = c.y; z = 1.1 + 0.1 * e * k; fx = lerp(fx, F.x, 0.2 * e); blur = (seg.dir > 0 ? (1 - smooth(u * 1.6)) : smooth((u - 0.55) * 2.2)) * 2.4; parZ = 0.35 * e; break; }
    case 'parallax_dolly': { fx = 0.5 + seg.dir * lerp(-0.22, 0.22, e) * k; fy = lerp(0.5, F.y, 0.3); z = 1.12; parX = seg.dir * (e - 0.5) * 2.4; break; }
    case 'breathing': { const c = towards(0.55); fx = c.x; fy = c.y; z = 1.12 + 0.09 * e * k + Math.sin(u * 6.28 * 1.3) * 0.01; fx += Math.sin(u * 2.3 + seg.seed) * 0.08; fy += Math.cos(u * 1.7 + seg.seed) * 0.05; parX = Math.sin(u * 5.1) * 0.5; parY = Math.cos(u * 3.7) * 0.35; break; }
    case 'locked_cctv': { const step = u < 0.46 ? 0 : 1; const c = towards(step ? 0.75 : 0); fx = c.x; fy = c.y; z = step ? 1.3 : 1.05; break; }
  }
  return { fx, fy, z, r, parX, parY, parZ, blur };
}

function shakeAmp(seg, P) {
  const base = { handheld_search: 1.3, breathing: 1.2, snap_zoom: 0.9, push_in: 0.7, pull_out: 0.7, drift: 0.6, rack_focus: 0.6, pan_lr: 0.75, pan_rl: 0.75, tilt_down: 0.7, tilt_up: 0.7, parallax_dolly: 0.55, locked_cctv: 0.05 }[seg.move] ?? 0.7;
  return base * P.shake;
}

// Перевод камеры в матрицу экран→UV с гарантией отсутствия чёрных краёв
export function cameraMatrix(cam, imgAspect, viewAspect, margin) {
  let z = Math.max(1, cam.z);
  const h0 = Math.min(1, imgAspect / viewAspect); // видимая высота при cover (в долях высоты изображения)
  const r = cam.r;
  const cos = Math.cos(r), sin = Math.sin(r);
  let cx = cam.fx * imgAspect, cy = cam.fy;
  for (let iter = 0; iter < 8; iter++) {
    const hv = h0 / z, wv = hv * viewAspect;
    const hx = wv / 2 + margin * hv, hy = hv / 2 + margin * hv;
    // полуразмеры повернутого прямоугольника
    const ex = Math.abs(cos) * hx + Math.abs(sin) * hy;
    const ey = Math.abs(sin) * hx + Math.abs(cos) * hy;
    if (ex * 2 <= imgAspect && ey * 2 <= 1) {
      cx = clamp(cx, ex, imgAspect - ex); cy = clamp(cy, ey, 1 - ey);
      const ax = cos * wv / imgAspect, bx = -sin * hv / imgAspect, ay = sin * wv, by = cos * hv;
      return { row0: [ax, bx, cx / imgAspect - 0.5 * ax - 0.5 * bx], row1: [ay, by, cy - 0.5 * ay - 0.5 * by], z, hv };
    }
    z *= 1.04;
  }
  const hv = h0 / z, wv = hv * viewAspect;
  return { row0: [wv / imgAspect, 0, 0.5 - wv / imgAspect / 2], row1: [0, hv, 0.5 - hv / 2], z, hv };
}

// ---------- Покадровое состояние ----------
function envelope(t, start, dur) { // быстрая атака, плавный спад
  if (t < start || t > start + dur) return 0;
  const u = (t - start) / dur;
  return u < 0.15 ? u / 0.15 : 1 - Math.pow((u - 0.15) / 0.85, 2) * 0.7;
}

function segmentAt(edl, t) {
  for (const s of edl.segments) if (t >= s.start && t < s.end) return s;
  return null;
}

function cameraFor(edl, seg, t, P) {
  const u = clamp((t - seg.start) / (seg.end - seg.start), 0, 1);
  const cam = moveCamera(seg, u, seg.analysis);
  const A = shakeAmp(seg, P) * (0.75 + edl.tension(t) * 0.5);
  const sd = seg.seed;
  // три октавы: покачивание, «руки», микродрожь
  const sx = vnoise(t * 0.45, sd) * 0.012 + vnoise(t * 1.6, sd + 3) * 0.005 + vnoise(t * 8, sd + 7) * 0.0012;
  const sy = vnoise(t * 0.4, sd + 11) * 0.010 + vnoise(t * 1.4, sd + 17) * 0.004 + vnoise(t * 9, sd + 19) * 0.0011;
  const sr = (vnoise(t * 0.35, sd + 23) * 0.006 + vnoise(t * 2.1, sd + 29) * 0.002) * A;
  cam.fx += sx * A; cam.fy += sy * A; cam.r += sr;
  // покачивание масштаба от «шагов» оператора
  cam.z += Math.abs(vnoise(t * 1.1, sd + 31)) * 0.008 * A;
  // автофокус и автоэкспозиция после склейки
  const since = t - seg.start;
  let blur = cam.blur;
  if (seg.focusStart) blur += seg.focusStart * Math.exp(-since * 3.2) * (1 + 0.3 * Math.sin(since * 22));
  // поиск фокуса в тёмных кадрах
  const dark = seg.analysis ? seg.analysis.mean < 0.22 : false;
  if (P.focusBreath > 0.2) blur += Math.max(0, vnoise(t * 0.3, sd + 41) - 0.55) * 2.5 * P.focusBreath * (dark ? 1.4 : 0.7);
  let exposure = seg.expStart * Math.exp(-since * 2.4);
  exposure += vnoise(t * 0.5, sd + 47) * 0.05 * P.exposureHunt;
  return { cam, blur, exposure, u };
}

const OSD_MONTHS = ['ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЙ', 'ИЮН', 'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК'];

export function osdText(edl, t) {
  if (!edl.osd || edl.osd === 'none') return null;
  const d = edl.era || { y: 1996, m: 10, d: 14, h: 2, min: 13, s: 7 };
  const tSec = Math.max(0, t - edl.introDur);
  const total = d.h * 3600 + d.min * 60 + d.s + Math.floor(tSec);
  const hh = Math.floor(total / 3600) % 24, mm = Math.floor(total / 60) % 60, ss = total % 60;
  const p2 = n => String(n).padStart(2, '0');
  if (edl.osd === 'cctv') {
    return { tl: `КАМ 0${(edl.seed % 7) + 1}`, tr: '', bl: `${d.y}-${p2(d.m)}-${p2(d.d)}  ${p2(hh)}:${p2(mm)}:${p2(ss)}`, br: '', blink: false };
  }
  if (edl.osd === 'archive') {
    const fr = Math.floor(t * edl.fps) % edl.fps;
    return { tl: '', tr: `КАТ. ${String(edl.seed % 900 + 100)}-${d.y % 100}`, bl: '', br: `${p2(Math.floor(tSec / 60))}:${p2(Math.floor(tSec % 60))}:${p2(fr)}`, blink: false };
  }
  return { tl: t < edl.introDur + 3.5 ? 'PLAY ▶' : '', tr: 'REC', bl: `${OSD_MONTHS[(d.m - 1) % 12]} ${p2(d.d)} ${d.y}`, br: `${hh % 12 || 12}:${p2(mm)}:${p2(ss)} ${hh < 12 ? 'AM' : 'PM'}`, blink: true };
}

// Главная функция: состояние кадра во времени t
export function stateAt(edl, t) {
  const P = edl.params;
  const fps = edl.fps;
  const frame = Math.floor(t * fps + 1e-6);
  const S = {
    t, frame,
    A: null, B: null, mix: 0, mixMode: 0,
    blur: 0, exposure: 0, flash: 0, fade: 1,
    rgb: P.baseRGB * 1.2, tear: 0, tearSeed: frame, block: 0, noise: 0, tracking: 0.08 * P.tracking, vroll: 0, jitter: 0,
    bands: [], flicker: 0,
    grain: P.grain, scan: P.scanlines, soft: P.softness, bleed: P.chromaBleed, vignette: P.vignette,
    sat: P.saturation, contrast: P.contrast, warmth: P.warmth, green: P.greenTint, lift: P.lift,
    seed: (frame * 7919 + edl.seed) % 100000,
    osd: osdText(edl, t), events: [],
  };

  // --- вступление ---
  if (t < edl.introDur) {
    S.fade = 0; S.osd = null; // индикация появляется только после захвата сигнала
    for (const b of edl.intro.bursts) {
      if (t >= b.t && t < b.t + b.dur) {
        if (b.kind === 'noise') { S.noise = b.amt; S.fade = 0.0; }
        if (b.kind === 'band') S.bands.push({ y: hash(b.t * 31) * 0.8 + 0.1, h: 0.04 + hash(b.t * 7) * 0.06, i: b.amt });
        if (b.kind === 'tracking') { S.tracking = 0.9 * b.amt; S.noise = Math.max(S.noise, 0.15); }
        S.events.push('intro:' + b.kind);
      }
    }
    S.noise = Math.max(S.noise, 0.04 + 0.03 * Math.sin(t * 13));
    const sub = edl.intro.subliminal;
    if (sub && t >= sub.t && t < sub.t + sub.dur) {
      const seg = edl.segments[sub.seg];
      const c = cameraFor(edl, seg, seg.start + (seg.end - seg.start) * 0.7, P);
      S.A = { seg, cam: c.cam }; S.fade = 0.55; S.rgb = 3; S.tear = 0.6; S.noise = 0.35; S.exposure = -0.2;
      S.events.push('subliminal');
    }
    return S;
  }

  // --- финал ---
  if (t >= edl.showEnd) {
    const o = edl.outro;
    S.fade = 0; if (t > o.start + o.burst) S.osd = null;
    if (t < o.start + o.burst) { S.noise = 0.9 * (1 - (t - o.start) / o.burst) + 0.1; S.events.push('outro:burst'); }
    const sub = o.subliminal;
    if (t >= sub.t && t < sub.t + sub.dur) {
      const seg = edl.segments[sub.seg];
      const c = cameraFor(edl, seg, seg.end - 0.1, P);
      S.A = { seg, cam: { ...c.cam, z: c.cam.z * 1.25 } }; S.fade = 0.7; S.exposure = 0.15; S.rgb = 4; S.tear = 0.4; S.events.push('subliminal');
    }
    S.noise = Math.max(S.noise, 0.02);
    return S;
  }

  // --- основной монтаж ---
  let seg = segmentAt(edl, t) || edl.segments[edl.segments.length - 1];
  let camT = t;
  // стоп-кадр (глитч freeze или переход freeze_drop)
  for (const g of edl.glitches) if (g.type === 'freeze' && t >= g.t && t < g.t + g.dur) camT = g.t;
  for (const tr of edl.transitions) if (tr.type === 'freeze_drop' && t >= tr.at - tr.pre && t < tr.at) camT = tr.at - tr.pre;
  const c = cameraFor(edl, seg, camT, P);
  S.A = { seg, cam: c.cam };
  S.blur = c.blur; S.exposure = c.exposure;

  // мерцание / нестабильность
  S.flicker = (vnoise(t * 9, edl.seed) * 0.5 + 0.5) * 0.06 * P.flicker;

  // захват сигнала после вступления
  const L = edl.intro.lock;
  if (t < L.t + L.dur) {
    const q = 1 - (t - L.t) / L.dur;
    S.vroll = Math.max(0, q * q * 0.35 * Math.sin(q * 4));
    S.tracking = Math.max(S.tracking, q * 0.9); S.noise = Math.max(S.noise, q * 0.35); S.rgb += q * 2;
    S.events.push('lock');
  }

  // переходы
  for (const tr of edl.transitions) {
    const t0 = tr.at - tr.pre, t1 = tr.at + tr.post;
    if (t < t0 || t >= t1) continue;
    const segA = edl.segments[tr.a], segB = edl.segments[tr.b];
    const before = t < tr.at;
    const q = before ? (t - t0) / Math.max(1e-6, tr.pre) : (t - tr.at) / Math.max(1e-6, tr.post); // 0..1 внутри половины
    S.events.push('tr:' + tr.type);
    switch (tr.type) {
      case 'glitch_cut':
        S.tear = Math.max(S.tear, before ? 0.5 + q * 0.5 : 1 - q * 0.8); S.rgb += before ? 3 * q : 4 * (1 - q); S.block = Math.max(S.block, before ? 0.3 * q : 0.5 * (1 - q));
        if (!before && q < 0.6) { const cb = cameraFor(edl, segA, tr.at - 0.01, P); S.B = { seg: segA, cam: cb.cam }; S.mix = 0.5; S.mixMode = 1; }
        break;
      case 'noise_burst':
        S.noise = Math.max(S.noise, before ? 0.4 + 0.6 * q : 1 - q * 0.9); S.tracking = Math.max(S.tracking, 0.5); break;
      case 'black_dip':
        S.fade = before ? 1 - q : (q < 0.55 ? 0 : (q - 0.55) / 0.45); if (!before) S.exposure += (1 - q) * 0.25; S.noise = Math.max(S.noise, 0.04); break;
      case 'flash':
        S.flash = before ? q : Math.max(0, 1 - q * 1.6); if (!before) S.exposure += (1 - q) * 0.35; break;
      case 'vhold_roll': {
        const x = before ? q : 1 - q; S.vroll = easeInOut(x) * 0.5 * (before ? 1 : -1); S.tracking = Math.max(S.tracking, 0.4 * x); S.rgb += 1.5 * x; break;
      }
      case 'freeze_drop':
        if (before) { S.tear = Math.max(S.tear, q * 0.35); S.rgb += q * 1.5; } else { S.fade = q < 0.5 ? 0 : 1; S.noise = Math.max(S.noise, q < 0.5 ? 0.5 : 0.1); } break;
      case 'tracking': {
        const x = before ? q : 1 - q; S.tracking = Math.max(S.tracking, 0.3 + 0.7 * x); S.tear = Math.max(S.tear, 0.3 * x); S.bands.push({ y: (t * 1.7) % 1, h: 0.05, i: 0.6 * x }); break;
      }
      case 'bleed': {
        const x = before ? 0.5 * q : 0.5 + 0.5 * q; // 0..1 через весь переход
        if (before) { const cb = cameraFor(edl, segB, segB.start, P); S.B = { seg: segB, cam: cb.cam }; S.mix = x; }
        else { const ca = cameraFor(edl, segA, segA.end - 0.01, P); S.B = { seg: segA, cam: ca.cam }; S.mix = 1 - x; }
        S.mixMode = 0; S.bleed = Math.min(1, S.bleed + 0.4); S.rgb += 1.2; S.tracking = Math.max(S.tracking, 0.3); break;
      }
      case 'signal_loss':
        if (before) { S.block = Math.max(S.block, q * 0.9); S.tear = Math.max(S.tear, q * 0.5); }
        else { if (q < 0.5) { S.fade = 0; S.noise = 0.15; S.bands.push({ y: 0.3 + hash(t) * 0.4, h: 0.02, i: 0.8 }); } else { const x = (1 - q) * 2; S.vroll = x * 0.25; S.tracking = Math.max(S.tracking, x); } }
        break;
      case 'cut': default: break;
    }
  }

  // глитчи
  for (const g of edl.glitches) {
    if (t < g.t || t >= g.t + g.dur) continue;
    const e = envelope(t, g.t, g.dur) * g.intensity;
    S.events.push('g:' + g.type);
    switch (g.type) {
      case 'green_band': {
        const n = 1 + (g.seed % 2);
        for (let k = 0; k < n; k++) S.bands.push({ y: (hash(g.seed + k * 3) * 0.85 + 0.05 + (t - g.t) * (k ? -0.15 : 0.25)) % 1, h: 0.015 + hash(g.seed + k * 5) * 0.07, i: e });
        S.rgb += e * 0.8; break;
      }
      case 'rgb_split': S.rgb += 3 + e * 7; S.jitter = Math.max(S.jitter, e * 0.2); break;
      case 'tear': S.tear = Math.max(S.tear, 0.4 + e * 0.6); S.tearSeed = g.seed + frame; S.rgb += e * 1.5; break;
      case 'dropout': S.fade = Math.min(S.fade, hash(frame + g.seed) < 0.6 ? 0.0 : 0.6); S.noise = Math.max(S.noise, 0.2 * e); break;
      case 'block': S.block = Math.max(S.block, 0.3 + e * 0.7); S.rgb += e; break;
      case 'jitter': S.jitter = Math.max(S.jitter, e); S.tracking = Math.max(S.tracking, e * 0.5); break;
      case 'freeze': S.tear = Math.max(S.tear, 0.12); S.noise = Math.max(S.noise, 0.06); break;
      case 'flicker': S.exposure += (hash(frame * 3.1 + g.seed) - 0.3) * 0.5 * e; S.flicker += 0.1 * e; break;
    }
  }
  return S;
}

export function describeEDL(edl) {
  return {
    moves: edl.segments.map(s => MOVES[s.move]?.name || s.move),
    transitions: edl.transitions.map(t => TRANSITIONS[t.type]?.name || t.type),
    glitchCount: edl.glitches.length,
  };
}
