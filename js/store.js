// HORROR STUDIO — хранилище проектов (IndexedDB).
// Всё хранится локально в браузере: проекты, изображения (Blob), видео (Blob),
// шаблоны монтажа и история идей. Резервная копия — экспорт в файл .hsproj.

const DB_NAME = 'horror-studio';
const DB_VERSION = 1;
const STORES = ['projects', 'images', 'videos', 'templates', 'ideas', 'meta'];

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Транзакция прервана'));
  });
}

function reqP(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

export const db = {
  async put(store, obj) { return tx(store, 'readwrite', s => reqP(s.put(obj))); },
  async get(store, id) { return tx(store, 'readonly', s => reqP(s.get(id))); },
  async del(store, id) { return tx(store, 'readwrite', s => reqP(s.delete(id))); },
  async all(store) { return tx(store, 'readonly', s => reqP(s.getAll())); },
};

export function uid(prefix = 'id') {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = await navigator.storage.persisted();
      if (already) return true;
      return await navigator.storage.persist();
    }
  } catch (e) { /* ignore */ }
  return false;
}

export async function storageEstimate() {
  try { if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate(); } catch (e) {}
  return null;
}

// ---------- Проекты ----------
export async function saveProject(p) {
  p.updatedAt = Date.now();
  await db.put('projects', JSON.parse(JSON.stringify(p)));
  return p;
}
export async function loadProject(id) { return db.get('projects', id); }
export async function listProjects() {
  const all = await db.all('projects');
  return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
export async function deleteProject(id) {
  const p = await loadProject(id);
  if (p) {
    for (const sh of (p.storyboard?.shots || [])) for (const v of (sh.images || [])) await db.del('images', v.imageId).catch(() => {});
    for (const v of (p.renders || [])) await db.del('videos', v.videoId).catch(() => {});
    for (const im of (p.unassigned || [])) await db.del('images', im.imageId).catch(() => {});
  }
  await db.del('projects', id);
}

// Снимок версии (история изменений проекта)
export function snapshot(p, label) {
  p.versions = p.versions || [];
  const copy = JSON.parse(JSON.stringify({ idea: p.idea, storyboard: p.storyboard, edit: p.edit, bible: p.bible }));
  p.versions.unshift({ id: uid('v'), at: Date.now(), label, data: copy });
  if (p.versions.length > 40) p.versions.length = 40;
}

// ---------- Изображения ----------
export async function saveImage(blob, meta = {}) {
  const id = uid('img');
  await db.put('images', { id, blob, type: blob.type, createdAt: Date.now(), ...meta });
  return id;
}
export async function getImage(id) { return db.get('images', id); }

const urlCache = new Map();
export async function imageURL(id) {
  if (!id) return null;
  if (urlCache.has(id)) return urlCache.get(id);
  const rec = await getImage(id);
  if (!rec) return null;
  const url = URL.createObjectURL(rec.blob);
  urlCache.set(id, url);
  return url;
}

// ---------- Видео ----------
export async function saveVideo(blob, meta = {}) {
  const id = uid('vid');
  await db.put('videos', { id, blob, type: blob.type, createdAt: Date.now(), ...meta });
  return id;
}
export async function getVideo(id) { return db.get('videos', id); }

// ---------- Шаблоны ----------
export async function listTemplates() { return (await db.all('templates')).sort((a, b) => b.createdAt - a.createdAt); }
export async function saveTemplate(t) { t.id = t.id || uid('tpl'); t.createdAt = t.createdAt || Date.now(); await db.put('templates', t); return t; }
export async function deleteTemplate(id) { return db.del('templates', id); }

// ---------- История идей ----------
export async function listIdeaHistory() { return (await db.all('ideas')).sort((a, b) => b.createdAt - a.createdAt); }
export async function saveIdeaRecord(rec) { rec.id = rec.id || uid('idea'); rec.createdAt = rec.createdAt || Date.now(); await db.put('ideas', rec); return rec; }
export async function deleteIdeaRecord(id) { return db.del('ideas', id); }

// ---------- Настройки ----------
export async function getSettings() {
  const s = await db.get('meta', 'settings');
  const v = s ? { ...s.value } : {};
  // переход на короткий формат: максимум 25 с (старые настройки 30–45 с заменяются один раз)
  if (!v.dur25) { const d = defaultSettings(); v.minDuration = d.minDuration; v.maxDuration = d.maxDuration; v.targetDuration = d.targetDuration; v.dur25 = true; }
  return Object.assign(defaultSettings(), v);
}
export async function saveSettings(value) { await db.put('meta', { id: 'settings', value }); }
export function defaultSettings() {
  return {
    mode: 'director',          // auto | director | manual
    width: 1080, height: 1920, fps: 30,
    minDuration: 18, maxDuration: 25, targetDuration: 24, dur25: true,
    videoBitrate: 10_000_000, audioBitrate: 192_000,
    defaultTemplate: 'builtin_vhs94',
    styles: ['analog', 'found', 'vhs'],
    osd: true,
    previewScale: 0.5,
  };
}

// ---------- Резервная копия проекта ----------
async function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}
async function dataURLToBlob(url) { return (await fetch(url)).blob(); }

export async function exportProjectFile(p) {
  const images = {};
  const ids = new Set();
  for (const sh of (p.storyboard?.shots || [])) for (const v of (sh.images || [])) ids.add(v.imageId);
  for (const im of (p.unassigned || [])) ids.add(im.imageId);
  for (const id of ids) { const rec = await getImage(id); if (rec) images[id] = { type: rec.type, data: await blobToDataURL(rec.blob), name: rec.name || '' }; }
  const out = { format: 'horror-studio-project', version: 1, exportedAt: Date.now(), project: p, images };
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}

export async function importProjectFile(file) {
  const data = JSON.parse(await file.text());
  if (data.format !== 'horror-studio-project') throw new Error('Это не файл проекта HORROR STUDIO');
  const p = data.project;
  for (const [id, im] of Object.entries(data.images || {})) {
    const blob = await dataURLToBlob(im.data);
    await db.put('images', { id, blob, type: im.type, name: im.name, createdAt: Date.now() });
  }
  p.renders = []; // видео в резервную копию не входят
  p.id = p.id || uid('prj');
  await saveProject(p);
  return p;
}
