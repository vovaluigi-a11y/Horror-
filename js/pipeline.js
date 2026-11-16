// Конвейер проекта: создание, распределение изображений, анализ, сборка монтажа и звука.

import { uid, saveImage, getImage, saveProject, snapshot } from './store.js';
import { analyzeImage, loadBitmap } from './analyze.js';
import { buildEDL } from './engine/timeline.js';
import { synthesizeTracks, mixTracks } from './engine/audio.js';
import { BUILTIN_TEMPLATES, templateById, editFromTemplate } from './templates.js';
import { FORMATS, LOCATIONS } from './content.js';
import { TRACKS } from './templates.js';

export function newProject(settings, title = 'Новый проект') {
  const t = templateById(settings.defaultTemplate);
  return {
    id: uid('prj'), title, createdAt: Date.now(), updatedAt: Date.now(),
    status: 'idea', mode: settings.mode,
    ideas: [], idea: null, ideaApproved: false,
    bible: null, script: '', storyboard: null,
    edit: editFromTemplate(t), unassigned: [], renders: [], versions: [], qc: null,
  };
}

export function applyIdea(project, idea) {
  project.idea = idea;
  project.title = idea.title;
  // стиль монтажа по формату записи
  const f = FORMATS.find(x => x.id === idea.parts?.format);
  if (f) {
    const t = templateById(f.template);
    const keepSeed = project.edit?.seed;
    project.edit = editFromTemplate(t);
    if (keepSeed) project.edit.seed = keepSeed;
  }
}

// Номер кадра из имени файла: shot_03.png, кадр-3.jpg, 03.webp, frame 3 ...
function numberFromName(name) {
  const m = name.match(/(?:shot|кадр|frame|scene|сцена|img|image)?[\s_\-]*0*(\d{1,2})(?!\d)/i);
  return m ? parseInt(m[1], 10) : null;
}

const analysisCache = new Map();
export async function getAnalysis(imageId) {
  if (analysisCache.has(imageId)) return analysisCache.get(imageId);
  const rec = await getImage(imageId);
  if (!rec) return null;
  if (rec.analysis) { analysisCache.set(imageId, rec.analysis); return rec.analysis; }
  const a = await analyzeImage(rec.blob);
  rec.analysis = a;
  const { db } = await import('./store.js');
  await db.put('images', rec);
  analysisCache.set(imageId, a);
  return a;
}

// Добавить файлы: распределение по кадрам (по номеру в имени, иначе — по порядку в свободные кадры)
// Проверка, что браузер действительно может прочитать файл как изображение
async function canDecode(file) {
  try { const b = await loadBitmap(file); const ok = b.width > 0 && b.height > 0; b.close?.(); return ok; }
  catch (e) { return false; }
}
function rejectReason(f) {
  if (/\.(heic|heif)$/i.test(f.name) || /hei[cf]/i.test(f.type)) return 'формат HEIC/HEIF (фото iPhone) этот браузер не читает — сохраните картинку как JPG или PNG';
  if (f.type && !/^image\//.test(f.type)) return `это не изображение (${f.type})`;
  if (!f.size) return 'пустой файл';
  return 'браузер не смог прочитать файл как изображение — сохраните его как JPG или PNG';
}

// Добавить файлы: распределение по кадрам (по номеру в имени, иначе — по порядку в свободные кадры).
// Каждый файл проверяется отдельно: ошибка одного файла не останавливает остальные.
export async function addImages(project, files, { targetShotId = null, onProgress } = {}) {
  const shots = project.storyboard?.shots || [];
  const report = [], rejected = [];
  const list = [...files];
  list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  let k = 0;
  for (const f of list) {
    onProgress?.(k++, list.length, f.name);
    if (!(await canDecode(f))) { rejected.push({ name: f.name, reason: rejectReason(f) }); continue; }
    let imageId, analysis = null;
    try {
      imageId = await saveImage(f, { name: f.name || 'image' });
    } catch (e) { rejected.push({ name: f.name, reason: 'не удалось сохранить в хранилище браузера (' + (e.message || e) + ')' }); continue; }
    try { analysis = await getAnalysis(imageId); } catch (e) { console.warn('analysis failed', e); }
    const entry = { imageId, name: f.name || 'image', addedAt: Date.now() };
    let target = null;
    if (targetShotId) target = shots.find(s => s.id === targetShotId);
    if (!target) { const n = numberFromName(f.name || ''); if (n) target = shots.find(s => s.n === n) || null; }
    if (!target) target = shots.find(s => !(s.images || []).length);
    if (target) {
      target.images = target.images || [];
      target.images.push(entry);
      target.activeImage = target.images.length - 1;
      report.push({ name: f.name, shot: target.n, issues: analysis?.issues || [] });
    } else {
      project.unassigned = project.unassigned || [];
      project.unassigned.push(entry);
      report.push({ name: f.name, shot: null, issues: analysis?.issues || [] });
    }
  }
  report.rejected = rejected;
  return report;
}

export async function collectAnalyses(project) {
  const map = {};
  for (const sh of project.storyboard?.shots || []) for (const im of sh.images || []) map[im.imageId] = await getAnalysis(im.imageId);
  return map;
}

export async function getBlob(imageId) { const r = await getImage(imageId); return r?.blob; }

// Текст титра «откуда эта запись» по идее и библии проекта
export function defaultTitleLines(project) {
  const idea = project.idea || {};
  const parts = idea.parts || {};
  const d = project.bible?.osdDate || { y: 1996, m: 10, d: 14, h: 2, min: 13 };
  const p2 = n => String(n).padStart(2, '0');
  // устойчивый «номер объекта» из названия проекта
  let h = 0; for (const ch of (idea.title || project.title || 'x')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const num = 3 + (h % 47);
  const loc = LOCATIONS.find(l => l.id === parts.location);
  let place = loc ? loc.name : (parts.location && typeof parts.location === 'string' ? parts.location : '');
  place = place ? place.toUpperCase() + (/\d/.test(place) ? '' : ` №${num}`) : `АРХИВНАЯ ЗАПИСЬ №${num}`;
  const fmt = FORMATS.find(f => f.id === parts.format);
  const lines = [place, `${p2(d.d)}.${p2(d.m)}.${d.y}  ${p2(d.h)}:${p2(d.min)}`];
  if (fmt) {
    lines.push('ИСТОЧНИК: ' + fmt.name.toLowerCase());
  } else if (parts.format && typeof parts.format === 'string') {
    lines.push('ИСТОЧНИК: ' + parts.format);
  } else {
    lines.push('ИСТОЧНИК НЕ УСТАНОВЛЕН');
  }
  return lines;
}

// Значения по умолчанию для новых возможностей монтажа (и для старых проектов)
export function ensureEditDefaults(project) {
  const e = project.edit;
  for (const t of TRACKS) if (!e.tracks[t.id]) e.tracks[t.id] = { on: true, vol: t.id === 'keys' ? 0.75 : 0.6 };
  if (!e.title) e.title = { on: true, lines: defaultTitleLines(project), auto: true };
  else if (e.title.auto && ((project.idea && e.title.forIdea !== project.idea.id) || (e.title.lines || []).length > 3)) { e.title.lines = defaultTitleLines(project); }
  if (project.idea) e.title.forIdea = project.idea.id;
  if (!e.screamer) e.screamer = { on: true, shotId: 'auto' };
  if (!e.editLog) e.editLog = [];
}

// Сборка: EDL + синтез дорожек + сведение
export async function buildEdit(project, settings) {
  ensureEditDefaults(project);
  const analyses = await collectAnalyses(project);
  if (project.bible?.osdDate) project.edit.osdDate = project.bible.osdDate;
  const edl = buildEDL(project, analyses, settings);
  edl.era = project.bible?.osdDate || null;
  const synth = synthesizeTracks(edl);
  const mix = mixTracks(synth, project.edit.tracks, project.edit.masterVol ?? 0.9);
  return { edl, synth, mix, analyses };
}

export { BUILTIN_TEMPLATES };
