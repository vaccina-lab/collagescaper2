import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import type { Specimen } from '../lib/types';
import type { Pace } from '../lib/engine';
import { TRAY_CAP } from '../lib/engine';
import { IcDown, IcPrint, IcScissors, IcTrash, Meter, SourceChip, Stamp } from './ui';

export interface BatchProgress { done: number; total: number; failed: number; mb: number }

/* ---------- export helpers ---------- */
function toBlobPart(u: Uint8Array): BlobPart {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 8000);
}
function loadImgEl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (/^https?:/i.test(url)) img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('img load failed'));
    img.src = url;
  });
}
async function blobIsUsable(b: Blob): Promise<boolean> {
  if (b.size < 200) return false;
  try {
    const url = URL.createObjectURL(b);
    const img = await loadImgEl(url);
    URL.revokeObjectURL(url);
    return img.naturalWidth >= 16 && img.naturalHeight >= 16;
  } catch { return false; }
}
async function fetchBlob(url: string): Promise<Blob> {
  const ctl = new AbortController();
  const t = window.setTimeout(() => ctl.abort(), 12_000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.blob();
  } finally { window.clearTimeout(t); }
}
async function imgToJpegBlob(img: HTMLImageElement, maxDim: number): Promise<Blob> {
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  if (!x) throw new Error('no canvas');
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, w, h);
  x.drawImage(img, 0, 0, w, h);
  return await new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', 0.92));
}

export async function exportTrayBatch(
  items: Specimen[],
  onProgress: (done: number, total: number, failed: number, mb: number) => void,
  opts?: { jpg1400?: boolean },
): Promise<{ count: number; failed: number; mb: number; blob: Blob; name: string }> {
  const zip = new JSZip();
  const folder = zip.folder(opts?.jpg1400 ? 'salvage9-1400px' : 'salvage9-fullsize');
  if (!folder) throw new Error('zip failed');
  const total = items.length;
  let done = 0, failed = 0, bytes = 0;
  const used = new Set<string>();
  for (const it of items) {
    const url = it.cutoutSrc ?? it.fullUrl ?? it.thumb ?? it.dataUri;
    try {
      let blob: Blob;
      if (opts?.jpg1400) {
        const img = await loadImgEl(url);
        blob = await imgToJpegBlob(img, 1400);
      } else {
        blob = await fetchBlob(url);
        if (!(await blobIsUsable(blob))) throw new Error('unusable');
      }
      let name = `${it.code.replace(/[^a-z0-9.-]/gi, '_')}.${opts?.jpg1400 ? 'jpg' : (url.split('.').pop() || 'jpg')}`;
      let n = 1;
      while (used.has(name)) name = `${it.code.replace(/[^a-z0-9.-]/gi, '_')}-${++n}.${opts?.jpg1400 ? 'jpg' : 'jpg'}`;
      used.add(name);
      folder.file(name, blob);
      bytes += blob.size;
    } catch { failed++; }
    done++;
    onProgress(done, total, failed, Math.round(bytes / 1048576));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const name = `salvage9-${opts?.jpg1400 ? '1400px' : 'full'}-${items.length}.zip`;
  downloadBlob(blob, name);
  return { count: done - failed, failed, mb: Math.round(bytes / 1048576), blob, name };
}

/* ---------- cutouts-only export ----------
   Packs ONLY plates that were isolated (have a cutoutSrc), as PNGs so the
   alpha channel survives. JPEG would flatten transparency onto white, which
   is useless for collage. */
export async function exportCutoutBatch(
  items: Specimen[],
  onProgress: (done: number, total: number, failed: number, mb: number) => void,
): Promise<{ count: number; failed: number; mb: number; blob: Blob; name: string }> {
  const zip = new JSZip();
  const folder = zip.folder('salvage9-cutouts');
  if (!folder) throw new Error('zip failed');
  const total = items.length;
  let done = 0, failed = 0, bytes = 0;
  const used = new Set<string>();
  for (const it of items) {
    try {
      if (!it.cutoutSrc) throw new Error('no cutout');
      const img = await loadImgEl(it.cutoutSrc);
      if (img.naturalWidth < 16 || img.naturalHeight < 16) throw new Error('too small');
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const x = c.getContext('2d');
      if (!x) throw new Error('no canvas');
      x.drawImage(img, 0, 0);
      const blob = await new Promise<Blob>((res, rej) =>
        c.toBlob(b => (b ? res(b) : rej(new Error('encode failed'))), 'image/png'));
      let name = `${it.code.replace(/[^a-z0-9.-]/gi, '_')}-cut.png`;
      let n = 1;
      while (used.has(name)) name = `${it.code.replace(/[^a-z0-9.-]/gi, '_')}-cut-${++n}.png`;
      used.add(name);
      folder.file(name, blob);
      bytes += blob.size;
    } catch { failed++; }
    done++;
    onProgress(done, total, failed, Math.round(bytes / 1048576));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const name = `salvage9-cutouts-${done - failed}.zip`;
  downloadBlob(blob, name);
  return { count: done - failed, failed, mb: Math.round(bytes / 1048576), blob, name };
}

/* Cutouts-only: grab just the isolated subjects (plates with a cutoutSrc)
   and zip them as transparent PNGs (alpha preserved — no JPEG flattening). */
async function imgToPngBlob(img: HTMLImageElement, maxDim: number): Promise<Blob> {
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  if (!x) throw new Error('no canvas');
  x.drawImage(img, 0, 0, w, h); /* transparent background kept */
  return await new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('encode failed'))), 'image/png'));
}

export async function exportTrayCutouts(
  items: Specimen[],
  onProgress: (done: number, total: number, failed: number, mb: number) => void,
): Promise<{ count: number; failed: number; mb: number; blob: Blob; name: string }> {
  const zip = new JSZip();
  const folder = zip.folder('salvage9-cutouts');
  if (!folder) throw new Error('zip failed');
  const total = items.length;
  let done = 0, failed = 0, bytes = 0;
  const used = new Set<string>();
  for (const it of items) {
    if (!it.cutoutSrc) { failed++; done++; onProgress(done, total, failed, Math.round(bytes / 1048576)); continue; }
    try {
      const img = await loadImgEl(it.cutoutSrc);
      const blob = await imgToPngBlob(img, 1400);
      if (!(await blobIsUsable(blob))) throw new Error('unusable');
      let name = `${it.code.replace(/[^a-z0-9.-]/gi, '_')}.png`;
      let n = 1;
      while (used.has(name)) name = `${it.code.replace(/[^a-z0-9.-]/gi, '_')}-${++n}.png`;
      used.add(name);
      folder.file(name, blob);
      bytes += blob.size;
    } catch { failed++; }
    done++;
    onProgress(done, total, failed, Math.round(bytes / 1048576));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const name = `salvage9-cutouts-${items.length}.zip`;
  downloadBlob(blob, name);
  return { count: done - failed, failed, mb: Math.round(bytes / 1048576), blob, name };
}

export async function exportTraySheet(items: Specimen[], gate: number): Promise<{ w: number; h: number; count: number }> {
  if (items.length === 0) throw new Error('empty tray');
  const cols = 4, cell = 320, gap = 16, pad = 28, headH = 130;
  const rows = Math.ceil(items.length / cols);
  const W = pad * 2 + cols * cell + (cols - 1) * gap;
  const H = headH + rows * (cell + 30) + (rows - 1) * gap + pad;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  if (!x) throw new Error('no canvas');
  x.fillStyle = '#e9e4d4'; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#1d1912'; x.lineWidth = 5; x.strokeRect(8, 8, W - 16, H - 16);
  x.fillStyle = '#1d1912';
  x.font = '800 40px "Bricolage Grotesque", sans-serif';
  x.fillText('SALVAGE/9 — CUTTING TRAY SHEET', pad, 70);
  x.font = '500 15px "IBM Plex Mono", monospace';
  x.fillStyle = '#4a4335';
  x.fillText(`${items.length} specimens · taste gate ${gate} · ${new Date().toISOString().slice(0, 16)} UTC`, pad, 100);
  const imgs = await Promise.all(items.map(it => loadImgEl(it.cutoutSrc ?? it.thumb ?? it.dataUri).catch(() => null)));
  items.forEach((it, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const px = pad + col * (cell + gap), py = headH + row * (cell + 30 + gap);
    x.strokeStyle = '#1d1912'; x.lineWidth = 2; x.strokeRect(px, py, cell, cell);
    const img = imgs[i];
    if (img) {
      const sc = Math.min((cell - 14) / img.naturalWidth, (cell - 14) / img.naturalHeight);
      const dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
      x.drawImage(img, px + (cell - dw) / 2, py + (cell - dh) / 2, dw, dh);
    }
    x.fillStyle = '#1d1912'; x.font = '600 12px "IBM Plex Mono", monospace';
    x.fillText(`${it.code} · grade ${it.score}`, px + 2, py + cell + 20);
  });
  c.toBlob(b => { if (b) downloadBlob(b, `salvage9-sheet-${items.length}.png`); }, 'image/png');
  return { w: W, h: H, count: items.length };
}

export async function exportSingle(it: Specimen): Promise<void> {
  const img = await loadImgEl(it.cutoutSrc ?? it.fullUrl ?? it.thumb ?? it.dataUri);
  const blob = await imgToJpegBlob(img, 1400);
  downloadBlob(blob, `${it.code.replace(/[^a-z0-9.-]/gi, '_')}.jpg`);
}

/* ---------- feed card ---------- */
export const SpecimenCard = memo(function SpecimenCard({ sp, inTray, onInspect, onCut, onBin, onZap, onDownload }: {
  sp: Specimen; inTray: boolean;
  onInspect: (sp: Specimen) => void; onCut: (sp: Specimen) => void; onBin: (id: string) => void;
  onZap: (sp: Specimen) => void; onDownload: (sp: Specimen) => void;
}) {
  const judged = sp.state === 'judged';
  const rejected = judged && sp.verdict === 'reject';
  let hsh = 0;
  for (let i = 0; i < sp.id.length; i++) hsh = (hsh * 31 + sp.id.charCodeAt(i)) >>> 0;
  const rot = ((hsh % 9) - 4) * 0.32;
  const taped = hsh % 3 === 0;
  return (
    <article data-plate-id={sp.id} style={{ transform: `rotate(${rot}deg)` }}
      className={`cv-card anim-rise group relative mb-5 break-inside-avoid border-2 border-[var(--line)] bg-[var(--panel)] transition-all duration-200 hover:-translate-y-1 hover:shadow-[6px_6px_0_var(--shadow-ink)] ${rejected ? 'opacity-70' : ''}`}>
      {taped && <span className="tape" aria-hidden="true" />}
      <button type="button" onClick={() => onInspect(sp)} className="relative block w-full cursor-zoom-in overflow-hidden border-b-2 border-[var(--line-soft)]" aria-label={`inspect ${sp.code}`}>
        <div style={{ aspectRatio: String(sp.aspect) }} className={`relative w-full bg-[var(--line-soft)] ${sp.cutoutSrc ? 'checker' : ''}`}>
          <img src={sp.cutoutSrc ?? sp.thumb ?? sp.dataUri} alt="" aria-hidden="true" loading="lazy" decoding="async" referrerPolicy="no-referrer"
            className={`absolute inset-0 h-full w-full ${sp.cutoutSrc ? 'object-contain' : 'object-cover'} transition-transform duration-500 group-hover:scale-[1.03] ${rejected ? 'grayscale-[0.7]' : ''} ${judged ? '' : 'opacity-40'}`} />
          {!judged && (
            <div className="shimmer-block absolute inset-0 grid place-items-center">
              <div className="scan-bar" />
              <span className="relative z-10 border-2 border-[var(--line)]/50 bg-[var(--panel)]/85 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.2em] text-[var(--fg2)]">FETCHING ▒▒</span>
            </div>
          )}
        </div>
        {judged && <span className="anim-stamp absolute right-2 top-2"><Stamp kind={rejected ? 'reject' : 'pass'} score={sp.score} /></span>}
        {inTray && <span className="absolute left-2 top-2"><Stamp kind="tray" /></span>}
        {sp.cutoutSrc && (
          <span className="absolute bottom-1.5 left-1.5 border border-verm/70 bg-[#2a120c]/85 px-1 py-px font-mono text-[8px] font-bold tracking-[0.16em] text-[#ff9d7a]">✂ {sp.cutEngine?.toUpperCase() ?? 'ISO'} {sp.cutScore ?? ''}</span>
        )}
        {!sp.cutoutSrc && (sp.isoState === 'queue' || sp.isoState === 'work') && (
          <span className="absolute bottom-1.5 left-1.5 animate-pulse border border-ultra/60 bg-[#10122a]/85 px-1 py-px font-mono text-[8px] font-bold tracking-[0.16em] text-[#9fb2ff]">✂ {sp.isoState === 'queue' ? 'QUEUED' : 'CUTTING'}</span>
        )}
      </button>
      <div className="px-2.5 pb-2 pt-2">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[12px] font-bold tracking-tight text-[var(--fg)]">{sp.code}</span>
          <SourceChip code={sp.srcCode} hue={sp.srcHue} />
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2" title={sp.why?.join(' · ')}>
          <span className="flex items-center gap-1.5"><Meter score={sp.score} /><span className="font-mono text-[11px] font-semibold tabular-nums text-[var(--fg2)]">{sp.score}</span></span>
          <span className="truncate font-display text-[12px] font-medium italic text-[var(--fg2)]">“{sp.archetype}”</span>
        </div>
        <div className="mt-1 truncate font-mono text-[9px] tracking-wide text-[var(--mut)]">
          {sp.credit ? `${sp.credit} · ` : ''}{sp.sourceName || sp.provider || ''}
        </div>
      </div>
      <div className="flex border-t-2 border-[var(--line-soft)]">
        {rejected ? (
          <button type="button" disabled={!judged} onClick={() => onCut(sp)}
            className="flex flex-1 items-center justify-center gap-1.5 py-1.5 font-mono text-[10px] font-bold tracking-[0.12em] text-verm transition-colors hover:bg-verm hover:text-[#f5f1e3] disabled:opacity-30"><IcScissors size={12} /> OVERRIDE</button>
        ) : inTray ? (
          <span className="flex flex-1 cursor-default items-center justify-center gap-1.5 py-1.5 font-mono text-[10px] font-bold tracking-[0.12em] text-ultra"><IcScissors size={12} /> CUT ✓</span>
        ) : (
          <button type="button" disabled={!judged} onClick={() => onCut(sp)}
            className="flex flex-1 items-center justify-center gap-1.5 py-1.5 font-mono text-[10px] font-bold tracking-[0.12em] text-[var(--fg)] transition-colors hover:bg-[var(--fg)] hover:text-[var(--bg)] disabled:opacity-30"><IcScissors size={12} /> CUT</button>
        )}
        <button type="button" onClick={() => onBin(sp.id)}
          className="flex flex-1 items-center justify-center gap-1.5 border-l border-[var(--line-soft)] py-1.5 font-mono text-[10px] font-bold tracking-[0.12em] text-[var(--fg2)] transition-colors hover:bg-[var(--fg)] hover:text-[var(--bg)]"><IcTrash size={12} /> BIN</button>
        <button type="button" disabled={!judged} onClick={() => onZap(sp)} title="send to the glitch lab"
          className="flex flex-1 items-center justify-center gap-1.5 border-l border-[var(--line-soft)] py-1.5 font-mono text-[10px] font-bold tracking-[0.12em] text-[var(--fg2)] transition-colors hover:bg-gold hover:border-gold hover:text-black disabled:opacity-30">⚡ ZAP</button>
        <button type="button" disabled={!judged} onClick={() => onDownload(sp)}
          className="flex flex-1 items-center justify-center gap-1.5 border-l border-[var(--line-soft)] py-1.5 font-mono text-[10px] font-bold tracking-[0.12em] text-[var(--fg2)] transition-colors hover:bg-ultra hover:text-[#f5f1e3] disabled:opacity-30"><IcDown size={12} /> JPG</button>
      </div>
    </article>
  );
}, (a, b) => a.sp === b.sp && a.inTray === b.inTray);

/* ---------- feed ---------- */
export function Feed({ feed, showRejects, trayIds, running, spm, onInspect, onCut, onBin, onZap, onDownload, onPurge }: {
  feed: Specimen[]; showRejects: boolean; trayIds: Set<string>; running: boolean; spm: number;
  onInspect: (sp: Specimen) => void; onCut: (sp: Specimen) => void; onBin: (id: string) => void;
  onZap: (sp: Specimen) => void; onDownload: (sp: Specimen) => void; onPurge: () => void;
}) {
  const visible = showRejects ? feed : feed.filter(f => f.state === 'incoming' || f.verdict === 'pass');
  const [colCount, setColCount] = useState(() => (window.innerWidth < 640 ? 1 : window.innerWidth < 1536 ? 2 : 3));
  useEffect(() => {
    const onR = () => setColCount(window.innerWidth < 640 ? 1 : window.innerWidth < 1536 ? 2 : 3);
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);
  const columns = useMemo(() => {
    const cols: Specimen[][] = Array.from({ length: colCount }, () => []);
    const heights = new Array(colCount).fill(0);
    for (const sp of visible) {
      const h = (1 / Math.max(0.05, sp.aspect)) * 100 + 150;
      let best = 0;
      for (let i = 1; i < colCount; i++) if (heights[i] < heights[best]) best = i;
      cols[best].push(sp);
      heights[best] += h;
    }
    return cols;
  }, [visible, colCount]);
  const tailRef = useRef<HTMLDivElement | null>(null);
  const nearRef = useRef(true);
  const [fresh, setFresh] = useState(0);
  const prevCount = useRef(feed.length);
  useEffect(() => {
    const onS = () => {
      const el = tailRef.current;
      if (!el) { nearRef.current = true; return; }
      const near = el.getBoundingClientRect().bottom < window.innerHeight + 520;
      nearRef.current = near;
      if (near) setFresh(0);
    };
    window.addEventListener('scroll', onS, { passive: true });
    window.addEventListener('resize', onS);
    onS();
    return () => { window.removeEventListener('scroll', onS); window.removeEventListener('resize', onS); };
  }, []);
  useEffect(() => {
    const delta = feed.length - prevCount.current;
    prevCount.current = feed.length;
    if (delta > 0 && !nearRef.current) setFresh(f => f + delta);
  }, [feed.length]);
  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[28px] font-extrabold leading-none tracking-tight text-[var(--fg)]">LIVE INTAKE</h2>
          <div className="mt-1.5 flex items-center gap-2">
            <span className={`inline-block h-[5px] w-16 ${running ? 'dash-live' : 'bg-[var(--line-soft)]'}`} />
            <span className="font-mono text-[10px] font-bold tracking-[0.22em] text-[var(--fg2)]">{running ? 'CHEWING' : 'HELD'}</span>
            <span className="font-mono text-[10px] tracking-[0.14em] text-[var(--mut)]">≈{spm}/MIN · {feed.length} ON BELT</span>
          </div>
        </div>
        <button type="button" onClick={onPurge}
          className="border-2 border-[var(--line)] px-3 py-1.5 font-mono text-[11px] font-bold tracking-[0.18em] text-[var(--fg)] transition-all duration-150 hover:-translate-y-0.5 hover:bg-verm hover:border-verm hover:text-[#f5f1e3]">PURGE BUFFER</button>
      </div>
      {visible.length === 0 ? (
        <div className="grid place-items-center border-2 border-dashed border-[var(--line)]/40 bg-[var(--panel)]/60 px-6 py-20 text-center">
          <div className="font-display text-2xl font-extrabold text-[var(--fg)]">THE HOPPER IS EMPTY.</div>
          <p className="mt-2 max-w-[380px] font-mono text-[11px] leading-relaxed text-[var(--fg2)]">
            {running ? 'Spiders are out on the mirrors — plates drop here the moment they clear intake.' : 'Machine is on HOLD. Resume the crawl to feed the intake.'}
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-4">
            {columns.map((col, ci) => (
              <div key={ci} className="flex min-w-0 flex-1 flex-col">
                {col.map(sp => (
                  <SpecimenCard key={sp.id} sp={sp} inTray={trayIds.has(sp.id)} onInspect={onInspect} onCut={onCut} onBin={onBin} onZap={onZap} onDownload={onDownload} />
                ))}
              </div>
            ))}
          </div>
          <div ref={tailRef} className="h-px" aria-hidden="true" />
        </>
      )}
      {fresh > 0 && (
        <button type="button" onClick={() => tailRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'end' })}
          className="chip-pulse fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2.5 border-2 border-verm bg-[var(--fg)] px-4 py-2.5 font-mono text-[11px] font-bold tracking-[0.16em] text-[var(--bg)] shadow-[4px_4px_0_var(--shadow-ink)] transition-all duration-150 hover:-translate-y-1 hover:bg-verm hover:text-[#f5f1e3]">
          <span className="anim-led inline-block h-2 w-2 rounded-full bg-[#7ebe5c]" />
          {fresh} FRESH ON THE BELT <span className="text-verm">▾</span>
        </button>
      )}
    </div>
  );
}

/* ---------- tray ---------- */
export function TrayRail({ tray, busySheet, batch, archive, gate, onInspect, onRemove, onClear, onCull, onExport, onBatch, onDismissArchive }: {
  tray: Specimen[]; busySheet: boolean; batch: BatchProgress | null; archive: { url: string; name: string } | null; gate: number;
  onInspect: (sp: Specimen) => void; onRemove: (id: string) => void; onClear: () => void; onCull: () => void;
  onExport: () => void; onBatch: (mode: 'full' | 'jpg1400' | 'cutouts') => void; onDismissArchive: () => void;
}) {
  const avg = tray.length ? Math.round(tray.reduce((a, b) => a + b.score, 0) / tray.length) : 0;
  const best = tray.length ? Math.max(...tray.map(t => t.score)) : 0;
  const cutCount = tray.filter(t => !!t.cutoutSrc).length;
  const packing = batch !== null;
  const pct = packing && batch ? Math.round((batch.done / Math.max(1, batch.total)) * 100) : 0;
  return (
    <div className="border-2 border-[var(--line)] bg-[var(--panel)] shadow-[4px_4px_0_var(--shadow-ink)] xl:sticky xl:top-[118px]">
      <div className="flex items-baseline justify-between border-b-2 border-[var(--line)] px-3 py-2">
        <h2 className="font-display text-[18px] font-extrabold tracking-tight text-[var(--fg)]">CUTTING <span className="text-verm">TRAY</span></h2>
        <span className="font-mono text-[10px] tabular-nums text-[var(--fg2)]">{tray.length}/{TRAY_CAP}</span>
      </div>
      <div className="h-1.5 w-full border-b border-[var(--line-soft)] bg-[var(--line-soft)]">
        <div className={`h-full transition-all duration-500 ${tray.length >= TRAY_CAP ? 'bg-verm' : tray.length >= TRAY_CAP * 0.8 ? 'bg-gold' : 'bg-ultra'}`}
          style={{ width: `${Math.min(100, (tray.length / TRAY_CAP) * 100)}%` }} />
      </div>
      <div className="grid grid-cols-2 gap-1.5 border-b border-[var(--line-soft)] p-2.5">
        {packing && batch ? (
          <div className="col-span-2 flex items-center justify-center gap-2 bg-moss px-2 py-1.5 font-mono text-[9px] font-bold tracking-wider text-[#f5f1e3]">
            <IcDown size={11} className="animate-bounce" /> PACKING {batch.done}/{batch.total} · {batch.mb}MB{batch.failed > 0 ? ` · ${batch.failed} SKIP` : ''}
          </div>
        ) : (
          <>
            <button type="button" onClick={() => onBatch('cutouts')} disabled={cutCount === 0 || !!batch}
              className="col-span-2 flex items-center justify-center gap-2 border-2 border-verm bg-verm px-2 py-1.5 font-mono text-[9px] font-bold tracking-wider text-[#f5f1e3] shadow-[2px_2px_0_var(--shadow-ink)] transition-all hover:-translate-y-0.5 hover:opacity-85 active:translate-y-0 disabled:translate-y-0 disabled:opacity-30">
              <IcScissors size={11} /> ZIP · CUTOUTS ONLY · {cutCount}
            </button>
            <button type="button" onClick={() => onBatch('jpg1400')} disabled={tray.length === 0 || !!batch}
              className="border-2 border-moss bg-moss px-2 py-1.5 font-mono text-[9px] font-bold tracking-wider text-[#f5f1e3] hover:opacity-85 disabled:opacity-30"><IcDown size={11} /> ZIP · JPG 1400</button>
            <button type="button" onClick={() => onBatch('full')} disabled={tray.length === 0 || !!batch}
              className="border-2 border-[var(--line)] px-2 py-1.5 font-mono text-[9px] font-bold tracking-wider text-[var(--fg)] hover:bg-[var(--fg)] hover:text-[var(--bg)] disabled:opacity-30"><IcDown size={11} /> ZIP · FULL</button>
          </>
        )}
        <button type="button" onClick={onExport} disabled={tray.length === 0 || busySheet}
          className="border-2 border-[var(--line)] px-2 py-1.5 font-mono text-[9px] font-bold tracking-wider text-[var(--fg)] hover:bg-[var(--fg)] hover:text-[var(--bg)] disabled:opacity-30"><IcPrint size={11} /> SHEET</button>
        <button type="button" onClick={onCull} disabled={tray.length === 0}
          className="border-2 border-ultra px-2 py-1.5 font-mono text-[9px] font-bold tracking-wider text-ultra hover:bg-ultra hover:text-[#f5f1e3] disabled:opacity-30">CULL &lt;{gate}</button>
        <button type="button" onClick={onClear} disabled={tray.length === 0}
          className="col-span-2 border-2 border-verm px-2 py-1.5 font-mono text-[9px] font-bold tracking-wider text-verm hover:bg-verm hover:text-[#f5f1e3] disabled:opacity-30"><IcTrash size={11} /> SWEEP TRAY</button>
      </div>
      {archive && (
        <div className="chip-pulse flex items-center justify-between gap-2 border-b border-[var(--line-soft)] bg-moss/20 px-2.5 py-1.5">
          <a href={archive.url} download={archive.name} className="flex-1 truncate font-mono text-[9px] font-bold tracking-wider text-moss hover:underline">ARCHIVE READY — TAP TO SAVE ▾</a>
          <button type="button" onClick={onDismissArchive} aria-label="dismiss archive" className="font-mono text-[10px] font-bold text-[var(--mut)] hover:text-verm">✕</button>
        </div>
      )}
      {tray.length > 0 && (
        <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-3 py-1.5 font-mono text-[9px] tracking-wider text-[var(--mut)]">
          <span>AVG <strong className="text-ultra">{avg}</strong></span>
          <span>BEST <strong className="text-verm">{best}</strong></span>
        </div>
      )}
      <div className="max-h-[420px] overflow-y-auto p-2.5 scroll-slim">
        {tray.length === 0 ? (
          <p className="py-8 text-center font-mono text-[10px] text-[var(--mut)]">nothing cut yet</p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {tray.map(sp => (
              <button key={sp.id} type="button" onClick={() => onInspect(sp)} className="group relative block overflow-hidden border border-[var(--line-soft)]">
                <span className={`block ${sp.cutoutSrc ? 'checker' : ''}`}>
                  <img src={sp.cutoutSrc ?? sp.thumb ?? sp.dataUri} alt="" aria-hidden="true" loading="lazy" referrerPolicy="no-referrer"
                    className={`block aspect-square w-full ${sp.cutoutSrc ? 'object-contain' : 'object-cover'}`} />
                </span>
                {sp.cutoutSrc && <span className="absolute left-0.5 top-0.5 bg-verm px-1 font-mono text-[8px] font-bold text-[#f5f1e3]">✂</span>}
                <button type="button" onClick={e => { e.stopPropagation(); onRemove(sp.id); }} aria-label={`remove ${sp.code}`}
                  className="absolute right-0.5 top-0.5 bg-[var(--ink)] p-0.5 text-[var(--bg)] opacity-0 group-hover:opacity-100"><IcTrash size={10} /></button>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- lightbox ---------- */
export function Lightbox({ sp, tray, pace, onPace, onClose, onCut, onBin, onDownload, onSelect }: {
  sp: Specimen; tray: Specimen[]; pace: Pace; onPace: (p: Pace) => void;
  onClose: () => void; onCut: () => void; onBin: () => void; onDownload: () => void; onSelect: (sp: Specimen) => void;
}) {
  const idx = tray.findIndex(t => t.id === sp.id);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && idx >= 0 && idx < tray.length - 1) onSelect(tray[idx + 1]);
      else if (e.key === 'ArrowLeft' && idx > 0) onSelect(tray[idx - 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idx, tray, onClose, onSelect]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="max-h-[90vh] max-w-3xl overflow-y-auto border-2 border-[var(--line)] bg-[var(--panel)] p-4 shadow-[8px_8px_0_var(--shadow-ink)] scroll-slim" onClick={e => e.stopPropagation()}>
        <div className={`grid place-items-center ${sp.cutoutSrc ? 'checker' : 'bg-[var(--line-soft)]'}`}>
          <img src={sp.cutoutSrc ?? sp.dataUri} alt="" aria-hidden="true" referrerPolicy="no-referrer"
            className={`mx-auto max-h-[52vh] ${sp.cutoutSrc ? 'object-contain' : 'object-contain'}`} />
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <div>
            <div className="font-mono text-[12px] font-bold text-[var(--fg)]">{sp.code} · {sp.archetype}</div>
            <div className="mt-0.5 flex items-center gap-2"><Meter score={sp.score} /><span className="font-mono text-[10px] tabular-nums text-[var(--fg2)]">{sp.score}</span>
              {sp.cutScore !== undefined && <span className="font-mono text-[9px] text-verm">✂ cut {sp.cutScore}</span>}
            </div>
            {sp.why && sp.why.length > 0 && (
              <p className="mt-1 max-w-[420px] font-mono text-[8.5px] leading-relaxed text-[var(--mut)]">{sp.why.join(' · ')}</p>
            )}
          </div>
          <button type="button" onClick={onClose} className="border-2 border-[var(--line)] px-2 py-1 font-mono text-[10px] font-bold text-[var(--fg)] hover:bg-[var(--fg)] hover:text-[var(--bg)]">ESC</button>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          <button type="button" onClick={onCut} className="border-2 border-[var(--line)] px-2 py-1.5 font-mono text-[9px] font-bold tracking-wider text-[var(--fg)] hover:bg-[var(--fg)] hover:text-[var(--bg)]"><IcScissors size={11} /> CUT</button>
          <button type="button" onClick={onDownload} className="border-2 border-[var(--line)] px-2 py-1.5 font-mono text-[9px] font-bold tracking-wider text-[var(--fg)] hover:bg-[var(--fg)] hover:text-[var(--bg)]"><IcDown size={11} /> JPG</button>
          <button type="button" onClick={onBin} className="border-2 border-verm px-2 py-1.5 font-mono text-[9px] font-bold tracking-wider text-verm hover:bg-verm hover:text-[#f5f1e3]"><IcTrash size={11} /> BIN</button>
          <div className="flex overflow-hidden border-2 border-[var(--line)]">
            {(['cruise', 'rapid'] as Pace[]).map(p => (
              <button key={p} type="button" onClick={() => onPace(p)}
                className={`flex-1 px-1 font-mono text-[9px] font-bold ${pace === p ? 'bg-[var(--fg)] text-[var(--bg)]' : 'text-[var(--fg2)]'}`}>{p === 'cruise' ? 'CRS' : 'RPD'}</button>
            ))}
          </div>
        </div>
        {idx >= 0 && (
          <p className="mt-2 text-center font-mono text-[9px] tracking-widest text-[var(--mut)]">← / → BROWSE TRAY · {idx + 1}/{tray.length}</p>
        )}
      </div>
    </div>
  );
}
