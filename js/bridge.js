// «Мост с ChatGPT»: приложение готовит точный запрос, вы вставляете его в ChatGPT
// (в рамках вашей обычной подписки, без API), а ответ вставляете обратно — приложение
// само разбирает JSON и раскладывает идеи / раскадровку по проекту.

import { uid } from './store.js';
import { buildPrompt, BEAT_NAMES } from './ideas.js';

export function ideasRequest(history, styles) {
  const avoid = history.slice(0, 40).map(h => h.idea?.title).filter(Boolean);
  return `Ты — сценарист коротких хоррор-видео в эстетике analog horror, found footage, false documentary, VHS horror, liminal и dreamcore.
Придумай 10 оригинальных идей для вертикального ролика 30–45 секунд, который выглядит как фрагмент найденной архивной записи.

Требования:
- никаких банальных «заброшенных больниц с призраками»;
- тревога должна считываться визуально в первые 3 секунды, без закадрового текста;
- одна чёткая аномалия на историю, понятная без объяснений;
- всё снимаемо статичными кадрами (изображения + монтаж), без сложной актёрской игры;
- стиль: ${styles || 'analog horror, found footage, VHS'}.
${avoid.length ? '\nНе повторяй эти уже использованные сюжеты:\n- ' + avoid.join('\n- ') + '\n' : ''}
Оцени каждую идею по 10-балльной шкале с учётом оригинальности, атмосферы, визуального потенциала и удержания внимания.

Ответь ТОЛЬКО JSON без пояснений, в формате:
{"ideas":[{"title":"","logline":"","visual":"главный визуальный образ","detail":"необычная пугающая деталь","ending":"финал","score":8.5,"reason":"почему такая оценка","format":"тип записи (например, кассета из вещдоков)","location":"место","entity":"существо или «нет»","year":1994}]}`;
}

export function storyboardRequest(idea, settings) {
  const target = settings.targetDuration || 38;
  return `Ты — режиссёр псевдодокументального хоррора. Разработай раскадровку вертикального ролика (9:16) длительностью ${target} секунд по идее:

Название: ${idea.title}
Суть: ${idea.logline}
Главный образ: ${idea.visual}
Пугающая деталь: ${idea.detail}
Финал: ${idea.ending}

Правила:
- 6–10 кадров, сумма длительностей ≈ ${target - 4} с (ещё ~4 с займут вступление из чёрного экрана с помехами и финальный обрыв — их не описывай);
- каждый кадр — одно неподвижное изображение, которое будет оживлено монтажом (движение камеры, помехи), поэтому не описывай действий, которые требуют видео;
- кадры складываются в одну историю с нарастанием: завязка → место → улика → нарастание → раскрытие → финал;
- одинаковые место, свет, персонажи и предметы во всех кадрах (опиши их один раз в "bible");
- без текста и надписей в изображениях.

beat — одно из: open, establish, build, detail, tension, reveal, climax, ending.
camera — одно из: auto, push_in, pull_out, pan_lr, pan_rl, tilt_down, tilt_up, drift, handheld_search, snap_zoom, rack_focus, parallax_dolly, breathing, locked_cctv.
transition — одно из: auto, cut, glitch_cut, noise_burst, black_dip, flash, vhold_roll, freeze_drop, tracking, bleed, signal_loss.

Ответь ТОЛЬКО JSON:
{"bible":{"location":"","character":"","keyObject":"","era":"год и тип камеры","palette":""},
 "shots":[{"duration":4.2,"beat":"open","content":"что на изображении","composition":"","camera":"auto","light":"","vfx":"","sound":"","transition":"auto","function":"драматургическая функция","prompt":"подробный промпт для генерации изображения на русском"}]}`;
}

export function imageRequest(sh, bible) {
  return `Сгенерируй изображение (вертикальное, 9:16, максимально высокое разрешение).\n\n${sh.prompt || buildPrompt(sh, bible)}`;
}

export function allImagesRequest(project) {
  const sh = project.storyboard.shots;
  return `Мне нужно ${sh.length} изображений для одного хоррор-ролика. Это кадры ОДНОЙ истории: место, свет, персонаж и предметы должны совпадать между кадрами.
Генерируй строго по одному изображению на сообщение, по порядку. После каждого изображения жди моего слова «дальше».
Все изображения вертикальные 9:16, без текста и надписей.

Общая библия проекта:
- Место: ${project.bible.location}
- Персонаж: ${project.bible.character}
- Ключевой предмет: ${project.bible.keyObject}
- Эпоха и камера: ${project.bible.era}

${sh.map(s => `КАДР ${s.n} (${BEAT_NAMES[s.beat]}):\n${s.prompt}`).join('\n\n')}

Начни с кадра 1.`;
}

// Извлечение JSON из ответа ChatGPT (терпимо к ```json, тексту вокруг и «умным» кавычкам)
export function extractJSON(text) {
  if (!text || !text.trim()) throw new Error('Пустой ответ');
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1];
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('В ответе не найден JSON. Попросите ChatGPT ответить только JSON.');
  t = t.slice(a, b + 1);
  try { return JSON.parse(t); } catch (e1) {
    const fixed = t.replace(/[\u201C\u201D]/g, '"').replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(fixed); } catch (e) { throw new Error('JSON повреждён: ' + e1.message + '. Попросите ChatGPT повторить ответ строго в JSON.'); }
  }
}

export function parseIdeas(text) {
  const j = extractJSON(text);
  const arr = Array.isArray(j) ? j : j.ideas;
  if (!Array.isArray(arr) || !arr.length) throw new Error('В JSON нет массива ideas');
  return arr.map(x => ({
    id: uid('i'),
    title: String(x.title || 'Без названия'),
    logline: String(x.logline || x.summary || ''),
    visual: String(x.visual || ''),
    detail: String(x.detail || ''),
    ending: String(x.ending || ''),
    score: Math.max(1, Math.min(10, Number(x.score) || 7)),
    reason: String(x.reason || ''),
    crit: null,
    parts: { custom: true, format: x.format || '', location: x.location || '', entity: x.entity || '', time: '' },
    year: Number(x.year) || 1995,
    source: 'ChatGPT (через мост)',
  })).sort((a, b) => b.score - a.score);
}

const BEATS = ['open', 'establish', 'build', 'detail', 'tension', 'reveal', 'climax', 'ending'];
export function parseStoryboard(text, idea) {
  const j = extractJSON(text);
  if (!Array.isArray(j.shots) || j.shots.length < 3) throw new Error('В JSON нет массива shots (нужно минимум 3 кадра)');
  const b = j.bible || {};
  const year = Number(String(b.era || '').match(/(19|20)\d\d/)?.[0]) || idea.year || 1996;
  const bible = {
    location: String(b.location || ''), character: String(b.character || ''), keyObject: String(b.keyObject || ''),
    era: String(b.era || `${year} год`), camera: String(b.era || 'бытовая VHS-камера'), palette: String(b.palette || ''),
    rules: 'Без текста и надписей. Одно место, свет и персонаж во всех кадрах. Вертикальный кадр 9:16.',
    osdDate: { y: year, m: 10, d: 14, h: 2, min: 13, s: 7 },
  };
  const shots = j.shots.slice(0, 10).map((s, i) => ({
    id: uid('sh'), n: i + 1,
    beat: BEATS.includes(s.beat) ? s.beat : (i === 0 ? 'open' : i === j.shots.length - 1 ? 'ending' : 'build'),
    duration: Math.max(2, Math.min(8, Number(s.duration) || 4)),
    content: String(s.content || ''), composition: String(s.composition || ''),
    camera: { move: String(s.camera || 'auto'), intensity: 0.6 }, light: String(s.light || ''),
    vfx: String(s.vfx || ''), vfxLevel: 1, sound: String(s.sound || ''), transition: String(s.transition || 'auto'),
    function: String(s.function || ''), images: [], activeImage: 0, enabled: true,
    prompt: '', promptEdited: false,
  }));
  shots.forEach((sh, i) => {
    const p = j.shots[i].prompt;
    if (p && String(p).length > 20) { sh.prompt = String(p) + '\nВертикальный кадр 9:16, без текста и надписей.'; sh.promptEdited = true; }
    else sh.prompt = buildPrompt(sh, bible);
  });
  return { storyboard: { shots, approved: false, createdAt: Date.now(), plannedDuration: shots.reduce((a, s) => a + s.duration, 0), source: 'ChatGPT (через мост)' }, bible };
}
