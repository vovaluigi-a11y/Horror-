// HORROR STUDIO — интерфейс.
import * as store from './store.js';
import { newProject, applyIdea, addImages, buildEdit, getBlob, collectAnalyses, getAnalysis, ensureEditDefaults, defaultTitleLines } from './pipeline.js';
import { isReady, describeState, aiEditPrompt, parseEditsLocal, applyOps } from './edits.js';
import { extractJSON } from './bridge.js';
import { generateIdeas, reworkIdea, generateStoryboard, recomputePrompts, buildPrompt, BEAT_NAMES, storyboardFromImages } from './ideas.js';
import { ideasRequest, storyboardRequest, imageRequest, allImagesRequest, parseIdeas, parseStoryboard } from './bridge.js';
import { BUILTIN_TEMPLATES, PARAM_DEFS, TRACKS, templateById, editFromTemplate } from './templates.js';
import { MOVES, TRANSITIONS, GLITCHES, buildEDL } from './engine/timeline.js';
import { Renderer } from './engine/renderer.js';
import { synthesizeTracks, mixTracks, toAudioBuffer, encodeWAV, SR } from './engine/audio.js';
import { exportVideo, detectCapabilities, describeCapabilities, verifyVideoFile } from './engine/export.js';
import { runQC, applyFix } from './qc.js';
import { describeAnalysis } from './analyze.js';
import { makeTestPlates } from './testplates.js';
import { initPlatform, saveFile, canSaveExt, hasAI, askAI, hasInbox, listInbox, fetchInbox } from './platform.js';

// ---------- состояние ----------
const app = {
  view: 'home', settings: null, project: null, projects: [], history: [], userTemplates: [], caps: null,
  build: null, building: null, renderer: null, player: { playing: false, t: 0, ctx: null, src: null, start: 0 },
  exportJob: null, montageTab: 'effects', autopilot: false,
};
window.HS = app; // для отладки и автотестов

const VIEWS = [
  ['home', 'Главная'], ['ideas', 'Генератор идей'], ['script', 'Сценарная'], ['gallery', 'Галерея'],
  ['montage', 'Монтажная'], ['qc', 'Контроль качества'], ['archive', 'Архив'], ['settings', 'Настройки'],
];
const MODES = { auto: 'Авто', director: 'Режиссёр', manual: 'Ручной' };
const MODE_HINT = {
  auto: 'Автоматический: система сама выбирает идею, утверждает раскадровку, монтирует, исправляет ошибки и экспортирует. От вас — только изображения.',
  director: 'Режиссёрский: система предлагает, вы подтверждаете ключевые решения (идея, раскадровка, финальный экспорт).',
  manual: 'Ручной: доступны все настройки каждого кадра — движение камеры, переход, интенсивность эффектов.',
};

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtT = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const fmtDate = t => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function toast(msg, ms = 3500) {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg;
  box.appendChild(d); while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => d.remove(), ms);
}
function modal(html, onMount) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener('mousedown', e => { if (e.target === bg) close(); });
  bg.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  onMount?.(bg, close);
  return close;
}
function confirmBox(text, okLabel = 'Подтвердить') {
  return new Promise(res => {
    modal(`<h3>Подтверждение</h3><p>${text}</p><div class="row" style="justify-content:flex-end"><button class="btn" data-no>Отмена</button><button class="btn primary" data-yes>${esc(okLabel)}</button></div>`, (bg, close) => {
      bg.querySelector('[data-no]').onclick = () => { close(); res(false); };
      bg.querySelector('[data-yes]').onclick = () => { close(); res(true); };
    });
  });
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('Скопировано в буфер обмена'); }
  catch (e) {
    modal(`<h3>Скопируйте текст вручную</h3><textarea style="min-height:300px">${esc(t)}</textarea><div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" data-close>Закрыть</button></div>`, bg => { const ta = bg.querySelector('textarea'); ta.focus(); ta.select(); });
  }
}
async function download(blob, name) {
  try { const ok = await saveFile(blob, name); if (!ok) toast('Сохранение отменено'); }
  catch (e) { toast('Не удалось сохранить: ' + e.message, 6000); }
}
const safeName = s => (s || 'horror').replace(/[^\p{L}\p{N}\-_ ]+/gu, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'horror';

async function save() { if (app.project) { await store.saveProject(app.project); } }
function invalidateBuild() { app.build = null; }

// ---------- навигация ----------
function renderNav() {
  $('#nav').innerHTML = VIEWS.map(([id, name], i) => `<button data-v="${id}" class="${app.view === id ? 'on' : ''}"><span class="num">${i + 1}</span>${name}</button>`).join('');
  $('#nav').querySelectorAll('button').forEach(b => b.onclick = () => go(b.dataset.v));
  const p = app.project;
  $('#sideFoot').innerHTML = `<span class="small">Проект</span><span class="cur">${p ? esc(p.title) : '—'}</span>
    <div class="modes">${Object.entries(MODES).map(([k, v]) => `<button data-m="${k}" class="${app.settings.mode === k ? 'on' : ''}" title="${esc(MODE_HINT[k])}">${v}</button>`).join('')}</div>`;
  $('#sideFoot').querySelectorAll('[data-m]').forEach(b => b.onclick = async () => {
    app.settings.mode = b.dataset.m; await store.saveSettings(app.settings);
    if (app.project) { app.project.mode = b.dataset.m; await save(); }
    toast(MODE_HINT[b.dataset.m], 5000); render();
  });
}
function go(v) {
  if (app.view === 'montage' && v !== 'montage') stopPlayback();
  app.view = v; render(); $('#main').scrollTop = 0;
}
function render() {
  renderNav();
  const fn = { home: viewHome, ideas: viewIdeas, script: viewScript, gallery: viewGallery, montage: viewMontage, qc: viewQC, archive: viewArchive, settings: viewSettings }[app.view];
  fn();
}
function needProject(title) {
  if (app.project) return false;
  $('#main').innerHTML = `<div class="page"><div class="page-head"><div><h1>${title}</h1></div></div><div class="card empty"><p>Нет открытого проекта.</p><button class="btn primary" id="np">Новый проект</button></div></div>`;
  $('#np').onclick = startNewProject;
  return true;
}

function progressSteps(p) {
  const shots = p?.storyboard?.shots || [];
  const withImg = shots.filter(s => (s.images || []).length).length;
  return [
    { k: 'ideas', name: 'Идея', done: !!p?.ideaApproved, txt: p?.idea ? esc(p.idea.title) : 'не выбрана' },
    { k: 'script', name: 'Раскадровка', done: !!p?.storyboard?.approved, txt: shots.length ? `${shots.length} кадров${p.storyboard.approved ? ', утверждена' : ''}` : '—' },
    { k: 'gallery', name: 'Изображения', done: shots.length > 0 && withImg === shots.length, txt: shots.length ? `${withImg} из ${shots.length}` : '—' },
    { k: 'montage', name: 'Монтаж', done: !!p?.edit?.approved, txt: p?.edit?.approved ? 'одобрен' : 'черновик' },
    { k: 'qc', name: 'Проверка', done: !!p?.qc && !p.qc.fails, txt: p?.qc ? p.qc.summary : 'не запускалась' },
    { k: 'archive', name: 'MP4', done: (p?.renders || []).length > 0, txt: (p?.renders || []).length ? `${p.renders.length} версий` : 'нет' },
  ];
}
function stepsHTML(p) {
  const st = progressSteps(p);
  const cur = st.findIndex(s => !s.done);
  return `<div class="steps">${st.map((s, i) => `<div class="step ${s.done ? 'done' : i === cur ? 'cur' : ''}" data-go="${s.k}" style="cursor:pointer"><b>${s.done ? '✓ ' : ''}${s.name}</b><span class="muted">${s.txt}</span></div>`).join('')}</div>`;
}
function bindGo(root = document) { root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go)); }

// ---------- проекты ----------
async function openProject(id) {
  const p = await store.loadProject(id);
  if (!p) return toast('Проект не найден');
  app.project = p; invalidateBuild(); stopPlayback();
  if (app.renderer) { app.renderer.dispose(); }
  const st = progressSteps(p); const cur = st.find(s => !s.done);
  go(cur ? cur.k : 'archive');
}
async function startNewProject() {
  const p = newProject(app.settings);
  app.project = p; invalidateBuild();
  await save();
  app.projects = await store.listProjects();
  if (app.settings.mode === 'auto') return autopilot();
  app.view = 'ideas'; render();
  doGenerateIdeas();
}

// ---------- выбор файлов (общий) ----------
// Открыть окно выбора файлов; если оно не появилось за 2 с — показать, как обойти.
function openPicker(inp, helpEl) {
  inp.value = '';
  let opened = false;
  const mark = () => { opened = true; };
  window.addEventListener('blur', mark, { once: true });
  document.addEventListener('visibilitychange', mark, { once: true });
  inp.addEventListener('change', mark, { once: true });
  inp.addEventListener('cancel', mark, { once: true });
  inp.click();
  setTimeout(() => {
    if (opened || document.hidden || !helpEl || !helpEl.isConnected) return;
    helpEl.innerHTML = `<div class="notice warn small" style="text-align:left"><b>Окно выбора файлов не открылось.</b> Похоже, студия открыта во встроенном окне приложения, которое не разрешает выбирать файлы. Откройте студию в браузере Chrome — или пришлите картинки в чат Claude и попросите положить их в студию (затем Галерея → «Забрать в кадры»).</div>`;
  }, 2000);
}

// Проект сразу из своих картинок: без идеи и раскадровки — сразу в монтаж
async function quickProjectFromFiles(files) {
  const list = [...(files || [])];
  if (!list.length) return toast('Файлы не выбраны');
  const p = newProject(app.settings, 'Мой ролик ' + new Date().toLocaleDateString('ru-RU'));
  p.idea = { id: store.uid('i'), title: p.title, logline: 'Ролик собран из ваших изображений.', visual: '', detail: '', ending: '', score: 0, reason: '', parts: {}, source: 'Свои изображения' };
  p.ideaApproved = true;
  p.storyboard = storyboardFromImages(Math.min(12, list.length), app.settings);
  p.bible = { location: '', character: '', keyObject: '', era: '1996', camera: 'бытовая VHS-камера', palette: '', rules: '', osdDate: { y: 1996, m: 10, d: 14, h: 2, min: 13, s: 7 } };
  p.script = 'Ролик из ваших изображений (' + list.length + ' шт.).';
  toast(`Получено файлов: ${list.length}. Анализирую…`);
  const rep = await addImages(p, list.slice(0, 12));
  const rej = rep.rejected || [];
  p.storyboard.shots = p.storyboard.shots.filter(s => (s.images || []).length);
  p.storyboard.shots.forEach((s, i) => s.n = i + 1);
  if (!p.storyboard.shots.length) {
    toast('Ни одно изображение не удалось прочитать. ' + (rej[0] ? rej[0].reason : ''), 9000);
    return;
  }
  app.project = p; invalidateBuild(); await save();
  app.uploadNote = `<div class="notice ok small">Создан проект из ${p.storyboard.shots.length} изображений. Порядок кадров — по именам файлов; его можно поменять в Сценарной (стрелки ↑↓).</div>` + (rej.length ? `<div class="notice bad small">Не загружено: ${rej.map(r => esc(r.name) + ': ' + esc(r.reason)).join('<br>')}</div>` : '');
  if (list.length > 12) toast('Взяты первые 12 изображений — это максимум для ролика 30–45 с', 6000);
  go('gallery');
}
function quickUploadHTML(id) {
  return `<button class="btn big" id="${id}Btn" type="button">📁 Смонтировать из своих картинок</button><input type="file" accept="image/*" multiple class="file-in" id="${id}In" tabindex="-1" aria-hidden="true">`;
}
function bindQuickUpload(id, helpSel) {
  const b = $('#' + id + 'Btn'), inp = $('#' + id + 'In'); if (!b) return;
  b.onclick = () => openPicker(inp, $(helpSel));
  inp.onchange = e => quickProjectFromFiles(e.target.files);
}

// ---------- ГЛАВНАЯ ----------
async function viewHome() {
  app.projects = await store.listProjects();
  const est = await store.storageEstimate();
  const caps = app.caps;
  const capLines = caps ? describeCapabilities(caps) : [];
  const active = app.projects.filter(p => !(p.renders || []).length);
  const done = app.projects.filter(p => (p.renders || []).length);
  $('#main').innerHTML = `<div class="page">
    <div class="hero">
      <div><h1>Новый ролик — от идеи до MP4</h1>
        <p class="muted">Система придумает сюжет, разложит его на кадры, подготовит промпты для изображений, смонтирует документальную запись с VHS-повреждениями и синхронным звуком, проверит и выдаст MP4 1080×1920.</p>
        <div class="row" style="margin-top:14px"><button class="btn primary big" id="newP">＋ Новый проект</button>
        <button class="btn big" id="autoP" title="${esc(MODE_HINT.auto)}">⚡ Автопилот</button>
        ${quickUploadHTML('quick')}
        ${app.project ? `<button class="btn big ghost" id="contP">Продолжить «${esc(app.project.title)}»</button>` : ''}</div>
        <div id="quickHelp"></div>
        <p class="small muted" style="margin-top:10px">Уже есть готовые картинки? «Смонтировать из своих картинок» — выберите их, и студия сразу соберёт монтаж, без идей и раскадровки.</p>
        <p class="small dim" style="margin-top:6px">Режим: <b>${MODES[app.settings.mode]}</b> — ${esc(MODE_HINT[app.settings.mode])}</p>
      </div>
    </div>
    ${app.project ? `<div class="card" style="margin-top:16px"><h3>Текущий проект: ${esc(app.project.title)}</h3>${stepsHTML(app.project)}</div>` : ''}
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Проекты в работе (${active.length})</h3>${active.length ? active.map(projRow).join('') : '<p class="muted">Пока нет.</p>'}</div>
      <div class="card"><h3>Готовые ролики (${done.length})</h3>${done.length ? done.map(projRow).join('') : '<p class="muted">Пока нет.</p>'}</div>
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Что реально умеет этот браузер</h3>${capLines.map(l => `<div class="status-${l.level === 'info' ? 'info' : l.level}" style="margin:4px 0">${l.level === 'ok' ? '✓' : l.level === 'bad' ? '✕' : '!'} <span style="color:var(--text)">${esc(l.text)}</span></div>`).join('') || '<p class="muted">Проверка…</p>'}</div>
      <div class="card"><h3>Хранилище</h3>
        <p class="muted small">Проекты, изображения и видео хранятся в этом браузере (IndexedDB). ${est ? `Занято ${(est.usage / 1e6).toFixed(0)} МБ из доступных ~${(est.quota / 1e9).toFixed(1)} ГБ.` : ''}</p>
        <p class="small">${app.persisted ? '<span class="status-ok">✓ Браузер подтвердил постоянное хранение — данные не будут удалены автоматически.</span>' : '<span class="status-warn">! Браузер может очистить данные при нехватке места.</span> Делайте резервные копии проектов (Архив → «Скачать проект»).'}</p>
        <div class="row"><button class="btn sm" id="persist">Запросить постоянное хранение</button><label class="btn sm">Импорт проекта<input type="file" accept=".hsproj,.json,application/json" id="imp" class="file-in"></label></div>
      </div>
    </div>
  </div>`;
  $('#newP').onclick = startNewProject;
  bindQuickUpload('quick', '#quickHelp');
  $('#autoP').onclick = async () => { app.settings.mode = 'auto'; await store.saveSettings(app.settings); startNewProject(); };
  if ($('#contP')) $('#contP').onclick = () => { const cur = progressSteps(app.project).find(s => !s.done); go(cur ? cur.k : 'archive'); };
  bindGo();
  bindProjRows();
  $('#persist').onclick = async () => { app.persisted = await store.requestPersistence(); toast(app.persisted ? 'Постоянное хранение включено' : 'Браузер отказал (обычно разрешает после нескольких посещений или установки как приложение)'); render(); };
  $('#imp').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const p = await store.importProjectFile(f); toast('Проект импортирован'); openProject(p.id); } catch (err) { toast('Ошибка импорта: ' + err.message); } };
}
function projRow(p) {
  const st = progressSteps(p); const n = st.filter(s => s.done).length;
  return `<div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)">
    <div style="min-width:0"><b>${esc(p.title)}</b><div class="small muted">${fmtDate(p.updatedAt)} · этапов ${n}/6</div></div>
    <div class="row"><button class="btn sm" data-open="${p.id}">Открыть</button><button class="btn sm ghost" data-del="${p.id}" title="Удалить">✕</button></div></div>`;
}
function bindProjRows() {
  document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openProject(b.dataset.open));
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!await confirmBox('Удалить проект со всеми изображениями и видео? Это действие необратимо.', 'Удалить')) return;
    await store.deleteProject(b.dataset.del);
    if (app.project?.id === b.dataset.del) app.project = null;
    render();
  });
}

// ---------- ГЕНЕРАТОР ИДЕЙ ----------
async function doGenerateIdeas() {
  app.history = await store.listIdeaHistory();
  const ideas = generateIdeas(10, app.history, Date.now());
  await setIdeas(ideas);
}
async function setIdeas(ideas) {
  const p = app.project;
  p.ideas = ideas;
  for (const i of ideas) await store.saveIdeaRecord({ idea: i, projectId: p.id, liked: false, id: 'h_' + i.id });
  app.history = await store.listIdeaHistory();
  await save(); render();
}
function ideaCard(i, rank, top) {
  const liked = app.history.find(h => h.id === 'h_' + i.id)?.liked;
  const sel = app.project.idea?.id === i.id;
  const crit = i.crit ? `<div class="bars">${[['Оригинальность', i.crit.originality], ['Атмосфера', i.crit.atmosphere], ['Визуальность', i.crit.visual], ['Удержание', i.crit.retention]].map(([n, v]) => `<span>${n}</span><div class="bar"><i style="width:${v * 10}%"></i></div><span class="mono">${v.toFixed(1)}</span>`).join('')}</div>` : '';
  return `<div class="card ${rank === 0 ? 'hl' : ''}" style="${sel ? 'outline:2px solid var(--ok)' : ''}">
    <div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:nowrap">
      <div style="min-width:0">${rank === 0 ? '<span class="tag red">Рекомендую</span> ' : top ? '<span class="tag">Топ-3</span> ' : ''}${sel ? '<span class="tag ok">Выбрана</span>' : ''}<h3 style="margin-top:6px">${esc(i.title)}</h3></div>
      <div class="score" title="Оценка">${i.score.toFixed(1)}</div></div>
    <p>${esc(i.logline)}</p>
    <dl class="kv"><dt>Главный образ</dt><dd>${esc(i.visual)}</dd><dt>Пугающая деталь</dt><dd>${esc(i.detail)}</dd><dt>Финал</dt><dd>${esc(i.ending)}</dd></dl>
    ${crit}<p class="small muted"><b>Почему ${i.score.toFixed(1)}:</b> ${esc(i.reason)}</p>
    <p class="small dim">${esc(i.source || '')}</p>
    <div class="row"><button class="btn primary sm" data-pick="${i.id}">Выбрать эту идею</button>
      <button class="btn sm ${liked ? 'on' : ''}" data-like="${i.id}">${liked ? '★ Нравится' : '☆ Нравится'}</button>
      <button class="btn sm" data-rework="${i.id}">↻ На переработку</button></div></div>`;
}
function viewIdeas() {
  if (needProject('Генератор идей')) return;
  const p = app.project;
  const ideas = p.ideas || [];
  const top = ideas.slice(0, 3), rest = ideas.slice(3);
  $('#main').innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Генератор идей</h1><p>10 сюжетов с оценкой по оригинальности, атмосфере, визуальности и удержанию. Три лучших — сверху, рекомендованный выделен. Понравившиеся элементы система учитывает в следующих генерациях, использованные — не повторяет.</p></div>
      <div class="row">${hasAI() ? '<button class="btn primary" id="genAI">✦ 10 идей от ИИ</button>' : ''}<button class="btn ${hasAI() ? '' : 'primary'}" id="gen">Сгенерировать 10 идей${hasAI() ? ' (встроенный)' : ''}</button><button class="btn" id="bridge">Идеи через ChatGPT…</button></div></div>
    <div id="aiBox"></div>
    <div class="notice small">Встроенный генератор работает без интернета и платных API: он комбинирует авторскую библиотеку из ${'14 форматов записи, 22 мест, 25 аномалий, 12 существ и 13 финалов'} и оценивает сочетания по правилам. Это не нейросеть. Если хотите идеи уровня языковой модели — ${hasAI() ? 'кнопка «10 идей от ИИ» (языковая модель доступна прямо в этой среде, без ключей и доплат) или ' : ''}кнопка «Идеи через ChatGPT»: скопируйте готовый запрос в ChatGPT и вставьте ответ обратно, приложение разберёт его само.</div>
    ${ideas.length ? `<h4 style="margin-top:20px">Лучшие три</h4><div class="grid g3">${top.map((i, k) => ideaCard(i, k, true)).join('')}</div>
      ${rest.length ? `<h4 style="margin-top:24px">Остальные идеи</h4><div class="grid g3">${rest.map(i => ideaCard(i, -1, false)).join('')}</div>` : ''}` : '<div class="card empty">Нажмите «Сгенерировать 10 идей».</div>'}
    <details style="margin-top:24px"><summary>История идей (${app.history.length}) — не будут повторены</summary>
      <div class="grid g2" style="margin-top:10px">${app.history.slice(0, 80).map(h => `<div class="card" style="padding:10px 12px"><div class="row" style="justify-content:space-between"><b>${esc(h.idea.title)}</b><span class="mono small">${h.idea.score?.toFixed?.(1) ?? ''} ${h.liked ? '★' : ''}</span></div><div class="small muted">${esc(h.idea.logline).slice(0, 180)}…</div><div class="row" style="margin-top:6px"><button class="btn sm" data-hpick="${h.id}">Использовать</button><button class="btn sm ghost" data-hdel="${h.id}">Удалить из истории</button></div></div>`).join('')}</div>
    </details></div>`;
  $('#gen').onclick = doGenerateIdeas;
  $('#bridge').onclick = bridgeIdeas;
  if ($('#genAI')) $('#genAI').onclick = () => aiIdeas();
  const find = id => ideas.find(i => i.id === id);
  document.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => pickIdea(find(b.dataset.pick)));
  document.querySelectorAll('[data-like]').forEach(b => b.onclick = async () => {
    const rec = app.history.find(h => h.id === 'h_' + b.dataset.like) || { id: 'h_' + b.dataset.like, idea: find(b.dataset.like), projectId: p.id };
    rec.liked = !rec.liked; await store.saveIdeaRecord(rec); app.history = await store.listIdeaHistory(); render();
  });
  document.querySelectorAll('[data-rework]').forEach(b => b.onclick = async () => {
    const old = find(b.dataset.rework);
    const nw = reworkIdea(old, app.history, Date.now());
    const idx = p.ideas.indexOf(old); p.ideas[idx] = nw;
    p.ideas.sort((a, c) => c.score - a.score);
    await store.saveIdeaRecord({ idea: nw, projectId: p.id, liked: false, id: 'h_' + nw.id });
    app.history = await store.listIdeaHistory();
    await save(); render(); toast(`Переработано: «${old.title}» ${old.score.toFixed(1)} → «${nw.title}» ${nw.score.toFixed(1)}`, 5000);
  });
  document.querySelectorAll('[data-hpick]').forEach(b => b.onclick = () => { const h = app.history.find(x => x.id === b.dataset.hpick); if (h) pickIdea(h.idea); });
  document.querySelectorAll('[data-hdel]').forEach(b => b.onclick = async () => { await store.deleteIdeaRecord(b.dataset.hdel); app.history = await store.listIdeaHistory(); render(); });
}
async function aiIdeas() {
  const box = $('#aiBox'); const btn = $('#genAI');
  if (btn) btn.disabled = true;
  if (box) box.innerHTML = '<div class="notice small">ИИ придумывает и оценивает 10 идей… <span id="aiLen"></span></div>';
  try {
    const text = await askAI(ideasRequest(app.history, app.settings.styles.join(', ')), { onText: u => { const l = $('#aiLen'); if (l) l.textContent = `(${u.text.length} симв.)`; } });
    const ideas = parseIdeas(text, 'ИИ (языковая модель среды)');
    await setIdeas(ideas); toast(`ИИ предложил идей: ${ideas.length}`);
    return ideas;
  } catch (e) { if ($('#aiBox')) $('#aiBox').innerHTML = `<div class="notice bad small">${esc(e.message)}</div>`; if (btn) btn.disabled = false; return null; }
}
function bridgeIdeas() {
  const req = ideasRequest(app.history, app.settings.styles.join(', '));
  modal(`<h2>Идеи через ChatGPT</h2>
    <p class="muted">1. Скопируйте запрос и отправьте его в ChatGPT (в вашем обычном чате — без API и доплат).<br>2. Скопируйте весь ответ ChatGPT и вставьте ниже.</p>
    <pre class="prompt">${esc(req)}</pre>
    <div class="row"><button class="btn" id="cp">Скопировать запрос</button><a class="btn ghost" href="https://chatgpt.com/" target="_blank" rel="noopener">Открыть ChatGPT ↗</a></div>
    <label class="f" style="margin-top:14px"><span>Ответ ChatGPT</span><textarea id="ans" style="min-height:180px" placeholder='{"ideas":[...]}'></textarea></label>
    <div id="err"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Отмена</button><button class="btn primary" id="ok">Разобрать ответ</button></div>`, (bg, close) => {
    bg.querySelector('#cp').onclick = () => copyText(req);
    bg.querySelector('#ok').onclick = async () => {
      try { const ideas = parseIdeas(bg.querySelector('#ans').value); close(); await setIdeas(ideas); toast(`Получено идей: ${ideas.length}`); }
      catch (e) { bg.querySelector('#err').innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; }
    };
  });
}
async function pickIdea(idea) {
  const p = app.project;
  if (p.storyboard?.approved && !await confirmBox('У проекта уже есть утверждённая раскадровка. Выбор новой идеи создаст новую версию проекта (старая сохранится в истории версий). Продолжить?', 'Создать новую версию')) return;
  if (p.storyboard) store.snapshot(p, 'Перед сменой идеи');
  applyIdea(p, idea);
  p.ideaApproved = true;
  const r = generateStoryboard(idea, app.settings, { seed: Date.now() });
  p.storyboard = r.storyboard; p.bible = r.bible; p.script = r.script;
  p.status = 'script'; p.edit.overrides = {};
  invalidateBuild();
  await save();
  toast('Идея утверждена, раскадровка создана');
  go('script');
}

// ---------- СЦЕНАРНАЯ ----------
function viewScript() {
  if (needProject('Сценарная')) return;
  const p = app.project;
  if (!p.storyboard) {
    $('#main').innerHTML = `<div class="page"><h1>Сценарная</h1><div class="card empty"><p>Сначала выберите идею.</p><button class="btn primary" data-go="ideas">К генератору идей</button></div></div>`; bindGo(); return;
  }
  const sb = p.storyboard, locked = !!sb.approved, manual = app.settings.mode === 'manual';
  const total = sb.shots.filter(s => s.enabled !== false).reduce((a, s) => a + Number(s.duration || 0), 0);
  const dis = locked ? 'disabled' : '';
  const moveOpts = sel => `<option value="auto">Авто (по композиции и драматургии)</option>` + Object.entries(MOVES).filter(([, v]) => !v.special).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${v.name}</option>`).join('');
  const trOpts = sel => `<option value="auto">Авто</option>` + Object.entries(TRANSITIONS).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${v.name}</option>`).join('');
  const beatOpts = sel => Object.entries(BEAT_NAMES).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${v}</option>`).join('');
  $('#main').innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Сценарная</h1><p>«${esc(p.idea?.title)}» · ${sb.shots.length} кадров · ≈${(total + 4).toFixed(0)} с с вступлением и финалом${sb.source ? ' · ' + esc(sb.source) : ''}</p></div>
      <div class="row">${locked ? `<span class="tag ok">Раскадровка утверждена</span><button class="btn" id="unlock">Изменить (новая версия)</button>` : `<button class="btn primary" id="approve">Утвердить раскадровку</button>`}
      <button class="btn" id="regen">Пересоздать</button>${hasAI() ? '<button class="btn" id="aiSb">✦ Раскадровка от ИИ</button>' : ''}<button class="btn" id="bridgeSb">Раскадровка через ChatGPT…</button></div></div>
    ${locked ? '<div class="notice ok small">Утверждённая версия защищена от изменений. Автоисправления контроля качества меняют только настройки монтажа, а не сценарий.</div>' : '<div class="notice small">Отредактируйте любые поля. Движение камеры и переход в режиме «Авто» подбираются монтажным движком по анализу изображения и драматургии кадра.</div>'}
    <div class="grid g2">
      <div class="card"><h3>Сценарий</h3><pre class="prompt" style="max-height:340px">${esc(p.script || '')}</pre></div>
      <div class="card"><h3>Библия проекта (единство кадров)</h3>
        ${[['location', 'Место'], ['character', 'Персонаж'], ['keyObject', 'Ключевой предмет'], ['era', 'Эпоха и камера'], ['palette', 'Палитра']].map(([k, n]) => `<label class="f"><span>${n}</span><textarea data-bible="${k}" ${dis} style="min-height:44px">${esc(p.bible?.[k] || '')}</textarea></label>`).join('')}
      </div>
    </div>
    <h4 style="margin-top:22px">Раскадровка</h4>
    ${sb.shots.map((s, i) => `<div class="card ${s.enabled === false ? 'dim' : ''}" style="margin-bottom:12px" data-shot="${s.id}">
      <div class="row" style="justify-content:space-between"><div class="row"><span class="shot-n">КАДР ${s.n}</span><span class="tag">${BEAT_NAMES[s.beat] || s.beat}</span><span class="small muted">${esc(s.function)}</span></div>
        <div class="row">${locked ? '' : `<button class="btn sm ghost" data-up="${i}" title="Выше">↑</button><button class="btn sm ghost" data-down="${i}" title="Ниже">↓</button><button class="btn sm ghost" data-dup="${i}" title="Дублировать">⧉</button><button class="btn sm ghost" data-rm="${i}" title="Удалить">✕</button>`}
        <label class="small"><input type="checkbox" data-f="enabled" ${s.enabled !== false ? 'checked' : ''} ${dis}> в монтаже</label></div></div>
      <div class="grid g3" style="margin-top:8px">
        <label class="f" style="grid-column:span 2"><span>Содержание изображения</span><textarea data-f="content" ${dis}>${esc(s.content)}</textarea></label>
        <div><label class="f"><span>Длительность, с</span><input type="number" step="0.1" min="1.8" max="9" data-f="duration" value="${s.duration}" ${dis}></label>
          <label class="f"><span>Драматургия</span><select data-f="beat" ${dis}>${beatOpts(s.beat)}</select></label></div>
        <label class="f"><span>Композиция</span><textarea data-f="composition" ${dis}>${esc(s.composition)}</textarea></label>
        <label class="f"><span>Свет и атмосфера</span><textarea data-f="light" ${dis}>${esc(s.light)}</textarea></label>
        <label class="f"><span>Визуальные эффекты</span><textarea data-f="vfx" ${dis}>${esc(s.vfx)}</textarea></label>
        <label class="f"><span>Движение камеры</span><select data-f="camera.move" ${dis}>${moveOpts(s.camera?.move)}</select></label>
        <label class="f"><span>Переход к следующему</span><select data-f="transition" ${dis}>${trOpts(s.transition)}</select></label>
        <label class="f"><span>Звук</span><textarea data-f="sound" ${dis} style="min-height:40px">${esc(s.sound)}</textarea></label>
        ${manual ? `<label class="f"><span>Интенсивность движения: ${(s.camera?.intensity ?? 0.6).toFixed(2)}</span><input type="range" min="0.1" max="1" step="0.05" data-f="camera.intensity" value="${s.camera?.intensity ?? 0.6}" ${dis}></label>
        <label class="f"><span>Сила эффектов кадра: ${(s.vfxLevel ?? 1).toFixed(2)}</span><input type="range" min="0" max="1.5" step="0.05" data-f="vfxLevel" value="${s.vfxLevel ?? 1}" ${dis}></label>` : ''}
      </div></div>`).join('')}
    ${locked ? '' : '<button class="btn" id="addShot">＋ Добавить кадр</button>'}
    <div class="row" style="margin-top:18px;justify-content:flex-end"><button class="btn primary" data-go="gallery">Дальше: изображения →</button></div>
  </div>`;
  bindGo();
  const sbShots = sb.shots;
  const renumber = () => sbShots.forEach((s, i) => s.n = i + 1);
  document.querySelectorAll('[data-shot]').forEach(card => {
    const sh = sbShots.find(s => s.id === card.dataset.shot);
    card.querySelectorAll('[data-f]').forEach(el => el.onchange = async () => {
      const f = el.dataset.f;
      let v = el.type === 'checkbox' ? el.checked : el.type === 'number' || el.type === 'range' ? Number(el.value) : el.value;
      if (f.startsWith('camera.')) { sh.camera = sh.camera || {}; sh.camera[f.split('.')[1]] = v; }
      else sh[f] = v;
      if (['content', 'composition', 'light', 'beat'].includes(f)) { sh.prompt = sh.promptEdited ? sh.prompt : buildPrompt(sh, p.bible); }
      invalidateBuild(); await save();
      if (el.type === 'range' || f === 'enabled') render();
    });
  });
  document.querySelectorAll('[data-bible]').forEach(el => el.onchange = async () => { p.bible[el.dataset.bible] = el.value; recomputePrompts(p); await save(); });
  const mv = async (i, d) => { const j = i + d; if (j < 0 || j >= sbShots.length) return; [sbShots[i], sbShots[j]] = [sbShots[j], sbShots[i]]; renumber(); invalidateBuild(); await save(); render(); };
  document.querySelectorAll('[data-up]').forEach(b => b.onclick = () => mv(+b.dataset.up, -1));
  document.querySelectorAll('[data-down]').forEach(b => b.onclick = () => mv(+b.dataset.down, 1));
  document.querySelectorAll('[data-dup]').forEach(b => b.onclick = async () => { const s = JSON.parse(JSON.stringify(sbShots[+b.dataset.dup])); s.id = store.uid('sh'); s.images = []; sbShots.splice(+b.dataset.dup + 1, 0, s); renumber(); await save(); render(); });
  document.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { if (sbShots.length <= 3) return toast('Нужно минимум 3 кадра'); if (!await confirmBox('Удалить кадр?', 'Удалить')) return; sbShots.splice(+b.dataset.rm, 1); renumber(); invalidateBuild(); await save(); render(); });
  if ($('#addShot')) $('#addShot').onclick = async () => { const s = { id: store.uid('sh'), n: sbShots.length + 1, beat: 'build', duration: 4, content: 'Новый кадр', composition: '', camera: { move: 'auto', intensity: 0.6 }, light: '', vfx: '', vfxLevel: 1, sound: '', transition: 'auto', function: '', images: [], activeImage: 0, enabled: true }; s.prompt = buildPrompt(s, p.bible); sbShots.push(s); await save(); render(); };
  if ($('#approve')) $('#approve').onclick = async () => { sb.approved = true; store.snapshot(p, 'Раскадровка утверждена'); await save(); toast('Раскадровка утверждена'); go('gallery'); };
  if ($('#unlock')) $('#unlock').onclick = async () => { if (!await confirmBox('Снять утверждение и редактировать? Текущая утверждённая версия сохранится в истории версий (Архив → Версии).', 'Редактировать')) return; store.snapshot(p, 'Утверждённая раскадровка (до правок)'); sb.approved = false; await save(); render(); };
  $('#regen').onclick = async () => {
    if (!await confirmBox(locked ? 'Раскадровка утверждена. Пересоздать её? Текущая версия сохранится в истории, изображения кадров будут перенесены по порядку.' : 'Пересоздать раскадровку? Изображения будут перенесены по порядку кадров.', 'Пересоздать')) return;
    store.snapshot(p, 'Перед пересозданием раскадровки');
    const old = p.storyboard.shots;
    const r = generateStoryboard(p.idea, app.settings, { seed: Date.now(), count: old.length });
    r.storyboard.shots.forEach((s, i) => { if (old[i]) { s.images = old[i].images; s.activeImage = old[i].activeImage; } });
    p.storyboard = r.storyboard; p.bible = r.bible; p.script = r.script; invalidateBuild(); await save(); render();
  };
  if ($('#aiSb')) $('#aiSb').onclick = async () => {
    if (locked && !await confirmBox('Раскадровка утверждена. Заменить её раскадровкой от ИИ? Текущая версия сохранится в истории.', 'Заменить')) return;
    const b = $('#aiSb'); b.disabled = true; b.textContent = 'ИИ пишет раскадровку…';
    try {
      const text = await askAI(storyboardRequest(p.idea, app.settings));
      const r = parseStoryboard(text, p.idea, 'ИИ (языковая модель среды)');
      store.snapshot(p, 'Перед раскадровкой от ИИ');
      const old = p.storyboard.shots;
      r.storyboard.shots.forEach((s, i) => { if (old[i]) { s.images = old[i].images; s.activeImage = old[i].activeImage; } });
      p.storyboard = r.storyboard; p.bible = { ...p.bible, ...r.bible };
      p.script = r.storyboard.shots.map(s => `[${BEAT_NAMES[s.beat]}] ${s.content}`).join('\n');
      invalidateBuild(); await save(); render(); toast('Раскадровка от ИИ загружена');
    } catch (e) { toast(e.message, 6000); b.disabled = false; b.textContent = '✦ Раскадровка от ИИ'; }
  };
  $('#bridgeSb').onclick = () => {
    const req = storyboardRequest(p.idea, app.settings);
    modal(`<h2>Раскадровка через ChatGPT</h2><p class="muted">Скопируйте запрос в ChatGPT, затем вставьте весь ответ ниже. Изображения уже загруженных кадров сохранятся по порядку.</p>
      <pre class="prompt">${esc(req)}</pre><div class="row"><button class="btn" id="cp">Скопировать запрос</button><a class="btn ghost" href="https://chatgpt.com/" target="_blank" rel="noopener">Открыть ChatGPT ↗</a></div>
      <label class="f" style="margin-top:14px"><span>Ответ ChatGPT</span><textarea id="ans" style="min-height:180px"></textarea></label><div id="err"></div>
      <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Отмена</button><button class="btn primary" id="ok">Разобрать</button></div>`, (bg, close) => {
      bg.querySelector('#cp').onclick = () => copyText(req);
      bg.querySelector('#ok').onclick = async () => {
        try {
          const r = parseStoryboard(bg.querySelector('#ans').value, p.idea);
          store.snapshot(p, 'Перед раскадровкой из ChatGPT');
          const old = p.storyboard.shots;
          r.storyboard.shots.forEach((s, i) => { if (old[i]) { s.images = old[i].images; s.activeImage = old[i].activeImage; } });
          p.storyboard = r.storyboard; p.bible = { ...p.bible, ...r.bible };
          p.script = r.storyboard.shots.map(s => `[${BEAT_NAMES[s.beat]}] ${s.content}`).join('\n');
          invalidateBuild(); await save(); close(); render(); toast('Раскадровка из ChatGPT загружена');
        } catch (e) { bg.querySelector('#err').innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; }
      };
    });
  };
}

// ---------- ГАЛЕРЕЯ ----------
async function viewGallery() {
  if (!app.project || !app.project.storyboard) {
    $('#main').innerHTML = `<div class="page"><h1>Галерея</h1><div class="card empty">
      <p>${app.project ? 'У проекта ещё нет раскадровки.' : 'Нет открытого проекта.'}</p>
      <p class="muted small">Загрузите свои картинки — студия сразу создаст из них проект и монтаж. Или начните с идеи: тогда студия придумает сюжет и даст промпты для картинок.</p>
      <div class="row" style="justify-content:center">${quickUploadHTML('gq')}<button class="btn" data-go="ideas">Начать с идеи</button></div><div id="gqHelp"></div></div></div>`;
    bindGo(); bindQuickUpload('gq', '#gqHelp');
    if (!app.project) { const b = document.querySelector('[data-go="ideas"]'); b.onclick = startNewProject; }
    return;
  }
  const p = app.project;
  if (!p.storyboard) { $('#main').innerHTML = `<div class="page"><h1>Галерея</h1><div class="card empty"><p>Сначала создайте раскадровку.</p><button class="btn primary" data-go="ideas">К идеям</button></div></div>`; bindGo(); return; }
  const shots = p.storyboard.shots;
  const withImg = shots.filter(s => (s.images || []).length).length;
  const urls = {};
  for (const s of shots) for (const im of s.images || []) urls[im.imageId] = await store.imageURL(im.imageId);
  for (const im of p.unassigned || []) urls[im.imageId] = await store.imageURL(im.imageId);
  const analyses = {};
  for (const s of shots) { const im = s.images?.[s.activeImage || 0]; if (im) analyses[s.id] = await getAnalysis(im.imageId); }
  $('#main').innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Галерея</h1><p>Изображения для ${shots.length} кадров: готово ${withImg} из ${shots.length}. Промпты учитывают библию проекта, чтобы место, свет и персонаж совпадали между кадрами.</p></div>
      <div class="row"><button class="btn" id="allP">Все промпты одним сообщением</button><button class="btn" id="test" title="Процедурные рисунки только для проверки движка">Тестовые кадры</button>
      <button class="btn primary" data-go="montage" ${withImg ? '' : 'disabled'}>Дальше: монтаж →</button></div></div>

    <div class="drop" id="drop">
      <button class="btn primary" id="pickFiles" type="button">Загрузить изображения</button>
      <input type="file" id="files" accept="image/*" multiple class="file-in" tabindex="-1" aria-hidden="true">
      <div class="small muted" style="margin-top:8px">Можно выбрать сразу все кадры или перетащить файлы сюда.</div>
      <div id="pasteBox" class="paste-box" contenteditable="true" inputmode="none" aria-label="Поле для вставки картинки">Или скопируйте картинку (в ChatGPT: долгое нажатие на картинку → «Копировать») и здесь: долгое нажатие → «Вставить». На компьютере — Ctrl+V.</div>
      <div id="pickHelp"></div></div>
    <div id="inbox"></div>
    <div id="upProg">${app.uploadNote || ''}</div>
    <details class="notice small"><summary><b>Как получить изображения без API и доплат</b></summary> Опубликованное веб-приложение не может само вызвать генератор изображений ChatGPT — для этого нужен платный API, поэтому кнопки «сгенерировать» здесь нет. Порядок такой: нажмите «Копировать запрос» у кадра (или «Все промпты одним сообщением») → вставьте в ChatGPT → скачайте картинки → перетащите их сюда. Файлы распределятся по кадрам сами: по номеру в имени (shot_03.png, кадр 3.jpg) или по порядку в свободные кадры. Каждая картинка сразу анализируется: экспозиция, контраст, точки интереса, рамки, разрешение.</details>
    ${(p.unassigned || []).length ? `<div class="card" style="margin-top:14px"><h3>Нераспределённые изображения</h3><div class="row">${p.unassigned.map(im => `<div style="text-align:center"><div class="thumb"><img src="${urls[im.imageId]}"></div><select class="small" data-assign="${im.imageId}" style="width:90px;margin-top:4px"><option value="">в кадр…</option>${shots.map(s => `<option value="${s.id}">Кадр ${s.n}</option>`).join('')}</select></div>`).join('')}</div></div>` : ''}
    <div style="margin-top:16px">${shots.map(s => {
      const act = s.images?.[s.activeImage || 0];
      const a = analyses[s.id];
      return `<div class="card shot" style="margin-bottom:12px" data-sid="${s.id}">
        <div><div class="pic">${act ? `<img src="${urls[act.imageId]}">` : 'нет<br>изображения'}</div></div>
        <div style="min-width:0">
          <div class="row" style="justify-content:space-between"><div class="row"><span class="shot-n">КАДР ${s.n}</span><span class="tag">${BEAT_NAMES[s.beat] || ''}</span>${s.enabled === false ? '<span class="tag warn">исключён</span>' : ''}</div>
            <div class="row"><button class="btn sm" data-copy="${s.id}">Копировать запрос</button><button class="btn sm" type="button" data-pickup="${s.id}">Загрузить в этот кадр</button><input type="file" accept="image/*" multiple class="file-in" tabindex="-1" aria-hidden="true" data-up="${s.id}"></div></div>
          <p class="small" style="margin:6px 0">${esc(s.content)}</p>
          <details><summary class="small">Промпт${s.promptEdited ? ' (изменён вручную)' : ''}</summary><textarea data-prompt="${s.id}" style="min-height:150px;font:12px var(--mono);margin-top:6px">${esc(s.prompt)}</textarea>
            <div class="row"><button class="btn sm ghost" data-reprompt="${s.id}">Вернуть автоматический промпт</button></div></details>
          ${(s.images || []).length ? `<div class="small muted" style="margin:8px 0 4px">Версии кадра (${s.images.length}) — нажмите, чтобы выбрать:</div><div class="thumbs">${s.images.map((im, k) => `<div class="thumb ${k === (s.activeImage || 0) ? 'on' : ''}" data-act="${s.id}:${k}" title="${esc(im.name)}"><img src="${urls[im.imageId]}"><button class="x" data-rmimg="${s.id}:${k}">✕</button></div>`).join('')}</div>` : ''}
          ${a ? `<div class="small muted" style="margin-top:6px">Анализ: ${esc(describeAnalysis(a))}</div>${a.issues.map(is => `<div class="small status-${is.level === 'fix' ? 'ok' : 'warn'}">${is.level === 'fix' ? '✓' : '!'} ${esc(is.text)}</div>`).join('')}` : ''}
        </div></div>`;
    }).join('')}</div></div>`;
  bindGo();
  const handleFiles = async (files, target = null) => {
    const prog = $('#upProg');
    const list = [...(files || [])];
    if (!list.length) { toast('Файлы не выбраны'); return; }
    if (prog) prog.innerHTML = `<div class="notice small">Получено файлов: ${list.length}. Проверяю и анализирую…</div>`;
    let rep;
    try {
      rep = await addImages(p, list, { targetShotId: target, onProgress: (i, n, name) => { if (prog) prog.innerHTML = `<div class="small muted">Анализ ${i + 1}/${n}: ${esc(name)}</div><div class="progress"><i style="width:${(i + 1) / n * 100}%"></i></div>`; } });
      invalidateBuild(); await save();
    } catch (e) {
      console.error(e);
      if (prog) prog.innerHTML = `<div class="notice bad">Не удалось загрузить изображения: ${esc(e.message || e)}</div>`;
      return;
    }
    const rej = rep.rejected || [];
    app.uploadNote = (rep.length ? `<div class="notice ok small">Загружено: ${rep.length}. ${rep.map(r => `${esc(r.name)} → ${r.shot ? 'кадр ' + r.shot : 'не распределено (все кадры заняты — выберите кадр ниже)'}`).join('; ')}</div>` : '')
      + (rej.length ? `<div class="notice bad small">Не загружено: ${rej.length}.<br>${rej.map(r => `${esc(r.name)}: ${esc(r.reason)}`).join('<br>')}</div>` : '');
    render();
    if (app.autopilot && p.storyboard.shots.every(s => (s.images || []).length)) autopilot();
  };
  // Открыть выбор файлов. Если окно выбора не появилось (так бывает во встроенных окнах
  // приложений на Android), через 2 с показываем, как обойти.
  const pick = inp => openPicker(inp, $('#pickHelp'));
  $('#pickFiles').onclick = () => pick($('#files'));
  // изображения, которые Claude положил в хранилище страницы из чата
  (async () => {
    if (!hasInbox()) return;
    const all = await listInbox();
    const done = new Set(p.importedAssets || []);
    const fresh = all.filter(a => !done.has(a.id));
    const box = $('#inbox'); if (!box) return;
    box.innerHTML = `<div class="card" style="margin-top:12px"><h3>Изображения из чата с Claude</h3>
      <p class="small muted">Если на телефоне не работает выбор файлов: пришлите картинки в чат Claude (по порядку кадров) и попросите положить их в студию. Они появятся здесь.</p>
      ${fresh.length ? `<button class="btn primary" id="takeInbox">Забрать в кадры: ${fresh.length} шт.</button>` : `<div class="small muted">Новых изображений нет${all.length ? ` (уже забрано: ${all.length})` : ''}.</div>`}
      <button class="btn sm ghost" id="refreshInbox">Проверить снова</button></div>`;
    $('#refreshInbox').onclick = () => render();
    if ($('#takeInbox')) $('#takeInbox').onclick = async () => {
      $('#takeInbox').disabled = true;
      const files = [], bad = [];
      for (let i = 0; i < fresh.length; i++) { try { files.push(await fetchInbox(fresh[i], (p.importedAssets || []).length + i)); } catch (e) { bad.push(e.message); } }
      p.importedAssets = [...(p.importedAssets || []), ...fresh.map(a => a.id)];
      if (bad.length) toast('Не получено: ' + bad.length + ' — ' + bad[0], 6000);
      await handleFiles(files);
    };
  })();
  document.querySelectorAll('[data-pickup]').forEach(b => b.onclick = () => pick(document.querySelector(`[data-up="${b.dataset.pickup}"]`)));
  // вставка картинки из буфера обмена (Ctrl+V или «Вставить» в поле на телефоне)
  const pasteFiles = list => list.map((f, i) => new File([f], f.name && f.name !== 'image.png' ? f.name : `вставка_${Date.now()}_${i + 1}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type || 'image/png' }));
  document.onpaste = e => {
    if (app.view !== 'gallery') return;
    const fs = [...(e.clipboardData?.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
    if (fs.length) { e.preventDefault(); handleFiles(pasteFiles(fs)); return; }
    if (e.target.closest?.('#pasteBox')) setTimeout(scanPasteBox, 50);
  };
  // некоторые клавиатуры вставляют картинку как элемент <img> — забираем её оттуда
  const pasteBox = $('#pasteBox');
  const pasteHint = pasteBox.textContent;
  const scanPasteBox = async () => {
    const imgs = [...pasteBox.querySelectorAll('img')];
    const out = [];
    for (const im of imgs) { try { if (/^(data|blob):/.test(im.src)) out.push(await (await fetch(im.src)).blob()); } catch (e) {} }
    pasteBox.textContent = pasteHint;
    if (out.length) handleFiles(pasteFiles(out));
    else if (imgs.length) toast('Не удалось забрать вставленную картинку — скачайте её и загрузите файлом');
  };
  pasteBox.addEventListener('focus', () => { if (pasteBox.textContent === pasteHint) pasteBox.textContent = ''; });
  pasteBox.addEventListener('blur', () => { if (!pasteBox.textContent.trim() && !pasteBox.querySelector('img')) pasteBox.textContent = pasteHint; });
  pasteBox.addEventListener('input', () => { if (pasteBox.querySelector('img')) scanPasteBox(); else if (pasteBox.textContent.trim() && pasteBox.textContent !== pasteHint) { pasteBox.textContent = ''; toast('В буфере текст, а не картинка'); } });
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
  $('#files').onchange = e => handleFiles(e.target.files);
  app.uploadNote = '';
  document.querySelectorAll('[data-up]').forEach(inp => inp.onchange = e => handleFiles(e.target.files, inp.dataset.up));
  document.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => { const s = shots.find(x => x.id === b.dataset.copy); copyText(imageRequest(s, p.bible)); });
  $('#allP').onclick = () => copyText(allImagesRequest(p));
  $('#test').onclick = async () => {
    if (!await confirmBox('Добавить ТЕСТОВЫЕ кадры? Это простые процедурные рисунки (коридор, дверь, силуэт), нарисованные кодом. Они нужны только чтобы проверить монтажный движок, звук и экспорт без своих изображений. В свободные кадры будут добавлены тестовые версии; ваши изображения не затрагиваются.', 'Добавить тестовые')) return;
    const free = shots.filter(s => !(s.images || []).length);
    const files = await makeTestPlates(shots.length);
    const sel = free.length ? free.map(s => files[s.n - 1]) : files;
    if (!free.length) return toast('Все кадры уже с изображениями');
    await handleFiles(sel);
  };
  document.querySelectorAll('[data-act]').forEach(t => t.onclick = async e => { if (e.target.classList.contains('x')) return; const [sid, k] = t.dataset.act.split(':'); const s = shots.find(x => x.id === sid); s.activeImage = +k; invalidateBuild(); await save(); render(); });
  document.querySelectorAll('[data-rmimg]').forEach(b => b.onclick = async e => { e.stopPropagation(); const [sid, k] = b.dataset.rmimg.split(':'); const s = shots.find(x => x.id === sid); if (!await confirmBox('Убрать эту версию изображения из кадра?', 'Убрать')) return; const [im] = s.images.splice(+k, 1); s.activeImage = Math.max(0, Math.min(s.activeImage || 0, s.images.length - 1)); await store.db.del('images', im.imageId); invalidateBuild(); await save(); render(); });
  document.querySelectorAll('[data-prompt]').forEach(t => t.onchange = async () => { const s = shots.find(x => x.id === t.dataset.prompt); s.prompt = t.value; s.promptEdited = true; await save(); });
  document.querySelectorAll('[data-reprompt]').forEach(b => b.onclick = async () => { const s = shots.find(x => x.id === b.dataset.reprompt); s.promptEdited = false; s.prompt = buildPrompt(s, p.bible); await save(); render(); });
  document.querySelectorAll('[data-assign]').forEach(sel => sel.onchange = async () => {
    if (!sel.value) return;
    const idx = p.unassigned.findIndex(x => x.imageId === sel.dataset.assign);
    const [im] = p.unassigned.splice(idx, 1);
    const s = shots.find(x => x.id === sel.value); s.images = s.images || []; s.images.push(im); s.activeImage = s.images.length - 1;
    invalidateBuild(); await save(); render();
  });
}

// ---------- МОНТАЖНАЯ ----------
async function ensureBuild(force = false) {
  const p = app.project;
  if (app.build && !force) return app.build;
  if (app.building) return app.building;
  app.building = (async () => {
    try { app.build = await buildEdit(p, app.settings); return app.build; }
    finally { app.building = null; }
  })();
  return app.building;
}
// Быстрое обновление после изменения параметров: EDL пересобирается, звук пересинтезируется
// только если изменилась временная структура сбоев
let rebuildTimer = null;
function scheduleRebuild({ audioOnly = false } = {}) {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(async () => {
    const p = app.project; if (!app.build) return;
    if (audioOnly) {
      app.build.mix = mixTracks(app.build.synth, p.edit.tracks, p.edit.masterVol ?? 0.9);
      if (app.player.playing) { const t = currentTime(); stopPlayback(); startPlayback(t); }
      return;
    }
    const sig = e => JSON.stringify([e.duration, e.soundEvents.map(s => [s.t, s.kind]), e.silences, e.stingers]);
    const old = app.build.edl;
    const edl = buildEDL(p, app.build.analyses, app.settings);
    edl.era = p.bible?.osdDate || null;
    if (sig(old) !== sig(edl)) {
      const st = $('#buildState'); if (st) st.textContent = 'пересчёт звука…';
      app.build.synth = synthesizeTracks(edl);
      app.build.mix = mixTracks(app.build.synth, p.edit.tracks, p.edit.masterVol ?? 0.9);
      if (st) st.textContent = '';
    }
    app.build.edl = edl;
    if (app.renderer) await app.renderer.prepare(edl, getBlob);
    drawTimeline(); renderFrame(app.player.t);
    if (app.player.playing) { const t = currentTime(); stopPlayback(); startPlayback(t); }
    await save();
  }, 250);
}
function currentTime() { const pl = app.player; return pl.playing ? Math.min(app.build.edl.duration, pl.ctx.currentTime - pl.start) : pl.t; }
function renderFrame(t) {
  if (!app.renderer || !app.build) return;
  app.renderer.renderAt(app.build.edl, Math.max(0, Math.min(t, app.build.edl.duration - 1e-3)));
  const tl = $('#ph'); if (tl) tl.style.left = (t / app.build.edl.duration * 100) + '%';
  const tm = $('#tm'); if (tm) tm.textContent = `${fmtT(t)} / ${fmtT(app.build.edl.duration)}`;
}
function startPlayback(from = 0) {
  const pl = app.player;
  if (!app.build) return;
  if (from >= app.build.edl.duration - 0.05) from = 0;
  pl.ctx = pl.ctx || new AudioContext({ sampleRate: SR });
  pl.ctx.resume();
  const buf = toAudioBuffer(pl.ctx, app.build.mix);
  pl.src = pl.ctx.createBufferSource(); pl.src.buffer = buf; pl.src.connect(pl.ctx.destination);
  pl.start = pl.ctx.currentTime + 0.03 - from;
  pl.src.start(pl.ctx.currentTime + 0.03, from);
  pl.playing = true;
  const btn = $('#play'); if (btn) btn.textContent = '❚❚ Пауза';
  const loop = () => {
    if (!pl.playing) return;
    const t = currentTime();
    if (t >= app.build.edl.duration) { stopPlayback(); pl.t = 0; renderFrame(0); return; }
    renderFrame(t); pl.raf = requestAnimationFrame(loop);
  };
  loop();
}
function stopPlayback() {
  const pl = app.player;
  if (pl.playing) { pl.t = currentTime(); try { pl.src.stop(); } catch (e) {} }
  pl.playing = false; cancelAnimationFrame(pl.raf);
  const btn = $('#play'); if (btn) btn.textContent = '▶ Смотреть';
}
async function drawTimeline() {
  const el = $('#tl'); if (!el || !app.build) return;
  const edl = app.build.edl, D = edl.duration;
  const pct = t => (t / D * 100) + '%';
  let h = '';
  for (const s of edl.segments) {
    const url = await store.imageURL(s.imageId);
    h += `<div class="seg" style="left:${pct(s.start)};width:${pct(s.end - s.start)};background-image:url('${url}')" title="${esc(MOVES[s.move].name)}" ${s.scream ? 'data-scream="1"' : ''}><span>${s.scream ? '⚡ СКРИМЕР' : esc(MOVES[s.move].name.split(' ')[0])}</span></div>`;
  }
  for (const t of edl.transitions) h += `<div class="tr" style="left:${pct(t.at - t.pre)};width:${pct(Math.max(1 / 30, t.pre + t.post))}" title="${esc(TRANSITIONS[t.type].name)}"></div>`;
  for (const g of edl.glitches) h += `<div class="gl" style="left:${pct(g.t)}" title="${esc(GLITCHES[g.type].name)} ${g.t.toFixed(2)} с"></div>`;
  for (const s of edl.soundEvents) h += `<div class="se" style="left:${pct(s.t)};width:${pct(s.dur)}"></div>`;
  for (const s of edl.silences) h += `<div class="si" style="left:${pct(s.t)};width:${pct(s.dur)}" title="Тишина"></div>`;
  if (edl.title) h += `<div class="ti" style="left:${pct(edl.title.start)};width:${pct(edl.title.dur)}" title="Титр"><span>ТИТР</span></div>`;
  h += `<div class="ph" id="ph"></div>`;
  el.innerHTML = h;
  el.onpointerdown = e => {
    const seek = ev => { const r = el.getBoundingClientRect(); const t = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * D; const was = app.player.playing; if (was) stopPlayback(); app.player.t = t; renderFrame(t); if (was) startPlayback(t); };
    seek(e); el.setPointerCapture(e.pointerId);
    el.onpointermove = ev => { if (ev.buttons) seek(ev); };
  };
  const ed = $('#edlInfo');
  if (ed) ed.innerHTML = edl.segments.map((s, i) => `<div class="small" style="padding:3px 0;border-bottom:1px solid var(--line)"><span class="shot-n">${String(i + 1).padStart(2, '0')}</span> ${fmtT(s.start)} · <b>${esc(MOVES[s.move].name)}</b>${edl.transitions[i] ? ` → <span class="muted">${esc(TRANSITIONS[edl.transitions[i].type].name)}</span>` : ''}</div>`).join('') + `<div class="small muted" style="margin-top:6px">Глитчей: ${edl.glitches.length}, звуковых событий: ${edl.soundEvents.length}, моментов тишины: ${edl.silences.length}, акцентов: ${edl.stingers.length}</div>`;
}
async function viewMontage() {
  if (needProject('Монтажная')) return;
  const p = app.project;
  if (p.edit) ensureEditDefaults(p);
  const has = (p.storyboard?.shots || []).some(s => (s.images || []).length && s.enabled !== false);
  if (!has) { $('#main').innerHTML = `<div class="page"><h1>Монтажная</h1><div class="card empty"><p>Нет кадров с изображениями.</p><button class="btn primary" data-go="gallery">В галерею</button></div></div>`; bindGo(); return; }
  const tpls = [...BUILTIN_TEMPLATES, ...app.userTemplates];
  const P = p.edit.params;
  const tab = app.montageTab;
  const groups = {};
  for (const d of PARAM_DEFS) (groups[d.group] = groups[d.group] || []).push(d);
  $('#main').innerHTML = `<div class="page" style="max-width:1400px">
    <div class="page-head"><div><h1>Монтажная</h1><p>Документальный монтаж собирается автоматически: движение камеры выбирается по композиции и драматургии каждого кадра, сбои — по кривой напряжения, звук синхронизирован со сбоями.</p></div>
      <div class="row"><span class="small muted" id="buildState"></span><button class="btn" id="reroll" title="Другая комбинация движений, переходов и сбоев">🎲 Другой вариант монтажа</button>
      ${p.edit.approved ? '<span class="tag ok">Монтаж одобрен</span>' : '<button class="btn" id="approveEdit">Одобрить монтаж</button>'}
      <button class="btn primary" id="exportBtn" disabled title="Сначала напишите «готово» в поле «Правки»">Экспорт MP4</button></div></div>
    <div class="editor">
      <div class="viewer">
        <div class="screen"><canvas id="cv"></canvas><div class="ovl" id="ovl">Сборка монтажа…</div></div>
        <div class="transport"><button class="btn" id="play">▶ Смотреть</button><button class="btn sm ghost" id="rew">⏮</button><span class="time" id="tm">0:00.0</span></div>
        <div class="card edits">
          <h3 style="margin-bottom:4px">Правки</h3>
          <p class="small muted" style="margin:0 0 8px">Напишите обычными словами, что переделать, — или «<b>готово</b>», если правок нет. Пока поле пустое, экспорт не запустится.</p>
          <textarea id="editsText" placeholder="Например: во 2 кадре камера медленнее; меньше зелёных полос; гул громче; скример из кадра 5; титр: Городская больница №13; 14.10.1996 02:13">${esc(app.editsDraft || '')}</textarea>
          <div class="row" style="margin-top:8px"><button class="btn primary" id="runEdits" disabled>Напишите правки или «готово»</button><span class="small muted" id="editsState"></span></div>
          <div id="editsResult">${app.lastEditResult || ''}</div>
          ${(p.edit.editLog || []).length ? `<details style="margin-top:8px"><summary class="small">История правок (${p.edit.editLog.length})</summary>${p.edit.editLog.slice(0, 20).map(l => `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)"><span class="dim">${fmtDate(l.at)}</span> — «${esc(l.text)}»<br><span class="muted">${l.changes.map(esc).join('; ') || 'без изменений'}</span></div>`).join('')}</details>` : ''}
        </div>
        <div id="exportBox"></div>
      </div>
      <div style="min-width:0">
        <div class="timeline" id="tl"></div>
        <div class="legend"><span><i style="background:rgba(224,72,62,.6)"></i>переходы</span><span><i style="background:#7be08b"></i>глитчи</span><span><i style="background:rgba(217,164,65,.8)"></i>синхронные звуки</span><span><i style="background:rgba(107,156,207,.6)"></i>тишина</span></div>
        <div class="tabs" style="margin-top:14px">${[['effects', 'Эффекты'], ['story', 'Титр и скример'], ['sound', 'Звук'], ['shots', 'Кадры'], ['plan', 'Монтажный план'], ['templates', 'Шаблоны']].map(([k, n]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${n}</button>`).join('')}</div>
        <div id="tabBody">
        ${tab === 'effects' ? `
          <div class="row" style="margin-bottom:10px"><label class="f" style="flex:1;margin:0"><span>Стиль (шаблон)</span><select id="tpl">${tpls.map(t => `<option value="${t.id}" ${p.edit.templateId === t.id ? 'selected' : ''}>${esc(t.name)}${t.builtin ? '' : ' (мой)'}</option>`).join('')}</select></label>
            <label class="f" style="width:170px;margin:0"><span>Экранная индикация</span><select id="osd">${[['vhs', 'VHS (REC, дата)'], ['cctv', 'Камера наблюдения'], ['archive', 'Архивный тайм-код'], ['none', 'Без индикации']].map(([k, n]) => `<option value="${k}" ${p.edit.osd === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
          <div class="grid g2">${Object.entries(groups).map(([g, ds]) => `<div class="card" style="padding:12px"><h4>${g}</h4>${ds.map(d => `<div class="sl"><span>${d.name}</span><input type="range" min="0" max="1" step="0.01" data-p="${d.id}" value="${P[d.id]}"><output>${Math.round(P[d.id] * 100)}</output></div>`).join('')}</div>`).join('')}
            <div class="card" style="padding:12px"><h4>Структура</h4>
              <div class="sl"><span>Целевая длительность, с</span><input type="range" min="${app.settings.minDuration}" max="${app.settings.maxDuration}" step="1" id="tdur" value="${p.edit.targetDuration || app.settings.targetDuration}"><output>${p.edit.targetDuration || app.settings.targetDuration}</output></div>
              <div class="sl"><span>Вступление (чёрный экран), с</span><input type="range" min="1.2" max="4" step="0.1" id="intro" value="${p.edit.introDur ?? 2.2}"><output>${(p.edit.introDur ?? 2.2).toFixed(1)}</output></div>
              <div class="sl"><span>Финальный обрыв, с</span><input type="range" min="1" max="4" step="0.1" id="outro" value="${p.edit.outroDur ?? 1.8}"><output>${(p.edit.outroDur ?? 1.8).toFixed(1)}</output></div>
            </div></div>` : ''}
        ${tab === 'sound' ? `<div class="card"><h4>Звуковые дорожки (синтезируются кодом — без чужих записей)</h4>
            ${TRACKS.map(t => `<div class="track"><input type="checkbox" data-ton="${t.id}" ${p.edit.tracks[t.id]?.on !== false ? 'checked' : ''}><span>${t.name}</span><input type="range" min="0" max="1" step="0.01" data-tvol="${t.id}" value="${p.edit.tracks[t.id]?.vol ?? 0.6}"><output class="small mono">${Math.round((p.edit.tracks[t.id]?.vol ?? 0.6) * 100)}</output></div>`).join('')}
            <div class="track"><span></span><b>Общая громкость</b><input type="range" min="0.3" max="1" step="0.01" id="master" value="${p.edit.masterVol ?? 0.9}"><output class="small mono">${Math.round((p.edit.masterVol ?? 0.9) * 100)}</output></div>
            <p class="small muted" style="margin-top:10px">Каждому визуальному сбою соответствует звуковой: зелёная полоса — сетевой гул, сдвиг RGB — цифровой писк, разрыв строк — хруст ленты, провал — обрыв звука со щелчком, блоки — цифровой скрежет. Перед раскрытием — полная тишина и удар. Сведение: мягкий лимитер, пик −1 дБFS.</p>
            ${canSaveExt('wav') ? '<button class="btn sm" id="wav">Скачать звук отдельно (WAV)</button>' : ''}</div>` : ''}
        ${tab === 'shots' ? `<div class="card"><h4>Настройки кадров для монтажа</h4><p class="small muted">Эти назначения хранятся в монтаже и не меняют утверждённый сценарий. «Авто» — движок выбирает сам.</p>
            ${p.storyboard.shots.filter(s => (s.images || []).length && s.enabled !== false).map(s => { const o = p.edit.overrides?.[s.id] || {}; return `<div class="grid g3" style="padding:8px 0;border-bottom:1px solid var(--line);align-items:end">
              <div><span class="shot-n">КАДР ${s.n}</span> <span class="small muted">${esc(BEAT_NAMES[s.beat])}</span><div class="small">${esc(s.content).slice(0, 90)}</div></div>
              <label class="f" style="margin:0"><span>Движение камеры</span><select data-ov="${s.id}:move"><option value="auto">Авто${s.camera?.move && s.camera.move !== 'auto' ? ' (по сценарию: ' + esc(MOVES[s.camera.move]?.name || '') + ')' : ''}</option>${Object.entries(MOVES).filter(([, v]) => !v.special).map(([k, v]) => `<option value="${k}" ${o.move === k ? 'selected' : ''}>${v.name}</option>`).join('')}</select></label>
              <label class="f" style="margin:0"><span>Переход после</span><select data-ov="${s.id}:transition"><option value="auto">Авто</option>${Object.entries(TRANSITIONS).map(([k, v]) => `<option value="${k}" ${o.transition === k ? 'selected' : ''}>${v.name}</option>`).join('')}</select></label>
              <div></div><label class="f" style="margin:0"><span>Интенсивность движения ${(o.intensity ?? s.camera?.intensity ?? 0.6).toFixed(2)}</span><input type="range" min="0.1" max="1" step="0.05" data-ov="${s.id}:intensity" value="${o.intensity ?? s.camera?.intensity ?? 0.6}"></label>
            </div>`; }).join('')}</div>` : ''}
        ${tab === 'story' ? `<div class="card"><h4>Титр — откуда эта запись</h4>
            <p class="small muted">После чёрного экрана с помехами текст печатается по буквам со звуком клавиатуры. Каждая строка — с новой строки. Составлен автоматически по идее; можно переписать.</p>
            <label class="row small" style="margin-bottom:6px"><input type="checkbox" id="titleOn" ${p.edit.title?.on !== false ? 'checked' : ''}> Показывать титр</label>
            <textarea id="titleLines" style="min-height:110px;font-family:var(--mono)">${esc((p.edit.title?.lines || []).join('\n'))}</textarea>
            <div class="row" style="margin-top:6px"><button class="btn sm" id="titleSave">Сохранить титр</button><button class="btn sm ghost" id="titleAuto">Составить заново по идее</button></div></div>
          <div class="card" style="margin-top:12px"><h4>Скример</h4>
            <p class="small muted">Перед финалом — затишье: камера почти замирает, звук плавно уходит. Затем удар: вспышка, лицо или фигура крупно, тряска, искажения, громкий крик. Изображение выбирается автоматически: фигура ближе к центру, контраст, роль кадра (раскрытие, кульминация). ${app.build?.edl?.scream ? `Сейчас выбран <b>кадр ${app.build.edl.scream.shotN}</b>${app.build.edl.scream.auto ? ' (авто)' : ''}, удар на ${fmtT(app.build.edl.scream.start)}.` : ''}</p>
            <label class="row small" style="margin-bottom:6px"><input type="checkbox" id="screamOn" ${p.edit.screamer?.on !== false ? 'checked' : ''}> Скример включён</label>
            <label class="f"><span>Изображение для скримера</span><select id="screamShot"><option value="auto">Авто — система выбирает сама</option>${p.storyboard.shots.filter(s => (s.images || []).length && s.enabled !== false).map(s => `<option value="${s.id}" ${p.edit.screamer?.shotId === s.id ? 'selected' : ''}>Кадр ${s.n} — ${esc(BEAT_NAMES[s.beat] || '')}: ${esc(String(s.content || '').slice(0, 50))}</option>`).join('')}</select></label>
            <button class="btn sm" id="screamPreview">Показать момент скримера</button></div>` : ''}
        ${tab === 'plan' ? `<div class="card"><h4>Решения режиссёра монтажа</h4><div id="edlInfo"></div></div>` : ''}
        ${tab === 'templates' ? `<div class="card"><h4>Библиотека шаблонов</h4><p class="small muted">Шаблон хранит все параметры эффектов, громкости дорожек и индикацию. Создайте удачный стиль один раз и применяйте в будущих роликах.</p>
            <div class="row"><input type="text" id="tplName" placeholder="Название моего стиля" style="max-width:320px"><button class="btn primary" id="saveTpl">Сохранить текущие настройки как шаблон</button></div>
            <div style="margin-top:12px">${tpls.map(t => `<div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)"><div><b>${esc(t.name)}</b> ${t.builtin ? '<span class="tag">встроенный</span>' : '<span class="tag red">мой</span>'}<div class="small muted">${esc(t.description || '')}</div></div><div class="row"><button class="btn sm" data-applytpl="${t.id}">Применить</button>${t.builtin ? '' : `<button class="btn sm ghost" data-deltpl="${t.id}">✕</button>`}</div></div>`).join('')}</div></div>` : ''}
        </div>
      </div>
    </div></div>`;

  $('#play').onclick = () => app.player.playing ? stopPlayback() : startPlayback(app.player.t || 0);
  $('#rew').onclick = () => { const was = app.player.playing; stopPlayback(); app.player.t = 0; renderFrame(0); if (was) startPlayback(0); };
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { stopPlayback(); app.montageTab = b.dataset.tab; viewMontage(); });
  $('#reroll').onclick = () => { p.edit.seed = Math.floor(Math.random() * 1e9); p.edit.approved = false; scheduleRebuild(); toast('Новый вариант монтажа'); };
  if ($('#approveEdit')) $('#approveEdit').onclick = async () => { p.edit.approved = true; store.snapshot(p, 'Монтаж одобрен'); await save(); toast('Монтаж одобрен. Изменение параметров снимет одобрение.'); viewMontage(); };
  // поле правок: экспорт только после «готово»
  const et = $('#editsText'), rb = $('#runEdits');
  const syncEdits = () => {
    const v = et.value.trim();
    app.editsDraft = et.value;
    rb.disabled = !v || !!app.editsBusy;
    rb.textContent = !v ? 'Напишите правки или «готово»' : isReady(v) ? 'Готово — экспорт MP4' : 'Применить правки';
    $('#exportBtn').disabled = !isReady(v);
  };
  et.oninput = syncEdits; syncEdits();
  rb.onclick = () => runEdits();
  $('#exportBtn').onclick = () => { if (isReady(et.value)) doExport(); else { et.focus(); toast('Сначала напишите в поле «Правки» ваши правки или «готово»'); } };
  if ($('#titleSave')) $('#titleSave').onclick = async () => { p.edit.title = { ...p.edit.title, on: $('#titleOn').checked, lines: $('#titleLines').value.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 6), auto: false }; p.edit.approved = false; invalidateBuild(); await save(); toast('Титр сохранён'); viewMontage(); };
  if ($('#titleOn')) $('#titleOn').onchange = async () => { p.edit.title.on = $('#titleOn').checked; p.edit.approved = false; invalidateBuild(); await save(); viewMontage(); };
  if ($('#titleAuto')) $('#titleAuto').onclick = async () => { p.edit.title = { on: true, lines: defaultTitleLines(p), auto: true }; invalidateBuild(); await save(); viewMontage(); };
  if ($('#screamOn')) $('#screamOn').onchange = async () => { p.edit.screamer = { ...p.edit.screamer, on: $('#screamOn').checked }; p.edit.approved = false; invalidateBuild(); await save(); viewMontage(); };
  if ($('#screamShot')) $('#screamShot').onchange = async () => { p.edit.screamer = { on: true, shotId: $('#screamShot').value }; p.edit.approved = false; invalidateBuild(); await save(); viewMontage(); };
  if ($('#screamPreview')) $('#screamPreview').onclick = () => { const sc = app.build?.edl?.scream; if (!sc) return toast('Скример выключен'); stopPlayback(); startPlayback(Math.max(0, sc.lullFrom - 1.5)); };
  document.querySelectorAll('[data-p]').forEach(r => r.oninput = () => { P[r.dataset.p] = +r.value; r.nextElementSibling.textContent = Math.round(r.value * 100); p.edit.approved = false; scheduleRebuild(); });
  if ($('#tpl')) $('#tpl').onchange = () => applyTemplate($('#tpl').value);
  if ($('#osd')) $('#osd').onchange = () => { p.edit.osd = $('#osd').value; scheduleRebuild(); };
  const bindNum = (id, key, fmt = v => v) => { const el = $(id); if (el) el.oninput = () => { p.edit[key] = +el.value; el.nextElementSibling.textContent = fmt(+el.value); scheduleRebuild(); }; };
  bindNum('#tdur', 'targetDuration'); bindNum('#intro', 'introDur', v => v.toFixed(1)); bindNum('#outro', 'outroDur', v => v.toFixed(1));
  document.querySelectorAll('[data-ton]').forEach(c => c.onchange = () => { p.edit.tracks[c.dataset.ton].on = c.checked; scheduleRebuild({ audioOnly: true }); save(); });
  document.querySelectorAll('[data-tvol]').forEach(r => r.oninput = () => { p.edit.tracks[r.dataset.tvol].vol = +r.value; r.nextElementSibling.textContent = Math.round(r.value * 100); scheduleRebuild({ audioOnly: true }); save(); });
  if ($('#master')) $('#master').oninput = e => { p.edit.masterVol = +e.target.value; e.target.nextElementSibling.textContent = Math.round(e.target.value * 100); scheduleRebuild({ audioOnly: true }); save(); };
  if ($('#wav')) $('#wav').onclick = () => app.build && download(encodeWAV(app.build.mix), safeName(p.title) + '_звук.wav');
  document.querySelectorAll('[data-ov]').forEach(el => el.oninput = el.onchange = () => {
    const [sid, key] = el.dataset.ov.split(':');
    p.edit.overrides = p.edit.overrides || {};
    const o = p.edit.overrides[sid] = p.edit.overrides[sid] || {};
    o[key] = key === 'intensity' ? +el.value : el.value;
    if (key === 'intensity') el.previousElementSibling.textContent = 'Интенсивность движения ' + (+el.value).toFixed(2);
    p.edit.approved = false; scheduleRebuild();
  });
  if ($('#saveTpl')) $('#saveTpl').onclick = async () => {
    const name = $('#tplName').value.trim() || `Мой стиль ${new Date().toLocaleDateString('ru-RU')}`;
    const t = await store.saveTemplate({ name, description: `Сохранён из проекта «${p.title}»`, osd: p.edit.osd, params: JSON.parse(JSON.stringify(P)), tracks: JSON.parse(JSON.stringify(p.edit.tracks)), builtin: false });
    app.userTemplates = await store.listTemplates(); p.edit.templateId = t.id; await save(); toast('Шаблон сохранён'); viewMontage();
  };
  document.querySelectorAll('[data-applytpl]').forEach(b => b.onclick = () => applyTemplate(b.dataset.applytpl));
  document.querySelectorAll('[data-deltpl]').forEach(b => b.onclick = async () => { if (!await confirmBox('Удалить шаблон?', 'Удалить')) return; await store.deleteTemplate(b.dataset.deltpl); app.userTemplates = await store.listTemplates(); viewMontage(); });
  // рендерер
  const cv = $('#cv');
  const sc = app.settings.previewScale || 0.5;
  cv.width = Math.round(app.settings.width * sc); cv.height = Math.round(app.settings.height * sc);
  try {
    if (app.renderer) app.renderer.dispose();
    app.renderer = new Renderer(cv);
    const bs = $('#buildState'); if (bs) bs.textContent = 'анализ и синтез звука…';
    await ensureBuild();
    if (!cv.isConnected) return;
    await app.renderer.prepare(app.build.edl, getBlob);
    $('#ovl')?.remove();
    if (bs) bs.textContent = '';
    renderFrame(app.player.t || app.build.edl.introDur + 0.6);
    drawTimeline();
  } catch (e) { if ($('#ovl')) $('#ovl').innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; console.error(e); return; }

}
// Применение правок из поля «Правки» (или экспорт при «готово»)
async function runEdits() {
  const p = app.project;
  const et = $('#editsText'); const text = (et?.value || '').trim();
  if (!text) return;
  if (isReady(text)) return doExport();
  app.editsBusy = true;
  const rb = $('#runEdits'); if (rb) { rb.disabled = true; rb.textContent = 'Разбираю правки…'; }
  const st = $('#editsState');
  try {
    await ensureBuild();
    let ops = null, reply = '', how = '';
    if (hasAI()) {
      try {
        if (st) st.textContent = 'ИИ читает правки…';
        const ans = extractJSON(await askAI(aiEditPrompt(text, describeState(p, app.build.edl))));
        ops = Array.isArray(ans.ops) ? ans.ops : []; reply = String(ans.reply || ''); how = 'ИИ';
      } catch (e) { console.warn('AI edits failed', e); ops = null; }
    }
    let notes = [];
    if (!ops) { const r = parseEditsLocal(text); ops = r.ops; notes = r.notes; how = 'разбор по ключевым словам'; }
    store.snapshot(p, 'Перед правками: ' + text.slice(0, 60));
    const changes = applyOps(p, ops, app.build.edl);
    p.edit.editLog = p.edit.editLog || [];
    p.edit.editLog.unshift({ at: Date.now(), text, changes, how });
    if (changes.length) { p.edit.approved = false; invalidateBuild(); }
    await save();
    app.lastEditResult = changes.length
      ? `<div class="notice ok small"><b>Применено (${how}):</b><br>${changes.map(esc).join('<br>')}${reply ? `<br><span class="muted">${esc(reply)}</span>` : ''}${notes.length ? `<br><span class="status-warn">Не понял: ${notes.map(esc).join('; ')}</span>` : ''}<br>Посмотрите результат. Если всё хорошо — напишите «готово».</div>`
      : `<div class="notice warn small">Не получилось понять правки${reply ? ': ' + esc(reply) : ''}. Попробуйте конкретнее, например: «кадр 3 медленнее», «меньше зелёных полос», «скример из кадра 5», «титр: Больница №13; 14.10.1996».</div>`;
    app.editsDraft = changes.length ? '' : text;
  } catch (e) {
    app.lastEditResult = `<div class="notice bad small">Ошибка: ${esc(e.message)}</div>`;
  } finally { app.editsBusy = false; }
  viewMontage();
}

async function applyTemplate(id) {
  const p = app.project;
  const t = templateById(id, app.userTemplates);
  const keep = (({ seed, overrides, targetDuration, introDur, outroDur, title, screamer, editLog }) => ({ seed, overrides, targetDuration, introDur, outroDur, title, screamer, editLog }))(p.edit);
  p.edit = { ...editFromTemplate(t), ...keep };
  invalidateBuild(); await save(); toast('Применён стиль: ' + t.name); viewMontage();
}

async function doExport({ auto = false } = {}) {
  const p = app.project;
  if (app.exportJob) return toast('Экспорт уже идёт');
  // экспорт запускается только словом «готово» в поле правок — это и есть одобрение монтажа
  if (!p.edit.approved) { p.edit.approved = true; store.snapshot(p, 'Монтаж одобрен («готово»)'); }
  p.edit.editLog = p.edit.editLog || [];
  p.edit.editLog.unshift({ at: Date.now(), text: 'готово', changes: ['Экспорт MP4'], how: 'готово' });
  app.lastEditResult = ''; app.editsDraft = '';
  stopPlayback();
  await ensureBuild();
  const box = $('#exportBox') || document.createElement('div');
  const ac = new AbortController();
  app.exportJob = ac;
  box.innerHTML = `<div class="card" style="margin-top:10px"><b>Экспорт ${app.settings.width}×${app.settings.height}, ${app.settings.fps} FPS</b><div class="progress"><i id="exP" style="width:0"></i></div><div class="small muted" id="exT">Подготовка…</div><button class="btn sm" id="exCancel">Отменить</button></div>`;
  $('#exCancel').onclick = () => ac.abort();
  try {
    const caps = app.caps || await detectCapabilities(app.settings.width, app.settings.height, app.settings.fps);
    const res = await exportVideo({
      edl: app.build.edl, getBlob, audio: app.build.mix, width: app.settings.width, height: app.settings.height,
      videoBitrate: app.settings.videoBitrate, audioBitrate: app.settings.audioBitrate, caps, signal: ac.signal,
      onProgress: pr => { const e = $('#exP'); if (e) e.style.width = (pr.done / pr.total * 100) + '%'; const tt = $('#exT'); if (tt) tt.textContent = `${pr.stage}: ${typeof pr.done === 'number' && pr.total > 2 ? `${Math.round(pr.done)} / ${Math.round(pr.total)}` : ''}${pr.eta ? ` · осталось ~${Math.ceil(pr.eta)} с` : ''}`; },
    });
    $('#exT') && ($('#exT').textContent = 'Проверка готового файла…');
    const verify = await verifyVideoFile(res.blob, app.build.edl);
    const videoId = await store.saveVideo(res.blob, { projectId: p.id });
    p.renders = p.renders || [];
    p.renders.unshift({ videoId, at: Date.now(), duration: app.build.edl.duration, size: res.blob.size, mime: res.mime, ext: res.ext, method: res.method, videoCodec: res.videoCodec, audioCodec: res.audioCodec, verify, width: app.settings.width, height: app.settings.height, template: p.edit.templateId });
    p.status = 'done';
    store.snapshot(p, 'Экспорт ' + new Date().toLocaleString('ru-RU'));
    await save();
    const url = URL.createObjectURL(res.blob);
    box.innerHTML = `<div class="card" style="margin-top:10px"><b class="status-${verify.ok ? 'ok' : 'warn'}">${verify.ok ? '✓ Видео готово и проверено' : '! Видео готово, есть замечания'}</b>
      <video src="${url}" controls playsinline style="margin:8px 0"></video>
      <div class="small muted">${res.ext.toUpperCase()} · ${(res.blob.size / 1e6).toFixed(1)} МБ · видео ${esc(res.videoCodec)} · звук ${esc(res.audioCodec)} · ${esc(res.method)}${res.seconds ? ` · ${res.seconds.toFixed(0)} с` : ''}</div>
      ${verify.checks.map(c => `<div class="small status-${c.ok ? 'ok' : c.warn ? 'warn' : 'bad'}">${c.ok ? '✓' : '!'} ${esc(c.text)}</div>`).join('')}
      ${res.audioCodec === 'opus' ? '<div class="notice warn small">Звук закодирован в Opus: этот браузер не умеет кодировать AAC. Для 100% совместимости с TikTok/Reels экспортируйте в Chrome/Edge на Windows, macOS или Android.</div>' : ''}
      <div class="row" style="margin-top:8px"><button class="btn primary" id="dl">Скачать ${res.ext.toUpperCase()}</button><button class="btn" data-go="archive">В архив</button></div></div>`;
    $('#dl').onclick = () => download(res.blob, `${safeName(p.title)}.${res.ext}`);
    bindGo(box);
    toast('Экспорт завершён');
    return res;
  } catch (e) {
    box.innerHTML = `<div class="notice ${e.name === 'AbortError' ? 'warn' : 'bad'}">${e.name === 'AbortError' ? 'Экспорт отменён' : 'Ошибка экспорта: ' + esc(e.message)}</div>`;
    console.error(e);
  } finally { app.exportJob = null; }
}

// ---------- КОНТРОЛЬ КАЧЕСТВА ----------
async function doQC() {
  const p = app.project;
  await ensureBuild(true);
  const st = $('#qcProg');
  const rep = await runQC({ project: p, edl: app.build.edl, analyses: app.build.analyses, synth: app.build.synth, mix: app.build.mix, settings: app.settings, getBlob, onProgress: pr => { if (st) st.innerHTML = `<div class="small muted">Рендер и анализ кадров: ${pr.done}/${pr.total}</div><div class="progress"><i style="width:${pr.done / pr.total * 100}%"></i></div>`; } });
  p.qc = rep; await save();
  return rep;
}
async function fixAll(maxIter = 3) {
  const p = app.project;
  if (p.edit.approved && app.settings.mode !== 'auto' && !await confirmBox('Монтаж одобрен. Автоисправление изменит параметры монтажа и снимет одобрение (сценарий не меняется). Продолжить?', 'Исправить')) return;
  const log = [];
  for (let k = 0; k < maxIter; k++) {
    const fixes = (p.qc?.items || []).filter(i => i.fix && i.status !== 'ok');
    if (!fixes.length) break;
    store.snapshot(p, 'Перед автоисправлением');
    for (const f of fixes) { const m = applyFix(p, f.fix, app.build.edl, app.settings); if (m) log.push(m); }
    p.edit.approved = false;
    invalidateBuild(); await save();
    await doQC();
  }
  return log;
}
function viewQC() {
  if (needProject('Контроль качества')) return;
  const p = app.project;
  const has = (p.storyboard?.shots || []).some(s => (s.images || []).length);
  const rep = p.qc;
  const icon = { ok: '✓', warn: '!', fail: '✕' };
  const lastRender = p.renders?.[0];
  $('#main').innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Контроль качества</h1><p>Автоматическая техническая проверка монтажа, реально отрендеренных кадров и звукового сигнала. Где можно — исправляет сама.</p></div>
      <div class="row"><button class="btn primary" id="run" ${has ? '' : 'disabled'}>Запустить проверку</button>${rep && (rep.fails || rep.warns) ? '<button class="btn" id="fixall">Исправить автоматически</button>' : ''}</div></div>
    <div id="qcProg"></div>
    ${rep ? `<div class="card"><div class="row" style="justify-content:space-between"><h3 class="status-${rep.fails ? 'fail' : rep.warns ? 'warn' : 'ok'}" style="margin:0">${esc(rep.summary)}</h3><span class="small muted">${fmtDate(rep.at)}</span></div>
      <p class="small muted">${esc(rep.method)}</p>
      ${rep.items.map(i => `<div class="qc-item"><span class="ic status-${i.status}">${icon[i.status]}</span><div><b>${esc(i.title)}</b><pre>${esc(i.details)}</pre></div>${i.fix && i.status !== 'ok' ? `<button class="btn sm" data-fix="${i.fix}">Исправить</button>` : '<span></span>'}</div>`).join('')}
    </div>` : `<div class="card empty">${has ? 'Проверка ещё не запускалась.' : 'Сначала загрузите изображения в Галерее.'}</div>`}
    ${lastRender?.verify ? `<div class="card" style="margin-top:14px"><h3>Проверка последнего экспортированного файла</h3><p class="small muted">${fmtDate(lastRender.at)} · браузер заново открыл готовый файл, проверил декодирование, длительность, кадры сцен и звуковую дорожку.</p>${lastRender.verify.checks.map(c => `<div class="small status-${c.ok ? 'ok' : c.warn ? 'warn' : 'bad'}">${c.ok ? '✓' : '!'} ${esc(c.text)}</div>`).join('')}</div>` : ''}
  </div>`;
  if ($('#run')) $('#run').onclick = async () => { $('#run').disabled = true; try { await doQC(); } catch (e) { toast('Ошибка: ' + e.message); } viewQC(); };
  if ($('#fixall')) $('#fixall').onclick = async () => { const log = await fixAll(); if (log) toast(log.join(' ') || 'Нечего исправлять', 6000); viewQC(); };
  document.querySelectorAll('[data-fix]').forEach(b => b.onclick = async () => {
    if (p.edit.approved && !await confirmBox('Монтаж одобрен. Исправление снимет одобрение (сценарий не меняется). Продолжить?', 'Исправить')) return;
    await ensureBuild(); store.snapshot(p, 'Перед исправлением: ' + b.dataset.fix);
    const m = applyFix(p, b.dataset.fix, app.build.edl, app.settings);
    p.edit.approved = false; invalidateBuild(); await save(); toast(m || 'Готово');
    b.disabled = true; b.textContent = 'Перепроверка…'; await doQC(); viewQC();
  });
}

// ---------- АРХИВ ----------
async function viewArchive() {
  const all = await store.listProjects();
  const withR = all.filter(p => (p.renders || []).length);
  const p = app.project;
  $('#main').innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Архив</h1><p>Готовые ролики, версии проектов и резервные копии.</p></div>
      <div class="row"><label class="btn">Импорт проекта<input type="file" accept=".hsproj,.json,application/json" id="imp" class="file-in"></label></div></div>
    ${p ? `<div class="card"><h3>Текущий проект: ${esc(p.title)}</h3>
      <div class="row"><button class="btn" id="backup">Скачать проект (резервная копия .json)</button><span class="small muted">Включает идею, сценарий, промпты, изображения и настройки монтажа. Видео не входит — его скачивайте отдельно.</span></div>
      <details style="margin-top:12px"><summary>История версий (${(p.versions || []).length})</summary>${(p.versions || []).map(v => `<div class="row" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)"><span class="small">${fmtDate(v.at)} — ${esc(v.label)}</span><button class="btn sm" data-restore="${v.id}">Восстановить</button></div>`).join('') || '<p class="muted small">Пусто</p>'}</details></div>` : ''}
    <h4 style="margin-top:20px">Готовые ролики</h4>
    ${withR.length ? `<div class="grid g3">${withR.map(pr => pr.renders.map((r, k) => `<div class="card"><b>${esc(pr.title)}</b>${k ? ` <span class="tag">версия ${pr.renders.length - k}</span>` : ' <span class="tag red">последняя</span>'}
      <div class="small muted">${fmtDate(r.at)} · ${r.duration.toFixed(1)} с · ${(r.size / 1e6).toFixed(1)} МБ · ${esc(r.ext?.toUpperCase())} · ${esc(r.videoCodec)} + ${esc(r.audioCodec)}</div>
      <div data-vid="${r.videoId}" style="margin:8px 0"><button class="btn sm" data-load="${r.videoId}">Показать видео</button></div>
      <div class="row"><button class="btn sm primary" data-dlv="${r.videoId}" data-name="${esc(safeName(pr.title))}.${r.ext}">Скачать</button><button class="btn sm" data-open="${pr.id}">Открыть проект</button><button class="btn sm ghost" data-delv="${pr.id}:${r.videoId}">Удалить видео</button></div></div>`).join('')).join('')}</div>` : '<div class="card empty">Пока нет экспортированных роликов.</div>'}
    <h4 style="margin-top:20px">Все проекты</h4><div class="card">${all.map(projRow).join('') || '<p class="muted">Нет проектов</p>'}</div>
  </div>`;
  bindProjRows();
  $('#imp').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const np = await store.importProjectFile(f); toast('Проект импортирован'); openProject(np.id); } catch (err) { toast('Ошибка импорта: ' + err.message); } };
  if ($('#backup')) $('#backup').onclick = async () => download(await store.exportProjectFile(p), safeName(p.title) + '.horror.json');
  document.querySelectorAll('[data-restore]').forEach(b => b.onclick = async () => {
    const v = p.versions.find(x => x.id === b.dataset.restore);
    if (!await confirmBox(`Восстановить версию «${esc(v.label)}» от ${fmtDate(v.at)}? Текущее состояние тоже сохранится в истории.`, 'Восстановить')) return;
    store.snapshot(p, 'Перед восстановлением версии');
    Object.assign(p, JSON.parse(JSON.stringify(v.data)));
    invalidateBuild(); await save(); toast('Версия восстановлена'); render();
  });
  document.querySelectorAll('[data-load]').forEach(b => b.onclick = async () => { const rec = await store.getVideo(b.dataset.load); if (!rec) return toast('Файл не найден'); b.parentElement.innerHTML = `<video src="${URL.createObjectURL(rec.blob)}" controls playsinline></video>`; });
  document.querySelectorAll('[data-dlv]').forEach(b => b.onclick = async () => { const rec = await store.getVideo(b.dataset.dlv); if (rec) download(rec.blob, b.dataset.name); });
  document.querySelectorAll('[data-delv]').forEach(b => b.onclick = async () => {
    if (!await confirmBox('Удалить этот видеофайл из архива?', 'Удалить')) return;
    const [pid, vid] = b.dataset.delv.split(':');
    const pr = await store.loadProject(pid); pr.renders = pr.renders.filter(r => r.videoId !== vid); await store.saveProject(pr); await store.db.del('videos', vid);
    if (app.project?.id === pid) app.project.renders = pr.renders;
    render();
  });
}

// ---------- НАСТРОЙКИ ----------
function viewSettings() {
  const s = app.settings;
  const tpls = [...BUILTIN_TEMPLATES, ...app.userTemplates];
  const capLines = app.caps ? describeCapabilities(app.caps) : [];
  $('#main').innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Настройки</h1><p>Параметры по умолчанию для новых проектов и экспорта.</p></div></div>
    <div class="grid g2">
      <div class="card"><h3>Режим работы</h3>${Object.entries(MODES).map(([k, v]) => `<label class="row" style="margin:6px 0;align-items:flex-start;flex-wrap:nowrap"><input type="radio" name="mode" value="${k}" ${s.mode === k ? 'checked' : ''}><span><b>${v}</b><br><span class="small muted">${esc(MODE_HINT[k])}</span></span></label>`).join('')}</div>
      <div class="card"><h3>Продолжительность</h3>
        <label class="f"><span>Минимум, с</span><input type="number" id="minD" value="${s.minDuration}" min="10" max="120"></label>
        <label class="f"><span>Максимум, с</span><input type="number" id="maxD" value="${s.maxDuration}" min="10" max="180"></label>
        <label class="f"><span>Целевая, с</span><input type="number" id="tD" value="${s.targetDuration}" min="10" max="180"></label></div>
      <div class="card"><h3>Экспорт</h3>
        <label class="f"><span>Разрешение</span><select id="res">${[[1080, 1920, '1080×1920 (стандарт Shorts/Reels/TikTok)'], [720, 1280, '720×1280 (быстрее, для черновиков)'], [1440, 2560, '1440×2560 (если браузер поддерживает)']].map(([w, h, n]) => `<option value="${w}x${h}" ${s.width === w ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="f"><span>Частота кадров</span><select id="fps">${[24, 25, 30].map(f => `<option ${s.fps === f ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
        <label class="f"><span>Битрейт видео, Мбит/с</span><input type="number" id="vbr" value="${s.videoBitrate / 1e6}" min="2" max="40" step="1"></label>
        <label class="f"><span>Качество предпросмотра</span><select id="pscale">${[[0.35, 'Экономное'], [0.5, 'Стандартное'], [0.75, 'Высокое']].map(([v, n]) => `<option value="${v}" ${s.previewScale === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
      <div class="card"><h3>Стиль по умолчанию</h3>
        <label class="f"><span>Шаблон монтажа для новых проектов (если формат идеи не задаёт свой)</span><select id="dtpl">${tpls.map(t => `<option value="${t.id}" ${s.defaultTemplate === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
        <label class="f"><span>Эстетика для запросов в ChatGPT</span><input type="text" id="styles" value="${esc(s.styles.join(', '))}"></label>
        <p class="small muted">Свои шаблоны создаются в Монтажной → Шаблоны.</p></div>
      <div class="card"><h3>Возможности этого браузера</h3>${capLines.map(l => `<div class="small status-${l.level === 'info' ? 'info' : l.level}" style="margin:4px 0">${l.level === 'ok' ? '✓' : l.level === 'bad' ? '✕' : '!'} <span style="color:var(--text)">${esc(l.text)}</span></div>`).join('')}</div>
      <div class="card"><h3>О системе</h3><p class="small muted">HORROR STUDIO работает полностью в браузере: монтаж — WebGL2, звук — собственный синтез, видео — WebCodecs (H.264) + MP4-контейнер (библиотека mp4-muxer, MIT). Данные не отправляются на серверы. Платные API не используются.</p></div>
    </div>
    <div class="row" style="margin-top:16px"><button class="btn primary" id="saveS">Сохранить настройки</button></div></div>`;
  $('#saveS').onclick = async () => {
    s.mode = document.querySelector('[name=mode]:checked').value;
    s.minDuration = +$('#minD').value; s.maxDuration = Math.max(s.minDuration, +$('#maxD').value); s.targetDuration = Math.min(s.maxDuration, Math.max(s.minDuration, +$('#tD').value));
    const [w, h] = $('#res').value.split('x').map(Number); s.width = w; s.height = h; s.fps = +$('#fps').value;
    s.videoBitrate = +$('#vbr').value * 1e6; s.previewScale = +$('#pscale').value; s.defaultTemplate = $('#dtpl').value;
    s.styles = $('#styles').value.split(',').map(x => x.trim()).filter(Boolean);
    await store.saveSettings(s); app.caps = await detectCapabilities(s.width, s.height, s.fps); invalidateBuild();
    toast('Настройки сохранены'); render();
  };
}

// ---------- АВТОПИЛОТ ----------
async function autopilot() {
  const p = app.project;
  app.autopilot = true;
  try {
    if (!p.ideaApproved) {
      app.history = await store.listIdeaHistory();
      if (!p.ideas?.length) { p.ideas = generateIdeas(10, app.history, Date.now()); for (const i of p.ideas) await store.saveIdeaRecord({ idea: i, projectId: p.id, liked: false, id: 'h_' + i.id }); }
      const best = p.ideas[0];
      applyIdea(p, best); p.ideaApproved = true;
      const r = generateStoryboard(best, app.settings, { seed: Date.now() });
      p.storyboard = r.storyboard; p.bible = r.bible; p.script = r.script; p.storyboard.approved = true;
      store.snapshot(p, 'Автопилот: идея и раскадровка');
      await save();
      toast(`Автопилот выбрал «${best.title}» (${best.score.toFixed(1)}) и утвердил раскадровку`, 6000);
    }
    const missing = p.storyboard.shots.filter(s => !(s.images || []).length && s.enabled !== false);
    if (missing.length) {
      app.view = 'gallery'; render();
      toast(`Автопилот ждёт изображения для ${missing.length} кадров. Скопируйте промпты в ChatGPT и перетащите картинки — дальше всё продолжится само.`, 9000);
      return;
    }
    app.view = 'qc'; render();
    invalidateBuild();
    await doQC();
    const fixes = await fixAll(3);
    viewQC();
    toast('Автопилот: проверка пройдена' + (fixes?.length ? ', исправлено: ' + fixes.length : '') + '. Экспорт…', 5000);
    app.view = 'montage'; app.montageTab = 'plan';
    await viewMontage();
    await save();
    toast('Автопилот собрал и проверил монтаж. Посмотрите ролик и напишите в поле «Правки» ваши правки или «готово» — после «готово» начнётся экспорт MP4.', 10000);
    $('#editsText')?.focus();
    app.autopilot = false;
  } catch (e) { toast('Автопилот остановлен: ' + e.message, 8000); console.error(e); app.autopilot = false; }
}

// ---------- запуск ----------
async function boot() {
  try {
    app.settings = await store.getSettings();
    app.userTemplates = await store.listTemplates();
    app.history = await store.listIdeaHistory();
    app.projects = await store.listProjects();
    try { app.persisted = await navigator.storage?.persisted?.(); } catch (e) {}
    app.caps = await detectCapabilities(app.settings.width, app.settings.height, app.settings.fps);
    const lastId = localStorageGet('hs_last');
    if (lastId) app.project = await store.loadProject(lastId) || null;
  } catch (e) {
    $('#main').innerHTML = `<div class="page"><div class="notice bad">Не удалось открыть локальное хранилище браузера: ${esc(e.message)}. Возможно, включён приватный режим или запрещены данные сайтов.</div></div>`;
    return;
  }
  render();
  initPlatform().then(c => { if (c.sample || c.downloads) render(); });
  setInterval(() => { if (app.project) localStorageSet('hs_last', app.project.id); }, 2000);
}
function localStorageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
window.addEventListener('keydown', e => { if (app.view === 'montage' && e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#play')?.click(); } });
boot();
