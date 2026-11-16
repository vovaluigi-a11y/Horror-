// Библиотека монтажных шаблонов. Встроенные стили + пользовательские (сохраняются в IndexedDB).
// Все значения 0..1, кроме явно указанных.

export const TRACKS = [
  { id: 'drone', name: 'Низкий гул' },
  { id: 'hiss', name: 'Аналоговое шипение' },
  { id: 'radio', name: 'Радиопомехи' },
  { id: 'clicks', name: 'Электрические щелчки' },
  { id: 'digital', name: 'Цифровые сбои (синхр. с глитчами)' },
  { id: 'stingers', name: 'Тревожные акценты и скример' },
  { id: 'keys', name: 'Клавиатура (титр)' },
];

export const PARAM_DEFS = [
  { id: 'grain', name: 'Плёночное зерно', group: 'Изображение' },
  { id: 'scanlines', name: 'Строчная развёртка', group: 'Изображение' },
  { id: 'softness', name: 'Аналоговая мягкость', group: 'Изображение' },
  { id: 'chromaBleed', name: 'Растекание цвета', group: 'Изображение' },
  { id: 'vignette', name: 'Виньетка', group: 'Изображение' },
  { id: 'baseRGB', name: 'Хром. аберрация (постоянная)', group: 'Изображение' },
  { id: 'saturation', name: 'Насыщенность', group: 'Цвет' },
  { id: 'contrast', name: 'Контраст', group: 'Цвет' },
  { id: 'warmth', name: 'Тёплый ↔ холодный (0.5 = нейтр.)', group: 'Цвет' },
  { id: 'greenTint', name: 'Зеленоватый оттенок', group: 'Цвет' },
  { id: 'lift', name: 'Подъём теней (выцветание)', group: 'Цвет' },
  { id: 'shake', name: 'Ручная съёмка (дрожание)', group: 'Камера' },
  { id: 'parallax', name: 'Параллакс (2.5D)', group: 'Камера' },
  { id: 'moveStrength', name: 'Сила движений камеры', group: 'Камера' },
  { id: 'focusBreath', name: 'Поиск фокуса', group: 'Камера' },
  { id: 'exposureHunt', name: 'Автоэкспозиция', group: 'Камера' },
  { id: 'glitchDensity', name: 'Плотность глитчей', group: 'Повреждения' },
  { id: 'greenBands', name: 'Зелёные полосы', group: 'Повреждения' },
  { id: 'rgbGlitch', name: 'Смещение RGB', group: 'Повреждения' },
  { id: 'tears', name: 'Разрывы строк', group: 'Повреждения' },
  { id: 'dropouts', name: 'Провалы сигнала', group: 'Повреждения' },
  { id: 'blocks', name: 'Цифровые блоки', group: 'Повреждения' },
  { id: 'tracking', name: 'Трекинг-помехи VHS', group: 'Повреждения' },
  { id: 'flicker', name: 'Нестабильность яркости', group: 'Повреждения' },
];

function base() {
  return {
    grain: 0.45, scanlines: 0.35, softness: 0.4, chromaBleed: 0.4, vignette: 0.45, baseRGB: 0.25,
    saturation: 0.55, contrast: 0.55, warmth: 0.5, greenTint: 0.1, lift: 0.25,
    shake: 0.5, parallax: 0.5, moveStrength: 0.55, focusBreath: 0.35, exposureHunt: 0.45,
    glitchDensity: 0.5, greenBands: 0.5, rgbGlitch: 0.5, tears: 0.5, dropouts: 0.4, blocks: 0.2, tracking: 0.5, flicker: 0.35,
  };
}

export const BUILTIN_TEMPLATES = [
  {
    id: 'builtin_vhs94', builtin: true, name: 'VHS 1994 — домашняя кассета',
    description: 'Бытовая камера на VHS-C: мягкое изображение, растекание цвета, трекинг, зелёные полосы, ручная съёмка.',
    osd: 'vhs',
    params: { ...base() },
    tracks: { drone: { on: true, vol: 0.75 }, hiss: { on: true, vol: 0.55 }, radio: { on: true, vol: 0.35 }, clicks: { on: true, vol: 0.5 }, digital: { on: true, vol: 0.6 }, stingers: { on: true, vol: 0.8 } },
  },
  {
    id: 'builtin_archive', builtin: true, name: 'Ведомственный архив (плёнка → телекино)',
    description: 'Псевдодокументальный архив: выцветшие цвета, сильное зерно, мерцание, редкие, но жёсткие сбои.',
    osd: 'archive',
    params: { ...base(), grain: 0.75, scanlines: 0.15, softness: 0.35, saturation: 0.25, contrast: 0.65, warmth: 0.62, lift: 0.4, shake: 0.3, flicker: 0.6, glitchDensity: 0.35, greenBands: 0.2, blocks: 0.05, tracking: 0.25, dropouts: 0.55, exposureHunt: 0.2 },
    tracks: { drone: { on: true, vol: 0.85 }, hiss: { on: true, vol: 0.6 }, radio: { on: true, vol: 0.2 }, clicks: { on: true, vol: 0.65 }, digital: { on: true, vol: 0.4 }, stingers: { on: true, vol: 0.8 } },
  },
  {
    id: 'builtin_cctv', builtin: true, name: 'Камера наблюдения',
    description: 'Статичная камера с цифровым зумом, холодно-зелёная гамма, макроблоки и пропуски кадров.',
    osd: 'cctv',
    params: { ...base(), shake: 0.08, parallax: 0.25, moveStrength: 0.3, saturation: 0.1, greenTint: 0.45, contrast: 0.6, softness: 0.25, blocks: 0.65, rgbGlitch: 0.3, tracking: 0.15, greenBands: 0.3, tears: 0.35, dropouts: 0.55, focusBreath: 0.05, exposureHunt: 0.2, grain: 0.55, chromaBleed: 0.15 },
    tracks: { drone: { on: true, vol: 0.6 }, hiss: { on: true, vol: 0.35 }, radio: { on: false, vol: 0.3 }, clicks: { on: true, vol: 0.55 }, digital: { on: true, vol: 0.75 }, stingers: { on: true, vol: 0.7 } },
  },
  {
    id: 'builtin_dream', builtin: true, name: 'Dreamcore / лиминал',
    description: 'Мягкий свет, пастельная выцветшая гамма, медленные плывущие движения, редкие тихие сбои.',
    osd: 'none',
    params: { ...base(), softness: 0.6, saturation: 0.45, warmth: 0.58, lift: 0.45, contrast: 0.4, shake: 0.25, parallax: 0.7, moveStrength: 0.45, focusBreath: 0.55, glitchDensity: 0.28, greenBands: 0.25, tears: 0.25, rgbGlitch: 0.35, dropouts: 0.3, blocks: 0.05, tracking: 0.3, grain: 0.4, vignette: 0.55 },
    tracks: { drone: { on: true, vol: 0.9 }, hiss: { on: true, vol: 0.35 }, radio: { on: true, vol: 0.25 }, clicks: { on: false, vol: 0.3 }, digital: { on: true, vol: 0.4 }, stingers: { on: true, vol: 0.6 } },
  },
  {
    id: 'builtin_evidence', builtin: true, name: 'Вещдок: цифровая камера 2000-х',
    description: 'Ранняя цифровая камера: резкая картинка, агрессивное дрожание, блоки сжатия, RGB-сбои.',
    osd: 'vhs',
    params: { ...base(), softness: 0.2, chromaBleed: 0.2, scanlines: 0.15, saturation: 0.5, shake: 0.75, moveStrength: 0.7, blocks: 0.6, rgbGlitch: 0.7, tears: 0.55, greenBands: 0.35, tracking: 0.15, glitchDensity: 0.6, exposureHunt: 0.65, focusBreath: 0.55 },
    tracks: { drone: { on: true, vol: 0.7 }, hiss: { on: true, vol: 0.35 }, radio: { on: true, vol: 0.3 }, clicks: { on: true, vol: 0.55 }, digital: { on: true, vol: 0.8 }, stingers: { on: true, vol: 0.85 } },
  },
];

export function templateById(id, user = []) {
  return BUILTIN_TEMPLATES.find(t => t.id === id) || user.find(t => t.id === id) || BUILTIN_TEMPLATES[0];
}

export function editFromTemplate(t) {
  return {
    templateId: t.id,
    osd: t.osd,
    params: JSON.parse(JSON.stringify(t.params)),
    tracks: JSON.parse(JSON.stringify(t.tracks)),
    seed: Math.floor(Math.random() * 1e9),
    masterVol: 0.9,
  };
}
