// Платформенный адаптер. Приложение — обычный статический сайт и работает на любом
// HTTPS-хостинге. Если страница открыта внутри среды, которая предоставляет дополнительные
// возможности (например, опубликованная страница claude.ai), они подключаются автоматически:
//  • downloads — сохранение файлов через окно подтверждения среды;
//  • sample — генерация текста языковой моделью (идеи и раскадровки уровня ИИ).
// Вне такой среды используются обычное скачивание и «мост с ChatGPT».

let caps = { downloads: null, sample: null, assets: null, ready: false };
const ALLOWED_EXT = ['mp4', 'webm', 'json', 'txt', 'png', 'jpg', 'jpeg', 'webp'];

export async function initPlatform() {
  if (!window.claude || typeof window.claude.use !== 'function') { caps.ready = true; return caps; }
  const safe = async n => { try { return await window.claude.use(n); } catch (e) { return null; } };
  const [d, s, a] = await Promise.all([safe('downloads'), safe('sample'), safe('assets')]);
  caps = { downloads: d, sample: s, assets: a, ready: true };
  return caps;
}
export function platform() { return caps; }
export function hasAI() { return !!caps.sample; }

// Можно ли сохранить файл с таким расширением в текущей среде
export function canSaveExt(ext) { return !caps.downloads || ALLOWED_EXT.includes(ext.toLowerCase()); }

export async function saveFile(blob, filename) {
  if (caps.downloads) {
    try { await caps.downloads.save({ filename, data: blob }); return true; }
    catch (e) {
      if (e?.code === 'declined') return false;
      if (e?.code !== 'unavailable' && e?.code !== 'not_granted') throw new Error(e?.message || e?.code || 'Не удалось сохранить файл');
    }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  return true;
}

// Запрос к языковой модели среды. Возвращает текст ответа.
export async function askAI(prompt, { onText, signal } = {}) {
  if (!caps.sample) throw new Error('ИИ-генерация недоступна в этой среде');
  try {
    const r = await caps.sample(prompt, { onText, signal, modelTier: 'default', cache: false });
    return r.text;
  } catch (e) {
    const map = { not_granted: 'Доступ к ИИ не разрешён в этой странице.', rate_limited: 'Слишком много запросов — подождите минуту.', cancelled: 'Отменено.' };
    throw new Error(map[e?.code] || e?.message || 'Ошибка ИИ-генерации');
  }
}

// «Входящие» изображения: картинки, которые Claude положил в хранилище страницы
// (например, присланные в чат с телефона, где выбор файлов не работает).
export function hasInbox() { return !!caps.assets; }
export async function listInbox() {
  if (!caps.assets) return [];
  try {
    const r = await caps.assets.list();
    return (r.assets || []).filter(a => /^image\//.test(a.contentType)).sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt)));
  } catch (e) { return []; }
}
export async function fetchInbox(a, i) {
  const res = await fetch(a.url);
  if (!res.ok) throw new Error('не удалось получить картинку (' + res.status + ')');
  const blob = await res.blob();
  const ext = (a.contentType.split('/')[1] || 'png').replace('jpeg', 'jpg');
  return new File([blob], `из_чата_${String(i + 1).padStart(2, '0')}.${ext}`, { type: a.contentType });
}
