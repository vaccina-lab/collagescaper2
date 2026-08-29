/* SALVAGE/9 — isolation engine.
   Routed pipeline: clean engraving → inkMatte; solid background → flood;
   else RMBG-2.0 (1.4 fallback) in a worker. */

export interface IsoResult {
  dataUrl: string;
  width: number;
  height: number;
  engine: 'ink' | 'flood' | 'model';
}

/* ---------------- worker pool ---------------- */
const POOL_SIZE = 2;
interface MatteOut { dims: number[]; data: Float32Array }
const pool: Worker[] = [];
const broken: boolean[] = [];
let rr = 0;
let nextReqId = 1;
const pending = new Map<number, { resolve: (v: MatteOut) => void; reject: (e: Error) => void }>();

function spawnWorker(): Worker {
  const w = new Worker(new URL('./isolate.worker.ts', import.meta.url), { type: 'module' });
  const slot = pool.length;
  let curModel = '';
  w.onmessage = (e: MessageEvent) => {
    const msg = e.data as { type: string; id?: number; dims?: number[]; buffer?: ArrayBuffer; model?: string; progress?: number | null; message?: string };
    if (msg.type === 'progress') {
      if (msg.model) curModel = msg.model;
      const pct = msg.progress ?? null;
      emitProgress(pct, curModel);
      return;
    }
    const reqId = msg.id;
    const p = reqId !== undefined ? pending.get(reqId) : undefined;
    if (!p || reqId === undefined) return;
    pending.delete(reqId);
    if (msg.type === 'result' && msg.buffer && msg.dims) {
      p.resolve({ dims: msg.dims, data: new Float32Array(msg.buffer) });
    } else if (msg.type === 'error') {
      p.reject(new Error(msg.message ?? 'inference failed'));
    } else {
      p.reject(new Error('bad worker message'));
    }
  };
  w.onerror = () => {
    broken[slot] = true;
    if (broken.every(Boolean)) {
      pending.forEach(p => p.reject(new Error('isolation worker crashed')));
      pending.clear();
    }
  };
  pool.push(w);
  broken.push(false);
  return w;
}

function runInference(url: string): Promise<MatteOut> {
  if (pool.length === 0) spawnWorker();
  if (pool.length < POOL_SIZE && pending.size > 0 && !broken[pool.length - 1]) spawnWorker();
  const alive = pool.filter((_, i) => !broken[i]);
  if (alive.length === 0) return Promise.reject(new Error('isolation worker unavailable'));
  const w = alive[rr % alive.length];
  rr = (rr + 1) % alive.length;
  const id = nextReqId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, url });
  });
}

/* progress event bus */
type ProgressFn = (pct: number | null, model: string) => void;
const progressSubs = new Set<ProgressFn>();
export function onIsoProgress(fn: ProgressFn): () => void {
  progressSubs.add(fn);
  return () => { progressSubs.delete(fn); };
}
function emitProgress(pct: number | null, model: string) {
  progressSubs.forEach(fn => fn(pct, model));
}

/* ---------------- helpers ---------------- */
export function loadCors(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (/^https?:/i.test(url)) img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load refused'));
    img.src = url;
  });
}

export function loadImageDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('dataurl decode failed'));
    img.src = dataUrl;
  });
}

function ctx2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) throw new Error('no canvas');
  return [c, x];
}

function canvasToDataUrl(c: HTMLCanvasElement): string {
  const webp = c.toDataURL('image/webp', 0.92);
  if (webp.startsWith('data:image/webp')) return webp;
  return c.toDataURL('image/png');
}

function opaqueBBox(c: HTMLCanvasElement): { x0: number; y0: number; bw: number; bh: number; coverage: number } | null {
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) return null;
  const { data, width: w, height: h } = x.getImageData(0, 0, c.width, c.height);
  let minX = w, minY = h, maxX = -1, maxY = -1, opaque = 0;
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      if (data[(yy * w + xx) * 4 + 3] > 40) {
        opaque++;
        if (xx < minX) minX = xx;
        if (xx > maxX) maxX = xx;
        if (yy < minY) minY = yy;
        if (yy > maxY) maxY = yy;
      }
    }
  }
  if (maxX < 0) return null;
  const coverage = opaque / (w * h);
  return { x0: minX, y0: minY, bw: maxX - minX + 1, bh: maxY - minY + 1, coverage };
}

function tightCrop(c: HTMLCanvasElement, padFrac = 0.012, floor = 0.004): HTMLCanvasElement | null {
  const bb = opaqueBBox(c);
  if (!bb || bb.coverage < floor) return null;
  const pad = Math.max(2, Math.round(Math.max(bb.bw, bb.bh) * padFrac));
  const x0 = Math.max(0, bb.x0 - pad), y0 = Math.max(0, bb.y0 - pad);
  const bw = Math.min(c.width - x0, bb.bw + pad * 2);
  const bh = Math.min(c.height - y0, bb.bh + pad * 2);
  const [out, ox] = ctx2d(bw, bh);
  ox.drawImage(c, x0, y0, bw, bh, 0, 0, bw, bh);
  return out;
}

/* ---------------- engraving confidence ---------------- */
function engravingConfidence(x: CanvasRenderingContext2D, w: number, h: number): number {
  const { data } = x.getImageData(0, 0, w, h);
  const N = w * h;
  let dark = 0, light = 0, edges = 0, chromaSum = 0;
  const lum = new Float32Array(N);
  for (let p = 0; p < N; p++) {
    const l = data[p * 4] * 0.299 + data[p * 4 + 1] * 0.587 + data[p * 4 + 2] * 0.114;
    lum[p] = l;
    if (l < 80) dark++;
    else if (l > 190) light++;
    const mx = Math.max(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);
    const mn = Math.min(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);
    chromaSum += mx - mn;
  }
  for (let y = 1; y < h - 1; y++) {
    for (let xx = 1; xx < w - 1; xx++) {
      const i = y * w + xx;
      if (Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + w] - lum[i - w]) > 40) edges++;
    }
  }
  const darkF = dark / N, lightF = light / N;
  const edgeD = edges / N;
  const avgChroma = chromaSum / N;
  if (darkF > 0.1 && darkF < 0.6 && lightF > 0.3 && edgeD > 0.08 && avgChroma < 40) return 0.7 + Math.min(0.25, edgeD);
  return avgChroma < 30 && edgeD > 0.05 ? 0.4 : 0.1;
}

function coarseInkFraction(x: CanvasRenderingContext2D, w: number, h: number): number {
  const { data } = x.getImageData(0, 0, w, h);
  let ink = 0;
  for (let p = 0; p < w * h; p++) {
    if (data[p * 4] * 0.299 + data[p * 4 + 1] * 0.587 + data[p * 4 + 2] * 0.114 < 100) ink++;
  }
  return ink / (w * h);
}

/* ---------------- inkMatte (clean engravings) ---------------- */
function inkMatte(x: CanvasRenderingContext2D, w: number, h: number): HTMLCanvasElement {
  const { data } = x.getImageData(0, 0, w, h);
  const N = w * h;
  const lum = new Float32Array(N);
  for (let p = 0; p < N; p++) lum[p] = data[p * 4] * 0.299 + data[p * 4 + 1] * 0.587 + data[p * 4 + 2] * 0.114;
  const ink = new Float32Array(N);
  for (let p = 0; p < N; p++) {
    const l = lum[p];
    ink[p] = l < 90 ? 1 : l > 160 ? 0 : (160 - l) / 70;
  }
  /* flood outward from paper, clearing only paper not connected to faint hatch ink */
  const out = x.getImageData(0, 0, w, h);
  const od = out.data;
  for (let p = 0; p < N; p++) {
    od[p * 4 + 3] = Math.round(Math.min(1, Math.max(0, ink[p])) * 255);
  }
  /* remove small specks */
  const minArea = Math.max(3, Math.round(N * 0.000006));
  const visited = new Uint8Array(N);
  for (let start = 0; start < N; start++) {
    if (visited[start] || od[start * 4 + 3] < 40) continue;
    const stack = [start];
    const comp: number[] = [];
    visited[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      comp.push(p);
      const px = p % w, py = Math.floor(p / w);
      if (px > 0 && !visited[p - 1] && od[(p - 1) * 4 + 3] >= 40) { visited[p - 1] = 1; stack.push(p - 1); }
      if (px < w - 1 && !visited[p + 1] && od[(p + 1) * 4 + 3] >= 40) { visited[p + 1] = 1; stack.push(p + 1); }
      if (py > 0 && !visited[p - w] && od[(p - w) * 4 + 3] >= 40) { visited[p - w] = 1; stack.push(p - w); }
      if (py < h - 1 && !visited[p + w] && od[(p + w) * 4 + 3] >= 40) { visited[p + w] = 1; stack.push(p + w); }
    }
    if (comp.length < minArea) for (const p of comp) od[p * 4 + 3] = 0;
  }
  const [c, cx] = ctx2d(w, h);
  cx.putImageData(out, 0, 0);
  return c;
}

/* ---------------- backgroundFlood (solid color backgrounds) ---------------- */
function backgroundFlood(img: HTMLImageElement, w: number, h: number): HTMLCanvasElement | null {
  const [c, x] = ctx2d(w, h);
  x.drawImage(img, 0, 0, w, h);
  const { data } = x.getImageData(0, 0, w, h);
  const N = w * h;
  /* sample border pixels to find the background color */
  const border: number[] = [];
  for (let xx = 0; xx < w; xx += 4) {
    border.push(data[(0 * w + xx) * 4], data[(0 * w + xx) * 4 + 1], data[(0 * w + xx) * 4 + 2]);
    border.push(data[((h - 1) * w + xx) * 4], data[((h - 1) * w + xx) * 4 + 1], data[((h - 1) * w + xx) * 4 + 2]);
  }
  for (let yy = 0; yy < h; yy += 4) {
    border.push(data[(yy * w + 0) * 4], data[(yy * w + 0) * 4 + 1], data[(yy * w + 0) * 4 + 2]);
    border.push(data[(yy * w + (w - 1)) * 4], data[(yy * w + (w - 1)) * 4 + 1], data[(yy * w + (w - 1)) * 4 + 2]);
  }
  let br = 0, bg2 = 0, bb = 0;
  const cnt = border.length / 3;
  for (let i = 0; i < border.length; i += 3) { br += border[i]; bg2 += border[i + 1]; bb += border[i + 2]; }
  br /= cnt; bg2 /= cnt; bb /= cnt;
  /* check border uniformity */
  let variance = 0;
  for (let i = 0; i < border.length; i += 3) {
    const dr = border[i] - br, dg = border[i + 1] - bg2, db = border[i + 2] - bb;
    variance += Math.sqrt(dr * dr + dg * dg + db * db);
  }
  variance /= cnt;
  if (variance > 38) return null; /* border too varied — not a solid background */
  /* flood from all border pixels, removing pixels close to the background color */
  const out = x.getImageData(0, 0, w, h);
  const od = out.data;
  const dist = (p: number) => {
    const dr = od[p * 4] - br, dg = od[p * 4 + 1] - bg2, db = od[p * 4 + 2] - bb;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };
  const visited = new Uint8Array(N);
  const stack: number[] = [];
  for (let xx = 0; xx < w; xx++) { stack.push(xx); stack.push((h - 1) * w + xx); }
  for (let yy = 0; yy < h; yy++) { stack.push(yy * w); stack.push(yy * w + (w - 1)); }
  for (const p of stack) { if (!visited[p] && dist(p) < 42) { visited[p] = 1; od[p * 4 + 3] = 0; } }
  const queue: number[] = [];
  for (let p = 0; p < N; p++) if (visited[p]) queue.push(p);
  let qi = 0;
  while (qi < queue.length) {
    const p = queue[qi++];
    const px = p % w, py = Math.floor(p / w);
    const nb = [];
    if (px > 0) nb.push(p - 1);
    if (px < w - 1) nb.push(p + 1);
    if (py > 0) nb.push(p - w);
    if (py < h - 1) nb.push(p + w);
    for (const q of nb) {
      if (!visited[q] && dist(q) < 42) {
        visited[q] = 1;
        od[q * 4 + 3] = 0;
        queue.push(q);
      }
    }
  }
  /* Fringe peel: the flood leaves a bg-colored halo (the "smudge"). Peel
     bg-colored semi-transparent pixels and opaque fringe touching removed
     background — but ONLY pixels actually close to the bg color, so the
     subject (which differs in color) is never touched. */
  for (let iter = 0; iter < 2; iter++) {
    const toRemove: number[] = [];
    for (let p = 0; p < N; p++) {
      if (visited[p]) continue;
      const a = od[p * 4 + 3];
      const isBgColored = dist(p) < 64;
      if (!isBgColored) continue;
      if (a < 128) { toRemove.push(p); continue; }
      const px = p % w, py = (p / w) | 0;
      const near = (px > 0 && visited[p - 1]) || (px < w - 1 && visited[p + 1]) || (py > 0 && visited[p - w]) || (py < h - 1 && visited[p + w]);
      if (near) toRemove.push(p);
    }
    for (const p of toRemove) { visited[p] = 1; od[p * 4 + 3] = 0; }
  }
  /* kill faint partial-alpha residue so no translucent smudge survives */
  for (let p = 0; p < N; p++) {
    if (od[p * 4 + 3] > 0 && od[p * 4 + 3] < 50) od[p * 4 + 3] = 0;
  }
  x.putImageData(out, 0, 0);
  return c;
}

function removeInteriorFlatRegions(c: HTMLCanvasElement): HTMLCanvasElement {
  /* Removes enclosed paper blocks — the white regions trapped inside the
     subject's outline (e.g. the white between a skeleton's bone lines) that
     a background flood can't reach because they're sealed off by ink.
     Safety: only runs on low-chroma (B&W) cutouts, and only removes bright
     opaque components that DON'T touch the image border. */
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) return c;
  const img = x.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const w = c.width, h = c.height, N = w * h;
  const lum = new Float32Array(N);
  let chromaSum = 0;
  for (let p = 0; p < N; p++) {
    const r = d[p * 4], g = d[p * 4 + 1], b = d[p * 4 + 2];
    lum[p] = r * 0.299 + g * 0.587 + b * 0.114;
    chromaSum += Math.max(r, g, b) - Math.min(r, g, b);
  }
  if (chromaSum / N > 40) return c; /* colorful — leave it alone */
  const opaque = (p: number) => d[p * 4 + 3] >= 40;
  const bright = (p: number) => lum[p] > 185;
  const visited = new Uint8Array(N);
  for (let start = 0; start < N; start++) {
    if (visited[start] || !opaque(start) || !bright(start)) continue;
    const stack = [start];
    const comp: number[] = [];
    let touchesBorder = false;
    visited[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      comp.push(p);
      const px = p % w, py = (p / w) | 0;
      if (px === 0 || px === w - 1 || py === 0 || py === h - 1) touchesBorder = true;
      const nb = [];
      if (px > 0) nb.push(p - 1);
      if (px < w - 1) nb.push(p + 1);
      if (py > 0) nb.push(p - w);
      if (py < h - 1) nb.push(p + w);
      for (const q of nb) if (!visited[q] && opaque(q) && bright(q)) { visited[q] = 1; stack.push(q); }
    }
    /* an enclosed bright block (sealed off from the border) is paper — remove it */
    if (!touchesBorder && comp.length >= 20) {
      for (const p of comp) d[p * 4 + 3] = 0;
    }
  }
  x.putImageData(img, 0, 0);
  return c;
}

/* ---------------- matteToAlpha ---------------- */
function matteToAlpha(matte: Float32Array, dims: number[]): Uint8ClampedArray {
  const mh = dims[dims.length - 2], mw = dims[dims.length - 1];
  const alpha = new Uint8ClampedArray(mw * mh * 4);
  for (let p = 0; p < mw * mh; p++) {
    let v = matte[p];
    if (Math.abs(v) > 1.5) v = 1 / (1 + Math.exp(-v)); /* sigmoid for raw logits */
    const a = Math.round(Math.max(0, Math.min(1, v)) * 255);
    alpha[p * 4] = 255; alpha[p * 4 + 1] = 255; alpha[p * 4 + 2] = 255; alpha[p * 4 + 3] = a;
  }
  return alpha;
}

/* ---------------- main entry ---------------- */
export async function isolateFromUrl(url: string, quality: 'fast' | 'fine' = 'fast', maxDim = 1400): Promise<IsoResult> {
  const img = await loadCors(url);
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(2, Math.round(img.naturalWidth * scale));
  const h = Math.max(2, Math.round(img.naturalHeight * scale));

  const [probeC, probeX] = ctx2d(64, 64);
  probeX.drawImage(img, 0, 0, 64, 64);
  const conf = engravingConfidence(probeX, 64, 64);
  const dense = coarseInkFraction(probeX, 64, 64);

  const [c, x] = ctx2d(w, h);
  x.drawImage(img, 0, 0, w, h);

  /* clean engraving (ink is a minority of the frame) → ink specialist */
  if (conf >= 0.62 && dense < 0.5) {
    try {
      const ink = inkMatte(x, w, h);
      const bb = opaqueBBox(ink);
      if (bb && bb.coverage > 0.004 && bb.coverage < 0.97) {
        const tight = tightCrop(ink);
        if (tight) return { dataUrl: canvasToDataUrl(tight), width: tight.width, height: tight.height, engine: 'ink' };
      }
    } catch { /* fall through to model */ }
  }

  /* solid color background → flood (no interior stripping — trust the flood) */
  const floodC = backgroundFlood(img, w, h);
  if (floodC) {
    const bb = opaqueBBox(floodC);
    if (bb && bb.coverage > 0.004 && bb.coverage < 0.97) {
      const tight = tightCrop(floodC);
      if (tight) {
        return { dataUrl: canvasToDataUrl(tight), width: tight.width, height: tight.height, engine: 'flood' };
      }
    }
  }

  /* model path */
  const blob = await new Promise<Blob | null>(res => c.toBlob(b => res(b), 'image/png'));
  if (!blob) throw new Error('could not rasterize');
  const objUrl = URL.createObjectURL(blob);
  let matte: Float32Array;
  let dims: number[];
  try {
    const r = await runInference(objUrl);
    matte = r.data;
    dims = r.dims;
  } finally {
    URL.revokeObjectURL(objUrl);
  }
  const alpha = matteToAlpha(matte, dims);
  const mh = dims[dims.length - 2], mw = dims[dims.length - 1];
  const [mc, mx] = ctx2d(mw, mh);
  const mid = mx.createImageData(mw, mh);
  for (let p = 0; p < mw * mh * 4; p++) mid.data[p] = alpha[p];
  mx.putImageData(mid, 0, 0);
  /* compose matte over the subject — TRUST THE MODEL. Do NOT strip enclosed
     bright regions here: that ate building facades (Space Needle), painting
     highlights, illuminated-manuscript letter fills and subject interiors. */
  const [res, rx] = ctx2d(mw, mh);
  rx.drawImage(c, 0, 0, mw, mh);
  rx.globalCompositeOperation = 'destination-in';
  rx.drawImage(mc, 0, 0);
  const out = res;
  if (quality === 'fine') {
    const bb = opaqueBBox(out);
    if (bb && bb.coverage > 0.004 && bb.coverage < 0.55) {
      /* crop-and-refine for sharper small subjects */
      try {
        const padX = Math.max(4, Math.round(bb.bw * 0.09));
        const padY = Math.max(4, Math.round(bb.bh * 0.09));
        const x0 = Math.max(0, bb.x0 - padX), y0 = Math.max(0, bb.y0 - padY);
        const bw2 = Math.min(out.width - x0, bb.bw + padX * 2);
        const bh2 = Math.min(out.height - y0, bb.bh + padY * 2);
        const [crop, cxx] = ctx2d(bw2, bh2);
        cxx.drawImage(out, x0, y0, bw2, bh2, 0, 0, bw2, bh2);
        const cb = await new Promise<Blob | null>(res2 => crop.toBlob(b2 => res2(b2), 'image/png'));
        if (cb) {
          const co = URL.createObjectURL(cb);
          try {
            const r2 = await runInference(co);
            const a2 = matteToAlpha(r2.data, r2.dims);
            const mh2 = r2.dims[r2.dims.length - 2], mw2 = r2.dims[r2.dims.length - 1];
            const [mc2, mx2] = ctx2d(mw2, mh2);
            const mid2 = mx2.createImageData(mw2, mh2);
            for (let p = 0; p < mw2 * mh2 * 4; p++) mid2.data[p] = a2[p];
            mx2.putImageData(mid2, 0, 0);
            const [res2, rx2] = ctx2d(mw2, mh2);
            rx2.drawImage(crop, 0, 0, mw2, mh2);
            rx2.globalCompositeOperation = 'destination-in';
            rx2.drawImage(mc2, 0, 0);
            const tight = tightCrop(res2);
            if (tight) return { dataUrl: canvasToDataUrl(tight), width: tight.width, height: tight.height, engine: 'model' };
          } finally { URL.revokeObjectURL(co); }
        }
      } catch { /* fall back to first pass */ }
    }
  }
  const tight = tightCrop(out, 0.012, 0.0002);
  if (!tight) throw new Error('empty matte');
  return { dataUrl: canvasToDataUrl(tight), width: tight.width, height: tight.height, engine: 'model' };
}

/* ---------------- cutout grader (separate scale, opaque pixels only) ---------------- */
export function gradeCutout(img: HTMLImageElement): { score: number } {
  const S = 64;
  const [c, x] = ctx2d(S, S);
  x.drawImage(img, 0, 0, S, S);
  const { data } = x.getImageData(0, 0, S, S);
  const N = S * S;
  let opaque = 0, edges = 0, counted = 0;
  let sumL = 0, variance = 0;
  const lum = new Float32Array(N);
  for (let p = 0; p < N; p++) {
    const a = data[p * 4 + 3];
    if (a > 128) {
      opaque++;
      lum[p] = data[p * 4] * 0.299 + data[p * 4 + 1] * 0.587 + data[p * 4 + 2] * 0.114;
      sumL += lum[p];
    } else lum[p] = -1;
  }
  if (opaque < 20) return { score: 8 };
  const coverage = opaque / N;
  const mean = sumL / opaque;
  for (let p = 0; p < N; p++) if (lum[p] >= 0) variance += (lum[p] - mean) * (lum[p] - mean);
  const std = Math.sqrt(variance / opaque);
  for (let y = 1; y < S - 1; y++) {
    for (let xx = 1; xx < S - 1; xx++) {
      const p = y * S + xx;
      if (lum[p] < 0) continue;
      let n = 0;
      if (lum[p + 1] >= 0) { if (Math.abs(lum[p + 1] - lum[p]) > 26) edges++; n++; }
      if (lum[p + S] >= 0) { if (Math.abs(lum[p + S] - lum[p]) > 26) edges++; n++; }
      counted += n;
    }
  }
  const detail = counted > 0 ? edges / counted : 0;
  const covScore = coverage < 0.01 ? 5 : coverage < 0.04 ? 24 : coverage > 0.97 ? 20 : coverage > 0.9 ? 34 : 40;
  const score = Math.max(5, Math.min(97, Math.round(
    Math.min(34, detail * 260) + Math.min(26, (std / 62) * 26) + covScore,
  )));
  return { score };
}
