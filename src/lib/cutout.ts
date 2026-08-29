/* SALVAGE/9 — automatic subject isolation.
   Routed pipeline:
   · clean ink-on-paper engravings → inkMatte (keeps ink, closes hatch gaps,
     fills enclosed interiors only when they hold faint hatch ink — so O/P/D
     counters and triangle interiors stay open while hatched figures read solid)
   · dense full-page engravings → semantic model (isolates the MAIN subject)
   · flat color backgrounds → backgroundFlood (Procreate-style color flood,
     second pass removes large bright enclosed panels like a frame's paper)
   · everything else → RMBG model + settleMatte + despill + sky/ground peel
   cutouts grade on a SEPARATE scale over opaque pixels only (gradeCutout). */

export interface IsoResult {
  dataUrl: string;
  width: number;
  height: number;
  engine: 'ink' | 'flood' | 'model';
}

/* ---------------- progress subscription ---------------- */

type ProgressFn = (pct: number | null, model?: string) => void;
const progressSubs = new Set<ProgressFn>();
export function onIsoProgress(fn: ProgressFn): () => void {
  progressSubs.add(fn);
  return () => { progressSubs.delete(fn); };
}
function reportProgress(pct: number | null, model?: string) {
  progressSubs.forEach(fn => fn(pct, model));
}

/* ---------------- worker pool (round-robin, 2 workers) ---------------- */

const POOL_SIZE = 2;
const pool: Worker[] = [];
const broken: boolean[] = [];
let rr = 0;
let nextReqId = 1;
interface MatteResult { dims: number[]; data: Float32Array; model: string }
const pending = new Map<number, {
  resolve: (v: MatteResult) => void;
  reject: (e: Error) => void;
}>();

function spawnWorker(): Worker {
  const w = new Worker(new URL('./isolate.worker.ts', import.meta.url), { type: 'module' });
  const slot = pool.length;
  let curModel = '';
  w.onmessage = (e: MessageEvent) => {
    const msg = e.data as { type: string; id?: number; dims?: number[]; buffer?: ArrayBuffer; model?: string; progress?: number | null; message?: string };
    if (msg.type === 'progress') {
      if (msg.model) curModel = msg.model;
      reportProgress(msg.progress ?? null, msg.model ?? curModel);
      return;
    }
    const reqId = msg.id;
    const p = reqId !== undefined ? pending.get(reqId) : undefined;
    if (!p || reqId === undefined) return;
    pending.delete(reqId);
    if (msg.type === 'result' && msg.buffer && msg.dims) {
      p.resolve({ dims: msg.dims, data: new Float32Array(msg.buffer), model: curModel });
    } else {
      p.reject(new Error(msg.message ?? 'inference failed'));
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

function runInference(url: string): Promise<{ dims: number[]; data: Float32Array; model: string }> {
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

/* ---------------- small canvas helpers ---------------- */

export function loadImageDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('dataurl decode failed'));
    img.src = dataUrl;
  });
}

function loadCors(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (/^https?:/i.test(url)) img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load refused'));
    img.src = url;
  });
}

function canvasToDataUrl(c: HTMLCanvasElement): string {
  const webp = c.toDataURL('image/webp', 0.92);
  if (webp.startsWith('image/webp')) return webp;
  return c.toDataURL('image/png');
}

function ctx2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) throw new Error('no canvas');
  return [c, x];
}

/* ---------------- matte → alpha composite ----------------
   RMBG may emit raw logits (|v|>1.5) — sigmoid-detect so clamping never
   flattens into a harsh binary mask. */
function matteToAlpha(matte: Float32Array, dims: number[]): Uint8ClampedArray {
  const mh = dims[dims.length - 2], mw = dims[dims.length - 1];
  const alpha = new Uint8ClampedArray(mw * mh);
  let raw = false;
  for (let i = 0; i < matte.length; i++) if (Math.abs(matte[i]) > 1.5) { raw = true; break; }
  for (let i = 0; i < mw * mh; i++) {
    let v = matte[i];
    if (raw) v = 1 / (1 + Math.exp(-v));
    alpha[i] = Math.round(Math.max(0, Math.min(1, v)) * 255);
  }
  return alpha;
}

/* ---------------- engraving detection ---------------- */

function lumArrays(x: CanvasRenderingContext2D, w: number, h: number): { lum: Float32Array; data: Uint8ClampedArray } {
  const d = x.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) lum[p] = d[p * 4] * 0.299 + d[p * 4 + 1] * 0.587 + d[p * 4 + 2] * 0.114;
  return { lum, data: d };
}

/* monochrome ink on light paper with real linework, regardless of how
   yellowed the paper is (we test the INK's neutrality, not the whole). */
export function engravingConfidence(x: CanvasRenderingContext2D, w: number, h: number): number {
  const { lum, data } = lumArrays(x, w, h);
  const N = w * h;
  const hist = new Float32Array(16);
  let inkChroma = 0, inkPx = 0, paperPx = 0, lightPx = 0;
  for (let p = 0; p < N; p++) {
    const l = lum[p];
    hist[Math.min(15, Math.floor(l / 16))]++;
    const r = data[p * 4], g = data[p * 4 + 1], b = data[p * 4 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (l < 110) { inkPx++; inkChroma += mx === 0 ? 0 : (mx - mn) / mx; }
    if (l > 150) { paperPx++; if (l > 200) lightPx++; }
  }
  if (inkPx < N * 0.02 || paperPx < N * 0.25) return 0;
  const avgInkChroma = inkChroma / inkPx;
  if (avgInkChroma > 0.3) return 0; /* colored art, not ink */
  let dark = 0, light = 0;
  for (let b2 = 0; b2 < 5; b2++) dark += hist[b2];
  for (let b2 = 11; b2 < 16; b2++) light += hist[b2];
  const bimodal = (dark / N > 0.08 && light / N > 0.2);
  let edges = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let xx = 1; xx < w - 1; xx++) {
      const i = y * w + xx;
      if (Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + w] - lum[i - w]) > 30) edges++;
    }
  }
  const edgeDensity = edges / N;
  if (edgeDensity < 0.06) return 0;
  let score = 0;
  if (bimodal) score += 0.35;
  if (lightPx / N > 0.3) score += 0.3;
  if (avgInkChroma < 0.15) score += 0.2;
  if (edgeDensity > 0.12) score += 0.15;
  return score; /* ≥0.65 → route to inkMatte */
}

/* dense = ink covers most of the frame → full-page scene → use the model */
export function coarseInkFraction(x: CanvasRenderingContext2D, w: number, h: number): number {
  const { lum } = lumArrays(x, w, h);
  let ink = 0;
  for (let p = 0; p < lum.length; p++) if (lum[p] < 128) ink++;
  return ink / lum.length;
}

/* ---------------- ink-matte (the engraving specialist) ---------------- */

export function inkMatte(x: CanvasRenderingContext2D, w: number, h: number): HTMLCanvasElement {
  const { lum, data } = lumArrays(x, w, h);
  const N = w * h;

  /* 1 — paper color from the border ring (median per channel) */
  const ringIdx: number[] = [];
  const step = Math.max(1, Math.floor((2 * (w + h)) / 600));
  for (let i = 0; i < w; i += step) { ringIdx.push(i); ringIdx.push((h - 1) * w + i); }
  for (let j = 0; j < h; j += step) { ringIdx.push(j * w); ringIdx.push(j * w + w - 1); }
  const chan = (off: number) => {
    const arr = ringIdx.map(i => data[i * 4 + off]).sort((a, b) => a - b);
    return arr[arr.length >> 1];
  };
  const pR = chan(0), pG = chan(1), pB = chan(2);

  /* 2 — ink strength per pixel = color distance from paper */
  const ink = new Float32Array(N);
  for (let p = 0; p < N; p++) {
    const dr = data[p * 4] - pR, dg = data[p * 4 + 1] - pG, db = data[p * 4 + 2] - pB;
    ink[p] = Math.sqrt(dr * dr + dg * dg + db * db) / 441;
  }

  /* 3 — raw mask + despeckle (removes foxing/freckles) */
  let raw = new Uint8Array(N);
  for (let p = 0; p < N; p++) raw[p] = ink[p] > 0.32 ? 1 : 0;
  raw = removeSmallComponents(raw, w, h, Math.max(3, Math.round(N * 0.000006)));

  /* 4 — HATCH CLOSE: hatched shading is thin strokes separated by paper
     gaps; close those gaps so shadow reads solid instead of being eaten */
  const closed = closeGaps(raw, w, h, 2);

  /* 5 — keep only components connected to the significant ink mass.
     Drop page-rule border frames (huge bbox, tiny solidity). */
  const kept = keepMainComponents(closed, w, h);

  /* 6 — alpha with feather, then fill enclosed interiors ONLY when they
     hold faint hatch ink — so letter counters (O/P/D) and geometric
     interiors stay open, while hatched figures read solid. */
  const out = ctx2d(w, h)[1];
  const img = out.createImageData(w, h);
  const od = img.data;
  for (let p = 0; p < N; p++) {
    const a = kept[p];
    const aa = a >= 1 ? 255 : Math.round(Math.min(1, Math.max(0, (ink[p] - 0.1) / 0.22)) * 255 * a);
    if (aa <= 0) continue;
    od[p * 4] = data[p * 4]; od[p * 4 + 1] = data[p * 4 + 1]; od[p * 4 + 2] = data[p * 4 + 2];
    od[p * 4 + 3] = aa;
  }
  out.putImageData(img, 0, 0);
  fillEnclosedHatchedHoles(out, w, h, ink);
  return out.canvas;
}

function closeGaps(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const out = new Uint8Array(mask);
  for (let y = radius; y < h - radius; y++) {
    for (let xx = radius; xx < w - radius; xx++) {
      const p = y * w + xx;
      if (mask[p]) continue;
      let hits = 0;
      for (let dy = -radius; dy <= radius && hits < 3; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (mask[(y + dy) * w + xx + dx]) { hits++; if (hits >= 3) break; }
        }
      }
      if (hits >= 3) out[p] = 1;
    }
  }
  return out;
}

function removeSmallComponents(mask: Uint8Array, w: number, h: number, minArea: number): Uint8Array {
  const label = new Int32Array(mask.length).fill(-1);
  const queue = new Int32Array(mask.length);
  const out = new Uint8Array(mask);
  let next = 0;
  for (let start = 0; start < mask.length; start++) {
    if (label[start] !== -1 || !mask[start]) continue;
    const L = next++;
    label[start] = L;
    let qh = 0, qt = 0, area = 0;
    queue[qt++] = start;
    while (qh < qt) {
      const p = queue[qh++];
      area++;
      const px = p % w, py = (p / w) | 0;
      const nb = [p - 1, p + 1, p - w, p + w];
      const ok = [px > 0, px < w - 1, py > 0, py < h - 1];
      for (let k = 0; k < 4; k++) if (ok[k] && label[nb[k]] === -1 && mask[nb[k]]) { label[nb[k]] = L; queue[qt++] = nb[k]; }
    }
    if (area < minArea) {
      for (let i = 0; i < qt; i++) out[queue[i]] = 0;
    }
  }
  return out;
}

function keepMainComponents(mask: Uint8Array, w: number, h: number): Uint8Array {
  const label = new Int32Array(mask.length).fill(-1);
  const queue = new Int32Array(mask.length);
  const out = new Uint8Array(mask);
  let next = 0;
  let bestArea = 0;
  const comps: Array<{ L: number; area: number; cells: number[] }> = [];
  for (let start = 0; start < mask.length; start++) {
    if (label[start] !== -1 || !mask[start]) continue;
    const L = next++;
    label[start] = L;
    let qh = 0, qt = 0;
    queue[qt++] = start;
    const cells: number[] = [];
    let minX = w, maxX = 0, minY = h, maxY = 0;
    while (qh < qt) {
      const p = queue[qh++];
      cells.push(p);
      const px = p % w, py = (p / w) | 0;
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
      const nb = [p - 1, p + 1, p - w, p + w];
      const ok = [px > 0, px < w - 1, py > 0, py < h - 1];
      for (let k = 0; k < 4; k++) if (ok[k] && label[nb[k]] === -1 && mask[nb[k]]) { label[nb[k]] = L; queue[qt++] = nb[k]; }
    }
    const bbox = (maxX - minX + 1) * (maxY - minY + 1);
    const solidity = cells.length / Math.max(1, bbox);
    const touchesBorder = minX <= 1 || maxX >= w - 2 || minY <= 1 || maxY >= h - 2;
    /* page-rule frame: huge bbox, near-zero solidity, hugs the border */
    if (bbox > w * h * 0.5 && solidity < 0.06 && touchesBorder) {
      for (const c of cells) out[c] = 0;
      continue;
    }
    comps.push({ L, area: cells.length, cells });
    if (cells.length > bestArea) bestArea = cells.length;
  }
  /* keep components ≥1% of the biggest (or ≥400px absolute) */
  const floor = Math.max(400, bestArea * 0.01);
  for (const comp of comps) {
    if (comp.area < floor) for (const c of comp.cells) out[c] = 0;
  }
  return out;
}

/* fill an enclosed transparent hole only if it contains faint hatch ink */
function fillEnclosedHatchedHoles(x: CanvasRenderingContext2D, w: number, h: number, ink: Float32Array) {
  const img = x.getImageData(0, 0, w, h);
  const d = img.data;
  const N = w * h;
  const opaque = new Uint8Array(N);
  for (let p = 0; p < N; p++) opaque[p] = d[p * 4 + 3] > 40 ? 1 : 0;
  /* flood from every border pixel to find the exterior */
  const exterior = new Uint8Array(N);
  const queue = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let xx = 0; xx < w; xx++) { if (!opaque[xx]) { exterior[xx] = 1; queue[qt++] = xx; } const b = (h - 1) * w + xx; if (!opaque[b]) { exterior[b] = 1; queue[qt++] = b; } }
  for (let y = 0; y < h; y++) { const l = y * w; const r = y * w + w - 1; if (!opaque[l]) { exterior[l] = 1; queue[qt++] = l; } if (!opaque[r]) { exterior[r] = 1; queue[qt++] = r; } }
  while (qh < qt) {
    const p = queue[qh++];
    const px = p % w, py = (p / w) | 0;
    const nb = [p - 1, p + 1, p - w, p + w];
    const ok = [px > 0, px < w - 1, py > 0, py < h - 1];
    for (let k = 0; k < 4; k++) if (ok[k] && !exterior[nb[k]] && !opaque[nb[k]]) { exterior[nb[k]] = 1; queue[qt++] = nb[k]; }
  }
  /* group the remaining holes (enclosed, transparent) and fill those with hatch */
  const label = new Int32Array(N).fill(-1);
  const hq = new Int32Array(N);
  let next = 0;
  for (let start = 0; start < N; start++) {
    if (label[start] !== -1 || opaque[start] || exterior[start]) continue;
    const L = next++;
    label[start] = L;
    let hh = 0, ht = 0;
    hq[ht++] = start;
    const cells: number[] = [];
    let inkSum = 0, cnt = 0;
    while (hh < ht) {
      const p = hq[hh++];
      cells.push(p);
      inkSum += ink[p]; cnt++;
      const px = p % w, py = (p / w) | 0;
      const nb = [p - 1, p + 1, p - w, p + w];
      const ok = [px > 0, px < w - 1, py > 0, py < h - 1];
      for (let k = 0; k < 4; k++) if (ok[k] && label[nb[k]] === -1 && !opaque[nb[k]] && !exterior[nb[k]]) { label[nb[k]] = L; hq[ht++] = nb[k]; }
    }
    const meanInk = cnt > 0 ? inkSum / cnt : 0;
    if (meanInk >= 0.1) { /* hole holds faint hatch ink → part of the figure */
      for (const c of cells) d[c * 4 + 3] = Math.max(d[c * 4 + 3], Math.round(Math.min(1, meanInk / 0.32) * 235));
    }
  }
  x.putImageData(img, 0, 0);
}

/* ---------------- color flood (solid backgrounds, à la Procreate) ---------------- */

export function backgroundFlood(img: HTMLImageElement, w: number, h: number): HTMLCanvasElement | null {
  const [c, x] = ctx2d(w, h);
  x.drawImage(img, 0, 0, w, h);
  const { data } = lumArrays(x, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const N = w * h;

  /* border color = median of the ring */
  const ringIdx: number[] = [];
  const step = Math.max(1, Math.floor((2 * (w + h)) / 600));
  for (let i = 0; i < w; i += step) { ringIdx.push(i); ringIdx.push((h - 1) * w + i); }
  for (let j = 0; j < h; j += step) { ringIdx.push(j * w); ringIdx.push(j * w + w - 1); }
  const med = (off: number) => { const a = ringIdx.map(i => d[i * 4 + off]).sort((a2, b2) => a2 - b2); return a[a.length >> 1]; };
  const bgR = med(0), bgG = med(1), bgB = med(2);

  /* is the border actually a flat color? if not, bail (not a solid bg) */
  let variance = 0;
  for (const i of ringIdx) {
    const dr = d[i * 4] - bgR, dg = d[i * 4 + 1] - bgG, db = d[i * 4 + 2] - bgB;
    variance += dr * dr + dg * dg + db * db;
  }
  if (Math.sqrt(variance / ringIdx.length) > 30) return null;

  /* flood from every border pixel through "close to bg" pixels */
  const TOL = 42;
  const mask = new Uint8Array(N);
  const queue = new Int32Array(N);
  let qh = 0, qt = 0;
  const close = (p: number) => {
    const dr = d[p * 4] - bgR, dg = d[p * 4 + 1] - bgG, db = d[p * 4 + 2] - bgB;
    return Math.sqrt(dr * dr + dg * dg + db * db) <= TOL;
  };
  for (let xx = 0; xx < w; xx++) { if (close(xx)) { mask[xx] = 1; queue[qt++] = xx; } const b = (h - 1) * w + xx; if (close(b)) { mask[b] = 1; queue[qt++] = b; } }
  for (let y = 0; y < h; y++) { const l = y * w; const r = y * w + w - 1; if (close(l)) { mask[l] = 1; queue[qt++] = l; } if (close(r)) { mask[r] = 1; queue[qt++] = r; } }
  while (qh < qt) {
    const p = queue[qh++];
    const px = p % w, py = (p / w) | 0;
    const nb = [p - 1, p + 1, p - w, p + w];
    const ok = [px > 0, px < w - 1, py > 0, py < h - 1];
    for (let k = 0; k < 4; k++) if (ok[k] && !mask[nb[k]] && close(nb[k])) { mask[nb[k]] = 1; queue[qt++] = nb[k]; }
  }
  /* keep = NOT flooded; feather the boundary */
  const img2 = x.getImageData(0, 0, w, h);
  const od = img2.data;
  for (let p = 0; p < N; p++) {
    od[p * 4 + 3] = mask[p] ? 0 : 255;
  }
  x.putImageData(img2, 0, 0);
  /* feather: soften the hard flood edge */
  softenAlphaEdge(x, w, h);
  return c;
}

/* second flood pass: remove a large, flat, BRIGHT enclosed region (the
   paper inside a frame). Never removes a subject's own interior. */
function removeInteriorFlatRegions(c: HTMLCanvasElement): HTMLCanvasElement {
  const w = c.width, h = c.height;
  const [c2, x] = ctx2d(w, h);
  x.drawImage(c, 0, 0);
  const { lum } = lumArrays(x, w, h);
  const img = x.getImageData(0, 0, w, h);
  const d = img.data;
  const N = w * h;
  const opaque = new Uint8Array(N);
  for (let p = 0; p < N; p++) opaque[p] = d[p * 4 + 3] > 40 ? 1 : 0;

  /* subject core = textured pixels, dilated into a guard zone */
  const core = new Uint8Array(N);
  for (let y = 1; y < h - 1; y++) {
    for (let xx = 1; xx < w - 1; xx++) {
      const i = y * w + xx;
      if (!opaque[i]) continue;
      if (Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + w] - lum[i - w]) > 26) core[i] = 1;
    }
  }
  const guard = new Uint8Array(N);
  const dil = 6;
  for (let y = 0; y < h; y++) {
    for (let xx = 0; xx < w; xx++) {
      if (!core[y * w + xx]) continue;
      for (let dy = -dil; dy <= dil; dy++) {
        for (let dx = -dil; dx <= dil; dx++) {
          const yy = y + dy, xx2 = xx + dx;
          if (yy >= 0 && yy < h && xx2 >= 0 && xx2 < w) guard[yy * w + xx2] = 1;
        }
      }
    }
  }

  /* find enclosed transparent holes that are big, flat, bright, unguarded */
  const exterior = new Uint8Array(N);
  const queue = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let xx = 0; xx < w; xx++) { if (!opaque[xx]) { exterior[xx] = 1; queue[qt++] = xx; } const b = (h - 1) * w + xx; if (!opaque[b]) { exterior[b] = 1; queue[qt++] = b; } }
  for (let y = 0; y < h; y++) { const l = y * w; const r = y * w + w - 1; if (!opaque[l]) { exterior[l] = 1; queue[qt++] = l; } if (!opaque[r]) { exterior[r] = 1; queue[qt++] = r; } }
  while (qh < qt) {
    const p = queue[qh++];
    const px = p % w, py = (p / w) | 0;
    const nb = [p - 1, p + 1, p - w, p + w];
    const ok = [px > 0, px < w - 1, py > 0, py < h - 1];
    for (let k = 0; k < 4; k++) if (ok[k] && !exterior[nb[k]] && !opaque[nb[k]]) { exterior[nb[k]] = 1; queue[qt++] = nb[k]; }
  }
  const label = new Int32Array(N).fill(-1);
  const hq = new Int32Array(N);
  let next = 0;
  const opaqueCount = opaque.reduce((a, b) => a + b, 0);
  for (let start = 0; start < N; start++) {
    if (label[start] !== -1 || opaque[start] || exterior[start]) continue;
    const L = next++;
    label[start] = L;
    let hh = 0, ht = 0;
    hq[ht++] = start;
    const cells: number[] = [];
    let lumSum = 0, lumVar = 0, guarded = 0;
    while (hh < ht) {
      const p = hq[hh++];
      cells.push(p);
      lumSum += lum[p];
      if (guard[p]) guarded++;
      const px = p % w, py = (p / w) | 0;
      const nb = [p - 1, p + 1, p - w, p + w];
      const ok = [px > 0, px < w - 1, py > 0, py < h - 1];
      for (let k = 0; k < 4; k++) if (ok[k] && label[nb[k]] === -1 && !opaque[nb[k]] && !exterior[nb[k]]) { label[nb[k]] = L; hq[ht++] = nb[k]; }
    }
    const mean = lumSum / cells.length;
    for (const p of cells) lumVar += (lum[p] - mean) * (lum[p] - mean);
    const std = Math.sqrt(lumVar / cells.length);
    const big = cells.length > Math.max(300, opaqueCount * 0.02);
    const flat = std < 14;
    const bright = mean > 185;
    const mostlyUnguarded = guarded / cells.length < 0.5;
    if (big && flat && bright && mostlyUnguarded) {
      for (const p of cells) d[p * 4 + 3] = 0;
    }
  }
  x.putImageData(img, 0, 0);
  return c2;
}

function softenAlphaEdge(x: CanvasRenderingContext2D, w: number, h: number) {
  const img = x.getImageData(0, 0, w, h);
  const d = img.data;
  const src = new Uint8ClampedArray(d);
  for (let y = 1; y < h - 1; y++) {
    for (let xx = 1; xx < w - 1; xx++) {
      const p = (y * w + xx) * 4 + 3;
      if (src[p] === 255) {
        let transparentNb = 0;
        if (src[p - 4] === 0) transparentNb++;
        if (src[p + 4] === 0) transparentNb++;
        if (src[p - w * 4] === 0) transparentNb++;
        if (src[p + w * 4] === 0) transparentNb++;
        if (transparentNb > 0) d[p] = Math.round(255 * (1 - transparentNb * 0.22));
      }
    }
  }
  x.putImageData(img, 0, 0);
}

/* ---------------- model post-passes ---------------- */

/* trimap guided filter: crush noise, snap edges to luminance, despeckle,
   fill SMALL enclosed holes. Never invents subject matter. */
function settleMatte(x: CanvasRenderingContext2D, w: number, h: number) {
  const img = x.getImageData(0, 0, w, h);
  const d = img.data;
  const { lum } = lumArrays(x, w, h);
  const N = w * h;
  const alpha = new Float32Array(N);
  for (let p = 0; p < N; p++) alpha[p] = d[p * 4 + 3] / 255;

  /* contrast stretch: definite bg <0.15 → 0, definite fg >0.6 → as-is */
  for (let p = 0; p < N; p++) {
    const a = alpha[p];
    if (a < 0.15) alpha[p] = a * 0.3;
    else if (a > 0.6) alpha[p] = Math.min(1, 0.6 + (a - 0.6) * 1.3);
  }
  /* 3×3 median despeckle on the uncertain band */
  const out = Float32Array.from(alpha);
  const win = new Float32Array(9);
  for (let y = 1; y < h - 1; y++) {
    for (let xx = 1; xx < w - 1; xx++) {
      const p = y * w + xx;
      const a0 = alpha[p];
      if (a0 < 0.15 || a0 > 0.6) { out[p] = a0 < 0.15 ? 0 : a0; continue; }
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) win[k++] = alpha[(y + dy) * w + xx + dx];
      win.sort();
      out[p] = win[4];
    }
  }
  /* guided snap: pull uncertain alpha toward the local luminance fit */
  for (let y = 1; y < h - 1; y++) {
    for (let xx = 1; xx < w - 1; xx++) {
      const p = y * w + xx;
      const a0 = out[p];
      if (a0 < 0.1 || a0 > 0.6) continue;
      let sa = 0, sl = 0, sll = 0, sal = 0, n = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const q = (y + dy) * w + xx + dx;
          sa += out[q]; sl += lum[q]; sll += lum[q] * lum[q]; sal += out[q] * lum[q]; n++;
        }
      }
      const meanA = sa / n, meanL = sl / n;
      const varL = Math.max(1e-4, sll / n - meanL * meanL);
      const g = (sal / n - meanA * meanL) / (varL + 0.02);
      const aNew = g * lum[p] + (meanA - g * meanL);
      out[p] = Math.max(a0 - 0.2, Math.min(a0 + 0.2, Math.max(0, Math.min(1, aNew))));
    }
  }
  for (let p = 0; p < N; p++) d[p * 4 + 3] = Math.round(out[p] * 255);
  x.putImageData(img, 0, 0);

  /* fill SMALL enclosed holes (<30px) — big holes are deliberate */
  const img2 = x.getImageData(0, 0, w, h);
  const d2 = img2.data;
  const opaque = new Uint8Array(N);
  for (let p = 0; p < N; p++) opaque[p] = d2[p * 4 + 3] > 40 ? 1 : 0;
  const exterior = new Uint8Array(N);
  const queue = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let xx = 0; xx < w; xx++) { if (!opaque[xx]) { exterior[xx] = 1; queue[qt++] = xx; } const b = (h - 1) * w + xx; if (!opaque[b]) { exterior[b] = 1; queue[qt++] = b; } }
  for (let y = 0; y < h; y++) { const l = y * w; const r = y * w + w - 1; if (!opaque[l]) { exterior[l] = 1; queue[qt++] = l; } if (!opaque[r]) { exterior[r] = 1; queue[qt++] = r; } }
  while (qh < qt) {
    const p = queue[qh++];
    const px = p % w, py = (p / w) | 0;
    const nb = [p - 1, p + 1, p - w, p + w];
    const ok = [px > 0, px < w - 1, py > 0, py < h - 1];
    for (let k = 0; k < 4; k++) if (ok[k] && !exterior[nb[k]] && !opaque[nb[k]]) { exterior[nb[k]] = 1; queue[qt++] = nb[k]; }
  }
  const label = new Int32Array(N).fill(-1);
  const hq = new Int32Array(N);
  let next = 0;
  for (let start = 0; start < N; start++) {
    if (label[start] !== -1 || opaque[start] || exterior[start]) continue;
    const L = next++;
    label[start] = L;
    let hh = 0, ht = 0;
    hq[ht++] = start;
    const cells: number[] = [];
    while (hh < ht) {
      const p = hq[hh++];
      cells.push(p);
      const px = p % w, py = (p / w) | 0;
      const nb = [p - 1, p + 1, p - w, p + w];
      const ok = [px > 0, px < w - 1, py > 0, py < h - 1];
      for (let k = 0; k < 4; k++) if (ok[k] && label[nb[k]] === -1 && !opaque[nb[k]] && !exterior[nb[k]]) { label[nb[k]] = L; hq[ht++] = nb[k]; }
    }
    if (cells.length < 30) for (const c2 of cells) d2[c2 * 4 + 3] = 255;
  }
  x.putImageData(img2, 0, 0);
}

/* strip the background-color fringe halo off the edge band */
function despillEdge(x: CanvasRenderingContext2D, w: number, h: number) {
  const img = x.getImageData(0, 0, w, h);
  const d = img.data;
  const src = new Uint8ClampedArray(d);
  const N = w * h;
  for (let y = 1; y < h - 1; y++) {
    for (let xx = 1; xx < w - 1; xx++) {
      const p = y * w + xx;
      const a = d[p * 4 + 3];
      if (a < 20 || a > 235) continue;
      let sr = 0, sg = 0, sb = 0, sw = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const q = ((y + dy) * w + xx + dx) * 4;
          const qa = src[q + 3];
          if (qa > 200) {
            const wt = 1 / (1 + dx * dx + dy * dy);
            sr += src[q] * wt; sg += src[q + 1] * wt; sb += src[q + 2] * wt; sw += wt;
          }
        }
      }
      if (sw > 0) {
        const i4 = p * 4;
        d[i4] = Math.round(src[i4] * 0.35 + (sr / sw) * 0.65);
        d[i4 + 1] = Math.round(src[i4 + 1] * 0.35 + (sg / sw) * 0.65);
        d[i4 + 2] = Math.round(src[i4 + 2] * 0.35 + (sb / sw) * 0.65);
      }
    }
  }
  x.putImageData(img, 0, 0);
}

/* peel sky above / safe ground below the subject (photo, painted, engraved) */
function removeSkyAndGround(c: HTMLCanvasElement) {
  const w = c.width, h = c.height;
  const [c2, x] = ctx2d(w, h);
  x.drawImage(c, 0, 0);
  const { lum } = lumArrays(x, w, h);
  const img = x.getImageData(0, 0, w, h);
  const d = img.data;
  const N = w * h;
  const opaque = new Uint8Array(N);
  let opaqueCount = 0;
  for (let p = 0; p < N; p++) { opaque[p] = d[p * 4 + 3] > 40 ? 1 : 0; if (opaque[p]) opaqueCount++; }
  if (opaqueCount < 200) return c;

  /* subject core = textured pixels + dilated guard */
  const core = new Uint8Array(N);
  let coreMean = 0, coreCnt = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let xx = 1; xx < w - 1; xx++) {
      const i = y * w + xx;
      if (!opaque[i]) continue;
      coreMean += lum[i]; coreCnt++;
      if (Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + w] - lum[i - w]) > 26) core[i] = 1;
    }
  }
  if (coreCnt === 0) return c;
  coreMean /= coreCnt;
  const guard = new Uint8Array(N);
  const dil = 8;
  for (let y = 0; y < h; y++) {
    for (let xx = 0; xx < w; xx++) {
      if (!core[y * w + xx]) continue;
      for (let dy = -dil; dy <= dil; dy++) {
        for (let dx = -dil; dx <= dil; dx++) {
          const yy = y + dy, xx2 = xx + dx;
          if (yy >= 0 && yy < h && xx2 >= 0 && xx2 < w) guard[yy * w + xx2] = 1;
        }
      }
    }
  }

  /* bbox of the subject */
  let minX = w, maxX = 0, minY = h, maxY = 0;
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
    if (!opaque[y * w + xx]) continue;
    if (xx < minX) minX = xx; if (xx > maxX) maxX = xx;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }

  const isSky = (p: number) => {
    if (guard[p]) return false;
    const l = lum[p];
    if (l > 190) return true; /* bright smooth paper/sky */
    /* engraved sky = horizontal hatch: strong vertical gradient, weak horizontal */
    const px = p % w, py = (p / w) | 0;
    if (px < 1 || py < 1 || px >= w - 1 || py >= h - 1) return false;
    const gv = Math.abs(lum[p + w] - lum[p - w]);
    const gh = Math.abs(lum[p + 1] - lum[p - 1]);
    return l > 140 && gv > 22 && gh < gv * 0.4;
  };
  const isGround = (p: number) => {
    if (guard[p]) return false;
    const l = lum[p];
    return Math.abs(l - coreMean) > 22 && (l > 170 || l < 60);
  };

  let removed = 0;
  /* flood sky from the top of the bbox */
  {
    const mask = new Uint8Array(N);
    const queue = new Int32Array(N);
    let qh = 0, qt = 0;
    for (let xx = minX; xx <= maxX; xx++) { const p = minY * w + xx; if (opaque[p] && isSky(p)) { mask[p] = 1; queue[qt++] = p; } }
    while (qh < qt) {
      const p = queue[qh++];
      const px = p % w, py = (p / w) | 0;
      const nb = [p - 1, p + 1, p - w, p + w];
      const ok = [px > 0, px < w - 1, py > 0, py < h - 1];
      for (let k = 0; k < 4; k++) if (ok[k] && !mask[nb[k]] && opaque[nb[k]] && isSky(nb[k])) { mask[nb[k]] = 1; queue[qt++] = nb[k]; }
    }
    for (let p = 0; p < N; p++) if (mask[p]) { d[p * 4 + 3] = 0; removed++; }
  }
  /* flood ground from the bottom of the bbox */
  {
    const mask = new Uint8Array(N);
    const queue = new Int32Array(N);
    let qh = 0, qt = 0;
    for (let xx = minX; xx <= maxX; xx++) { const p = maxY * w + xx; if (opaque[p] && isGround(p)) { mask[p] = 1; queue[qt++] = p; } }
    while (qh < qt) {
      const p = queue[qh++];
      const px = p % w, py = (p / w) | 0;
      const nb = [p - 1, p + 1, p - w, p + w];
      const ok = [px > 0, px < w - 1, py > 0, py < h - 1];
      for (let k = 0; k < 4; k++) if (ok[k] && !mask[nb[k]] && opaque[nb[k]] && isGround(nb[k])) { mask[nb[k]] = 1; queue[qt++] = nb[k]; }
    }
    for (let p = 0; p < N; p++) if (mask[p]) { d[p * 4 + 3] = 0; removed++; }
  }
  /* sanity: don't wipe more than 70% of the subject */
  if (removed > opaqueCount * 0.7) return c;
  x.putImageData(img, 0, 0);
  return c2;
}

/* ---------------- crop / grading ---------------- */

function opaqueBBox(c: HTMLCanvasElement, floor = 0.004): { x0: number; y0: number; bw: number; bh: number; coverage: number } | null {
  const w = c.width, h = c.height;
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) return null;
  const d = x.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1, solid = 0;
  for (let y = 0; y < h; y++) {
    for (let xx = 0; xx < w; xx++) {
      if (d[(y * w + xx) * 4 + 3] > 40) {
        solid++;
        if (xx < minX) minX = xx; if (xx > maxX) maxX = xx;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0 || solid / (w * h) < floor) return null;
  return { x0: minX, y0: minY, bw: maxX - minX + 1, bh: maxY - minY + 1, coverage: solid / (w * h) };
}

function tightCrop(src: HTMLCanvasElement, padFrac = 0.012, floor = 0.004): HTMLCanvasElement | null {
  const bb = opaqueBBox(src, floor);
  if (!bb) return null;
  const pad = Math.max(2, Math.round(Math.max(bb.bw, bb.bh) * padFrac));
  const x0 = Math.max(0, bb.x0 - pad), y0 = Math.max(0, bb.y0 - pad);
  const cw = Math.min(src.width - x0, bb.bw + pad * 2);
  const ch = Math.min(src.height - y0, bb.bh + pad * 2);
  const [c, x] = ctx2d(cw, ch);
  x.drawImage(src, x0, y0, cw, ch, 0, 0, cw, ch);
  return c;
}

/* cutout grade — SEPARATE scale over opaque pixels only */
export function gradeCutout(img: HTMLImageElement): { score: number } {
  try {
    const S = 64;
    const [c, x] = ctx2d(S, S);
    x.drawImage(img, 0, 0, S, S);
    const d = x.getImageData(0, 0, S, S).data;
    const N = S * S;
    let opaque = 0;
    const lums: number[] = [];
    for (let p = 0; p < N; p++) {
      if (d[p * 4 + 3] > 128) {
        opaque++;
        lums.push(d[p * 4] * 0.299 + d[p * 4 + 1] * 0.587 + d[p * 4 + 2] * 0.114);
      }
    }
    if (opaque < 20) return { score: 8 };
    const coverage = opaque / N;
    const lumArr = new Float32Array(N).fill(-1);
    for (let p = 0; p < N; p++) if (d[p * 4 + 3] > 128) lumArr[p] = d[p * 4] * 0.299 + d[p * 4 + 1] * 0.587 + d[p * 4 + 2] * 0.114;
    let edges = 0, counted = 0;
    for (let y = 1; y < S - 1; y++) {
      for (let xx = 1; xx < S - 1; xx++) {
        const p = y * S + xx;
        if (lumArr[p] < 0) continue;
        const r = p + 1, b = p + S;
        if (lumArr[r] >= 0) { counted++; if (Math.abs(lumArr[p] - lumArr[r]) > 26) edges++; }
        if (lumArr[b] >= 0) { counted++; if (Math.abs(lumArr[p] - lumArr[b]) > 26) edges++; }
      }
    }
    const detail = counted > 0 ? edges / counted : 0;
    let mean = 0;
    for (const l of lums) mean += l;
    mean /= lums.length;
    let variance = 0;
    for (const l of lums) variance += (l - mean) * (l - mean);
    const std = Math.sqrt(variance / lums.length);
    const covScore = coverage < 0.01 ? 5 : coverage < 0.04 ? 24 : coverage > 0.97 ? 20 : coverage > 0.9 ? 34 : 40;
    const score = Math.max(5, Math.min(97, Math.round(
      Math.min(34, detail * 260) + Math.min(26, (std / 62) * 26) + covScore,
    )));
    return { score };
  } catch {
    return { score: 55 };
  }
}

/* ---------------- the one public isolation entry ---------------- */

export async function isolateFromUrl(url: string, quality: 'fast' | 'fine' = 'fast', maxDim = 1400): Promise<IsoResult> {
  const img = await loadCors(url);
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(2, Math.round(img.naturalWidth * scale));
  const h = Math.max(2, Math.round(img.naturalHeight * scale));

  /* route: clean engraving → inkMatte; solid color bg → flood; else model */
  const [probeC, probeX] = ctx2d(64, 64);
  probeX.drawImage(img, 0, 0, 64, 64);
  const conf = engravingConfidence(probeX, 64, 64);
  const dense = coarseInkFraction(probeX, 64, 64);

  const [c, x] = ctx2d(w, h);
  x.drawImage(img, 0, 0, w, h);

  if (conf >= 0.65 && dense < 0.5) {
    /* clean figure / text on paper → the ink specialist */
    try {
      const ink = inkMatte(x, w, h);
      const bb = opaqueBBox(ink);
      if (bb && bb.coverage > 0.004 && bb.coverage < 0.97) {
        const tight = tightCrop(ink);
        if (tight) return { dataUrl: canvasToDataUrl(tight), width: tight.width, height: tight.height, engine: 'ink' };
      }
    } catch { /* fall through to model */ }
  }

  const floodC = backgroundFlood(img, w, h);
  if (floodC) {
    const bb = opaqueBBox(floodC);
    if (bb && bb.coverage > 0.004 && bb.coverage < 0.97) {
      const tight = tightCrop(floodC);
      if (tight) {
        const twice = removeInteriorFlatRegions(tight);
        return { dataUrl: canvasToDataUrl(twice), width: twice.width, height: twice.height, engine: 'flood' };
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
  for (let p = 0; p < mw * mh; p++) {
    mid.data[p * 4] = alpha[p]; mid.data[p * 4 + 1] = alpha[p]; mid.data[p * 4 + 2] = alpha[p]; mid.data[p * 4 + 3] = 255;
  }
  mx.putImageData(mid, 0, 0);
  const [ac, ax] = ctx2d(w, h);
  ax.drawImage(img, 0, 0, w, h);
  ax.globalCompositeOperation = 'destination-in';
  ax.imageSmoothingEnabled = true;
  ax.imageSmoothingQuality = 'high';
  ax.drawImage(mc, 0, 0, w, h);
  ax.globalCompositeOperation = 'source-over';

  if (w >= 64 && h >= 64) {
    settleMatte(ax, w, h);
    despillEdge(ax, w, h);
    removeSkyAndGround(ac);
  }

  /* 'fine' adds a crop-and-refine second pass for sharper edges */
  let finalCanvas = ac;
  if (quality === 'fine') {
    const bb = opaqueBBox(ac);
    if (bb && bb.coverage < 0.55 && bb.bw > 110 && bb.bh > 110) {
      try {
        const padX = Math.max(6, Math.round(bb.bw * 0.09));
        const padY = Math.max(6, Math.round(bb.bh * 0.09));
        const cx0 = Math.max(0, bb.x0 - padX), cy0 = Math.max(0, bb.y0 - padY);
        const cw2 = Math.min(w - cx0, bb.bw + padX * 2), ch2 = Math.min(h - cy0, bb.bh + padY * 2);
        if (cw2 > 64 && ch2 > 64) {
          const [crop, cxx] = ctx2d(cw2, ch2);
          cxx.drawImage(ac, cx0, cy0, cw2, ch2, 0, 0, cw2, ch2);
          const cb = await new Promise<Blob | null>(res => crop.toBlob(b2 => res(b2), 'image/png'));
          if (cb) {
            const cu = URL.createObjectURL(cb);
            try {
              const r2 = await runInference(cu);
              const a2 = matteToAlpha(r2.data, r2.dims);
              const m2h = r2.dims[r2.dims.length - 2], m2w = r2.dims[r2.dims.length - 1];
              const [m2c, m2x] = ctx2d(m2w, m2h);
              const m2id = m2x.createImageData(m2w, m2h);
              for (let p = 0; p < m2w * m2h; p++) { m2id.data[p * 4] = a2[p]; m2id.data[p * 4 + 1] = a2[p]; m2id.data[p * 4 + 2] = a2[p]; m2id.data[p * 4 + 3] = 255; }
              m2x.putImageData(m2id, 0, 0);
              const bid = ax.getImageData(cx0, cy0, cw2, ch2);
              const [upc, upx] = ctx2d(cw2, ch2);
              upx.drawImage(crop, 0, 0);
              upx.globalCompositeOperation = 'destination-in';
              upx.imageSmoothingEnabled = true;
              upx.imageSmoothingQuality = 'high';
              upx.drawImage(m2c, 0, 0, cw2, ch2);
              upx.globalCompositeOperation = 'source-over';
              const uid = upx.getImageData(0, 0, cw2, ch2);
              for (let p = 0; p < cw2 * ch2; p++) bid.data[p * 4 + 3] = uid.data[p * 4 + 3];
              ax.putImageData(bid, cx0, cy0);
            } finally {
              URL.revokeObjectURL(cu);
            }
          }
        }
      } catch { /* refinement is best-effort */ }
    }
  }

  /* lenient crop: any present matte yields a cut; only empty bails */
  let tight = tightCrop(finalCanvas);
  if (!tight) tight = tightCrop(finalCanvas, 0.012, 0.0002);
  if (!tight) throw new Error('empty matte');
  return { dataUrl: canvasToDataUrl(tight), width: tight.width, height: tight.height, engine: 'model' };
}
