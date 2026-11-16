// Правки к монтажу обычными словами.
// Текст превращается в список операций (через языковую модель, если она доступна в среде,
// иначе — разбором по ключевым словам), операции применяются к настройкам монтажа,
// а пользователь видит список того, что именно изменилось. Сценарий не меняется.

import { PARAM_DEFS, TRACKS, BUILTIN_TEMPLATES } from './templates.js';
import { MOVES, TRANSITIONS } from './engine/timeline.js';

export const READY_WORDS = ['готово', 'готов', 'готова', 'ок, готово', 'всё готово', 'все готово'];
export function isReady(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[.!\s]+$/g, '').replace(/ё/g, 'е');
  return ['готово', 'готов', 'готова', 'все готово', 'ок готово', 'ок, готово'].includes(t);
}

const clamp01 = v => Math.max(0, Math.min(1, v));
const PNAME = Object.fromEntries(PARAM_DEFS.map(d => [d.id, d.name]));
const TNAME = Object.fromEntries(TRACKS.map(t => [t.id, t.name]));
const pct = v => Math.round(v * 100);

// ---------- Описание текущего состояния для языковой модели ----------
export function describeState(project, edl) {
  const e = project.edit;
  const shots = (project.storyboard?.shots || []).filter(s => (s.images || []).length && s.enabled !== false);
  const segOf = id => edl?.segments.find(s => s.shotId === id);
  return {
    shots: shots.map(s => {
      const seg = segOf(s.id), ov = e.overrides?.[s.id] || {};
      const tr = seg ? edl.transitions.find(t => t.a === seg.i) : null;
      return { n: s.n, role: s.beat, content: String(s.content || '').slice(0, 120), duration: seg ? +(seg.end - seg.start).toFixed(1) : s.duration, move: seg?.move || 'auto', moveForced: ov.move && ov.move !== 'auto' ? ov.move : null, transitionAfter: tr?.type || null, intensity: ov.intensity ?? s.camera?.intensity ?? 0.6 };
    }),
    params: Object.fromEntries(PARAM_DEFS.map(d => [d.id, +e.params[d.id].toFixed(2)])),
    tracks: Object.fromEntries(TRACKS.map(t => [t.id, { on: e.tracks[t.id]?.on !== false, vol: +(e.tracks[t.id]?.vol ?? 0.6).toFixed(2) }])),
    masterVol: e.masterVol ?? 0.9, osd: e.osd,
    title: { on: e.title?.on !== false, lines: e.title?.lines || [] },
    screamer: { on: e.screamer?.on !== false, shot: edl?.scream ? edl.scream.shotN : null, auto: (e.screamer?.shotId || 'auto') === 'auto' },
    targetDuration: e.targetDuration || null, introDur: e.introDur ?? 1.2, outroDur: e.outroDur ?? 1.2,
    totalDuration: edl ? +edl.duration.toFixed(1) : null,
  };
}

export function aiEditPrompt(text, state) {
  return `Ты — ассистент монтажёра в программе для хоррор-роликов (found footage, VHS). Пользователь пишет правки к монтажу обычными словами. Преврати их в операции над настройками.

ТЕКУЩЕЕ СОСТОЯНИЕ (JSON):
${JSON.stringify(state)}

Параметры params (0..1): ${PARAM_DEFS.map(d => `${d.id} — ${d.name}`).join('; ')}.
Дорожки tracks: ${TRACKS.map(t => `${t.id} — ${t.name}`).join('; ')}.
Движения камеры move: ${Object.entries(MOVES).filter(([, v]) => !v.special).map(([k, v]) => `${k} — ${v.name}`).join('; ')}; auto — выбор движка.
Переходы transition: ${Object.entries(TRANSITIONS).map(([k, v]) => `${k} — ${v.name}`).join('; ')}; auto.
Экранная индикация osd: vhs, cctv, archive, none.

Допустимые операции (массив ops):
{"op":"param","key":"<id>","value":0..1} или {"op":"param","key":"<id>","delta":-1..1}
{"op":"shot","n":<номер кадра>,"move":"<id|auto>","transition":"<id|auto>","intensity":0.1..1,"duration":2..8}  (любые поля по необходимости)
{"op":"track","id":"<id>","on":true|false,"vol":0..1}
{"op":"master","vol":0.3..1}
{"op":"osd","value":"vhs|cctv|archive|none"}
{"op":"title","lines":["строка 1","строка 2",...]}  или {"op":"title","on":false|true}
{"op":"screamer","on":true|false}  или {"op":"screamer","n":<номер кадра>|"auto"}
{"op":"duration","seconds":15..25}
{"op":"intro","seconds":0.6..4}  {"op":"outro","seconds":0.8..4}
{"op":"reroll"}  — другой вариант расстановки движений/переходов/сбоев

Правила: меняй только то, о чём просят. «Меньше/слабее» ≈ delta −0.2, «сильно меньше/убрать» — value 0 или выключить, «больше» ≈ +0.2. Номера кадров — как в состоянии. Если просьба невыполнима этими операциями — не выдумывай, объясни в reply.

ПРАВКИ ПОЛЬЗОВАТЕЛЯ:
"""${text}"""

Ответь ТОЛЬКО JSON: {"ops":[...],"reply":"коротко по-русски, что сделано или что невозможно"}`;
}

// ---------- Разбор без языковой модели (ключевые слова) ----------
const PARAM_WORDS = [
  [/зел[её]н/, 'greenBands'], [/зерн/, 'grain'], [/(глитч|помех|сбо[йия])/, 'glitchDensity'], [/(дрож|тряс|трясё|тряск|ручн)/, 'shake'],
  [/(rgb|ргб|сдвиг цвет|хроматич)/, 'rgbGlitch'], [/разрыв/, 'tears'], [/(блок|квадрат|пиксел)/, 'blocks'], [/трекинг/, 'tracking'],
  [/виньет/, 'vignette'], [/(параллакс|объ[её]м)/, 'parallax'], [/(провал|выпаден)/, 'dropouts'], [/(мерцан|мига)/, 'flicker'],
  [/насыщ/, 'saturation'], [/контраст/, 'contrast'], [/(фокус|размыт)/, 'focusBreath'], [/(движени|камер)/, 'moveStrength'],
  [/(мягк|мыл)/, 'softness'], [/(развёртк|развертк|строк)/, 'scanlines'], [/(растекан|цветн.* размаз)/, 'chromaBleed'],
];
const TRACK_WORDS = [[/гул/, 'drone'], [/шипени/, 'hiss'], [/радио/, 'radio'], [/щелч/, 'clicks'], [/(цифров.*звук|звук.*сбо)/, 'digital'], [/(акцент|удар)/, 'stingers'], [/клавиат/, 'keys']];
const MOVE_WORDS = [[/наезд/, 'push_in'], [/отъезд/, 'pull_out'], [/панорам.*(лев|право)?/, 'pan_lr'], [/наклон.*вниз/, 'tilt_down'], [/наклон.*вверх/, 'tilt_up'], [/(зум|увелич)/, 'snap_zoom'], [/фокус/, 'rack_focus'], [/(ищет|поиск)/, 'handheld_search'], [/(проезд|сбоку)/, 'parallax_dolly'], [/(дыхани|дыш)/, 'breathing'], [/(статичн|неподвиж|наблюдени)/, 'locked_cctv'], [/дрейф/, 'drift']];
const TR_WORDS = [[/(провал.*ч[её]рн|в ч[её]рное|затемнен)/, 'black_dip'], [/вспышк.*стат|статик/, 'noise_burst'], [/(засвет|вспышк)/, 'flash'], [/(срыв строк|глитч.*склейк)/, 'glitch_cut'], [/(склейк|резк)/, 'cut'], [/(синхрон|кадров.*срыв|прокрут)/, 'vhold_roll'], [/стоп.?кадр/, 'freeze_drop'], [/трекинг/, 'tracking'], [/(наложен|перезапис)/, 'bleed'], [/(потер.* сигнал|нет сигнала)/, 'signal_loss']];

function direction(s) {
  if (/(убер|убра|без |выключ|отключ|не нужн|удали)/.test(s)) return 'off';
  if (/(сильно|намного|гораздо|значительно) (меньше|слабее|тише)/.test(s)) return -0.35;
  if (/(меньше|слабее|тише|пореже|медленн|спокойн|уменьш|сниз)/.test(s)) return -0.2;
  if (/(сильно|намного|гораздо|значительно) (больше|сильнее|громче)/.test(s)) return 0.35;
  if (/(больше|сильнее|громче|почаще|быстр|добав|увелич|усил|включ)/.test(s)) return 0.2;
  return null;
}

export function parseEditsLocal(text) {
  const ops = [], notes = [];
  const raw = String(text || '');
  // титр: «титр: строка; строка»
  const tm = raw.match(/(титр|текст в начале|надпись)\s*[:—-]\s*([\s\S]+)/i);
  if (tm) ops.push({ op: 'title', lines: tm[2].split(/[;\n]|\s\/\s/).map(x => x.trim()).filter(Boolean) });
  const body = tm ? raw.slice(0, tm.index) : raw;
  const parts = body.toLowerCase().replace(/ё/g, 'е').split(/[.!;\n]+|,\s*(?=[а-я])/).map(x => x.trim()).filter(Boolean);
  for (const s of parts) {
    let used = false;
    if (/(без титр|убер.* титр|убра.* титр)/.test(s)) { ops.push({ op: 'title', on: false }); continue; }
    if (/титр/.test(s) && /(верн|включ|добав)/.test(s)) { ops.push({ op: 'title', on: true }); continue; }
    if (/скример/.test(s)) {
      const n = s.match(/кадр[а-яё]*\s*(\d+)|(\d+)\s*кадр/);
      if (/(убер|убра|без|выключ|не нужен)/.test(s)) ops.push({ op: 'screamer', on: false });
      else if (n) ops.push({ op: 'screamer', n: +(n[1] || n[2]) });
      else ops.push({ op: 'screamer', on: true });
      continue;
    }
    if (/(другой вариант|переставь|перемешай|по-другому)/.test(s)) { ops.push({ op: 'reroll' }); continue; }
    if (/(страшн|жутк|тревожн|напряж)/.test(s) && !/кадр/.test(s)) {
      const less = /(менее|меньше|слишком)/.test(s);
      const k = less ? -1 : 1;
      ops.push({ op: 'param', key: 'glitchDensity', delta: 0.15 * k }, { op: 'param', key: 'shake', delta: 0.1 * k }, { op: 'param', key: 'lift', delta: -0.08 * k }, { op: 'param', key: 'vignette', delta: 0.1 * k }, { op: 'track', id: 'drone', on: true, delta: 0.1 * k });
      continue;
    }
    const dm = s.match(/(\d{2})\s*(сек|с\b)/);
    if (dm && /(длительн|ролик|видео|сделай|всего)/.test(s) && !/кадр/.test(s)) { ops.push({ op: 'duration', seconds: +dm[1] }); continue; }
    if (/(индикац|rec|дата на экране|таймкод|тайм-код)/.test(s)) { ops.push({ op: 'osd', value: /(убер|без|выключ)/.test(s) ? 'none' : /наблюден/.test(s) ? 'cctv' : /архив/.test(s) ? 'archive' : 'vhs' }); continue; }
    const shotM = s.match(/кадр[а-яё]*\s*(\d+)|(\d+)\s*-?\s*(?:й|ой|ий|ем|м)?\s*кадр/);
    if (shotM) {
      const n = +(shotM[1] || shotM[2]);
      const op = { op: 'shot', n };
      if (/переход/.test(s)) { for (const [re, id] of TR_WORDS) if (re.test(s)) { op.transition = id; break; } }
      else for (const [re, id] of MOVE_WORDS) if (re.test(s)) { op.move = id; if (id === 'pan_lr' && /(справа|налево)/.test(s)) op.move = 'pan_rl'; break; }
      const dsec = s.match(/(\d+(?:[.,]\d)?)\s*(сек|с\b)/);
      if (dsec) op.duration = parseFloat(dsec[1].replace(',', '.'));
      else if (/(длинн|дольше)/.test(s)) op.durationDelta = 1; else if (/(короч|быстрее закончи)/.test(s)) op.durationDelta = -1;
      const d = direction(s);
      if (!op.move && !op.transition && op.duration == null && op.durationDelta == null && d != null && d !== 'off') op.intensityDelta = d;
      if (Object.keys(op).length > 2) { ops.push(op); used = true; }
    }
    if (used) continue;
    const d = direction(s);
    for (const [re, id] of TRACK_WORDS) if (re.test(s) && /(звук|гром|тих|убер|выключ|включ|добав|гул|шип|радио|щелч|клавиат|удар|акцент)/.test(s)) {
      ops.push(d === 'off' ? { op: 'track', id, on: false } : { op: 'track', id, on: true, delta: d ?? 0.2 }); used = true;
    }
    if (used) continue;
    if (/(общ.*громк|весь звук|звук в целом)/.test(s) && d != null) { ops.push({ op: 'master', delta: d === 'off' ? -0.3 : d }); continue; }
    for (const [re, id] of PARAM_WORDS) if (re.test(s)) {
      ops.push(d === 'off' ? { op: 'param', key: id, value: 0 } : { op: 'param', key: id, delta: d ?? 0.2 }); used = true; break;
    }
    if (/(темнее|ярче|светлее)/.test(s)) { ops.push({ op: 'param', key: 'lift', delta: /темнее/.test(s) ? -0.15 : 0.15 }); used = true; }
    if (!used) notes.push(s);
  }
  return { ops, notes };
}

// ---------- Применение операций ----------
export function applyOps(project, ops, edl) {
  const e = project.edit;
  const changes = [];
  const shots = project.storyboard?.shots || [];
  const shotByN = n => shots.find(s => s.n === Number(n));
  e.overrides = e.overrides || {};
  for (const o of ops || []) {
    try {
      switch (o.op) {
        case 'param': {
          if (!(o.key in e.params)) break;
          const old = e.params[o.key];
          const v = clamp01(o.value != null ? Number(o.value) : old + Number(o.delta || 0));
          if (Math.abs(v - old) < 0.005) break;
          e.params[o.key] = v; changes.push(`${PNAME[o.key]}: ${pct(old)} → ${pct(v)}`); break;
        }
        case 'shot': {
          const sh = shotByN(o.n); if (!sh) { changes.push(`! Кадра ${o.n} нет`); break; }
          const ov = e.overrides[sh.id] = e.overrides[sh.id] || {};
          if (o.move && (o.move === 'auto' || (MOVES[o.move] && !MOVES[o.move].special))) { ov.move = o.move; changes.push(`Кадр ${sh.n}: движение → ${o.move === 'auto' ? 'авто' : MOVES[o.move].name}`); }
          if (o.transition && (o.transition === 'auto' || TRANSITIONS[o.transition])) { ov.transition = o.transition; changes.push(`Кадр ${sh.n}: переход после → ${o.transition === 'auto' ? 'авто' : TRANSITIONS[o.transition].name}`); }
          const curI = ov.intensity ?? sh.camera?.intensity ?? 0.6;
          if (o.intensity != null || o.intensityDelta != null) {
            const v = Math.max(0.1, Math.min(1, o.intensity != null ? Number(o.intensity) : curI + Number(o.intensityDelta)));
            ov.intensity = v; changes.push(`Кадр ${sh.n}: сила движения ${curI.toFixed(2)} → ${v.toFixed(2)}`);
          }
          const seg = edl?.segments.find(s => s.shotId === sh.id);
          const curD = ov.duration ?? (seg ? seg.end - seg.start : Number(sh.duration) || 4);
          if (o.duration != null || o.durationDelta != null) {
            const v = Math.max(2, Math.min(8, o.duration != null ? Number(o.duration) : curD + Number(o.durationDelta)));
            ov.duration = v; changes.push(`Кадр ${sh.n}: длительность ${curD.toFixed(1)} → ${v.toFixed(1)} с`);
          }
          break;
        }
        case 'track': {
          if (!e.tracks[o.id]) break;
          const tr = e.tracks[o.id]; const was = `${tr.on === false ? 'выкл' : pct(tr.vol)}`;
          if (o.on != null) tr.on = !!o.on;
          if (o.vol != null) tr.vol = clamp01(Number(o.vol));
          else if (o.delta != null) tr.vol = clamp01(tr.vol + Number(o.delta));
          changes.push(`Звук «${TNAME[o.id]}»: ${was} → ${tr.on === false ? 'выкл' : pct(tr.vol)}`); break;
        }
        case 'master': { const old = e.masterVol ?? 0.9; const v = Math.max(0.3, Math.min(1, o.vol != null ? Number(o.vol) : old + Number(o.delta || 0))); e.masterVol = v; changes.push(`Общая громкость: ${pct(old)} → ${pct(v)}`); break; }
        case 'osd': if (['vhs', 'cctv', 'archive', 'none'].includes(o.value)) { e.osd = o.value; changes.push(`Экранная индикация → ${{ vhs: 'VHS', cctv: 'камера наблюдения', archive: 'архивный тайм-код', none: 'нет' }[o.value]}`); } break;
        case 'title':
          e.title = e.title || { on: true, lines: [] };
          if (Array.isArray(o.lines) && o.lines.length) { e.title.lines = o.lines.map(String).slice(0, 6); e.title.on = true; e.title.auto = false; changes.push('Титр: ' + e.title.lines.join(' / ')); }
          if (o.on != null && !o.lines) { e.title.on = !!o.on; changes.push(o.on ? 'Титр включён' : 'Титр выключен'); }
          break;
        case 'screamer':
          e.screamer = e.screamer || { on: true, shotId: 'auto' };
          if (o.n != null && o.n !== 'auto') { const sh = shotByN(o.n); if (sh) { e.screamer = { on: true, shotId: sh.id }; changes.push(`Скример: изображение кадра ${sh.n}`); } else changes.push(`! Кадра ${o.n} нет — скример не изменён`); }
          else if (o.n === 'auto') { e.screamer = { on: true, shotId: 'auto' }; changes.push('Скример: выбор изображения — авто'); }
          else if (o.on != null) { e.screamer.on = !!o.on; changes.push(o.on ? 'Скример включён' : 'Скример выключен'); }
          break;
        case 'duration': { const want = Number(o.seconds), v = Math.max(15, Math.min(25, want)); e.targetDuration = v; changes.push(`Длительность ролика → ${v} с` + (want > 25 ? ' (максимум 25 с)' : '')); break; }
        case 'intro': { const v = Math.max(0.6, Math.min(4, Number(o.seconds))); e.introDur = v; changes.push(`Чёрный экран в начале → ${v.toFixed(1)} с`); break; }
        case 'outro': { const v = Math.max(0.8, Math.min(4, Number(o.seconds))); e.outroDur = v; changes.push(`Финальный обрыв → ${v.toFixed(1)} с`); break; }
        case 'template': { const t = BUILTIN_TEMPLATES.find(x => x.id === o.id); if (t) { e.params = JSON.parse(JSON.stringify(t.params)); e.osd = t.osd; e.templateId = t.id; changes.push('Стиль → ' + t.name); } break; }
        case 'reroll': e.seed = Math.floor(Math.random() * 1e9); changes.push('Новый вариант расстановки движений, переходов и сбоев'); break;
      }
    } catch (err) { changes.push('! Не удалось применить: ' + JSON.stringify(o)); }
  }
  return changes;
}
