import JSZip from 'jszip';
import type { Specimen } from './types';

function clickSave(url: string, name: string) {
  const a = document.createElement('a');
  a.download = name;
  a.href = url;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
function download(canvas: HTMLCanvasElement, name: string) {
  /* JPEG — the house format: no webp, no png (low-spec friendly) */
  canvas.toBlob(b => {
    if (!b) return;
    const url = URL.createObjectURL(b);
    clickSave(url, name);
    window.setTimeout(() => URL.revokeObjectURL(url), 15_000);
  }, 'image/jpeg', 0.92);
}

/* flatten an image (possibly alpha cutout) onto white, scale to ≤ maxDim,
   encode as JPEG. The ONLY way cutouts leave this app. */
function toJpegBlob(img: HTMLImageElement, maxDim: number, quality = 0.92): Promise<Blob> {
  const s = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * s));
  const h = Math.max(1, Math.round(img.naturalHeight * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  if (!x) return Promise.reject(new Error('no canvas'));
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, w, h);
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, w, h);
  return new Promise((res, rej) =>
    c.toBlob(b => (b ? res(b) : rej(new Error('jpeg encode failed'))), 'image/jpeg', quality));
}
function loadSpecimenImage(it: Specimen): Promise<HTMLImageElement> {
  const urls = [it.cutoutSrc, it.fullUrl, it.thumb, it.dataUri].filter(Boolean) as string[];
  const tryLoad = (u: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    if (/^https?:/i.test(u)) { img.crossOrigin = 'anonymous'; }
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('load failed'));
    img.src = u;
  });
  return (async () => {
    let last: unknown = null;
    for (const u of urls) { try { return await tryLoad(u); } catch (e) { last = e; } }
    throw last instanceof Error ? last : new Error('no source');
  })();
}

/* composite sheet press */
export async function exportTraySheet(items: Specimen[], gate: number): Promise<{ w: number; h: number; count: number }> {
  const usable = items.slice(0, 96);
  if (usable.length === 0) throw new Error('empty tray');
  const cols = 4, cell = 330, gap = 18, capH = 34, pad = 30, headH = 150;
  const rows = Math.ceil(usable.length / cols);
  const W = pad * 2 + cols * cell + (cols - 1) * gap;
  const H = headH + rows * (cell + capH) + (rows - 1) * gap + pad;
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('no canvas');
  ctx.fillStyle = '#e9e4d4'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#1d1912'; ctx.lineWidth = 5; ctx.strokeRect(10, 10, W - 20, H - 20);
  ctx.fillStyle = '#1d1912';
  ctx.font = '800 40px "Bricolage Grotesque", sans-serif';
  ctx.fillText('SALVAGE/9 — CUTTING TRAY SHEET', pad + 6, 80);
  ctx.font = '500 16px "IBM Plex Mono", monospace';
  ctx.fillStyle = '#4a4335';
  ctx.fillText(`${usable.length} specimens · gate ${gate} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, pad + 8, 114);
  const imgs = await Promise.all(usable.map(it => loadSpecimenImage(it).catch(() => null)));
  usable.forEach((it, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = pad + col * (cell + gap), y = headH + row * (cell + capH + gap);
    ctx.fillStyle = '#f5f1e3'; ctx.fillRect(x, y, cell, cell);
    ctx.strokeStyle = '#1d1912'; ctx.lineWidth = 2; ctx.strokeRect(x, y, cell, cell);
    const img = imgs[i];
    if (img) {
      const s = Math.min((cell - 18) / img.naturalWidth, (cell - 18) / img.naturalHeight);
      ctx.drawImage(img, x + (cell - img.naturalWidth * s) / 2, y + (cell - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
    }
    ctx.fillStyle = '#1d1912';
    ctx.font = '600 13px "IBM Plex Mono", monospace';
    ctx.fillText(`${it.code} · grade ${it.score}`, x + 2, y + cell + 20);
  });
  download(canvas, `salvage9-sheet-${usable.length}cuts.png`);
  return { w: W, h: H, count: usable.length };
}

export async function exportSingle(it: Specimen): Promise<void> {
  const img = await loadSpecimenImage(it);
  const blob = await toJpegBlob(img, 1400);
  const url = URL.createObjectURL(blob);
  clickSave(url, `${it.code.replace(/[^a-z0-9.-]/gi, '_')}.jpg`);
  window.setTimeout(() => URL.revokeObjectURL(url), 15_000);
}

/* full-size ZIP batch */
function toBlobPart(u: Uint8Array): BlobPart { return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer; }

/* a blob is only "good" if it decodes into a real, decently-sized image —
   corrupt/placeholder JPEGs (the blank-icon files) fail this check */
function blobIsUsableImage(b: Blob): Promise<boolean> {
  if (b.size < 200) return Promise.resolve(false);
  const url = URL.createObjectURL(b);
  return new Promise<boolean>(resolve => {
    const img = new Image();
    img.onload = () => {
      const ok = img.naturalWidth >= 16 && img.naturalHeight >= 16;
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(false); };
    img.src = url;
  });
}

/* Cutouts ride out as dataURLs — fetching a megabyte-scale dataURL fails on
   low-spec devices and the old ladder silently fell through to the full
   plate. Decode the cutout as an Image and re-encode instead: reliable
   everywhere, and the cutout ALWAYS wins over the full plate. */
async function cutoutBlob(it: Specimen): Promise<Blob | null> {
  if (!it.cutoutSrc) return null;
  try {
    const onlyCut = { ...it } as Specimen;
    (onlyCut as { fullUrl?: string }).fullUrl = undefined;
    (onlyCut as { thumb?: string }).thumb = undefined;
    (onlyCut as { dataUri?: string }).dataUri = undefined;
    const img = await loadSpecimenImage(onlyCut);
    const mime = it.cutoutSrc.startsWith('image/webp') || it.cutoutSrc.includes('image/webp') ? 'image/webp' : 'image/png';
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d');
    if (!x) return null;
    x.drawImage(img, 0, 0);
    const b = await new Promise<Blob | null>(res => c.toBlob(b2 => res(b2), mime, 0.95));
    return b && b.size > 0 && (await blobIsUsableImage(b)) ? b : null;
  } catch { return null; }
}

async function fetchPlateBlob(it: Specimen): Promise<Blob> {
  const cut = await cutoutBlob(it);
  if (cut) return cut;
  const urls = [it.fullUrl, it.thumb, it.dataUri].filter(Boolean) as string[];
  let last: unknown = null;
  for (const u of urls) {
    try {
      const res = await fetch(u);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const b = await res.blob();
      if (b.size > 0 && (await blobIsUsableImage(b))) return b;
      last = new Error('blank or corrupt image');
    } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error('no source');
}
export async function exportTrayBatch(
  items: Specimen[],
  onProgress?: (done: number, total: number, failed: number, mb: number) => void,
  opts?: { jpg1400?: boolean },
): Promise<{ count: number; failed: number; mb: number; url: string; name: string }> {
  if (items.length === 0) throw new Error('empty tray');
  const zip = new JSZip();
  const folder = zip.folder(opts?.jpg1400 ? 'salvage9-1400px-jpg' : 'salvage9');
  if (!folder) throw new Error('zip failed');
  const used = new Set<string>();
  let done = 0, failed = 0, bytes = 0;
  const total = items.length;
  const queue = [...items];
  const workers = Array.from({ length: 8 }, async () => {
    while (queue.length > 0) {
      const it = queue.shift()!;
      try {
        const name = `${it.code.replace(/[^a-z0-9.-]/gi, '_')}`;
        let blob: Blob;
        let ext: string;
        if (opts?.jpg1400) {
          /* cutouts flatten onto white (JPEG carries no alpha), scaled to
             ≤1400px, encoded image/jpeg — nothing but .jpg leaves here */
          const img = await loadSpecimenImage(it);
          blob = await toJpegBlob(img, 1400);
          if (!(await blobIsUsableImage(blob))) throw new Error('blank jpeg');
          ext = 'jpg';
        } else {
          blob = await fetchPlateBlob(it);
          ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
        }
        let fname = `${name}.${ext}`;
        let n = 1;
        while (used.has(fname)) fname = `${name}-${++n}.${ext}`;
        used.add(fname);
        folder.file(fname, blob);
        bytes += blob.size;
        done++;
      } catch { failed++; }
      onProgress?.(done + failed, total, failed, Math.round(bytes / 1048576));
    }
  });
  await Promise.all(workers);
  const out = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
  const name = `salvage9-${items.length}cuts.zip`;
  const blob = new Blob([toBlobPart(out)], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  return { count: done, failed, mb: Math.round(bytes / 1048576), url, name };
}
