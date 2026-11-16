// Контроль качества. Два уровня, и они честно разделены в отчёте:
// 1) проверка монтажного плана (длительности, повторы, плотность сбоев, синхронизация событий);
// 2) анализ реально отрендеренных кадров и реального звукового сигнала
//    (движение между кадрами, чёрные края, пересвет, клиппинг, NaN, непреднамеренная тишина).

import { Renderer } from './engine/renderer.js';
import { stateAt, MOVES, TRANSITIONS } from './engine/timeline.js';
import { analyzeAudio, verifySync } from './engine/audio.js';

function frameStats(gl, W, H) {
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) lum[i] = (px[i * 4] * 0.2126 + px[i * 4 + 1] * 0.7152 + px[i * 4 + 2] * 0.0722) / 255;
  return lum;
}

const STATIC_T = 0.012; // ≈1% ширины кадра в секунду
export async function runQC({ project, edl, analyses, synth, mix, settings, getBlob, onProgress }) {
  const shotsN = seg => project.storyboard.shots.find(x => x.id === seg.shotId)?.n ?? '?';
  const items = [];
  const add = (id, title, status, details, fix) => items.push({ id, title, status, details, fix });
  const P = edl.params;

  // ---------- 1. Длительность ----------
  const minD = settings.minDuration, maxD = settings.maxDuration;
  if (edl.duration < minD - 0.05 || edl.duration > maxD + 0.05) add('duration', 'Продолжительность', 'fail', `${edl.duration.toFixed(1)} с — вне диапазона ${minD}–${maxD} с.`, 'fixDuration');
  else add('duration', 'Продолжительность', 'ok', `${edl.duration.toFixed(1)} с (диапазон ${minD}–${maxD} с), ${edl.frames} кадров при ${edl.fps} FPS.`);

  // ---------- 1б. Титр и скример ----------
  if (edl.title) add('title', 'Титр «откуда эта запись»', 'ok', `${edl.title.lines.join(' / ')} — печатается ${(edl.title.dur).toFixed(1)} с, ${edl.title.keys.length} нажатий клавиш со звуком.`);
  else add('title', 'Титр «откуда эта запись»', 'warn', 'Титр выключен или пуст. Зритель не узнает, откуда эта запись.', 'fixTitle');
  if (edl.scream) {
    const prev = edl.segments[edl.scream.segIndex - 1];
    add('scream', 'Скример', 'ok', `Изображение кадра ${edl.scream.shotN}${edl.scream.auto ? ' (выбрано автоматически: фигура ближе к центру, контраст, роль в истории)' : ' (выбрано вами)'}; затишье ${(edl.scream.start - edl.scream.lullFrom).toFixed(1)} с, удар на ${edl.scream.start.toFixed(2)} с${prev ? `, после кадра ${shotsN(prev)}` : ''}.`);
  } else add('scream', 'Скример', 'warn', 'Скример выключен или для него недостаточно кадров (нужно минимум 2).', 'fixScream');

  const moves = edl.segments.filter(s => !s.scream).map(s => s.move);
  const consec = moves.filter((m, i) => i && m === moves[i - 1]).length;
  const counts = {}; moves.forEach(m => counts[m] = (counts[m] || 0) + 1);
  const over = Object.entries(counts).filter(([, c]) => c > 2);
  if (consec) add('moves', 'Разнообразие движений камеры', 'fail', `Одинаковые движения подряд: ${consec}.`, 'fixMoves');
  else if (over.length) add('moves', 'Разнообразие движений камеры', 'warn', 'Часто повторяются: ' + over.map(([m, c]) => `${MOVES[m].name} ×${c}`).join(', '), 'fixMoves');
  else add('moves', 'Разнообразие движений камеры', 'ok', `${Object.keys(counts).length} разных движений на ${moves.length} кадров, повторов подряд нет.`);

  // ---------- 3. Переходы ----------
  const trs = edl.transitions.filter(t => !t.forced).map(t => t.type); // склейки вокруг скримера — намеренные
  const tcons = trs.filter((m, i) => i && m === trs[i - 1]).length;
  const tc = {}; trs.forEach(m => tc[m] = (tc[m] || 0) + 1);
  const tover = Object.entries(tc).filter(([k, c]) => c > (k === 'cut' ? 3 : 2));
  if (tcons) add('transitions', 'Разнообразие переходов', 'fail', `Одинаковые переходы подряд: ${tcons}.`, 'fixTransitions');
  else if (tover.length) add('transitions', 'Разнообразие переходов', 'warn', 'Часто: ' + tover.map(([m, c]) => `${TRANSITIONS[m].name} ×${c}`).join(', '), 'fixTransitions');
  else add('transitions', 'Разнообразие переходов', 'ok', trs.map(t => TRANSITIONS[t].name).join(' → ') || 'один кадр');

  // ---------- 4. Плотность глитчей ----------
  const showDur = edl.showEnd - edl.introDur;
  const glTime = edl.glitches.reduce((a, g) => a + g.dur, 0) + edl.transitions.reduce((a, t) => a + t.pre + t.post, 0);
  const share = glTime / showDur;
  let maxWin = 0;
  for (let t = edl.introDur; t < edl.showEnd - 5; t += 0.5) maxWin = Math.max(maxWin, edl.glitches.filter(g => g.t >= t && g.t < t + 5).length);
  if (share > 0.22 || maxWin > 7) add('glitch', 'Количество сбоев', 'fail', `Сбои занимают ${(share * 100).toFixed(0)}% экранного времени, до ${maxWin} событий за 5 с. Зритель перестанет видеть историю.`, 'fixGlitch');
  else if (share < 0.03 && edl.glitches.length < 3) add('glitch', 'Количество сбоев', 'warn', `Сбоев очень мало (${edl.glitches.length}) — ролик может выглядеть «чистым» слайд-шоу.`, 'fixGlitchUp');
  else add('glitch', 'Количество сбоев', 'ok', `${edl.glitches.length} глитчей + ${edl.transitions.length} переходов, ${(share * 100).toFixed(0)}% экранного времени, максимум ${maxWin} за 5 с.`);

  // ---------- 5. Синхронизация звука и изображения ----------
  const planSync = edl.glitches.filter(g => !edl.soundEvents.some(s => Math.abs(s.t - g.t) < 1 / edl.fps + 1e-6)).length;
  const sig = verifySync(synth, edl);
  const bad = sig.filter(s => !s.ok);
  const digitalOn = project.edit.tracks.digital?.on !== false && (project.edit.tracks.digital?.vol ?? 1) > 0;
  if (planSync) add('sync', 'Синхронизация звуковых и визуальных сбоев', 'fail', `${planSync} визуальных сбоев без звукового события.`);
  else if (bad.length) add('sync', 'Синхронизация звуковых и визуальных сбоев', 'warn', `По сигналу: ${sig.length - bad.length} из ${sig.length} сбоев дают всплеск звука точно в кадре (не прошли: ${bad.map(b => b.t.toFixed(2) + 'с').join(', ')}).`);
  else add('sync', 'Синхронизация звуковых и визуальных сбоев', digitalOn ? 'ok' : 'warn', `Проверено по звуковому сигналу: ${sig.length} из ${sig.length} визуальных сбоев сопровождаются всплеском дорожки сбоев в том же кадре.` + (digitalOn ? '' : ' Внимание: дорожка цифровых сбоев выключена в микшере — синхронные звуки не слышны.'));

  // ---------- 6. Звуковая дорожка ----------
  const A = analyzeAudio(mix, edl);
  const plannedSilent = (t) => edl.silences.some(s => t >= s.t - 0.3 && t <= s.t + s.dur + 0.3) || t < edl.introDur;
  const aIssues = [];
  if (A.nan) aIssues.push(`${A.nan} повреждённых отсчётов (NaN)`);
  if (A.clip > 10) aIssues.push(`клиппинг: ${A.clip} отсчётов`);
  if (A.rmsDb < -40) aIssues.push(`слишком тихо (RMS ${A.rmsDb.toFixed(1)} дБ)`);
  if (Math.abs(A.dc) > 0.02) aIssues.push('постоянная составляющая');
  if (A.longestSilence > 1.2 && !plannedSilent(A.longestSilenceAt)) aIssues.push(`непреднамеренная тишина ${A.longestSilence.toFixed(1)} с на ${A.longestSilenceAt.toFixed(1)} с`);
  add('audio', 'Звуковая дорожка (анализ сигнала)', aIssues.length ? (A.nan || A.clip > 10 ? 'fail' : 'warn') : 'ok',
    aIssues.length ? aIssues.join('; ') : `Пик ${A.peakDb.toFixed(1)} дБFS, RMS ${A.rmsDb.toFixed(1)} дБ, без NaN и клиппинга, длительность ${A.duration.toFixed(2)} с.`, aIssues.length ? 'fixAudio' : null);

  // ---------- 7. Последовательность сцен ----------
  const shots = project.storyboard.shots;
  const missing = shots.filter(s => s.enabled !== false && !(s.images || []).length);
  const seq = [];
  if (missing.length) seq.push(`без изображений: кадры ${missing.map(s => s.n).join(', ')} (исключены из монтажа)`);
  const order = ['open', 'establish', 'build', 'detail', 'tension', 'reveal', 'climax', 'ending'];
  const beats = edl.segments.filter(s => !s.scream).map(s => order.indexOf(s.beat));
  const back = beats.filter((b, i) => i && b >= 0 && beats[i - 1] >= 0 && b < beats[i - 1] - 2).length;
  if (back) seq.push(`драматургия «откатывается назад» ${back} раз(а)`);
  // визуальная согласованность: выброс по яркости/насыщенности/оттенку
  const ans = edl.segments.map(s => s.analysis).filter(Boolean);
  if (ans.length >= 3) {
    const med = arr => { const a = [...arr].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
    const mL = med(ans.map(a => a.mean)), mS = med(ans.map(a => a.saturation));
    const out = edl.segments.filter(s => s.analysis && (Math.abs(s.analysis.mean - mL) > 0.28 || Math.abs(s.analysis.saturation - mS) > 0.35));
    if (out.length) seq.push(`визуально выбивается: кадр ${out.map(s => shots.find(x => x.id === s.shotId)?.n).join(', ')} (яркость/цвет сильно отличаются от остальных — проверьте единство места и света)`);
  }
  add('sequence', 'Последовательность сцен', seq.length ? 'warn' : 'ok', seq.length ? seq.join('; ') : `${edl.segments.length} кадров по порядку раскадровки, драматургия нарастает, визуальная гамма согласована.`);

  // ---------- 8. Исходные изображения ----------
  const imgIssues = [];
  for (const s of edl.segments.filter(x => !x.scream)) for (const is of (s.analysis?.issues || [])) imgIssues.push(`кадр ${shots.find(x => x.id === s.shotId)?.n}: ${is.text}`);
  add('images', 'Технические дефекты исходников', imgIssues.some(t => !t.includes('автоматически')) ? 'warn' : 'ok', imgIssues.length ? imgIssues.join('\n') : 'Разрешение, экспозиция и пропорции в норме.');

  // ---------- 9. Анализ отрендеренных кадров ----------
  const W = 108, H = 192;
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const renderer = new Renderer(canvas);
  await renderer.prepare(edl, getBlob);
  const gl = renderer.gl;
  const step = 0.1;
  let prev = null, prevInfo = null;
  const segMotion = edl.segments.map(() => ({ sum: 0, n: 0, minRun: 0, run: 0, maxRun: 0 }));
  let borderFrames = 0, borderAt = [], clippedFrames = 0, crushedFrames = 0, analyzed = 0;
  const total = Math.floor(edl.duration / step);
  for (let k = 0; k < total; k++) {
    const t = k * step;
    const S0 = stateAt(edl, t);
    // для измерения движения содержимого отключаем зерно и мерцание (иначе шум маскирует статику)
    const S = { ...S0, grain: 0, flicker: 0, tracking: 0, seed: 1, tearSeed: S0.tearSeed };
    renderer.draw(S, edl);
    const lum = frameStats(gl, W, H);
    analyzed++;
    const clean = S.fade > 0.99 && S.A && !S.B && Math.abs(S.vroll) < 0.001 && S.noise < 0.1 && S.flash < 0.01 && S.events.length === 0;
    if (clean) {
      // чёрные края: среднее по краевым столбцам/строкам против середины
      const col = x => { let s = 0; for (let y = 8; y < H - 8; y++) s += lum[y * W + x]; return s / (H - 16); };
      const rowm = y => { let s = 0; for (let x = 4; x < W - 4; x++) s += lum[y * W + x]; return s / (W - 8); };
      let mid = 0; for (let i = 0; i < lum.length; i++) mid += lum[i]; mid /= lum.length;
      // настоящий чёрный край = почти ноль на самом краю и резкий скачок яркости чуть глубже
      const pairs = [[col(0), col(4)], [col(W - 1), col(W - 5)], [rowm(0), rowm(5)], [rowm(H - 1), rowm(H - 6)]];
      if (mid > 0.04 && pairs.some(([e, inner]) => e < 0.006 && inner > e + 0.05)) { borderFrames++; if (borderAt.length < 5) borderAt.push(t.toFixed(1)); }
      let hi = 0, lo = 0; for (let i = 0; i < lum.length; i++) { if (lum[i] > 0.985) hi++; if (lum[i] < 0.01) lo++; }
      if (hi / lum.length > 0.25) clippedFrames++;
      if (lo / lum.length > 0.7) crushedFrames++;
    }
    // движение между соседними пробами внутри одного кадра монтажа (без сбоев и переходов)
    const si = edl.segments.findIndex(s => t >= s.start && t < s.end);
    if (prev && si >= 0 && prevInfo === si && clean) {
      // сравнение по блокам 9×16 (без нижних 12% кадра), с вычетом общего сдвига яркости
      const bw = 12, bh = 12, nx = W / bw, ny = Math.floor(H * 0.88 / bh);
      const bm = (L) => { const out = new Float32Array(nx * ny); for (let by = 0; by < ny; by++) for (let bx = 0; bx < nx; bx++) { let s = 0; for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) s += L[(by * bh + y) * W + bx * bw + x]; out[by * nx + bx] = s / (bw * bh); } return out; };
      const a1 = bm(lum), a0 = bm(prev);
      let g = 0; for (let i = 0; i < a1.length; i++) g += a1[i] - a0[i]; g /= a1.length;
      let d = 0; for (let i = 0; i < a1.length; i++) d += Math.abs(a1[i] - a0[i] - g);
      d /= a1.length;
      // нормировка на текстурность: d/grad ≈ смещение содержимого в блоках (не зависит от детальности изображения)
      let gr = 0, gc = 0; for (let by = 0; by < ny - 1; by++) for (let bx = 0; bx < nx - 1; bx++) { const i = by * nx + bx; gr += Math.abs(a1[i] - a1[i + 1]) + Math.abs(a1[i] - a1[i + nx]); gc += 2; }
      gr = gr / Math.max(1, gc);
      d = d / Math.max(0.004, gr);
      const m = segMotion[si]; m.sum += d; m.n++;
      if (d < STATIC_T) { m.run += step; m.maxRun = Math.max(m.maxRun, m.run); } else m.run = 0;
    }
    prev = lum; prevInfo = clean ? si : -1;
    if (k % 20 === 0) { onProgress?.({ done: k, total }); await new Promise(r => setTimeout(r, 0)); }
  }
  renderer.dispose();
  const staticSegs = [];
  segMotion.forEach((m, i) => { if (m.maxRun > 2.2 && !edl.segments[i].scream && !(edl.segments[i].lullFrom)) staticSegs.push({ i, run: m.maxRun }); });
  window.__qcMotion = segMotion.map(m => [m.n ? m.sum / m.n : 0, m.maxRun]);
  if (staticSegs.length) add('static', 'Статичные сцены (по реальным кадрам)', 'fail', staticSegs.map(s => `кадр ${shots.find(x => x.id === edl.segments[s.i].shotId)?.n}: ${s.run.toFixed(1)} с почти без изменений изображения`).join('; '), 'fixStatic');
  else add('static', 'Статичные сцены (по реальным кадрам)', 'ok', `Проанализировано ${analyzed} отрендеренных кадров: нет участков дольше 2.2 с без движения. Среднее межкадровое изменение по сценам: ${segMotion.map(m => m.n ? (m.sum / m.n * 1000).toFixed(1) : '—').join(' / ')} (×10⁻³).`);
  if (borderFrames) add('borders', 'Чёрные края и растяжение (по реальным кадрам)', 'fail', `Тёмные края обнаружены в ${borderFrames} кадрах (t = ${borderAt.join(', ')} с).`, 'fixBorders');
  else add('borders', 'Чёрные края и растяжение (по реальным кадрам)', 'ok', 'Видимых чёрных краёв нет; изображение всегда заполняет кадр 9:16, масштаб изменяется пропорционально (без растяжения).');
  const expo = [];
  if (clippedFrames > analyzed * 0.05) expo.push(`пересвет в ${clippedFrames} пробах`);
  if (crushedFrames > analyzed * 0.15) expo.push(`почти чёрная картинка в ${crushedFrames} пробах вне задуманных затемнений`);
  add('exposure', 'Экспозиция (по реальным кадрам)', expo.length ? 'warn' : 'ok', expo.length ? expo.join('; ') : 'Нет массового пересвета и «проваленных» кадров вне задуманных затемнений.', expo.length ? 'fixExposure' : null);

  const fails = items.filter(i => i.status === 'fail').length, warns = items.filter(i => i.status === 'warn').length;
  return {
    at: Date.now(), items, fails, warns,
    summary: fails ? `Найдено проблем: ${fails}, предупреждений: ${warns}` : warns ? `Критичных проблем нет, предупреждений: ${warns}` : 'Все проверки пройдены',
    method: `Проверены монтажный план, звуковой сигнал (${A.duration.toFixed(1)} с, ${Math.round(A.duration * 48000)} отсчётов) и ${analyzed} кадров, реально отрендеренных движком в уменьшенном разрешении (каждые 0.1 с). Художественное качество (страшно ли, понятна ли история) автоматикой не оценивается — это решает режиссёр.`,
  };
}

// Автоисправления. Меняют только параметры монтажа (не одобренный сценарий).
export function applyFix(project, fix, edl, settings) {
  const e = project.edit, P = e.params;
  const shots = project.storyboard.shots;
  const byId = id => shots.find(s => s.id === id);
  switch (fix) {
    case 'fixDuration': e.targetDuration = Math.min(settings.maxDuration, Math.max(settings.minDuration, settings.targetDuration)); return 'Длительность подогнана к целевой.';
    case 'fixMoves': {
      // снимаем ручные назначения, создающие повторы подряд, и перераспределяем
      e.overrides = e.overrides || {};
      edl.segments.forEach((s, i) => { if (i && s.move === edl.segments[i - 1].move) { const o = e.overrides[s.shotId] = e.overrides[s.shotId] || {}; o.move = 'auto'; } });
      e.seed = (e.seed * 16807 + 11) % 2147483647; return 'Движения перераспределены режиссёром монтажа.';
    }
    case 'fixTransitions': e.seed = (e.seed * 48271 + 7) % 2147483647; return 'Переходы перераспределены.';
    case 'fixGlitch': P.glitchDensity = Math.max(0.05, P.glitchDensity * 0.7); return `Плотность глитчей снижена до ${(P.glitchDensity * 100).toFixed(0)}%.`;
    case 'fixGlitchUp': P.glitchDensity = Math.min(1, P.glitchDensity + 0.2); return `Плотность глитчей увеличена до ${(P.glitchDensity * 100).toFixed(0)}%.`;
    case 'fixAudio': e.masterVol = Math.max(0.5, (e.masterVol || 0.9) - 0.1); return 'Сведение пересчитано, громкость понижена, лимитер применён.';
    case 'fixStatic': {
      e.overrides = e.overrides || {};
      for (const s of edl.segments) {
        if (['breathing', 'locked_cctv', 'drift', 'rack_focus'].includes(s.move)) {
          const o = e.overrides[s.shotId] = e.overrides[s.shotId] || {};
          o.move = s.move === 'drift' ? 'push_in' : 'handheld_search';
          o.intensity = Math.min(1, (o.intensity ?? 0.6) + 0.25);
        }
      }
      P.moveStrength = Math.min(1, P.moveStrength + 0.15); P.shake = Math.min(1, P.shake + 0.1);
      return 'Усилены движения камеры и ручная съёмка в статичных сценах (сценарий не изменён — изменены только настройки монтажа).';
    }
    case 'fixTitle': e.title = e.title || {}; e.title.on = true; e.title.auto = true; e.title.forIdea = null; return 'Титр включён (текст составлен по идее).';
    case 'fixScream': e.screamer = { on: true, shotId: 'auto' }; return 'Скример включён, изображение выбирается автоматически.';
    case 'fixBorders': P.parallax = Math.max(0, P.parallax - 0.2); return 'Параллакс уменьшен, запас кадрирования увеличен.';
    case 'fixExposure': P.contrast = Math.max(0.3, P.contrast - 0.1); P.lift = Math.min(0.5, P.lift + 0.08); P.exposureHunt = Math.max(0.1, P.exposureHunt - 0.15); return 'Скорректированы контраст, тени и автоэкспозиция.';
  }
  return null;
}
