export interface GlitchParams {
  damage: number; grain: number; rgb: number; slice: number; block: number;
  scan: number; sort: number; wave: number; smear: number; echo: number;
  crush: number; hue: number; chem: number; drain: number; mosaic: number; mirror: number;
  seed: number;
}
export const DEFAULT_PARAMS: GlitchParams = {
  damage: 42, grain: 22, rgb: 38, slice: 30, block: 24, scan: 30,
  sort: 0, wave: 0, smear: 0, echo: 0, crush: 0, hue: 0, chem: 0, drain: 0, mosaic: 0, mirror: 0, seed: 1988,
};
export const CHANNELS: Array<{ key: keyof GlitchParams; label: string; min: number; max: number }> = [
  { key: 'damage', label: 'DAMAGE', min: -100, max: 100 },
  { key: 'rgb', label: 'RGB SPLIT', min: -100, max: 100 },
  { key: 'slice', label: 'ROW SLICE', min: -100, max: 100 },
  { key: 'block', label: 'BLOCK ROT', min: -100, max: 100 },
  { key: 'grain', label: 'STATIC', min: -100, max: 100 },
  { key: 'scan', label: 'SCANLINES', min: -100, max: 100 },
  { key: 'sort', label: 'PIXEL SORT', min: -100, max: 100 },
  { key: 'wave', label: 'WAVE WARP', min: -100, max: 100 },
  { key: 'smear', label: 'SMEAR', min: -100, max: 100 },
  { key: 'echo', label: 'ECHO', min: -100, max: 100 },
  { key: 'crush', label: 'BITCRUSH', min: -100, max: 100 },
  { key: 'hue', label: 'HUE ROLL', min: -100, max: 100 },
  { key: 'chem', label: 'CHEM', min: -100, max: 100 },
  { key: 'drain', label: 'DRAIN', min: -100, max: 100 },
  { key: 'mosaic', label: 'MOSAIC', min: -100, max: 100 },
  { key: 'mirror', label: 'MIRROR', min: -100, max: 100 },
];
export const PRESETS: Array<{ name: string; p: Partial<GlitchParams> }> = [
  { name: 'VHS', p: { damage: 40, rgb: 30, slice: 26, block: 6, grain: 34, scan: 52 } },
  { name: 'CRT', p: { scan: 72, rgb: 18, crush: 22 } },
  { name: 'SHATTER', p: { slice: 62, mosaic: 22, rgb: 44 } },
  { name: 'ACID', p: { hue: 130, chem: 38, grain: 12 } },
  { name: 'GHOST', p: { rgb: -52, chem: 22, scan: 18, mirror: 30 } },
  { name: 'SIGNAL LOST', p: { damage: 88, grain: 82, scan: 44, crush: 30 } },
];
export type Pipeline = 'pixel' | 'composite';
export interface GlitchSource { el: HTMLImageElement | HTMLCanvasElement; w: number; h: number }
function fxRng(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function fxCv(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) throw new Error('no canvas');
  return [c, x];
}
function snap(c: HTMLCanvasElement): HTMLCanvasElement { const [n, x] = fxCv(c.width, c.height); x.drawImage(c, 0, 0); return n; }
function huePass(d: Uint8ClampedArray, deg: number) {
  const rad = (deg * Math.PI) / 180; const cos = Math.cos(rad), sin = Math.sin(rad);
  const m = [0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928, 0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.140, 0.072 - cos * 0.072 - sin * 0.283, 0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072];
  for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2]; d[i] = r * m[0] + g * m[1] + b * m[2]; d[i + 1] = r * m[3] + g * m[4] + b * m[5]; d[i + 2] = r * m[6] + g * m[7] + b * m[8]; }
}
function satPass(d: Uint8ClampedArray, amt: number) {
  const k = amt > 0 ? 1 + amt * 3 : Math.max(0, 1 + amt);
  for (let i = 0; i < d.length; i += 4) { const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = l + (d[i] - l) * k; d[i + 1] = l + (d[i + 1] - l) * k; d[i + 2] = l + (d[i + 2] - l) * k; }
}
function solarPass(d: Uint8ClampedArray, amt: number, sign: number) {
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) { const v = d[i + c]; const s = sign >= 0 ? (v > 128 ? 255 - v : v) : 255 - v; d[i + c] = v * (1 - amt) + s * amt; }
}
export function renderGlitch(src: GlitchSource, w: number, h: number, p: GlitchParams): { canvas: HTMLCanvasElement; pipe: Pipeline } {
  const R = fxRng(p.seed);
  const [base, bx] = fxCv(w, h);
  const scale = Math.max(w / src.w, h / src.h);
  bx.drawImage(src.el, (w - src.w * scale) / 2, (h - src.h * scale) / 2, src.w * scale, src.h * scale);
  let work = base;
  const [out, ox] = fxCv(w, h);
  ox.drawImage(work, 0, 0);
  if (p.slice) {
    const a = Math.abs(p.slice) / 100, sign = Math.sign(p.slice) || 1;
    const cuts = 4 + Math.round(a * 22);
    for (let i = 0; i < cuts; i++) {
      const sy = Math.floor(R() * h); const sh = 2 + Math.floor(R() * (14 + a * 40));
      const dx = Math.floor((sign * (0.4 + R() * 0.6) + (R() - 0.5) * 0.6) * a * w * 0.35);
      ox.drawImage(base, 0, sy, w, sh, dx, sy, w, sh);
    }
  }
  if (p.wave) {
    const a = Math.abs(p.wave) / 100, sign = Math.sign(p.wave) || 1;
    const c2 = snap(out); ox.clearRect(0, 0, w, h);
    const freq = 0.02 + R() * 0.05, phase = R() * Math.PI * 2 * sign, amp = a * w * 0.16;
    for (let y = 0; y < h; y += 2) { const dx = Math.round(Math.sin(y * freq + phase) * amp); ox.drawImage(c2, 0, y, w, 2, dx, y, w, 2); }
  }
  if (p.echo) {
    const a = Math.abs(p.echo) / 100, sign = Math.sign(p.echo) || 1;
    const c2 = snap(out); const ghosts = 2 + Math.round(a * 2);
    for (let i = ghosts; i >= 1; i--) { ox.globalAlpha = 0.24; ox.drawImage(c2, sign * (i / ghosts) * a * w * 0.3 * (0.5 + R() * 0.5), sign * (i / ghosts) * a * h * 0.12 * (R() - 0.5)); }
    ox.globalAlpha = 1;
  }
  if (p.mirror) {
    const a = Math.abs(p.mirror) / 100;
    const c2 = snap(out); ox.clearRect(0, 0, w, h);
    const half = Math.round(w / 2);
    ox.drawImage(c2, 0, 0, half, h, 0, 0, half, h);
    ox.save(); ox.translate(w, 0); ox.scale(-1, 1); ox.globalAlpha = a; ox.drawImage(c2, 0, 0, half, h, 0, 0, half, h); ox.restore();
    ox.globalAlpha = 1 - a; ox.drawImage(c2, half, 0, w - half, h, half, 0, w - half, h); ox.globalAlpha = 1;
  }
  let pipe: Pipeline = 'pixel';
  try {
    const img = ox.getImageData(0, 0, w, h);
    const d = img.data;
    const srcData = bx.getImageData(0, 0, w, h).data;
    if (p.rgb) {
      const a = Math.abs(p.rgb) / 100, sign = Math.sign(p.rgb) || 1;
      const shift = Math.round(a * w * 0.045) * sign;
      for (let y = 0; y < h; y++) {
        const wobble = Math.round(Math.sin(y * 0.05 + p.seed) * a * w * 0.012) * sign;
        const s = shift + wobble;
        for (let xx = 0; xx < w; xx++) {
          const i = (y * w + xx) * 4;
          const xr = Math.min(w - 1, Math.max(0, xx + s)), xb = Math.min(w - 1, Math.max(0, xx - s));
          d[i] = srcData[(y * w + xr) * 4]; d[i + 2] = srcData[(y * w + xb) * 4 + 2];
        }
      }
    }
    if (p.grain > 0) { const a = p.grain / 100; for (let i = 0; i < d.length; i += 4) if (R() < a * 0.28) { const v = (R() - 0.5) * 2 * 255 * a; d[i] += v; d[i + 1] += v; d[i + 2] += v; } }
    if (p.crush) {
      const a = Math.abs(p.crush) / 100, sign = Math.sign(p.crush) || 1;
      if (sign >= 0) { const levels = Math.max(2, Math.round(12 - a * 10)); const step = 255 / (levels - 1); for (let i = 0; i < d.length; i += 4) { d[i] = Math.round(d[i] / step) * step; d[i + 1] = Math.round(d[i + 1] / step) * step; d[i + 2] = Math.round(d[i + 2] / step) * step; } }
      else { for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) { const i = (y * w + xx) * 4; const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; const v = l > 128 * (1 - a + 0.3) ? 255 : 0; d[i] = v; d[i + 1] = v; d[i + 2] = v; } }
    }
    if (p.chem) solarPass(d, Math.abs(p.chem) / 100, Math.sign(p.chem) || 1);
    if (p.hue) huePass(d, (p.hue / 100) * 180);
    if (p.drain) satPass(d, p.drain / 100);
    if (p.mosaic) { const a = Math.abs(p.mosaic) / 100; const k = Math.max(2, Math.round(2 + a * 30)); for (let y = 0; y < h; y += k) for (let xx = 0; xx < w; xx += k) { const i = (y * w + xx) * 4; const r = d[i], g = d[i + 1], b = d[i + 2]; for (let yy = 0; yy < k && y + yy < h; yy++) for (let dx = 0; dx < k && xx + dx < w; dx++) { const j = ((y + yy) * w + xx + dx) * 4; d[j] = r; d[j + 1] = g; d[j + 2] = b; } } }
    ox.putImageData(img, 0, 0);
  } catch { pipe = 'composite'; }
  if (p.scan) {
    const a = Math.abs(p.scan) / 100, sign = Math.sign(p.scan) || 1;
    ox.fillStyle = `rgba(0,0,0,${0.16 + a * 0.2})`;
    const gap = a > 0.6 ? 2 : 3;
    if (sign >= 0) for (let y = 0; y < h; y += gap) ox.fillRect(0, y, w, 1);
    else for (let xx = 0; xx < w; xx += gap) ox.fillRect(xx, 0, 1, h);
  }
  if (p.damage < 0) { /* repair: soften */ }
  return { canvas: out, pipe };
}
export function stageDims(iw: number, ih: number, maxW = 640, maxH = 560): { w: number; h: number } {
  const s = Math.min(maxW / iw, maxH / ih, 1.2);
  return { w: Math.max(160, Math.round(iw * s)), h: Math.max(120, Math.round(ih * s)) };
}
export function exportDims(iw: number, ih: number, cap = 2000): { w: number; h: number } {
  const s = Math.min(cap / iw, cap / ih, 1);
  return { w: Math.max(1, Math.round(iw * s)), h: Math.max(1, Math.round(ih * s)) };
}
