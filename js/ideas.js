// Генератор идей (алгоритмический, работает без интернета и API) + оценка + переработка.
// Важно: это комбинаторно-оценочная система на авторской библиотеке элементов, а не нейросеть.
// Для идей уровня языковой модели есть «мост с ChatGPT» (см. bridge.js).

import { FORMATS, LOCATIONS, ANOMALIES, ENTITIES, ENDINGS, OPERATORS, TIMES } from './content.js';
import { rng } from './engine/timeline.js';
import { uid } from './store.js';

const byId = (arr, id) => arr.find(x => x.id === id);

// Совместимость: какие сущности естественны для аномалий (бонус к атмосфере)
const AFFINITY = {
  drained_pool: ['swimmer', 'absence'], costume_teeth: ['rabbit'], gas_masks: ['gasmask'], extra_student: ['masked_kids', 'absence'],
  smiling_photos: ['smile_family'], voice_address: ['announcer'], future_tape: ['operator_double'], mirror_lag: ['operator_double', 'tall_coat'],
  tv_same_room: ['tall_coat', 'operator_double'], children_drawings: ['tall_coat'], counted_doors: ['duty_woman', 'numbered_man', 'absence'],
  warm_chair: ['absence'], queue: ['numbered_man', 'conductor'], step_closer: ['tall_coat', 'conductor', 'gasmask', 'rabbit'],
  loop_corridor: ['operator_double', 'absence'], mannequin_breath: ['absence'], sheets_chair: ['absence', 'duty_woman'],
};
const LOC_AFF = {
  drained_pool: ['pool'], extra_student: ['school_radio', 'kindergarten', 'camp'], voice_address: ['school_radio', 'apartment', 'dacha'],
  mannequin_breath: ['theater_props', 'mall'], costume_teeth: ['mall', 'culture_house', 'kindergarten', 'camp'], reverse_snow: ['dacha', 'dorm', 'apartment'],
  stairs_13: ['elevator', 'dorm', 'watertower'], tv_same_room: ['apartment', 'dorm'], counted_doors: ['store247', 'culture_house', 'mall'],
  queue: ['store247', 'culture_house', 'tram_depot'], children_drawings: ['kindergarten', 'camp'], warm_chair: ['culture_house', 'planetarium', 'tram_depot'],
};

function weighted(r, items, wfn) {
  let tot = 0; const ws = items.map(x => { const w = Math.max(0.001, wfn(x)); tot += w; return w; });
  let v = r() * tot;
  for (let i = 0; i < items.length; i++) { v -= ws[i]; if (v <= 0) return items[i]; }
  return items[items.length - 1];
}

// Профиль предпочтений из истории: понравившиеся элементы получают вес
export function preferenceProfile(history) {
  const used = {}, liked = {};
  for (const h of history) {
    const c = h.idea?.parts; if (!c) continue;
    for (const k of Object.values(c)) { used[k] = (used[k] || 0) + 1; if (h.liked) liked[k] = (liked[k] || 0) + 1; }
  }
  return { used, liked, recentAnomalies: history.slice(0, 30).map(h => h.idea?.parts?.anomaly).filter(Boolean) };
}

export function scoreIdea(parts, profile) {
  const f = byId(FORMATS, parts.format), l = byId(LOCATIONS, parts.location), a = byId(ANOMALIES, parts.anomaly), e = byId(ENTITIES, parts.entity), en = byId(ENDINGS, parts.ending);
  const usedPenalty = k => Math.min(2.5, (profile?.used?.[k] || 0) * 0.6);
  let originality = (f.orig * 0.25 + l.orig * 0.25 + a.orig * 0.3 + e.orig * 0.2) - (usedPenalty(parts.anomaly) * 0.6 + usedPenalty(parts.location) * 0.25 + usedPenalty(parts.ending) * 0.15);
  const affE = (AFFINITY[a.id] || []).includes(e.id), affL = (LOC_AFF[a.id] || []).includes(l.id);
  if (!affL) originality += 0.4; // неожиданное сочетание места и аномалии
  let atmosphere = f.atm * 0.4 + l.atm * 0.6 + (affE ? 0.6 : 0) + (affL ? 0.5 : 0);
  let visual = l.vis * 0.45 + a.vis * 0.55 - (e.id === 'absence' ? 0.6 : 0);
  let retention = a.hook * 0.6 + en.twist * 0.4 + (e.id === 'absence' ? -0.3 : 0.2);
  const clamp10 = v => Math.max(1, Math.min(10, v));
  originality = clamp10(originality); atmosphere = clamp10(atmosphere); visual = clamp10(visual); retention = clamp10(retention);
  const total = clamp10(originality * 0.3 + atmosphere * 0.22 + visual * 0.24 + retention * 0.24);
  const crit = { originality, atmosphere, visual, retention };
  const names = { originality: 'оригинальность', atmosphere: 'атмосфера', visual: 'визуальный потенциал', retention: 'удержание внимания' };
  const sorted = Object.entries(crit).sort((x, y) => y[1] - x[1]);
  const best = sorted[0], worst = sorted[sorted.length - 1];
  const why = [];
  why.push(`Сильнее всего — ${names[best[0]]} (${best[1].toFixed(1)})`);
  if (best[0] === 'retention' || a.hook >= 8) why.push('аномалию можно показать в первые секунды без объяснений');
  if (affE) why.push('существо органично вытекает из аномалии');
  if (!affL) why.push('неожиданное сочетание места и явления');
  if (en.twist >= 8) why.push('финал переворачивает смысл увиденного');
  if (worst[1] < 6.5) why.push(`слабее — ${names[worst[0]]} (${worst[1].toFixed(1)})`);
  if ((profile?.used?.[parts.anomaly] || 0) > 0) why.push('похожая аномалия уже встречалась в истории — оценка снижена');
  return { total: Math.round(total * 10) / 10, crit, reason: why.join('; ') + '.' };
}

function buildIdea(parts, r, profile) {
  const f = byId(FORMATS, parts.format), l = byId(LOCATIONS, parts.location), a = byId(ANOMALIES, parts.anomaly), e = byId(ENTITIES, parts.entity), en = byId(ENDINGS, parts.ending);
  const year = Math.round(f.era[0] + r() * (f.era[1] - f.era[0]));
  const operator = parts.operator || OPERATORS[Math.floor(r() * OPERATORS.length)];
  const time = parts.time || TIMES[Math.floor(r() * TIMES.length)];
  const titleBase = a.title[Math.floor(r() * a.title.length)];
  const titleForms = [titleBase, `${titleBase}. ${l.name}, ${year}`, `${l.short[0].toUpperCase() + l.short.slice(1)}: ${titleBase.toLowerCase()}`, `Кассета №${Math.floor(r() * 90 + 10)}: ${titleBase.toLowerCase()}`];
  const title = titleForms[Math.floor(r() * titleForms.length)];
  const s = scoreIdea(parts, profile);
  return {
    id: uid('i'),
    title,
    logline: `${f.name} (${year}): ${operator} снимает ${l.name.toLowerCase()} ${time}. Постепенно становится ясно, что ${a.text}.${e.id !== 'absence' ? ' В кадре появляется ' + e.name.toLowerCase() + '.' : ''} ${f.found[0].toUpperCase() + f.found.slice(1)}.`,
    visual: a.visual + '; ' + l.wide,
    detail: a.detail + '. Деталь места: ' + l.details[Math.floor(r() * l.details.length)] + '.',
    ending: en.text[0].toUpperCase() + en.text.slice(1) + '.',
    score: s.total, crit: s.crit, reason: s.reason,
    parts: { ...parts, operator, time }, year,
    source: 'Алгоритмический генератор',
  };
}

function randomParts(r, profile, keep = {}) {
  const liked = profile?.liked || {}, used = profile?.used || {};
  const recent = new Set(profile?.recentAnomalies || []);
  const w = (x, base) => (base || 5) * (1 + (liked[x.id] || 0) * 0.5) / (1 + (used[x.id] || 0) * 0.8);
  const anomaly = keep.anomaly || weighted(r, ANOMALIES, x => w(x, x.orig + x.hook) * (recent.has(x.id) ? 0.15 : 1)).id;
  const locAff = LOC_AFF[anomaly] || [];
  const location = keep.location || weighted(r, LOCATIONS, x => w(x, x.atm + x.vis) * (locAff.includes(x.id) ? 1.6 : 1)).id;
  const entAff = AFFINITY[anomaly] || [];
  const entity = keep.entity || weighted(r, ENTITIES, x => w(x, x.orig) * (entAff.includes(x.id) ? 3 : 1)).id;
  const format = keep.format || weighted(r, FORMATS, x => w(x, x.orig + x.atm)).id;
  const ending = keep.ending || weighted(r, ENDINGS, x => w(x, x.twist)).id;
  return { format, location, anomaly, entity, ending, operator: keep.operator, time: keep.time };
}

export function generateIdeas(count, history, seed = Date.now()) {
  const r = rng(seed);
  const profile = preferenceProfile(history);
  const out = [];
  const usedA = new Set(), usedL = new Set();
  let guard = 0;
  while (out.length < count && guard++ < count * 40) {
    const parts = randomParts(r, profile);
    if (usedA.has(parts.anomaly)) continue; // внутри пачки — разные аномалии
    if (usedL.has(parts.location) && r() < 0.8) continue;
    // не повторять точные комбинации из истории
    if (history.some(h => h.idea?.parts?.anomaly === parts.anomaly && h.idea?.parts?.location === parts.location)) continue;
    usedA.add(parts.anomaly); usedL.add(parts.location);
    out.push(buildIdea(parts, r, profile));
  }
  return out.sort((a, b) => b.score - a.score);
}

// Переработка слабой идеи: сохраняем сильные элементы, заменяем слабые
export function reworkIdea(idea, history, seed = Date.now()) {
  const r = rng(seed);
  const profile = preferenceProfile(history);
  let best = null;
  for (let k = 0; k < 40; k++) {
    const keep = {};
    const c = idea.crit || {};
    // сохраняем то, что работает: место (атмосфера) и формат
    if ((c.atmosphere || 0) >= 7) { keep.location = idea.parts.location; keep.format = idea.parts.format; }
    if ((c.retention || 0) >= 7.5) keep.anomaly = idea.parts.anomaly;
    if (!keep.anomaly && !keep.location) keep.format = idea.parts.format;
    const parts = randomParts(r, profile, keep);
    if (parts.anomaly === idea.parts.anomaly && parts.ending === idea.parts.ending && parts.entity === idea.parts.entity) continue;
    const cand = buildIdea(parts, r, profile);
    if (!best || cand.score > best.score) best = cand;
  }
  best.reworkedFrom = idea.title;
  best.source = 'Переработка: ' + idea.title;
  return best;
}

// ---------- Сценарий и раскадровка ----------
const BEATS_BY_COUNT = {
  6: ['open', 'establish', 'detail', 'tension', 'reveal', 'ending'],
  7: ['open', 'establish', 'build', 'detail', 'tension', 'reveal', 'ending'],
  8: ['open', 'establish', 'build', 'detail', 'tension', 'reveal', 'climax', 'ending'],
  9: ['open', 'establish', 'build', 'detail', 'build', 'tension', 'reveal', 'climax', 'ending'],
  10: ['open', 'establish', 'build', 'detail', 'build', 'tension', 'detail', 'reveal', 'climax', 'ending'],
};
// Раскадровка-заготовка под готовые изображения пользователя (без идеи)
export function storyboardFromImages(n, settings) {
  const base = BEATS_BY_COUNT[Math.max(6, Math.min(10, n))];
  const beats = Array.from({ length: n }, (_, i) => n === 1 ? 'reveal' : base[Math.round(i * (base.length - 1) / (n - 1))]);
  const target = settings.targetDuration || 24;
  const per = Math.max(1.6, Math.min(6, (target - 7) / n));
  const shots = beats.map((b, i) => ({
    id: uid('sh'), n: i + 1, beat: b, duration: Math.round(per * 10) / 10,
    content: `Ваше изображение ${i + 1}`, composition: COMPOSITION[b], camera: { move: 'auto', intensity: b === 'climax' ? 0.9 : 0.6 },
    light: '', vfx: VFX[b], vfxLevel: b === 'climax' ? 1.2 : b === 'open' ? 0.7 : 1, sound: SOUND[b], transition: 'auto', function: FUNCTION[b],
    images: [], activeImage: 0, enabled: true, prompt: '', promptEdited: true,
  }));
  return { shots, approved: true, createdAt: Date.now(), plannedDuration: shots.reduce((a, x) => a + x.duration, 0), source: 'Из ваших изображений' };
}

export const BEAT_NAMES = { open: 'Завязка', establish: 'Место действия', build: 'Продвижение', detail: 'Улика', tension: 'Нарастание', reveal: 'Раскрытие', climax: 'Кульминация', ending: 'Финал' };

const COMPOSITION = {
  open: 'общий план, глубокая перспектива, линия горизонта в нижней трети, много пустого пространства',
  establish: 'средне-общий план, ведущие линии к центру, объект интереса смещён от центра',
  build: 'съёмка от первого лица на уровне глаз, коридор/проход уходит в глубину',
  detail: 'крупный план предмета, небольшая глубина резкости, фон размыт',
  tension: 'средний план, в глубине кадра едва различимый силуэт, тёмные зоны по краям',
  reveal: 'фигура в центре или на линии трети, контровой или жёсткий направленный свет',
  climax: 'неустойчивый наклонённый кадр, близкая дистанция, смазанные края',
  ending: 'статичная композиция, симметрия, тревожная пустота или прямой взгляд в объектив',
};
const SOUND = {
  open: 'низкий гул, шипение ленты, редкие щелчки', establish: 'гул помещения, далёкий скрип, радиопомехи',
  build: 'шаги оператора, дыхание, гул усиливается', detail: 'тишина с гулом, короткий электрический щелчок',
  tension: 'гул нарастает, радио ловит обрывки, затем секунда тишины', reveal: 'полная тишина → низкий удар',
  climax: 'цифровой скрежет, помехи, рваный звук', ending: 'гул обрывается, остаётся шипение, финальный удар и тишина',
};
const FUNCTION = {
  open: 'Погрузить в атмосферу, заставить вглядываться в пустоту', establish: 'Показать место и правила «нормального» мира',
  build: 'Создать ощущение продвижения вглубь и точку невозврата', detail: 'Дать улику, которая противоречит норме',
  tension: 'Показать угрозу так, чтобы зритель заметил её раньше героя', reveal: 'Подтвердить худшее подозрение',
  climax: 'Потеря контроля над камерой и ситуацией', ending: 'Оставить тревожный вопрос, перевернуть смысл',
};
const VFX = {
  open: 'вступление из чёрного: статика, трекинг, захват сигнала', establish: 'зерно, мягкая ручная съёмка, редкая зелёная полоса',
  build: 'дрожание при ходьбе, поиск автофокуса', detail: 'перевод фокуса, лёгкий сдвиг RGB',
  tension: 'нарастающие помехи, краткий стоп-кадр', reveal: 'провал сигнала перед раскрытием, разрыв строк',
  climax: 'плотные глитчи, срыв синхронизации', ending: 'обрыв в статику, подсознательный кадр, тишина',
};
const LIGHT_BY_BEAT = {
  reveal: 'жёсткий направленный свет фонаря выхватывает фигуру', climax: 'свет фонаря мечется, пересветы и провалы',
  ending: 'почти темнота, слабый источник света', open: null, establish: null, build: 'луч фонаря оператора', detail: 'свет фонаря крупно на предмете', tension: 'фонарь едва достаёт до глубины',
};

export function generateStoryboard(idea, settings, opts = {}) {
  const r = rng(opts.seed || Date.now());
  const f = byId(FORMATS, idea.parts.format) || FORMATS[0], l = byId(LOCATIONS, idea.parts.location) || LOCATIONS[0];
  const a = byId(ANOMALIES, idea.parts.anomaly) || ANOMALIES[0], e = byId(ENTITIES, idea.parts.entity) || ENTITIES[0], en = byId(ENDINGS, idea.parts.ending) || ENDINGS[0];
  const target = settings.targetDuration || 24;
  const count = opts.count || Math.max(6, Math.min(8, Math.round((target - 7) / 2.6)));
  const beats = BEATS_BY_COUNT[count];
  const pickDetail = (() => { const d = [...l.details]; return () => d.length ? d.splice(Math.floor(r() * d.length), 1)[0] : l.details[0]; })();
  const figure = e.id === 'absence' ? 'следы присутствия' : e.name.toLowerCase();
  const content = {
    open: () => `${l.wide}, ${idea.parts.time}. Никого. Ощущение, что место только что покинули.`,
    build: () => `${l.path[0].toUpperCase() + l.path.slice(1)}. Камера продвигается вглубь.`,
    detail: () => `${a.clue[0].toUpperCase() + a.clue.slice(1)}.`,
    tension: () => `${l.path[0].toUpperCase() + l.path.slice(1)}: ${a.hint}.`,
    reveal: () => `${a.reveal[0].toUpperCase() + a.reveal.slice(1)}.${e.id !== 'absence' ? ' ' + e.desc[0].toUpperCase() + e.desc.slice(1) + '.' : ''}`,
    climax: () => e.id === 'absence' ? `Камера мечется: ${pickDetail()}, рядом свежие следы, ведущие к оператору.` : `${e.name} совсем близко к камере, детали лица не различимы, кадр завален.`,
    ending: () => `${en.visual[0].toUpperCase() + en.visual.slice(1)}.`,
  };
  const shots = beats.map((b, i) => {
    let c;
    if (b === 'establish') { const d = pickDetail(); c = `${d[0].toUpperCase() + d.slice(1)}. ${l.name}, ${idea.parts.time}.`; }
    else if (b === 'build' && i > 3) { const d = pickDetail(); c = `${d[0].toUpperCase() + d.slice(1)} — камера задерживается, затем идёт дальше.`; }
    else if (b === 'detail' && i > 5) c = `Ещё одна улика: ${a.detail}.`;
    else c = content[b]();
    const dur = { open: 4.2, establish: 4.4, build: 4.2, detail: 3.8, tension: 4.8, reveal: 4.2, climax: 3.2, ending: 4.6 }[b];
    return {
      id: uid('sh'), n: i + 1, beat: b,
      duration: Math.round(dur * 10) / 10,
      content: c,
      composition: COMPOSITION[b],
      camera: { move: 'auto', intensity: b === 'climax' ? 0.9 : b === 'tension' ? 0.5 : 0.6 },
      light: LIGHT_BY_BEAT[b] || l.light,
      vfx: VFX[b], vfxLevel: b === 'climax' ? 1.2 : b === 'open' ? 0.7 : 1,
      sound: SOUND[b], transition: 'auto', function: FUNCTION[b],
      images: [], activeImage: 0, enabled: true,
    };
  });
  const bible = buildBible(idea, f, l, e, a);
  shots.forEach(sh => { sh.prompt = buildPrompt(sh, bible); });
  const total = shots.reduce((s, x) => s + x.duration, 0);
  const script = buildScriptText(idea, shots, f, l, a, e, en);
  return { storyboard: { shots, approved: false, createdAt: Date.now(), plannedDuration: total }, bible, script };
}

function buildBible(idea, f, l, e, a) {
  const y = idea.year || 1996;
  const m = 1 + Math.floor(Math.abs(Math.sin(y)) * 11), d = 1 + Math.floor(Math.abs(Math.cos(y)) * 27);
  return {
    location: `${l.name}: ${l.wide}. Палитра: ${l.palette}. Свет: ${l.light}.`,
    character: e.id === 'absence' ? 'Существо не показывается напрямую — только следы его присутствия.' : `${e.name}: ${e.desc}. Внешность одинакова во всех кадрах.`,
    keyObject: a.clue,
    era: `${y} год, ${f.camera}`,
    camera: f.camera,
    palette: l.palette,
    rules: 'Без текста и надписей в изображении. Без современных предметов вне эпохи. Одно и то же место, свет и персонаж во всех кадрах. Вертикальный кадр 9:16.',
    osdDate: { y, m, d, h: 2 + Math.floor(Math.abs(Math.sin(y * 3)) * 2), min: Math.floor(Math.abs(Math.sin(y * 7)) * 59), s: 7 },
  };
}

export function buildPrompt(sh, bible) {
  const style = `кадр из найденной видеозаписи (${bible.camera}), ${bible.era.split(',')[0]}, фотореалистично, как стоп-кадр реального любительского видео, лёгкая мягкость оптики, естественный шум сенсора`;
  return [
    `Вертикальный кадр 9:16. ${sh.content}`,
    `Композиция: ${sh.composition}.`,
    `Свет и атмосфера: ${sh.light}.`,
    `Место (одинаково во всех кадрах): ${bible.location}`,
    bible.character && !bible.character.startsWith('Существо не') && ['tension', 'reveal', 'climax', 'ending'].includes(sh.beat) ? `Персонаж (одинаков во всех кадрах): ${bible.character}` : '',
    `Стиль: ${style}.`,
    'Без текста, без надписей, без водяных знаков, без рамок, без интерфейса камеры, без людей, смотрящих в камеру, если это не указано. Не постановочная фотография, не иллюстрация, не 3D-рендер.',
  ].filter(Boolean).join('\n');
}

function buildScriptText(idea, shots, f, l, a, e, en) {
  let t = `«${idea.title}»\n${f.name}. ${f.found[0].toUpperCase() + f.found.slice(1)}.\n\n`;
  let at = 0;
  for (const sh of shots) {
    t += `${fmt(at)}–${fmt(at + sh.duration)}  [${BEAT_NAMES[sh.beat]}] ${sh.content}\n   Звук: ${sh.sound}.\n`;
    at += sh.duration;
  }
  t += `\nФинал: ${en.text}.`;
  return t;
}
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function recomputePrompts(project) {
  for (const sh of project.storyboard.shots) if (!sh.promptEdited) sh.prompt = buildPrompt(sh, project.bible);
}
