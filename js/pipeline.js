// Конвейер проекта: создание, распределение изображений, анализ, сборка монтажа и звука.

import { uid, saveImage, getImage, saveProject, snapshot } from './store.js';
import { analyzeImage } from './analyze.js';
import { buildEDL } from './engine/timeline.js';
import { synthesizeTracks, mixTracks } from './engine/audio.js';
import { BUILTIN_TEMPLATES, templateById, editFromTemplate } from './templates.js';
import { FORMATS } from './content.js';

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
export async function addImages(project, files, { targetShotId = null, onProgress } = {}) {
  const shots = project.storyboard?.shots || [];
  const report = [];
  const list = [...files].filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name));
  list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  let k = 0;
  for (const f of list) {
    onProgress?.(k++, list.length, f.name);
    const imageId = await saveImage(f, { name: f.name });
    const analysis = await getAnalysis(imageId);
    const entry = { imageId, name: f.name, addedAt: Date.now() };
    let target = null;
    if (targetShotId) target = shots.find(s => s.id === targetShotId);
    if (!target) { const n = numberFromName(f.name); if (n) target = shots.find(s => s.n === n); }
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
  return report;
}

export async function collectAnalyses(project) {
  const map = {};
  for (const sh of project.storyboard?.shots || []) for (const im of sh.images || []) map[im.imageId] = await getAnalysis(im.imageId);
  return map;
}

export async function getBlob(imageId) { const r = await getImage(imageId); return r?.blob; }

// Сборка: EDL + синтез дорожек + сведение
export async function buildEdit(project, settings) {
  const analyses = await collectAnalyses(project);
  if (project.bible?.osdDate) project.edit.osdDate = project.bible.osdDate;
  const edl = buildEDL(project, analyses, settings);
  edl.era = project.bible?.osdDate || null;
  const synth = synthesizeTracks(edl);
  const mix = mixTracks(synth, project.edit.tracks, project.edit.masterVol ?? 0.9);
  return { edl, synth, mix, analyses };
}

export { BUILTIN_TEMPLATES };
