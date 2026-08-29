/* SALVAGE/9 — automatic subject isolation.
   Heavy inference runs in isolate.worker.ts (off the main thread). The main
   thread only does lightweight compositing/refinement. Two engines:
     · model (RMBG-2.0/1.4) — photos, continuous tone, sculpture, architecture
     · ink   — purpose-built matte for ink-on-paper engravings (Doré et al.),
               preserving cross-hatching and closing hatch gaps.
   Never fold gradeCutout back into gradePlate. */

export interface IsoResult {
  dataUrl: string;
  width: number;
  height: number;
  engine: 'ink' | 'flood' | 'model';
}

/* ---------------- shared helpers ---------------- */

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
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load refused'));
    img.src = url;
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    p.then(v => { window.clearTimeout(t); resolve(v); }, e => { window.clearTimeout(t); reject(e); });
  });
}

function canvasToDataUrl(c: HTMLCanvasElement): string {
  const webp = c.toDataURL('image/webp', 0.92);
  if (webp.startsWith('data:image/webp')) return webp;
  return c.toDataURL('image/png');
}

/* ---------------- progress hook (first-time model download) ---------------- */

type ProgressFn = (pct: number | null, model: string) => void;
const progressSubs = new Set<ProgressFn>();
export function onIsoProgress(fn: ProgressFn): () => void {
  progressSubs.add(fn);
  return () => { progressSubs.delete(fn); };
}
function reportProgress(pct: number | null, model: string) {
  progressSubs.forEach(fn => fn(pct, model));
}

/* ---------------- worker management (round-robin pool) ----------------
   Two concurrent inference workers double throughput on multi-core
   machines; each loads its own model session (second load is served from
   the shared browser cache, so it's near-free). Requests are dispatched
   round-robin; the shared `pending` map keys by unique id so any worker
   can resolve any request. */

const POOL_SIZE = 2;
const pool: Worker[] = [];
const broken: boolean[] = [];
let rr = 0;
let nextReqId = 1;
const pending = new Map<number, {
  resolve: (v: { dims: number[]; data: Float32Array; model: string }) => void;
  reject: (e: Error) => void;
}>();

function spawnWorker(): Worker {
  const w = new Worker(new URL('./isolate.worker.ts', import.meta.url), { type: 'module' });
  const slot = pool.length;
  w.onmessage = (e: MessageEvent) => {
    const msg = e.data as { type: string; id?: number; dims?: number[]; buffer?: ArrayBuffer; model?: string; progress?: number; message?: string };
    if (msg.type === 'progress') { reportProgress(msg.progress ?? null, msg.model ?? ''); return; }
    const reqId = msg.id;
    const p = reqId !== undefined ? pending.get(reqId) : undefined;
    if (!p || reqId === undefined) return;
    pending.delete(reqId);
    if (msg.type === 'result' && msg.buffer && msg.dims) {
      p.resolve({ dims: msg.dims, data: new Float32Array(msg.buffer), model: msg.model ?? '' });
    } else {
      p.reject(new Error(msg.message ?? 'inference failed'));
    }
  };
  w.onerror = () => {
    broken[slot] = true;
    /* only fail requests this worker owned — but we can't tell, so if ALL
       workers are broken, fail everything outstanding */
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
  /* grow to the second worker only once one is already busy — avoids two
     simultaneous cold model downloads */
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

/* run the model via worker → grayscale matte canvas (at model resolution) */
async function rmbgMatteCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const objUrl = URL.createObjectURL(blob);
  try {
    const { dims, data } = await withTimeout(runInference(objUrl), 240_000, 'matting inference');
    const mh = dims[dims.length - 2], mw = dims[dims.length - 1];
    /* RMBG-2.0 may emit raw logits (outside [0,1]) — detect and sigmoid so
       edges stay soft instead of a harsh binary mask. */
    let needsSigmoid = false;
    for (let p = 0; p < data.length; p += 257) {
      if (data[p] > 1.5 || data[p] < -1.5) { needsSigmoid = true; break; }
    }
    const mc = document.createElement('canvas');
    mc.width = mw; mc.height = mh;
    const mx = mc.getContext('2d');
    if (!mx) throw new Error('no canvas');
    const mid = mx.createImageData(mw, mh);
    for (let p = 0; p < mw * mh; p++) {
      let v = data[p];
      if (needsSigmoid) v = 1 / (1 + Math.exp(-v));
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      const a = Math.round(v * 255);
      mid.data[p * 4] = a; mid.data[p * 4 + 1] = a; mid.data[p * 4 + 2] = a; mid.data[p * 4 + 3] = 255;
    }
    mx.putImageData(mid, 0, 0);
    return mc;
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

/* ================================================================== */
/*  INK-MATTE engine — for ink-on-paper engravings (Doré, woodcuts)    */
/* ================================================================== */

/* How confident are we this is monochrome ink-on-paper? 0..1. Strict, so it
   never butchers a photo. Engravings: low chroma + bimodal peaks + linework. */
export function engravingConfidence(img: HTMLImageElement): number {
  const S = 96;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) return 0;
  x.drawImage(img, 0, 0, S, S);
  let d: ImageData;
  try { d = x.getImageData(0, 0, S, S); } catch { return 0; }
  const px = d.data;
  const N = S * S;
  const hist = new Float32Array(16);
  const lum = new Float32Array(N);
  /* The discriminating signal is the CHROMA OF THE INK, not the whole image.
     An engraving has neutral (low-chroma) dark ink even on heavily aged,
     yellowed paper. A color illustration has chromatic darks. So measure
     chroma only over the dark half of the histogram. */
  let inkChroma = 0, inkN = 0;
  for (let p = 0; p < N; p++) {
    const r = px[p * 4], g = px[p * 4 + 1], b = px[p * 4 + 2];
    const l = r * 0.299 + g * 0.587 + b * 0.114;
    lum[p] = l;
    hist[Math.min(15, Math.floor(l / 16))]++;
    if (l < 128) { inkChroma += Math.max(r, g, b) - Math.min(r, g, b); inkN++; }
  }
  const inkC = inkN > 0 ? inkChroma / inkN : 999;
  if (inkC > 60) return 0; /* darks are colorful → color art, not an engraving */
  let dark = 0, light = 0;
  for (let b2 = 0; b2 < 5; b2++) dark += hist[b2];
  for (let b2 = 11; b2 < 16; b2++) light += hist[b2];
  const bimodal = dark / N > 0.05 && light / N > 0.15;
  if (!bimodal) return 0;
  /* line evidence: strong local edges */
  let edges = 0;
  for (let y = 1; y < S - 1; y++) {
    for (let xx = 1; xx < S - 1; xx++) {
      const i = y * S + xx;
      if (Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + S] - lum[i - S]) > 40) edges++;
    }
  }
  const edgeDensity = edges / N;
  if (edgeDensity < 0.04) return 0;
  return Math.min(1, 0.5 + edgeDensity * 2 + (light / N));
}

/* How much of the frame is covered by ink? Used to decide whether an
   engraving is a clean figure/text on paper (low — the ink matte is right)
   or a dense full-page scene like a Vesalius plate or a Doré Inferno
   (high — only the semantic model can isolate the main subject). */
export function coarseInkFraction(img: HTMLImageElement): number {
  const S = 96;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) return 0;
  x.drawImage(img, 0, 0, S, S);
  let d: ImageData;
  try { d = x.getImageData(0, 0, S, S); } catch { return 0; }
  const px = d.data;
  const N = S * S;
  /* paper color = median of the border ring */
  const ring: number[] = [];
  for (let i = 0; i < S; i++) { ring.push(i, (S - 1) * S + i, i * S, i * S + S - 1); }
  const med = (off: number) => {
    const a = ring.map(p => px[p * 4 + off]).sort((p, q) => p - q);
    return a[a.length >> 1];
  };
  const pR = med(0), pG = med(1), pB = med(2);
  let inky = 0;
  for (let p = 0; p < N; p++) {
    const dr = px[p * 4] - pR, dg = px[p * 4 + 1] - pG, db = px[p * 4 + 2] - pB;
    if (Math.sqrt(dr * dr + dg * dg + db * db) > 60) inky++;
  }
  return inky / N;
}

/* connected components → clear small ones (or fill small holes) */
function removeSmallComponents(mask: Uint8Array, w: number, h: number, minArea: number, clearValue: 0 | 1): void {
  const N = w * h;
  const label = new Int32Array(N).fill(-1);
  const queue = new Int32Array(N);
  let next = 0;
  const touches: boolean[] = [];
  const areas: number[] = [];
  for (let start = 0; start < N; start++) {
    if (label[start] !== -1) continue;
    const val = mask[start];
    const L = next++;
    label[start] = L;
    let qh = 0, qt = 0;
    queue[qt++] = start;
    let area = 0, border = false;
    while (qh < qt) {
      const p = queue[qh++];
      area++;
      const pxx = p % w, pyy = (p / w) | 0;
      if (pxx === 0 || pyy === 0 || pxx === w - 1 || pyy === h - 1) border = true;
      const nb = [p - 1, p + 1, p - w, p + w];
      const ok = [pxx > 0, pxx < w - 1, pyy > 0, pyy < h - 1];
      for (let k = 0; k < 4; k++) {
        if (!ok[k]) continue;
        const q = nb[k];
        if (label[q] === -1 && mask[q] === val) { label[q] = L; queue[qt++] = q; }
      }
    }
    touches[L] = border;
    areas[L] = area;
  }
  for (let p = 0; p < N; p++) {
    const L = label[p];
    if (areas[L] >= minArea || touches[L]) continue;
    if (mask[p] === clearValue) mask[p] = clearValue === 1 ? 0 : 1;
  }
}

/* The ink matte: keep the ink strokes, drop the paper, close hatch gaps so
   dense cross-hatching reads as solid. Returns an alpha canvas at img size. */
function inkMatte(img: HTMLImageElement, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) throw new Error('no canvas');
  x.drawImage(img, 0, 0, w, h);
  const id = x.getImageData(0, 0, w, h);
  const px = id.data;
  const N = w * h;

  /* sample paper color from the border ring (median, robust) */
  const ringIdx: number[] = [];
  const step = Math.max(1, Math.floor((2 * (w + h)) / 900));
  for (let i = 0; i < w; i += step) { ringIdx.push(i); ringIdx.push((h - 1) * w + i); }
  for (let j = 0; j < h; j += step) { ringIdx.push(j * w); ringIdx.push(j * w + w - 1); }
  const chan = (off: number) => {
    const arr = ringIdx.map(p2 => px[p2 * 4 + off]).sort((a2, b2) => a2 - b2);
    return arr[arr.length >> 1];
  };
  const pR = chan(0), pG = chan(1), pB = chan(2);

  /* ink amount per pixel = distance from paper, normalized */
  const ink = new Float32Array(N);
  const LO = 26, HI = 118;
  for (let p = 0; p < N; p++) {
    const dr = px[p * 4] - pR, dg = px[p * 4 + 1] - pG, db = px[p * 4 + 2] - pB;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    let t = (dist - LO) / (HI - LO);
    ink[p] = t < 0 ? 0 : t > 1 ? 1 : t;
  }

  /* raw mask + despeckle (removes foxing / freckle specks) */
  let raw: Uint8Array = new Uint8Array(N);
  for (let p = 0; p < N; p++) raw[p] = ink[p] > 0.32 ? 1 : 0;
  raw = raw.slice() as Uint8Array;
  removeSmallComponents(raw, w, h, Math.max(3, Math.round(N * 0.000006)), 1);

  /* close hatch gaps so dense cross-hatching reads as solid ink */
  const r = Math.max(2, Math.round(Math.max(w, h) / 420));
  const closed = new Uint8Array(N);
  for (let y = 0; y < h; y++) {
    for (let xx = 0; xx < w; xx++) {
      const p = y * w + xx;
      if (raw[p] === 1) { closed[p] = 1; continue; }
      let hit = false;
      outer:
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const px2 = xx + dx;
          if (px2 < 0 || px2 >= w) continue;
          if (raw[yy * w + px2] === 1) { hit = true; break outer; }
        }
      }
      /* only close if this pixel is at least faintly inky (avoid bleeding into paper) */
      closed[p] = hit && ink[p] > 0.14 ? 1 : 0;
    }
  }

  /* remove plate-mark / page-rule border frames: clear thin components that
     hug the outer margin but keep anything substantial */
  removeSmallComponents(closed, w, h, Math.max(20, Math.round(N * 0.0012)), 1);

  /* Enclosed paper holes: a hole that is really just background showing
     through (a letter counter like the middle of an "O", the interior of a
     geometric triangle) must STAY transparent. But a hole sitting inside a
     hatched/shaded figure is an artifact of imperfect hatch-closing and
     should be filled so the figure reads solid.
     Discriminator: the mean continuous-ink value *inside* the hole. A clean
     paper hole averages ~0; a hole amid hatching carries faint ink (~0.12+). */
  {
    const exterior = new Uint8Array(N);
    const q = new Int32Array(N);
    let qh = 0, qt = 0;
    for (let p = 0; p < N; p++) {
      const onBorder = p % w === 0 || p % w === w - 1 || p < w || p >= N - w;
      if (onBorder && closed[p] === 0) { exterior[p] = 1; q[qt++] = p; }
    }
    while (qh < qt) {
      const p = q[qh++];
      const nb = [p - 1, p + 1, p - w, p + w];
      const ok = [p % w > 0, p % w < w - 1, p >= w, p < N - w];
      for (let k = 0; k < 4; k++) {
        if (!ok[k]) continue;
        const qq = nb[k];
        if (!exterior[qq] && closed[qq] === 0) { exterior[qq] = 1; q[qt++] = qq; }
      }
    }
    /* group the interior holes into components, measure mean ink, fill only
       the hatched ones */
    const HOLE_INK = 0.10;
    const seen = new Uint8Array(N);
    const hq = new Int32Array(N);
    for (let start = 0; start < N; start++) {
      if (closed[start] === 1 || exterior[start] || seen[start]) continue;
      let hh = 0, ht = 0, area = 0, inkSum = 0;
      hq[ht++] = start; seen[start] = 1;
      const members: number[] = [];
      while (hh < ht) {
        const p = hq[hh++];
        area++; inkSum += ink[p]; members.push(p);
        const px = p % w, py = (p / w) | 0;
        const nb = [p - 1, p + 1, p - w, p + w];
        const ok = [px > 0, px < w - 1, py > 0, py < h - 1];
        for (let k = 0; k < 4; k++) {
          if (!ok[k]) continue;
          const qq = nb[k];
          if (closed[qq] === 0 && !exterior[qq] && !seen[qq]) { seen[qq] = 1; hq[ht++] = qq; }
        }
      }
      const meanInk = inkSum / Math.max(1, area);
      if (meanInk >= HOLE_INK) {
        for (const m of members) closed[m] = 1; /* hatched → fill solid */
      }
      /* else: clean paper hole → leave transparent */
    }
  }

  /* build alpha with a soft ramp so edges are anti-aliased, not binary */
  const out = x.createImageData(w, h);
  for (let p = 0; p < N; p++) {
    let a: number;
    if (closed[p] === 1) {
      a = ink[p] > 0.5 ? 255 : Math.round(120 + ink[p] * 270); /* solid ink */
      a = Math.min(255, a);
    } else {
      a = 0;
    }
    out.data[p * 4] = px[p * 4];
    out.data[p * 4 + 1] = px[p * 4 + 1];
    out.data[p * 4 + 2] = px[p * 4 + 2];
    out.data[p * 4 + 3] = a;
  }
  x.putImageData(out, 0, 0);
  return c;
}

/* ================================================================== */
/*  matte post-passes (model path)                                     */
/* ================================================================== */

function opaqueBBox(c: HTMLCanvasElement, floor = 0.004): { x0: number; y0: number; bw: number; bh: number; coverage: number } | null {
  const w = c.width, h = c.height;
  const sx = c.getContext('2d', { willReadFrequently: true });
  if (!sx) return null;
  const d = sx.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1, solid = 0;
  for (let y = 0; y < h; y++) {
    for (let xx = 0; xx < w; xx++) {
      if (d[(y * w + xx) * 4 + 3] > 40) {
        solid++;
        if (xx < minX) minX = xx;
        if (xx > maxX) maxX = xx;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0 || solid / (w * h) < floor) return null;
  return { x0: minX, y0: minY, bw: maxX - minX + 1, bh: maxY - minY + 1, coverage: solid / (w * h) };
}

/* refineMatte — trimap-based. Flood-fill definite background/foreground,
   only touch the narrow uncertain band: contrast stretch → median → guided
   filter → snap. Provably safe on the solid interior. */
function refineMatte(x: CanvasRenderingContext2D, w: number, h: number) {
  const id = x.getImageData(0, 0, w, h);
  const d = id.data;
  const N = w * h;
  const lum = new Float32Array(N);
  for (let p = 0; p < N; p++) lum[p] = d[p * 4] * 0.299 + d[p * 4 + 1] * 0.587 + d[p * 4 + 2] * 0.114;

  const alpha = new Float32Array(N);
  for (let p = 0; p < N; p++) alpha[p] = d[p * 4 + 3] / 255;

  /* contrast stretch: crush faint haze just outside the edge, keep the
     real transition continuous */
  for (let p = 0; p < N; p++) {
    const a = alpha[p];
    if (a < 0.06) alpha[p] = 0;
    else if (a > 0.94) alpha[p] = 1;
    else alpha[p] = (a - 0.06) / 0.88;
  }

  /* trimap: definite background (transparent, connected to border) vs the rest */
  const bg = new Uint8Array(N);
  const queue = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let p = 0; p < N; p++) {
    const onBorder = p % w === 0 || p % w === w - 1 || p < w || p >= N - w;
    if (onBorder && alpha[p] < 0.05) { bg[p] = 1; queue[qt++] = p; }
  }
  while (qh < qt) {
    const p = queue[qh++];
    const nb = [p - 1, p + 1, p - w, p + w];
    const ok = [p % w > 0, p % w < w - 1, p >= w, p < N - w];
    for (let k = 0; k < 4; k++) {
      if (!ok[k]) continue;
      const q = nb[k];
      if (!bg[q] && alpha[q] < 0.05) { bg[q] = 1; queue[qt++] = q; }
    }
  }

  /* only refine the uncertain band (neither definite background nor solid) */
  const out = Float32Array.from(alpha);
  const R = 2;
  for (let y = R; y < h - R; y++) {
    for (let xx = R; xx < w - R; xx++) {
      const p = y * w + xx;
      const a0 = alpha[p];
      if (bg[p] || a0 < 0.05 || a0 > 0.8) continue;
      let sa = 0, sl = 0, sll = 0, sal = 0, n = 0;
      const lp = lum[p];
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const q = (y + dy) * w + xx + dx;
          sa += alpha[q]; sl += lum[q]; sll += lum[q] * lum[q]; sal += alpha[q] * lum[q]; n++;
        }
      }
      const meanA = sa / n, meanL = sl / n;
      const varL = Math.max(1e-4, sll / n - meanL * meanL);
      const covAL = sal / n - meanA * meanL;
      const g = covAL / (varL + 0.01);
      const b = meanA - g * meanL;
      out[p] = Math.max(0.02, Math.min(0.92, Math.max(a0 - 0.22, Math.min(a0 + 0.22, g * lp + b))));
    }
  }
  for (let p = 0; p < N; p++) d[p * 4 + 3] = Math.round(out[p] * 255);

  /* despeckle + fill enclosed holes */
  const minArea = Math.max(20, Math.round(N * 0.00003));
  const mask = new Uint8Array(N);
  for (let p = 0; p < N; p++) mask[p] = d[p * 4 + 3] > 128 ? 1 : 0;
  const label = new Int32Array(N).fill(-1);
  const q2 = new Int32Array(N);
  let next = 0;
  const touches: boolean[] = [];
  const areas: number[] = [];
  for (let start = 0; start < N; start++) {
    if (label[start] !== -1) continue;
    const val = mask[start];
    const L = next++;
    label[start] = L;
    let h2 = 0, t2 = 0;
    q2[t2++] = start;
    let area = 0, border = false;
    while (h2 < t2) {
      const p = q2[h2++];
      area++;
      const pxx = p % w, pyy = (p / w) | 0;
      if (pxx === 0 || pyy === 0 || pxx === w - 1 || pyy === h - 1) border = true;
      const nb = [p - 1, p + 1, p - w, p + w];
      const ok = [pxx > 0, pxx < w - 1, pyy > 0, pyy < h - 1];
      for (let k = 0; k < 4; k++) {
        if (!ok[k]) continue;
        const q3 = nb[k];
        if (label[q3] === -1 && mask[q3] === val) { label[q3] = L; q2[t2++] = q3; }
      }
    }
    touches[L] = border;
    areas[L] = area;
  }
  for (let p = 0; p < N; p++) {
    const L = label[p];
    if (touches[L]) continue;                      /* connected to the border → leave alone */
    if (mask[p] === 1) {
      if (areas[L] < minArea) d[p * 4 + 3] = 0;    /* despeckle small opaque specks        */
    } else {
      d[p * 4 + 3] = 255;                          /* fill EVERY enclosed transparent hole   */
    }
  }

  x.putImageData(id, 0, 0);
}

/* despillEdge — strip background-color fringe on semi-transparent edge pixels.
   Distance-weighted toward nearby solid pixels. Only the edge band is touched. */
function despillEdge(x: CanvasRenderingContext2D, w: number, h: number) {
  const id = x.getImageData(0, 0, w, h);
  const d = id.data;
  const R = 3;
  const out = new Uint8ClampedArray(d);
  for (let y = 0; y < h; y++) {
    for (let xx = 0; xx < w; xx++) {
      const p = y * w + xx;
      const a = d[p * 4 + 3];
      if (a < 20 || a > 235) continue;
      let sr = 0, sg = 0, sb = 0, sw = 0;
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -R; dx <= R; dx++) {
          const px2 = xx + dx;
          if (px2 < 0 || px2 >= w) continue;
          const q = yy * w + px2;
          if (d[q * 4 + 3] > 235) {
            const wgt = 1 / (1 + dx * dx + dy * dy);
            sr += d[q * 4] * wgt; sg += d[q * 4 + 1] * wgt; sb += d[q * 4 + 2] * wgt; sw += wgt;
          }
        }
      }
      if (sw < 0.5) continue;
      const ir = sr / sw, ig = sg / sw, ib = sb / sw;
      const t = 1 - a / 255;
      const k = 0.55 * t;
      out[p * 4] = d[p * 4] + (ir - d[p * 4]) * k;
      out[p * 4 + 1] = d[p * 4 + 1] + (ig - d[p * 4 + 1]) * k;
      out[p * 4 + 2] = d[p * 4 + 2] + (ib - d[p * 4 + 2]) * k;
    }
  }
  x.putImageData(new ImageData(out, w, h), 0, 0);
}

/* removeSkyAndGround — after the main matte, peel away sky above the subject
   and safe-to-remove ground below it, WITHOUT touching the subject.
   Safety model: textured pixels = the subject "core". The core is dilated
   into a protected guard zone. Only SMOOTH or sky-hatched pixels that are
   connected to the top/bottom edge of the subject's bounding box AND lie
   outside the guard zone are removed. Ground is only removed when its tone
   clearly differs from the subject core (so a same-tone smooth subject is
   never eaten). Engraved sky = purely-horizontal hatching (vertical gradient
   dominant, little horizontal gradient) — cross-hatched subject shading has
   gradient in both directions, so it stays protected. */
function removeSkyAndGround(src: HTMLCanvasElement): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const sx = src.getContext('2d', { willReadFrequently: true });
  if (!sx) return src;
  const id = sx.getImageData(0, 0, w, h);
  const d = id.data;
  const N = w * h;

  const opaque = new Uint8Array(N);
  const lum = new Float32Array(N);
  const ex = new Float32Array(N);
  const ey = new Float32Array(N);
  let opaqueCount = 0;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let xx = 0; xx < w; xx++) {
      const p = y * w + xx;
      const a = d[p * 4 + 3];
      lum[p] = d[p * 4] * 0.299 + d[p * 4 + 1] * 0.587 + d[p * 4 + 2] * 0.114;
      if (a > 40) {
        opaque[p] = 1; opaqueCount++;
        if (xx < minX) minX = xx; if (xx > maxX) maxX = xx;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (opaqueCount === 0 || maxX < 0) return src;
  const coverage = opaqueCount / N;
  if (coverage < 0.02 || coverage > 0.97) return src;

  /* gradients (interior, opaque pixels only) */
  for (let y = 1; y < h - 1; y++) {
    for (let xx = 1; xx < w - 1; xx++) {
      const p = y * w + xx;
      if (!opaque[p]) continue;
      ex[p] = Math.abs(lum[p + 1] - lum[p - 1]);
      ey[p] = Math.abs(lum[p + w] - lum[p - w]);
    }
  }

  const SMOOTH = 12;
  /* purely-horizontal hatching = engraved sky/ground */
  const isHatch = (p: number) => ey[p] > 16 && ey[p] / (ex[p] + ey[p] + 1e-6) > 0.62 && ex[p] < 14;

  /* subject core = textured pixels that are NOT sky-hatch */
  const CORE_EDGE = 26;
  const coreRaw = new Uint8Array(N);
  let coreCount = 0, coreLumSum = 0;
  for (let p = 0; p < N; p++) {
    if (!opaque[p]) continue;
    const ed = ex[p] + ey[p];
    if (ed > CORE_EDGE && !isHatch(p)) { coreRaw[p] = 1; coreCount++; coreLumSum += lum[p]; }
  }
  /* no reliable subject texture → can't safely tell sky/ground from subject */
  if (coreCount < opaqueCount * 0.02) return src;
  const meanCoreLum = coreLumSum / coreCount;

  /* separable dilation of the core into a guard zone */
  const DILATE = 5;
  const hguard = new Uint8Array(N);
  const guard = new Uint8Array(N);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let xx = 0; xx < w; xx++) {
      if (!coreRaw[row + xx]) continue;
      const lo = Math.max(0, xx - DILATE), hi = Math.min(w - 1, xx + DILATE);
      for (let px2 = lo; px2 <= hi; px2++) hguard[row + px2] = 1;
    }
  }
  for (let xx = 0; xx < w; xx++) {
    for (let y = 0; y < h; y++) {
      if (!hguard[y * w + xx]) continue;
      const lo = Math.max(0, y - DILATE), hi = Math.min(h - 1, y + DILATE);
      for (let yy = lo; yy <= hi; yy++) guard[yy * w + xx] = 1;
    }
  }

  const isSkyLike = (p: number) => {
    if (!opaque[p] || guard[p]) return false;
    if (isHatch(p)) return true;                    /* engraved sky */
    const ed = ex[p] + ey[p];
    if (ed < SMOOTH) {
      if (lum[p] > 140) return true;                /* bright photo/painted sky */
      if (d[p * 4 + 2] > d[p * 4] + 18 && d[p * 4 + 2] > d[p * 4 + 1] + 8) return true; /* blue sky */
    }
    return false;
  };
  const isGroundLike = (p: number) => {
    if (!opaque[p] || guard[p]) return false;
    if (isHatch(p)) return true;                    /* engraved ground */
    return ex[p] + ey[p] < SMOOTH;                  /* smooth photo ground */
  };

  /* BFS sky from the top row of the bbox */
  const q = new Int32Array(N);
  const sky = new Uint8Array(N);
  let qh = 0, qt = 0, skyCount = 0;
  for (let xx = minX; xx <= maxX; xx++) {
    const p = minY * w + xx;
    if (isSkyLike(p)) { sky[p] = 1; q[qt++] = p; skyCount++; }
  }
  while (qh < qt) {
    const p = q[qh++];
    const nb = [p - 1, p + 1, p - w, p + w];
    const ok = [p % w > 0, p % w < w - 1, p >= w, p < N - w];
    for (let k = 0; k < 4; k++) {
      if (!ok[k]) continue;
      const qq = nb[k];
      if (!sky[qq] && isSkyLike(qq)) { sky[qq] = 1; q[qt++] = qq; skyCount++; }
    }
  }

  /* BFS ground from the bottom row of the bbox */
  const ground = new Uint8Array(N);
  qh = 0; qt = 0;
  let groundCount = 0, groundLumSum = 0;
  for (let xx = minX; xx <= maxX; xx++) {
    const p = maxY * w + xx;
    if (isGroundLike(p)) { ground[p] = 1; q[qt++] = p; groundCount++; groundLumSum += lum[p]; }
  }
  while (qh < qt) {
    const p = q[qh++];
    const nb = [p - 1, p + 1, p - w, p + w];
    const ok = [p % w > 0, p % w < w - 1, p >= w, p < N - w];
    for (let k = 0; k < 4; k++) {
      if (!ok[k]) continue;
      const qq = nb[k];
      if (!ground[qq] && isGroundLike(qq)) { ground[qq] = 1; q[qt++] = qq; groundCount++; groundLumSum += lum[qq]; }
    }
  }

  const applySky = skyCount >= opaqueCount * 0.005 && skyCount <= opaqueCount * 0.7;
  let applyGround = false;
  if (groundCount >= opaqueCount * 0.005 && groundCount <= opaqueCount * 0.6) {
    const meanGroundLum = groundLumSum / groundCount;
    if (Math.abs(meanGroundLum - meanCoreLum) > 22) applyGround = true;
  }
  if (!applySky && !applyGround) return src;

  for (let p = 0; p < N; p++) {
    if ((applySky && sky[p]) || (applyGround && ground[p])) d[p * 4 + 3] = 0;
  }
  sx.putImageData(id, 0, 0);
  return src;
}

function tightCrop(src: HTMLCanvasElement, padFrac = 0.012, floor = 0.004): HTMLCanvasElement | null {
  const bb = opaqueBBox(src, floor);
  if (!bb) return null;
  const w = src.width, h = src.height;
  const pad = Math.max(2, Math.round(Math.max(bb.bw, bb.bh) * padFrac));
  const x0 = Math.max(0, bb.x0 - pad), y0 = Math.max(0, bb.y0 - pad);
  const cw = Math.min(w - x0, bb.bw + pad * 2);
  const ch = Math.min(h - y0, bb.bh + pad * 2);
  const out = document.createElement('canvas');
  out.width = cw; out.height = ch;
  const ox = out.getContext('2d');
  if (!ox) return null;
  ox.drawImage(src, x0, y0, cw, ch, 0, 0, cw, ch);
  return out;
}

/* ================================================================== */
/*  background flood-fill — Procreate "Automatic" select               */
/*                                                                     */
/*  A color-similarity region grow seeded from the frame border. When   */
/*  the background is a solid (or gently graded) color, this removes it */
/*  with razor-sharp edges and no halo — exactly what tapping the       */
/*  background in Procreate's Automatic mode does. It's also nearly     */
/*  free compared to the neural net. Returns null when the border isn't */
/*  uniform enough, so the caller falls through to the model.           */
/* ================================================================== */

function backgroundFlood(img: HTMLImageElement, w: number, h: number): HTMLCanvasElement | null {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) return null;
  x.drawImage(img, 0, 0, w, h);
  const id = x.getImageData(0, 0, w, h);
  const d = id.data;
  const N = w * h;

  /* 1 — seed color: mean of the border ring */
  const borderIdx: number[] = [];
  for (let i = 0; i < w; i++) { borderIdx.push(i); borderIdx.push((h - 1) * w + i); }
  for (let j = 0; j < h; j++) { borderIdx.push(j * w); borderIdx.push(j * w + w - 1); }
  let br = 0, bgc = 0, bb = 0;
  for (const p of borderIdx) { br += d[p * 4]; bgc += d[p * 4 + 1]; bb += d[p * 4 + 2]; }
  const bn = borderIdx.length;
  br /= bn; bgc /= bn; bb /= bn;

  /* 2 — uniformity gate: bail if the border isn't a consistent color */
  let varSum = 0;
  for (const p of borderIdx) {
    const dr = d[p * 4] - br, dg = d[p * 4 + 1] - bgc, db = d[p * 4 + 2] - bb;
    varSum += dr * dr + dg * dg + db * db;
  }
  if (Math.sqrt(varSum / bn) > 26) return null;

  /* 3 — region grow. Each candidate is compared against the running region
        mean, so the fill rides gentle gradients but stops at the sharp
        subject boundary. */
  const TOL = 30;
  const tol2 = TOL * TOL;
  const dist2 = (p: number, mr: number, mg: number, mb: number) => {
    const dr = d[p * 4] - mr, dg = d[p * 4 + 1] - mg, db = d[p * 4 + 2] - mb;
    return dr * dr + dg * dg + db * db;
  };
  const visited = new Uint8Array(N);
  const queue = new Int32Array(N);
  let qh = 0, qt = 0;
  let rr = 0, rg = 0, rb = 0;
  for (const p of borderIdx) {
    if (visited[p]) continue;
    if (dist2(p, br, bgc, bb) > tol2 * 4) continue; /* border outlier */
    visited[p] = 1; queue[qt++] = p;
    rr += d[p * 4]; rg += d[p * 4 + 1]; rb += d[p * 4 + 2];
  }
  let regionN = qt;
  if (regionN === 0) return null;
  while (qh < qt) {
    const p = queue[qh++];
    const px = p % w, py = (p / w) | 0;
    const mr = rr / regionN, mg = rg / regionN, mb = rb / regionN;
    const nb = [p - 1, p + 1, p - w, p + w];
    const ok = [px > 0, px < w - 1, py > 0, py < h - 1];
    for (let k = 0; k < 4; k++) {
      if (!ok[k]) continue;
      const q = nb[k];
      if (visited[q]) continue;
      if (dist2(q, mr, mg, mb) <= tol2) {
        visited[q] = 1; queue[qt++] = q;
        rr += d[q * 4]; rg += d[q * 4 + 1]; rb += d[q * 4 + 2];
        regionN++;
      }
    }
  }

  /* 4 — sanity: we must have removed a meaningful-but-not-total amount */
  const removedFrac = qt / N;
  if (removedFrac < 0.12 || removedFrac > 0.92) return null;

  /* 5 — alpha. Subject = not flooded. Boundary pixels get partial alpha
        based on how far their color sits from the background, which keeps
        crisp edges crisp and only softens genuinely anti-aliased pixels. */
  const mr = rr / regionN, mg = rg / regionN, mb = rb / regionN;
  for (let p = 0; p < N; p++) {
    if (visited[p]) { d[p * 4 + 3] = 0; continue; }
    const px = p % w, py = (p / w) | 0;
    const onBoundary =
      (px > 0 && visited[p - 1]) || (px < w - 1 && visited[p + 1]) ||
      (py > 0 && visited[p - w]) || (py < h - 1 && visited[p + w]);
    if (!onBoundary) { d[p * 4 + 3] = 255; continue; }
    const dd = Math.sqrt(dist2(p, mr, mg, mb));
    const t = Math.max(0, Math.min(1, (dd - TOL * 0.5) / (TOL * 1.5)));
    d[p * 4 + 3] = Math.round(255 * t);
  }
  x.putImageData(id, 0, 0);
  return c;
}

/* ================================================================== */
/*  second-pass flood — remove INTERIOR solid-color regions            */
/* ================================================================== */
/*  After the background flood, the subject can still contain a large   */
/*  flat region that is *enclosed* — e.g. the white paper inside a      */
/*  picture frame, or a flat sky panel inside an illustration. This     */
/*  finds connected flat-color regions that are (a) large, (b) very     */
/*  flat, and (c) do NOT touch the subject's outer boundary, and cuts   */
/*  them away. Regions that touch the boundary (the frame itself, a     */
/*  solid logo, the subject's silhouette) are always kept.              */
function removeInteriorFlatRegions(src: HTMLCanvasElement): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const sx = src.getContext('2d', { willReadFrequently: true });
  if (!sx) return src;
  const id = sx.getImageData(0, 0, w, h);
  const d = id.data;
  const N = w * h;

  /* opaque bounding box (the subject after the first crop) */
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let xx = 0; xx < w; xx++) {
      if (d[(y * w + xx) * 4 + 3] > 40) {
        if (xx < x0) x0 = xx;
        if (xx > x1) x1 = xx;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return src;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const bboxArea = bw * bh;

  /* deliberately conservative: only remove a region that is unmistakably a
     big, dead-flat panel (the white paper inside a frame). Tightening these
     protects real subject interiors — a hand, a logo counter, a face — from
     being hollowed out. */
  const GROUP = 20;      /* color distance that still counts as "same color" */
  const FLAT_STD = 7;    /* max luminance stddev to call a region flat       */
  const MIN_FRAC = 0.22; /* must cover ≥22% of the subject bbox to bother    */

  /* connected components over opaque pixels, grouped by color similarity */
  const labels = new Int32Array(N).fill(-1);
  const queue = new Int32Array(N);
  const colorDist = (p: number, q: number) => {
    const dr = d[p * 4] - d[q * 4], dg = d[p * 4 + 1] - d[q * 4 + 1], db = d[p * 4 + 2] - d[q * 4 + 2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  let cap = 64, comp = 0;
  let compArea = new Int32Array(cap);
  let compTouch = new Uint8Array(cap);
  let compSum = new Float64Array(cap);
  let compSumSq = new Float64Array(cap);
  const compPixels: number[][] = [];
  const ensureCap = () => {
    if (comp >= cap) {
      cap *= 2;
      const na = new Int32Array(cap); na.set(compArea); compArea = na;
      const nt = new Uint8Array(cap); nt.set(compTouch); compTouch = nt;
      const ns = new Float64Array(cap); ns.set(compSum); compSum = ns;
      const nq = new Float64Array(cap); nq.set(compSumSq); compSumSq = nq;
    }
  };

  for (let start = 0; start < N; start++) {
    if (d[start * 4 + 3] <= 40 || labels[start] !== -1) continue;
    ensureCap();
    const cid = comp++;
    compPixels.push([]);
    labels[start] = cid;
    let qh = 0, qt = 0;
    queue[qt++] = start;
    compPixels[cid].push(start);
    while (qh < qt) {
      const p = queue[qh++];
      const px = p % w, py = (p / w) | 0;
      const pl = d[p * 4] * 0.299 + d[p * 4 + 1] * 0.587 + d[p * 4 + 2] * 0.114;
      compSum[cid] += pl;
      compSumSq[cid] += pl * pl;
      compArea[cid]++;
      if (px === x0 || px === x1 || py === y0 || py === y1) compTouch[cid] = 1;
      const nx = [p - 1, p + 1, p - w, p + w];
      const ok = [px > 0, px < w - 1, py > 0, py < h - 1];
      for (let k = 0; k < 4; k++) {
        if (!ok[k]) continue;
        const q = nx[k];
        if (d[q * 4 + 3] <= 40 || labels[q] !== -1) continue;
        if (colorDist(p, q) > GROUP) continue;
        labels[q] = cid;
        queue[qt++] = q;
        compPixels[cid].push(q);
      }
    }
  }

  /* Cut an interior region ONLY if it is unmistakably a nested background:
     big, dead-flat, AND bright like paper. A subject's own interior (a face,
     a logo counter, a dark shape) is colored or dark, so it is always kept. */
  const minArea = MIN_FRAC * bboxArea;
  const BRIGHT_MIN = 185; /* mean luminance a panel needs to read as "paper" */
  let removed = 0;
  for (let cid = 0; cid < comp; cid++) {
    if (compTouch[cid]) continue;              /* touches the edge → keep    */
    if (compArea[cid] < minArea) continue;     /* too small → keep           */
    const mean = compSum[cid] / compArea[cid];
    if (mean < BRIGHT_MIN) continue;           /* not paper-bright → keep    */
    const variance = compSumSq[cid] / compArea[cid] - mean * mean;
    if (Math.sqrt(Math.max(0, variance)) > FLAT_STD) continue; /* not flat   */
    for (const p of compPixels[cid]) d[p * 4 + 3] = 0;
    removed += compArea[cid];
  }

  if (removed === 0) return src;
  sx.putImageData(id, 0, 0);
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ox = out.getContext('2d');
  if (!ox) return src;
  ox.drawImage(src, 0, 0);
  return out;
}

/* ================================================================== */
/*  the one public isolation entry                                     */
/* ================================================================== */

export async function isolateFromUrl(url: string, quality: 'fast' | 'fine' = 'fast', maxDim = 1400): Promise<IsoResult> {
  /* 'fast' runs a single inference pass; 'fine' adds a crop-and-refine
     second pass (slower but sharper edges on small subjects). */
  const doRefine = quality === 'fine';
  const blob = await (await withTimeout(fetch(url), 20_000, 'image fetch')).blob();
  if (!blob.type.startsWith('image')) throw new Error('host served a non-image');
  const img = await loadCors(url);
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(2, Math.round(img.naturalWidth * scale));
  const h = Math.max(2, Math.round(img.naturalHeight * scale));

  /* Classify the plate so each route only fires when it is the right tool:
     · clean engraving (ink is a minority of the frame) → ink matte, which
       keeps strokes/hatching and now leaves clean paper holes transparent.
     · dense full-page engraving (a Vesalius plate, a Doré Inferno) → the
       semantic MODEL. The ink matte would keep *all* the ink (= everything),
       so dense plates must skip it and go straight to subject isolation. */
  let conf = 0;
  try { conf = engravingConfidence(img); } catch { conf = 0; }
  let dense = 0;
  try { dense = coarseInkFraction(img); } catch { dense = 0; }
  const isDenseEngraving = conf >= 0.62 && dense >= 0.5;

  if (conf >= 0.62 && !isDenseEngraving) {
    try {
      const inkC = inkMatte(img, w, h);
      /* peel engraved sky/ground around the figure (safe no-op for clean text) */
      if (w >= 64 && h >= 64) removeSkyAndGround(inkC);
      const bb = opaqueBBox(inkC);
      if (bb && bb.coverage > 0.004 && bb.coverage < 0.97) {
        const tight = tightCrop(inkC);
        if (tight) return { dataUrl: canvasToDataUrl(tight), width: tight.width, height: tight.height, engine: 'ink' };
      }
      /* ink matte produced garbage — fall through to the model */
    } catch { /* fall through */ }
  }

  /* route: solid-color background → color-similarity flood. Razor-sharp on
     flat/graded backgrounds (stickers, flat illustrations, product shots,
     berries-on-leaf) and near-free. Falls through to the model when the
     border isn't uniform or the result isn't a coherent subject. Skipped for
     dense engravings, where only the model can find the main subject. */
  if (!isDenseEngraving) {
    try {
      const floodC = backgroundFlood(img, w, h);
      if (floodC) {
        const bb = opaqueBBox(floodC);
        if (bb && bb.coverage > 0.004 && bb.coverage < 0.97) {
          const tight = tightCrop(floodC);
          if (tight) {
            /* SECOND flood: also cut away any large, flat, *enclosed* region
               left inside the subject — e.g. the white paper inside a picture
               frame, or a flat sky panel in a flat illustration. Only regions
               that do NOT touch the subject's outer boundary are removed, so
               the frame / logo / silhouette itself is always kept. */
            const twice = removeInteriorFlatRegions(tight);
            return { dataUrl: canvasToDataUrl(twice), width: twice.width, height: twice.height, engine: 'flood' };
          }
        }
      }
    } catch { /* fall through */ }
  }

  /* model path */
  const matte = await rmbgMatteCanvas(blob);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) throw new Error('no canvas');
  x.drawImage(img, 0, 0, w, h);
  const mc = document.createElement('canvas');
  mc.width = w; mc.height = h;
  const mx = mc.getContext('2d', { willReadFrequently: true });
  if (!mx) throw new Error('no canvas');
  mx.imageSmoothingEnabled = true;
  mx.imageSmoothingQuality = 'high';
  mx.drawImage(matte, 0, 0, w, h);
  const md = mx.getImageData(0, 0, w, h).data;
  const id = x.getImageData(0, 0, w, h);
  const dd = id.data;
  for (let p = 0; p < w * h; p++) dd[p * 4 + 3] = md[p * 4];
  x.putImageData(id, 0, 0);
  if (w >= 64 && h >= 64) {
    refineMatte(x, w, h);
    despillEdge(x, w, h);
  }
  /* peel sky above / safe ground below the subject (photo, painted, or engraved) */
  if (w >= 64 && h >= 64) removeSkyAndGround(c);

  /* crop-and-refine: when the subject is a small part of the frame, the model
     decided its edge at low effective resolution. Re-run on the crop so the
     boundary is re-decided at full detail, then merge back. Only in 'fine' —
     it is a second full inference pass. */
  const bb = doRefine ? opaqueBBox(c) : null;
  if (bb && bb.coverage < 0.55 && bb.bw > 110 && bb.bh > 110) {
    const padX = Math.max(6, Math.round(bb.bw * 0.09));
    const padY = Math.max(6, Math.round(bb.bh * 0.09));
    const cx0 = Math.max(0, bb.x0 - padX), cy0 = Math.max(0, bb.y0 - padY);
    const cx1 = Math.min(w, bb.x0 + bb.bw + padX), cy1 = Math.min(h, bb.y0 + bb.bh + padY);
    const cw2 = cx1 - cx0, ch2 = cy1 - cy0;
    if (cw2 > 64 && ch2 > 64) {
      const crop = document.createElement('canvas');
      crop.width = cw2; crop.height = ch2;
      const cxx = crop.getContext('2d');
      if (cxx) {
        cxx.drawImage(c, cx0, cy0, cw2, ch2, 0, 0, cw2, ch2);
        const cropBlob = await new Promise<Blob | null>(res => crop.toBlob(b2 => res(b2), 'image/png'));
        if (cropBlob) {
          try {
            const matte2 = await rmbgMatteCanvas(cropBlob);
            const m2c = document.createElement('canvas');
            m2c.width = cw2; m2c.height = ch2;
            const m2x = m2c.getContext('2d', { willReadFrequently: true });
            if (m2x) {
              m2x.imageSmoothingEnabled = true;
              m2x.imageSmoothingQuality = 'high';
              m2x.drawImage(matte2, 0, 0, cw2, ch2);
              const m2 = m2x.getImageData(0, 0, cw2, ch2).data;
              const bid = x.getImageData(cx0, cy0, cw2, ch2);
              for (let p = 0; p < cw2 * ch2; p++) bid.data[p * 4 + 3] = m2[p * 4];
              x.putImageData(bid, cx0, cy0);
              if (w >= 64 && h >= 64) { refineMatte(x, w, h); despillEdge(x, w, h); }
            }
          } catch { /* refinement best-effort — keep pass 1 */ }
        }
      }
    }
  }

  /* the crop-and-refine merge can reintroduce sky/ground the refined model
     kept — strip them once more before the final crop (only in 'fine') */
  if (doRefine && w >= 64 && h >= 64) removeSkyAndGround(c);

  /* Lenient crop: accept a sparse-but-present matte (some subjects are small
     or low-contrast). Only a truly empty matte is a failure. This is the
     difference between "most plates get cut" and "most plates bail". */
  let tight = tightCrop(c);
  if (!tight) tight = tightCrop(c, 0.012, 0.0002);
  if (!tight) throw new Error('empty matte');
  return { dataUrl: canvasToDataUrl(tight), width: tight.width, height: tight.height, engine: 'model' };
}

/* ================================================================== */
/*  cutout grader (SEPARATE scale — never fold into gradePlate)        */
/* ================================================================== */

export function gradeCutout(img: HTMLImageElement): { score: number } {
  try {
    const S = 64;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const x = c.getContext('2d', { willReadFrequently: true });
    if (!x) return { score: 55 };
    x.drawImage(img, 0, 0, S, S);
    const d = x.getImageData(0, 0, S, S).data;
    const N = S * S;
    let opaque = 0;
    const lums: number[] = [];
    for (let p = 0; p < N; p++) {
      const a = d[p * 4 + 3];
      if (a > 128) {
        opaque++;
        lums.push(d[p * 4] * 0.299 + d[p * 4 + 1] * 0.587 + d[p * 4 + 2] * 0.114);
      }
    }
    if (opaque < 20) return { score: 8 }; /* truly empty matte */
    const coverage = opaque / N;
    const lumArr = new Float32Array(N).fill(-1);
    for (let p = 0; p < N; p++) {
      if (d[p * 4 + 3] > 128) lumArr[p] = d[p * 4] * 0.299 + d[p * 4 + 1] * 0.587 + d[p * 4 + 2] * 0.114;
    }
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
