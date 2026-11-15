// WebGL-рендерер документального хоррор-монтажа.
// Один проход фрагментного шейдера: камера (матрица экран→изображение), 2.5D-параллакс по
// карте глубины, фокус, экспозиция, цвет, хроматические и аналоговые повреждения, зерно, OSD.

import { stateAt, cameraMatrix } from './timeline.js';
import { loadBitmap } from '../analyze.js';

const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }`;

const FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform vec2 uRes;
uniform sampler2D uTexA, uDepA, uTexB, uDepB, uOsd;
uniform vec3 uA0, uA1, uParA, uB0, uB1, uParB;
uniform float uHasA, uHasB, uMix, uMixMode, uHasOsd;
uniform float uBlur, uExposure, uFlash, uFade;
uniform float uRGB, uTear, uTearSeed, uBlock, uNoise, uTracking, uVroll, uJitter;
uniform vec3 uBands[4]; uniform float uBandCount;
uniform float uGrain, uScan, uSoft, uBleed, uVignette, uSat, uContrast, uWarmth, uGreen, uLift, uFlicker, uSeed;

float h1(float n){ return fract(sin(n*127.1+311.7)*43758.5453); }
float h2(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }

vec2 toImg(vec3 r0, vec3 r1, vec2 p){ return vec2(dot(r0, vec3(p,1.0)), dot(r1, vec3(p,1.0))); }

vec3 imgSample(sampler2D tex, sampler2D dep, vec3 r0, vec3 r1, vec3 par, vec2 p){
  vec2 uv = toImg(r0, r1, p);
  vec2 c = toImg(r0, r1, vec2(0.5));
  float d = texture(dep, uv).r - 0.5;
  uv += par.xy * d * 0.018;
  uv = c + (uv - c) * (1.0 - par.z * d * 0.035);
  if (uBlur > 0.02) {
    vec2 px = vec2(abs(r0.x), abs(r1.y)) / uRes * uBlur * 3.0;
    vec3 acc = texture(tex, uv).rgb * 0.2;
    acc += texture(tex, uv + px*vec2( 1.0, 0.0)).rgb * 0.1;
    acc += texture(tex, uv + px*vec2(-1.0, 0.0)).rgb * 0.1;
    acc += texture(tex, uv + px*vec2( 0.0, 1.0)).rgb * 0.1;
    acc += texture(tex, uv + px*vec2( 0.0,-1.0)).rgb * 0.1;
    acc += texture(tex, uv + px*vec2( 0.7, 0.7)*1.6).rgb * 0.1;
    acc += texture(tex, uv + px*vec2(-0.7, 0.7)*1.6).rgb * 0.1;
    acc += texture(tex, uv + px*vec2( 0.7,-0.7)*1.6).rgb * 0.1;
    acc += texture(tex, uv + px*vec2(-0.7,-0.7)*1.6).rgb * 0.1;
    return acc;
  }
  return texture(tex, uv).rgb;
}

vec3 scene(vec2 p, float row){
  vec3 a = uHasA > 0.5 ? imgSample(uTexA, uDepA, uA0, uA1, uParA, p) : vec3(0.0);
  if (uHasB > 0.5 && uMix > 0.001) {
    vec3 b = imgSample(uTexB, uDepB, uB0, uB1, uParB, p);
    float m = uMix;
    if (uMixMode > 0.5) m = step(0.5, h1(floor(row/6.0) + uTearSeed*0.13)) * step(0.15, uMix);
    a = mix(a, b, m);
  }
  return a;
}

void main(){
  vec2 p = vec2(vUv.x, 1.0 - vUv.y);
  float bar = 0.0;
  // срыв кадровой синхронизации
  if (abs(uVroll) > 0.0001) {
    float y = p.y + uVroll;
    float f = fract(y);
    bar = 1.0 - smoothstep(0.0, 0.035, min(f, 1.0 - f) );
    p.y = f;
  }
  float row = floor(p.y * uRes.y / max(1.0, uRes.y/480.0));
  // нестабильная строчная синхронизация
  if (uJitter > 0.001) {
    p.x += (h1(row*0.31 + uSeed) - 0.5) * 0.006 * uJitter + sin(p.y*40.0 + uSeed)*0.004*uJitter;
    p.y += (h1(uSeed*1.7) - 0.5) * 0.01 * uJitter;
  }
  // разрывы строк
  if (uTear > 0.001) {
    float c = h1(uTearSeed*0.77);
    float zone = 1.0 - smoothstep(0.0, 0.08 + 0.18*uTear, abs(p.y - c));
    float r2 = floor(p.y * 90.0);
    float sel = step(1.0 - 0.6*uTear, h1(r2 + uTearSeed*1.3));
    p.x += ((h1(r2*1.7 + uTearSeed) - 0.5) * 0.12 * uTear) * max(zone, sel*0.5);
  }
  // трекинг: зона искажения внизу кадра
  float trackZone = smoothstep(1.0 - 0.05 - uTracking*0.12, 1.0, p.y);
  p.x += trackZone * (h1(row*0.13 + uSeed) - 0.3) * 0.05 * uTracking;
  // зелёные полосы — сдвиг изображения внутри полосы
  float bandMask = 0.0;
  for (int i = 0; i < 4; i++) {
    if (float(i) >= uBandCount) break;
    vec3 b = uBands[i];
    float m = 1.0 - smoothstep(b.y*0.5*0.6, b.y*0.5, abs(p.y - b.x));
    bandMask = max(bandMask, m * b.z);
  }
  p.x += bandMask * 0.015 * sin(row*0.9 + uSeed);
  // цифровые блоки
  vec2 pb = p;
  float blockQ = 0.0;
  if (uBlock > 0.001) {
    vec2 bc = floor(p * vec2(12.0, 21.0));
    float hb = h2(bc + floor(uSeed*0.25));
    if (hb < uBlock * 0.4) {
      pb += (vec2(h2(bc+3.1), h2(bc+7.7)) - 0.5) * vec2(0.08, 0.03) * uBlock;
      blockQ = 1.0;
    }
  }
  // выборка с хроматическим смещением, аналоговой мягкостью и растеканием цвета
  float sh = uRGB / uRes.x * (uRes.x/1080.0) * 1.0 / 1.0;
  float spx = (1.5 + uSoft*2.5) / 1080.0;
  vec3 c0 = scene(pb, row);
  vec3 cR = scene(pb + vec2(sh, 0.0), row);
  vec3 cB = scene(pb - vec2(sh, 0.0), row);
  vec3 col = vec3(cR.r, c0.g, cB.b);
  if (uSoft > 0.01 || uBleed > 0.01) {
    vec3 cl = scene(pb - vec2(spx, 0.0), row);
    vec3 cr = scene(pb + vec2(spx*2.0, 0.0), row);
    col = mix(col, (col*2.0 + cl + cr) * 0.25, uSoft);
    vec3 cs = (c0 + cr + cr + cR) * 0.25;
    // YIQ: яркость резкая, цветность размытая и сдвинутая
    mat3 toY = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
    mat3 fromY = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
    vec3 y1 = toY * col; vec3 y2 = toY * cs;
    y1.yz = mix(y1.yz, y2.yz, uBleed);
    col = fromY * y1;
  }
  if (blockQ > 0.5) col = floor(col * 10.0) / 10.0;
  // экспозиция, мерцание, цвет
  col *= exp2(uExposure);
  col *= 1.0 + uFlicker * (h1(uSeed*0.37) - 0.5) * 2.0;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSat * 1.6);
  col = (col - 0.42) * (0.65 + uContrast * 0.8) + 0.42;
  col.r *= 1.0 + (uWarmth - 0.5) * 0.28; col.b *= 1.0 - (uWarmth - 0.5) * 0.32;
  l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(l*0.82, l*1.06, l*0.78), uGreen);
  col = col * (1.0 - uLift*0.22) + uLift * 0.075;
  col = mix(col, vec3(1.0), clamp(uFlash, 0.0, 1.0));
  // зелёные полосы
  if (bandMask > 0.001) {
    float n = h2(vec2(floor(p.x*uRes.x/3.0), row) + uSeed);
    vec3 g = vec3(0.12, 0.85, 0.32) * (0.55 + 0.45*n) + vec3(l*0.25);
    col = mix(col, g, clamp(bandMask*0.75, 0.0, 1.0));
  }
  // виньетка
  vec2 vq = (p - 0.5) * vec2(1.0, 0.82);
  col *= 1.0 - uVignette * 0.6 * pow(clamp(length(vq) * 1.45, 0.0, 1.4), 2.6);
  col *= uFade;
  // трекинг-шум и выпадения ленты
  float streak = step(0.985 - uTracking*0.06, h2(vec2(floor(p.x*uRes.x/40.0 + h1(row)*20.0), row + floor(uSeed))));
  col = mix(col, vec3(0.85), trackZone * uTracking * (0.35 + 0.65*streak));
  float drop = step(0.9993 - uTracking*0.0012, h2(vec2(row, floor(uSeed*0.5))));
  col = mix(col, vec3(0.9), drop * step(0.6, h1(p.x*30.0 + row)));
  // статика («снег»)
  if (uNoise > 0.001) {
    float s = h2(floor(p * uRes / vec2(2.0, 1.5)) + uSeed * 1.31);
    s = s * (0.75 + 0.25 * h1(row + uSeed));
    col = mix(col, vec3(s), clamp(uNoise, 0.0, 1.0));
  }
  // зерно
  float gn = h2(gl_FragCoord.xy * 0.37 + uSeed * 0.91) - 0.5;
  float gw = 0.6 + 0.4 * (1.0 - abs(l - 0.45) * 1.6);
  col += gn * uGrain * 0.16 * gw;
  // строчная развёртка
  col *= 1.0 - uScan * 0.16 * (0.5 + 0.5 * sin(p.y * 480.0 * 3.14159));
  col = mix(col, vec3(0.0), bar);
  // OSD
  if (uHasOsd > 0.5) {
    vec4 o = texture(uOsd, vec2(vUv.x, 1.0 - vUv.y));
    col = mix(col, o.rgb, o.a);
  }
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const MAX_TEX = 2048;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 недоступен в этом браузере. Используйте актуальный Chrome, Edge, Firefox или Safari.');
    this.gl = gl;
    this.prog = this._program(VS, FS);
    gl.useProgram(this.prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    const n = gl.getProgramParameter(this.prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(this.prog, i); const name = info.name.replace('[0]', ''); this.u[name] = gl.getUniformLocation(this.prog, info.name); }
    this.textures = new Map();
    this.flat = this._texFromPixels(new Uint8Array([128, 128, 128, 255]), 1, 1);
    this.black = this._texFromPixels(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.osdCanvas = document.createElement('canvas');
    this.osdTex = gl.createTexture();
    this.osdKey = '';
  }

  _program(vs, fs) {
    const gl = this.gl;
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Шейдер: ' + gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Программа: ' + gl.getProgramInfoLog(p));
    return p;
  }

  _texParams() {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  _texFromPixels(px, w, h) {
    const gl = this.gl; const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  _texFromSource(src) {
    const gl = this.gl; const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    this._texParams();
    return t;
  }

  // Загрузка текстур всех кадров монтажа
  async prepare(edl, getBlob) {
    for (const seg of edl.segments) {
      if (this.textures.has(seg.imageId)) continue;
      const blob = await getBlob(seg.imageId);
      if (!blob) throw new Error('Изображение кадра не найдено в хранилище');
      const bmp = await loadBitmap(blob);
      const crop = seg.analysis?.crop || { x: 0, y: 0, w: bmp.width, h: bmp.height };
      const sc = Math.min(1, MAX_TEX / Math.max(crop.w, crop.h));
      const c = document.createElement('canvas');
      c.width = Math.max(2, Math.round(crop.w * sc)); c.height = Math.max(2, Math.round(crop.h * sc));
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
      const tex = this._texFromSource(c);
      let dep = this.flat;
      if (seg.analysis?.depthURL) {
        const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = seg.analysis.depthURL; });
        dep = this._texFromSource(img);
      }
      this.textures.set(seg.imageId, { tex, dep, aspect: crop.w / crop.h });
    }
  }

  dispose() {
    const gl = this.gl;
    for (const v of this.textures.values()) { gl.deleteTexture(v.tex); if (v.dep !== this.flat) gl.deleteTexture(v.dep); }
    this.textures.clear();
  }

  _osd(S, W, H) {
    const o = S.osd;
    const blinkOn = Math.floor(S.t * 2) % 2 === 0;
    const key = o ? [o.tl, o.tr, o.bl, o.br, blinkOn, W, H].join('|') : '';
    if (key === this.osdKey) return !!o;
    this.osdKey = key;
    if (!o) return false;
    const c = this.osdCanvas;
    c.width = Math.round(W / 2); c.height = Math.round(H / 2);
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    const fs = Math.round(c.width * 0.052);
    g.font = `bold ${fs}px "Courier New", ui-monospace, monospace`;
    g.textBaseline = 'top';
    const pad = c.width * 0.07;
    const draw = (txt, x, y, align) => {
      if (!txt) return;
      g.textAlign = align;
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillText(txt, x + 2, y + 2);
      g.fillStyle = 'rgba(235,235,225,0.92)'; g.fillText(txt, x, y);
    };
    draw(o.tl, pad, pad * 1.4, 'left');
    if (o.tr) {
      if (o.tr === 'REC') {
        if (!o.blink || blinkOn) { g.fillStyle = 'rgba(220,30,30,0.95)'; g.beginPath(); g.arc(c.width - pad - fs * 2.6, pad * 1.4 + fs * 0.5, fs * 0.33, 0, Math.PI * 2); g.fill(); }
        draw('REC', c.width - pad, pad * 1.4, 'right');
      } else draw(o.tr, c.width - pad, pad * 1.4, 'right');
    }
    draw(o.bl, pad, c.height - pad * 1.6 - fs, 'left');
    draw(o.br, c.width - pad, c.height - pad * 1.6 - fs, 'right');
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.osdTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return true;
  }

  // Отрисовать кадр по состоянию S
  draw(S, edl) {
    const gl = this.gl, u = this.u;
    const W = this.canvas.width, H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.prog);
    const P = edl.params;
    const view = W / H;
    const bind = (unit, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); };
    const setLayer = (L, texU, depU, r0, r1, par, has, unitT, unitD) => {
      if (!L) { gl.uniform1f(has, 0); bind(unitT, this.black); bind(unitD, this.flat); gl.uniform1i(texU, unitT); gl.uniform1i(depU, unitD); return; }
      const T = this.textures.get(L.seg.imageId);
      const margin = 0.03 + 0.03 * P.parallax;
      const m = cameraMatrix(L.cam, T.aspect, view, margin);
      gl.uniform3fv(r0, m.row0); gl.uniform3fv(r1, m.row1);
      const pk = P.parallax * 1.0;
      gl.uniform3f(par, L.cam.parX * pk, L.cam.parY * pk, L.cam.parZ * pk);
      gl.uniform1f(has, 1);
      bind(unitT, T.tex); bind(unitD, T.dep);
      gl.uniform1i(texU, unitT); gl.uniform1i(depU, unitD);
    };
    setLayer(S.A, u.uTexA, u.uDepA, u.uA0, u.uA1, u.uParA, u.uHasA, 0, 1);
    setLayer(S.B, u.uTexB, u.uDepB, u.uB0, u.uB1, u.uParB, u.uHasB, 2, 3);
    gl.uniform1f(u.uMix, S.mix); gl.uniform1f(u.uMixMode, S.mixMode);
    gl.uniform2f(u.uRes, W, H);
    gl.uniform1f(u.uBlur, S.blur * (H / 1920) * 2.0);
    gl.uniform1f(u.uExposure, S.exposure); gl.uniform1f(u.uFlash, S.flash); gl.uniform1f(u.uFade, S.fade);
    gl.uniform1f(u.uRGB, S.rgb * (W / 1080) * 1.0);
    gl.uniform1f(u.uTear, Math.min(1.2, S.tear)); gl.uniform1f(u.uTearSeed, S.tearSeed % 1000);
    gl.uniform1f(u.uBlock, Math.min(1, S.block)); gl.uniform1f(u.uNoise, Math.min(1, S.noise));
    gl.uniform1f(u.uTracking, Math.min(1, S.tracking)); gl.uniform1f(u.uVroll, S.vroll); gl.uniform1f(u.uJitter, S.jitter);
    const bands = new Float32Array(12);
    const nb = Math.min(4, S.bands.length);
    for (let i = 0; i < nb; i++) { bands[i * 3] = S.bands[i].y; bands[i * 3 + 1] = S.bands[i].h; bands[i * 3 + 2] = Math.min(1, S.bands[i].i); }
    gl.uniform3fv(u.uBands, bands); gl.uniform1f(u.uBandCount, nb);
    gl.uniform1f(u.uGrain, S.grain); gl.uniform1f(u.uScan, S.scan); gl.uniform1f(u.uSoft, S.soft); gl.uniform1f(u.uBleed, S.bleed);
    gl.uniform1f(u.uVignette, S.vignette); gl.uniform1f(u.uSat, S.sat); gl.uniform1f(u.uContrast, S.contrast);
    gl.uniform1f(u.uWarmth, S.warmth); gl.uniform1f(u.uGreen, S.green); gl.uniform1f(u.uLift, S.lift);
    gl.uniform1f(u.uFlicker, S.flicker); gl.uniform1f(u.uSeed, S.seed % 1000);
    const hasOsd = this._osd(S, W, H);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, hasOsd ? this.osdTex : this.black);
    gl.uniform1i(u.uOsd, 5); gl.uniform1f(u.uHasOsd, hasOsd ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  renderAt(edl, t) { const S = stateAt(edl, t); this.draw(S, edl); return S; }
}
