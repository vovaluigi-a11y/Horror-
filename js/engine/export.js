// Экспорт видео.
// Основной путь: WebCodecs (аппаратный/программный H.264 в браузере) + mp4-muxer → настоящий MP4.
// Звук: AAC, если браузер умеет его кодировать (Chrome/Edge на Windows/macOS/Android, Safari);
// иначе Opus в MP4 (Chrome на Linux) — с честным предупреждением.
// Запасной путь: MediaRecorder (запись в реальном времени) — MP4 или WebM, что поддерживает браузер.

import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer.mjs';
import { Renderer } from './renderer.js';
import { stateAt } from './timeline.js';
import { SR } from './audio.js';

export async function detectCapabilities(width = 1080, height = 1920, fps = 30) {
  const caps = { webcodecs: false, videoCodec: null, audioCodec: null, mediaRecorder: [], webgl2: false, secure: window.isSecureContext };
  try { const c = document.createElement('canvas'); caps.webgl2 = !!c.getContext('webgl2'); } catch (e) {}
  if (typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined') {
    for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.640032', 'avc1.42e028']) {
      try { const s = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate: 8e6, framerate: fps }); if (s.supported) { caps.videoCodec = codec; break; } } catch (e) {}
    }
    for (const [codec, name] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
      try { const s = await AudioEncoder.isConfigSupported({ codec, sampleRate: SR, numberOfChannels: 2, bitrate: 192000 }); if (s.supported) { caps.audioCodec = name; caps.audioCodecString = codec; break; } } catch (e) {}
    }
    caps.webcodecs = !!caps.videoCodec;
  }
  if (window.MediaRecorder) for (const t of ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']) { try { if (MediaRecorder.isTypeSupported(t)) caps.mediaRecorder.push(t); } catch (e) {} }
  return caps;
}

export function describeCapabilities(c) {
  const lines = [];
  if (!c.secure) lines.push({ level: 'bad', text: 'Страница открыта не по HTTPS — браузер отключает кодировщики видео. Откройте приложение по https:// или с localhost.' });
  lines.push(c.webgl2 ? { level: 'ok', text: 'WebGL2 доступен — монтажный движок работает на видеокарте.' } : { level: 'bad', text: 'WebGL2 недоступен — рендер невозможен.' });
  if (c.webcodecs) lines.push({ level: 'ok', text: `Кодировщик H.264 доступен (${c.videoCodec}) — экспорт настоящего MP4 1080×1920.` });
  else lines.push({ level: 'warn', text: 'WebCodecs H.264 недоступен — будет использована запись в реальном времени (MediaRecorder).' });
  if (c.audioCodec === 'aac') lines.push({ level: 'ok', text: 'Кодировщик AAC доступен — итог: MP4 (H.264 + AAC), идеально для TikTok/Shorts/Reels.' });
  else if (c.audioCodec === 'opus') lines.push({ level: 'warn', text: 'Этот браузер не кодирует AAC (типично для Chrome на Linux). Звук будет в Opus внутри MP4: YouTube и большинство плееров принимают, но для 100% совместимости экспортируйте в Chrome/Edge на Windows/macOS/Android или Safari.' });
  else lines.push({ level: 'warn', text: 'Кодировщик звука WebCodecs недоступен — используется запасной путь.' });
  if (c.mediaRecorder.length) lines.push({ level: 'info', text: 'Запасной формат записи: ' + c.mediaRecorder[0] });
  return lines;
}

// Полный экспорт: рендер каждого кадра + кодирование
export async function exportVideo({ edl, getBlob, audio, width, height, videoBitrate, audioBitrate, onProgress, signal, caps }) {
  caps = caps || await detectCapabilities(width, height, edl.fps);
  if (caps.webcodecs) return exportWebCodecs({ edl, getBlob, audio, width, height, videoBitrate, audioBitrate, onProgress, signal, caps });
  if (caps.mediaRecorder.length) return exportRealtime({ edl, getBlob, audio, width, height, videoBitrate, onProgress, signal, caps });
  throw new Error('Браузер не поддерживает ни WebCodecs, ни MediaRecorder. Используйте актуальный Chrome, Edge или Safari.');
}

async function exportWebCodecs({ edl, getBlob, audio, width, height, videoBitrate, audioBitrate, onProgress, signal, caps }) {
  const fps = edl.fps;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const renderer = new Renderer(canvas);
  await renderer.prepare(edl, getBlob);
  const hasAudio = !!(audio && caps.audioCodec);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width, height, frameRate: fps },
    audio: hasAudio ? { codec: caps.audioCodec === 'aac' ? 'aac' : 'opus', sampleRate: SR, numberOfChannels: 2 } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let encErr = null;
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { encErr = e; } });
  venc.configure({ codec: caps.videoCodec, width, height, bitrate: videoBitrate, framerate: fps, latencyMode: 'quality', avc: { format: 'avc' } });

  const total = edl.frames;
  const t0 = performance.now();
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw new DOMException('Экспорт отменён', 'AbortError');
    if (encErr) throw encErr;
    const t = i / fps;
    const S = stateAt(edl, t);
    renderer.draw(S, edl);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
    venc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    while (venc.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 2));
    if (i % 5 === 0) {
      const el = (performance.now() - t0) / 1000;
      onProgress?.({ stage: 'Видео', done: i + 1, total, eta: el / (i + 1) * (total - i - 1) });
      await new Promise(r => setTimeout(r, 0));
    }
  }
  await venc.flush();
  venc.close();

  if (hasAudio) {
    onProgress?.({ stage: 'Звук', done: 0, total: 1 });
    const [L, R] = audio;
    const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: e => { encErr = e; } });
    aenc.configure({ codec: caps.audioCodecString, sampleRate: SR, numberOfChannels: 2, bitrate: audioBitrate });
    const block = 4800;
    const n = Math.min(L.length, Math.round(edl.duration * SR));
    for (let i = 0; i < n; i += block) {
      const m = Math.min(block, n - i);
      const data = new Float32Array(m * 2);
      data.set(L.subarray(i, i + m), 0); data.set(R.subarray(i, i + m), m);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: m, numberOfChannels: 2, timestamp: Math.round(i * 1e6 / SR), data });
      aenc.encode(ad); ad.close();
      if (encErr) throw encErr;
    }
    await aenc.flush(); aenc.close();
  }
  muxer.finalize();
  renderer.dispose();
  const blob = new Blob([target.buffer], { type: 'video/mp4' });
  return { blob, mime: 'video/mp4', ext: 'mp4', videoCodec: caps.videoCodec, audioCodec: hasAudio ? caps.audioCodec : 'нет', method: 'WebCodecs', seconds: (performance.now() - t0) / 1000 };
}

// Запасной путь: запись с холста в реальном времени
async function exportRealtime({ edl, getBlob, audio, width, height, videoBitrate, onProgress, signal, caps }) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const renderer = new Renderer(canvas);
  await renderer.prepare(edl, getBlob);
  const ctx = new AudioContext({ sampleRate: SR });
  const dest = ctx.createMediaStreamDestination();
  const stream = canvas.captureStream(edl.fps);
  let src = null;
  if (audio) {
    const b = ctx.createBuffer(2, audio[0].length, SR); b.copyToChannel(audio[0], 0); b.copyToChannel(audio[1], 1);
    src = ctx.createBufferSource(); src.buffer = b; src.connect(dest);
    for (const tr of dest.stream.getAudioTracks()) stream.addTrack(tr);
  }
  const mime = caps.mediaRecorder[0];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: videoBitrate });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise(r => { rec.onstop = r; });
  renderer.renderAt(edl, 0);
  rec.start(500);
  await ctx.resume();
  const start = ctx.currentTime + 0.05;
  if (src) src.start(start);
  await new Promise((resolve, reject) => {
    const tick = () => {
      if (signal?.aborted) { reject(new DOMException('Экспорт отменён', 'AbortError')); return; }
      const t = ctx.currentTime - start;
      if (t >= edl.duration) { resolve(); return; }
      renderer.renderAt(edl, Math.max(0, t));
      onProgress?.({ stage: 'Запись в реальном времени', done: Math.max(0, t), total: edl.duration });
      requestAnimationFrame(tick);
    };
    tick();
  }).finally(() => { try { rec.stop(); } catch (e) {} });
  await done;
  ctx.close(); renderer.dispose();
  const isMp4 = mime.startsWith('video/mp4');
  const blob = new Blob(chunks, { type: isMp4 ? 'video/mp4' : 'video/webm' });
  return { blob, mime: blob.type, ext: isMp4 ? 'mp4' : 'webm', videoCodec: mime, audioCodec: audio ? 'в составе записи' : 'нет', method: 'MediaRecorder (реальное время)' };
}

// Проверка готового файла: браузер декодирует видео, сверяем длительность, кадры и звук
export async function verifyVideoFile(blob, edl) {
  const res = { checks: [] };
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  try {
    await new Promise((ok, bad) => { v.onloadedmetadata = ok; v.onerror = () => bad(new Error('Браузер не смог открыть файл')); setTimeout(() => bad(new Error('Таймаут чтения файла')), 20000); });
    res.width = v.videoWidth; res.height = v.videoHeight; res.duration = v.duration;
    res.checks.push({ ok: v.videoWidth > 0, text: `Файл декодируется: ${v.videoWidth}×${v.videoHeight}` });
    const dd = Math.abs(v.duration - edl.duration);
    res.checks.push({ ok: dd < 0.25, text: `Длительность файла ${v.duration.toFixed(2)} с (план ${edl.duration.toFixed(2)} с)` });
    const c = document.createElement('canvas'); c.width = 54; c.height = 96;
    const g = c.getContext('2d', { willReadFrequently: true });
    const samples = [];
    for (const s of edl.segments) samples.push((s.start + s.end) / 2);
    let okFrames = 0;
    const lum = [];
    for (const t of samples) {
      await new Promise((ok) => { v.onseeked = ok; v.currentTime = Math.min(v.duration - 0.05, t); setTimeout(ok, 4000); });
      g.drawImage(v, 0, 0, c.width, c.height);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      const m = s / (d.length / 4) / 3 / 255; lum.push(m);
      if (m > 0.02) okFrames++;
    }
    res.checks.push({ ok: okFrames === samples.length, text: `Кадры сцен читаются из файла: ${okFrames} из ${samples.length} (средняя яркость ${lum.map(x => (x * 100).toFixed(0)).join('/')}%)` });
  } catch (e) {
    res.checks.push({ ok: false, text: 'Ошибка проверки видео: ' + e.message });
  } finally { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); }
  // звук: декодируем дорожку из файла
  try {
    const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, SR, SR);
    const ab = await blob.arrayBuffer();
    const buf = await ctx.decodeAudioData(ab);
    const ch = buf.getChannelData(0);
    let e = 0; for (let i = 0; i < ch.length; i += 7) e += ch[i] * ch[i];
    const rms = Math.sqrt(e / (ch.length / 7));
    res.audioDuration = buf.duration;
    res.checks.push({ ok: rms > 0.003 && Math.abs(buf.duration - edl.duration) < 0.3, text: `Звуковая дорожка декодируется: ${buf.duration.toFixed(2)} с, RMS ${(20 * Math.log10(rms + 1e-9)).toFixed(1)} дБ` });
  } catch (e) {
    res.checks.push({ ok: false, warn: true, text: 'Браузер не смог отдельно декодировать звук из файла (' + (e.message || e) + '). Проверьте звук, открыв файл в плеере.' });
  }
  res.ok = res.checks.every(c => c.ok || c.warn);
  return res;
}
