import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { unzipSync, zipSync } from 'fflate';
import type { Specimen } from '../lib/types';
import type { LogLine } from '../lib/engine';
import {
  renderGlitch, stageDims, exportDims, DEFAULT_PARAMS, CHANNELS, PRESETS, type GlitchParams,
} from '../lib/glitch';
import {
  drawScene, hitLayer, hitHandle, layerFromSpecimen, colorLayer, textLayer, primeImages, renderComposite, layerH,
  BLEND_LABELS, BLEND_KEYS, DESK_PALETTE, SIZE_PRESETS,
  type Blend, type DeskDoc, type DeskLayer, type SizeId,
} from '../lib/collage';
import { IcDown } from './ui';

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

/* ============================================================ */
/*  GLITCH LAB                                                  */
/* ============================================================ */
export function GlitchLab({ feed, tray, zap, onLog }: {
  feed: Specimen[]; tray: Specimen[]; zap: { sp: Specimen; n: number } | null;
  onLog: (level: LogLine['level'], msg: string) => void;
}) {
  const beltOptions = useMemo(() => feed.filter(f => f.state === 'judged' && f.verdict === 'pass').slice(-60), [feed]);
  const sources = tray.length > 0 ? tray : beltOptions;
  const [srcId, setSrcId] = useState<string | null>(null);
  const [params, setParams] = useState<GlitchParams>(DEFAULT_PARAMS);
  const [fileSrc, setFileSrc] = useState<{ el: HTMLImageElement; w: number; h: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pipe, setPipe] = useState<'pixel' | 'composite'>('pixel');
  const [flick, setFlick] = useState(0);

  const active = fileSrc ? null : sources.find(s => s.id === srcId) ?? null;

  useEffect(() => { if (zap) { setFileSrc(null); setSrcId(zap.sp.id); } }, [zap]);
  useEffect(() => { if (!srcId && sources.length > 0) setSrcId(sources[0].id); }, [sources, srcId]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const cvs = canvasRef.current;
      if (!cvs) return;
      let el: HTMLImageElement | null = null;
      let iw = 0, ih = 0;
      if (fileSrc) { el = fileSrc.el; iw = fileSrc.w; ih = fileSrc.h; }
      else if (active) {
        try { el = await loadImgEl(active.cutoutSrc ?? active.fullUrl ?? active.thumb ?? active.dataUri); iw = el.naturalWidth; ih = el.naturalHeight; }
        catch { el = null; }
      }
      if (cancelled || !el) return;
      imgRef.current = el;
      const { w, h } = stageDims(iw, ih);
      if (cvs.width !== w) cvs.width = w;
      if (cvs.height !== h) cvs.height = h;
      const ctx = cvs.getContext('2d');
      if (!ctx) return;
      try {
        const { canvas, pipe: p } = renderGlitch({ el, w: iw, h: ih }, w, h, params);
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(canvas, 0, 0);
        setPipe(p);
        setFlick(f => (f + 1) % 1000);
      } catch { /* ignore */ }
    };
    void run();
    return () => { cancelled = true; };
  }, [active, fileSrc, params, srcId]);
  void flick;

  const set = (patch: Partial<GlitchParams>) => setParams(p => ({ ...p, ...patch }));
  const rerollSeed = () => set({ seed: Math.floor(Math.random() * 99999) });
  const signed = (span: number) => Math.floor((Math.random() * 2 - 1) * span);
  const rerollFx = () => setParams(p => {
    const next: GlitchParams = { ...p };
    for (const ch of CHANNELS) {
      if (ch.key === 'seed') continue;
      if (Math.random() < 0.45) { next[ch.key] = 0; continue; }
      const mag = Math.round(12 + Math.random() * 80);
      next[ch.key] = ch.min < 0 ? (Math.random() < 0.5 ? -mag : mag) : mag;
    }
    if (CHANNELS.every(ch => ch.key === 'seed' || next[ch.key] === 0)) {
      const pick = CHANNELS[Math.floor(Math.random() * CHANNELS.length)];
      if (pick.key !== 'seed') next[pick.key] = 60;
    }
    return next;
  });

  const exportPng = () => {
    const el = imgRef.current;
    if (!el) return;
    const { w, h } = exportDims(el.naturalWidth, el.naturalHeight);
    const { canvas } = renderGlitch({ el, w: el.naturalWidth, h: el.naturalHeight }, w, h, params);
    canvas.toBlob(b => {
      if (b) {
        downloadBlob(b, `glitch-s${params.seed}.png`);
        onLog('cut', `lab: exported glitch @ ${w}×${h} (seed ${params.seed})`);
      }
    }, 'image/png');
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    const url = URL.createObjectURL(f);
    void loadImgEl(url).then(el => { setSrcId(null); setFileSrc({ el, w: el.naturalWidth, h: el.naturalHeight }); });
  };

  return (
    <main className="mx-auto max-w-[1560px] px-4 py-5 lg:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[28px] font-extrabold leading-none tracking-tight text-[var(--fg)]">GLITCH <span className="text-verm">LAB</span></h2>
          <p className="mt-1 font-mono text-[10px] tracking-[0.2em] text-[var(--mut)]">24 SIGNED CHANNELS · SEEDED · {pipe === 'pixel' ? 'PIXEL PIPE' : 'COMPOSITE PIPE'}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={rerollSeed} className="border-2 border-[var(--line)] px-3 py-1.5 font-mono text-[10px] font-bold tracking-widest text-[var(--fg)] hover:bg-[var(--fg)] hover:text-[var(--bg)]">⟳ SEED {params.seed}</button>
          <button type="button" onClick={rerollFx} className="border-2 border-gold px-3 py-1.5 font-mono text-[10px] font-bold tracking-widest text-[#8a5f10] hover:bg-gold hover:text-black">⚄ REROLL FX</button>
          <button type="button" onClick={exportPng} disabled={!imgRef.current && !fileSrc && !active} className="border-2 border-moss bg-moss px-3 py-1.5 font-mono text-[10px] font-bold tracking-widest text-[#f5f1e3] hover:opacity-85 disabled:opacity-30"><IcDown size={11} /> EXPORT PNG</button>
        </div>
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[280px_minmax(0,1fr)_300px]">
        <section className="border-2 border-[var(--line)] bg-[var(--panel)] shadow-[4px_4px_0_var(--shadow-ink)]">
          <div className="flex items-center justify-between border-b-2 border-[var(--line)] px-3 py-2">
            <span className="font-display text-[15px] font-extrabold tracking-tight"><span className="mr-1.5 text-verm">A</span>SOURCE</span>
            <button type="button" onClick={() => fileRef.current?.click()} className="border border-[var(--line)] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[var(--fg2)] hover:bg-[var(--fg)] hover:text-[var(--bg)]">+ FILE</button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
          </div>
          <div className="grid max-h-[420px] grid-cols-3 gap-1.5 overflow-y-auto p-2 scroll-slim">
            {fileSrc ? (
              <button type="button" onClick={() => setFileSrc(null)} className="col-span-3 border-2 border-verm px-2 py-2 font-mono text-[9px] font-bold text-verm hover:bg-verm hover:text-[#f5f1e3]">USING FILE — TAP TO CLEAR</button>
            ) : sources.length === 0 ? (
              <p className="col-span-3 py-6 text-center font-mono text-[9px] text-[var(--mut)]">no plates yet</p>
            ) : sources.map(sp => (
              <button key={sp.id} type="button" onClick={() => setSrcId(sp.id)}
                className={`overflow-hidden border-2 ${sp.id === srcId ? 'border-verm' : 'border-[var(--line-soft)] hover:border-[var(--line)]'}`}>
                <img src={sp.cutoutSrc ?? sp.thumb ?? sp.dataUri} alt={sp.code} loading="lazy" referrerPolicy="no-referrer" className={`block aspect-square w-full ${sp.cutoutSrc ? 'checker object-contain' : 'object-cover'}`} />
              </button>
            ))}
          </div>
        </section>

        <section className="border-2 border-[var(--line)] bg-[#171310] p-3 shadow-[4px_4px_0_var(--shadow-ink)]">
          <div className="grid place-items-center">
            <canvas ref={canvasRef} className="max-w-full border border-[var(--line-soft)] bg-[#0e0b1c]" />
          </div>
        </section>

        <section className="border-2 border-[var(--line)] bg-[var(--panel)] shadow-[4px_4px_0_var(--shadow-ink)]">
          <div className="flex items-center justify-between border-b-2 border-[var(--line)] px-3 py-2">
            <span className="font-display text-[15px] font-extrabold tracking-tight"><span className="mr-1.5 text-verm">B</span>CHANNELS</span>
            <div className="flex flex-wrap gap-1">
              {PRESETS.map(pr => (
                <button key={pr.name} type="button" onClick={() => setParams(p => ({ ...DEFAULT_PARAMS, seed: p.seed, ...pr.p }))}
                  className="border border-[var(--line)]/60 px-1 py-0.5 font-mono text-[8px] font-bold text-[var(--fg2)] hover:bg-[var(--fg)] hover:text-[var(--bg)]">{pr.name}</button>
              ))}
            </div>
          </div>
          <div className="grid max-h-[440px] grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto p-3 scroll-slim">
            {CHANNELS.map(ch => (
              <label key={ch.key} className="block">
                <span className="mb-0.5 flex justify-between font-mono text-[8px] font-semibold tracking-[0.14em] text-[var(--mut)]">
                  <span>{ch.label}</span>
                  <span className={`tabular-nums ${params[ch.key] > 0 ? 'text-verm' : params[ch.key] < 0 ? 'text-ultra' : 'text-[var(--fg2)]'}`}>
                    {params[ch.key] > 0 ? `+${params[ch.key]}` : params[ch.key]}
                  </span>
                </span>
                <input type="range" min={ch.min} max={ch.max} value={params[ch.key]}
                  onChange={e => set({ [ch.key]: Number(e.target.value) } as Partial<GlitchParams>)} className="gate-range w-full" />
              </label>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

/* ============================================================ */
/*  PASTE-UP DESK                                               */
/* ============================================================ */
export function CollageDesk({ feed, tray, onLog }: {
  feed: Specimen[]; tray: Specimen[]; onLog: (level: LogLine['level'], msg: string) => void;
}) {
  const [sizeId, setSizeId] = useState<SizeId>('square');
  const size = SIZE_PRESETS.find(s => s.id === sizeId) ?? SIZE_PRESETS[0];
  const [bg, setBg] = useState(DESK_PALETTE[1]);
  const [layers, setLayers] = useState<DeskLayer[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ mode: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'pan'; id: string | null; sx: number; sy: number; ox: number; oy: number; ow: number } | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const doc: DeskDoc = useMemo(() => ({ w: size.w, h: size.h, bg, layers }), [size, bg, layers]);
  const selLayer = layers.find(l => l.id === selId) ?? null;
  const docRef = useRef(doc);
  useEffect(() => { docRef.current = doc; }, [doc]);

  useEffect(() => { primeImages(doc.layers); }, [doc]);

  const fitScale = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return 0.4;
    return Math.min((wrap.clientWidth - 24) / size.w, (wrap.clientHeight - 24) / size.h, 1);
  }, [size]);
  const [scale, setScale] = useState(0.4);
  useEffect(() => { setScale(fitScale()); }, [fitScale]);
  useEffect(() => {
    const onR = () => setScale(fitScale());
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, [fitScale]);

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    cvs.width = Math.round(size.w * scale);
    cvs.height = Math.round(size.h * scale);
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    const raf = requestAnimationFrame(() => drawScene(ctx, docRef.current, scale, { selectedId: selId }));
    return () => cancelAnimationFrame(raf);
  }, [doc, scale, selId, size]);

  const toDoc = (e: { clientX: number; clientY: number }) => {
    const cvs = canvasRef.current;
    if (!cvs) return { x: 0, y: 0 };
    const r = cvs.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const patch = (id: string, patchObj: Partial<DeskLayer>) =>
    setLayers(ls => ls.map(l => (l.id === id ? { ...l, ...patchObj } : l)));

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toDoc(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (selId) {
      const sl = docRef.current.layers.find(l => l.id === selId);
      if (sl) {
        const h = hitHandle(sl, p.x, p.y, 14 / scale);
        if (h) {
          dragRef.current = { mode: h, id: selId, sx: p.x, sy: p.y, ox: sl.x, oy: sl.y, ow: sl.w };
          return;
        }
      }
    }
    for (let i = docRef.current.layers.length - 1; i >= 0; i--) {
      const L = docRef.current.layers[i];
      if (hitLayer(L, p.x, p.y)) {
        setSelId(L.id);
        dragRef.current = { mode: 'move', id: L.id, sx: p.x, sy: p.y, ox: L.x, oy: L.y, ow: L.w };
        return;
      }
    }
    setSelId(null);
    dragRef.current = { mode: 'pan', id: null, sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y, ow: 0 };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.mode === 'pan') {
      setPan({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) });
      return;
    }
    if (!d.id) return;
    const p = toDoc(e);
    const dx = p.x - d.sx, dy = p.y - d.sy;
    if (d.mode === 'move') {
      patch(d.id, { x: d.ox + dx, y: d.oy + dy });
    } else {
      const factor = Math.abs(dx) > Math.abs(dy) ? dx : dy;
      const dir = d.mode === 'nw' || d.mode === 'sw' ? -1 : 1;
      const w = Math.max(20, d.ow + dir * factor * 1.6);
      const L = docRef.current.layers.find(l => l.id === d.id);
      if (!L) return;
      const hh0 = layerH(L);
      const hh1 = w / L.aspect;
      patch(d.id, { w, x: d.ox + (d.mode === 'nw' || d.mode === 'sw' ? (d.ow - w) / 2 : (w - d.ow) / 2), y: d.oy + (d.mode === 'nw' || d.mode === 'ne' ? (hh0 - hh1) / 2 : (hh1 - hh0) / 2) });
    }
  };
  const onPointerUp = () => { dragRef.current = null; };

  const addFrom = (sp: Specimen) => {
    const L = layerFromSpecimen(sp, doc.w / 2, doc.h / 2);
    setLayers(ls => [...ls, L]);
    setSelId(L.id);
    onLog('sys', `desk: “${sp.archetype}” → layer`);
  };
  const addColor = (col: string) => { const L = colorLayer(col, doc.w / 2, doc.h / 2); setLayers(ls => [...ls, L]); setSelId(L.id); };
  const addText = () => { const L = textLayer('PASTE TEXT', doc.w / 2, doc.h / 2); setLayers(ls => [...ls, L]); setSelId(L.id); };
  const bringFront = () => { if (!selId) return; setLayers(ls => { const i = ls.findIndex(l => l.id === selId); if (i < 0) return ls; const arr = [...ls]; const [m] = arr.splice(i, 1); arr.push(m); return arr; }); };
  const sendBack = () => { if (!selId) return; setLayers(ls => { const i = ls.findIndex(l => l.id === selId); if (i < 0) return ls; const arr = [...ls]; const [m] = arr.splice(i, 1); arr.unshift(m); return arr; }); };
  const removeSel = () => { if (!selId) return; setLayers(ls => ls.filter(l => l.id !== selId)); setSelId(null); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') removeSel();
      else if (e.key === ']') bringFront();
      else if (e.key === '[') sendBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const exportDesk = async () => {
    setBusy(true);
    try {
      const scale2 = Math.min(2000 / doc.w, 2);
      const c = await renderComposite(doc, scale2);
      c.toBlob(b => { if (b) { downloadBlob(b, `salvage9-desk-${size.w}x${size.h}.png`); onLog('cut', `desk: exported ${c.width}×${c.height}`); } }, 'image/png');
    } catch { onLog('err', 'desk: export failed'); }
    finally { setBusy(false); }
  };

  const candidates = tray.length > 0 ? tray : feed.filter(f => f.verdict === 'pass');

  return (
    <main className="mx-auto max-w-[1560px] px-4 py-5 lg:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[28px] font-extrabold leading-none tracking-tight text-[var(--fg)]">PASTE-UP <span className="text-verm">DESK</span></h2>
          <p className="mt-1 font-mono text-[10px] tracking-[0.2em] text-[var(--mut)]">DRAG · SCALE · BLEND · EXPORT · {layers.length} LAYERS</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {SIZE_PRESETS.map(s => (
            <button key={s.id} type="button" onClick={() => setSizeId(s.id)}
              className={`border-2 px-2 py-1 font-mono text-[9px] font-bold ${sizeId === s.id ? 'bg-[var(--fg)] text-[var(--bg)] border-[var(--fg)]' : 'border-[var(--line)] text-[var(--fg2)] hover:bg-[var(--line-soft)]'}`}>{s.label}</button>
          ))}
          <button type="button" onClick={exportDesk} disabled={busy || layers.length === 0}
            className="border-2 border-moss bg-moss px-3 py-1 font-mono text-[9px] font-bold tracking-wider text-[#f5f1e3] hover:opacity-85 disabled:opacity-30"><IcDown size={11} /> EXPORT</button>
        </div>
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[280px_minmax(0,1fr)_280px]">
        <section className="border-2 border-[var(--line)] bg-[var(--panel)] shadow-[4px_4px_0_var(--shadow-ink)]">
          <div className="border-b-2 border-[var(--line)] px-3 py-2 font-display text-[15px] font-extrabold tracking-tight"><span className="mr-1.5 text-verm">A</span>MATERIAL</div>
          <div className="grid max-h-[300px] grid-cols-3 gap-1.5 overflow-y-auto p-2 scroll-slim">
            {candidates.length === 0 ? (
              <p className="col-span-3 py-6 text-center font-mono text-[9px] text-[var(--mut)]">no plates yet</p>
            ) : candidates.slice(0, 60).map(sp => (
              <button key={sp.id} type="button" onClick={() => addFrom(sp)} title={`add ${sp.archetype}`}
                className="overflow-hidden border border-[var(--line-soft)] hover:border-verm">
                <img src={sp.cutoutSrc ?? sp.thumb ?? sp.dataUri} alt={sp.code} loading="lazy" referrerPolicy="no-referrer" className={`block aspect-square w-full ${sp.cutoutSrc ? 'checker object-contain' : 'object-cover'}`} />
              </button>
            ))}
          </div>
          <div className="border-t border-[var(--line-soft)] p-2">
            <div className="mb-1 font-mono text-[8px] font-semibold tracking-[0.2em] text-[var(--mut)]">COLOR BLOCKS</div>
            <div className="flex flex-wrap gap-1">
              {DESK_PALETTE.map(col => (
                <button key={col} type="button" onClick={() => addColor(col)} aria-label={`add ${col}`}
                  className="h-7 w-7 border-2 border-[var(--line)] transition-transform hover:scale-110" style={{ background: col }} />
              ))}
              <button type="button" onClick={addText} className="border-2 border-[var(--line)] px-2 font-mono text-[10px] font-bold text-[var(--fg2)] hover:bg-[var(--fg)] hover:text-[var(--bg)]">+ TEXT</button>
            </div>
            <div className="mt-2 font-mono text-[8px] font-semibold tracking-[0.2em] text-[var(--mut)]">BACKGROUND</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {DESK_PALETTE.map(col => (
                <button key={col} type="button" onClick={() => setBg(col)} aria-label={`bg ${col}`}
                  className={`h-6 w-6 border-2 ${bg === col ? 'border-verm' : 'border-[var(--line)]'}`} style={{ background: col }} />
              ))}
            </div>
          </div>
        </section>

        <section className="overflow-hidden border-2 border-[var(--line)] bg-[#171310] shadow-[4px_4px_0_var(--shadow-ink)]">
          <div ref={wrapRef} className="grid h-[64vh] place-items-center overflow-hidden p-3">
            <div style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
              <canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
                className="cursor-crosshair border border-[var(--line-soft)] shadow-[0_0_0_1px_var(--line)]" />
            </div>
          </div>
        </section>

        <section className="border-2 border-[var(--line)] bg-[var(--panel)] shadow-[4px_4px_0_var(--shadow-ink)]">
          <div className="flex items-center justify-between border-b-2 border-[var(--line)] px-3 py-2">
            <span className="font-display text-[15px] font-extrabold tracking-tight"><span className="mr-1.5 text-verm">B</span>LAYERS</span>
            <span className="font-mono text-[9px] tabular-nums text-[var(--mut)]">{layers.length}</span>
          </div>
          <div className="max-h-[200px] overflow-y-auto p-2 scroll-slim">
            {layers.length === 0 ? (
              <p className="py-6 text-center font-mono text-[9px] text-[var(--mut)]">empty desk</p>
            ) : [...layers].reverse().map(L => (
              <button key={L.id} type="button" onClick={() => setSelId(L.id)}
                className={`mb-1 flex w-full items-center justify-between border px-2 py-1 font-mono text-[9px] ${L.id === selId ? 'border-verm bg-verm/10 text-verm' : 'border-[var(--line-soft)] text-[var(--fg2)] hover:border-[var(--line)]'}`}>
                <span className="truncate">{L.name}</span>
                <span className="ml-2 shrink-0 opacity-60">{L.kind}</span>
              </button>
            ))}
          </div>
          {selLayer && (
            <div className="space-y-2 border-t border-[var(--line-soft)] p-3">
              <div className="font-mono text-[8px] font-semibold tracking-[0.2em] text-[var(--mut)]">SELECTED · {selLayer.name}</div>
              <label className="block">
                <span className="mb-0.5 flex justify-between font-mono text-[8px] font-semibold tracking-[0.16em] text-[var(--mut)]"><span>OPACITY</span><span className="tabular-nums">{Math.round(selLayer.opacity * 100)}%</span></span>
                <input type="range" min={0} max={100} value={Math.round(selLayer.opacity * 100)} onChange={e => patch(selLayer.id, { opacity: Number(e.target.value) / 100 })} className="gate-range w-full" />
              </label>
              <label className="block">
                <span className="mb-0.5 flex justify-between font-mono text-[8px] font-semibold tracking-[0.16em] text-[var(--mut)]"><span>ROTATE</span><span className="tabular-nums">{Math.round(selLayer.rot)}°</span></span>
                <input type="range" min={-180} max={180} value={Math.round(selLayer.rot)} onChange={e => patch(selLayer.id, { rot: Number(e.target.value) })} className="gate-range w-full" />
              </label>
              {selLayer.kind === 'text' && (
                <label className="block">
                  <span className="mb-0.5 block font-mono text-[8px] font-semibold tracking-[0.16em] text-[var(--mut)]">TEXT</span>
                  <input value={selLayer.text ?? ''} onChange={e => patch(selLayer.id, { text: e.target.value })} className="w-full border border-[var(--line)] bg-[var(--panel2)] px-2 py-1 font-mono text-[11px]" />
                </label>
              )}
              <label className="block">
                <span className="mb-0.5 block font-mono text-[8px] font-semibold tracking-[0.16em] text-[var(--mut)]">BLEND</span>
                <select value={selLayer.blend} onChange={e => patch(selLayer.id, { blend: e.target.value as Blend })} className="w-full border border-[var(--line)] bg-[var(--panel2)] px-1 py-1 font-mono text-[10px]">
                  {BLEND_KEYS.map(b => <option key={b} value={b}>{BLEND_LABELS[b]}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <button type="button" onClick={bringFront} className="border-2 border-[var(--line)] py-1.5 font-mono text-[9px] font-bold text-[var(--fg)] hover:bg-[var(--fg)] hover:text-[var(--bg)]">FRONT ]</button>
                <button type="button" onClick={sendBack} className="border-2 border-[var(--line)] py-1.5 font-mono text-[9px] font-bold text-[var(--fg)] hover:bg-[var(--fg)] hover:text-[var(--bg)]">BACK [</button>
                <button type="button" onClick={removeSel} className="col-span-2 border-2 border-verm py-1.5 font-mono text-[9px] font-bold text-verm hover:bg-verm hover:text-[#f5f1e3]">REMOVE · DEL</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

/* ============================================================ */
/*  BRUSH FORGE                                                 */
/* ============================================================ */
export function BrushForge({ onLog }: { onLog: (level: LogLine['level'], msg: string) => void }) {
  const [templates, setTemplates] = useState<Array<{ name: string; files: Record<string, Uint8Array> }>>([]);
  const [count, setCount] = useState(8);
  const [seed, setSeed] = useState(() => String(Math.floor(Math.random() * 99999)));
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const onFiles = async (list: FileList | null) => {
    if (!list) return;
    const found: Array<{ name: string; files: Record<string, Uint8Array> }> = [];
    for (const f of Array.from(list)) {
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        const all = unzipSync(buf);
        const byBrush = new Map<string, Record<string, Uint8Array>>();
        for (const [path, data] of Object.entries(all)) {
          const parts = path.split('/');
          if (parts.length < 2) { byBrush.set('(root)', { ...(byBrush.get('(root)') ?? {}), [path]: data }); continue; }
          const folder = parts[0];
          byBrush.set(folder, { ...(byBrush.get(folder) ?? {}), [parts.slice(1).join('/')]: data });
        }
        for (const [folder, files] of byBrush) {
          if (files['Brush.archive']) found.push({ name: folder === '(root)' ? f.name.replace(/\.brushset$/i, '') : folder, files });
        }
      } catch { onLog('warn', `forge: could not read ${f.name}`); }
    }
    if (found.length > 0) {
      setTemplates(found);
      onLog('sys', `forge: ${found.length} brush template(s) loaded`);
    } else {
      onLog('warn', 'forge: no Brush.archive found in that file');
    }
  };

  /* Apply a deterministic glitch to a brush's texture PNGs. We reuse the
     template's Brush.archive untouched (keeps name/plist valid) and only
     regenerate Shape.png / Grain.png / QuickLook/Thumbnail.png. */
  const buildSet = async () => {
    if (templates.length === 0) { onLog('warn', 'forge: load a template first'); return; }
    setBusy(true);
    try {
      let s = parseInt(seed, 10) || 0;
      const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      const out: Record<string, Uint8Array> = {};
      const manifest: string[] = [];
      for (let i = 0; i < Math.min(count, templates.length); i++) {
        const t = templates[i % templates.length];
        const dir = t.name;
        for (const [p, d] of Object.entries(t.files)) out[`${dir}/${p}`] = d;
        const shape = t.files['Shape.png'];
        const grain = t.files['Grain.png'];
        if (shape) out[`${dir}/Shape.png`] = await glitchPng(shape, rnd);
        if (grain) out[`${dir}/Grain.png`] = await glitchPng(grain, rnd);
        const thumbSrc = shape ?? grain;
        if (thumbSrc) out[`${dir}/QuickLook/Thumbnail.png`] = await makeThumb(thumbSrc);
        manifest.push(dir);
      }
      const blob = new Blob([toBlobPart(zipSync(out))], { type: 'application/zip' });
      downloadBlob(blob, `salvage9-forge-s${seed}-${manifest.length}.brushset`);
      onLog('cut', `forge: built ${manifest.length}-brush set (seed ${seed})`);
    } catch (e) {
      onLog('err', `forge: build failed — ${e instanceof Error ? e.message : 'unknown'}`);
    } finally { setBusy(false); }
  };

  const glitchPng = async (png: Uint8Array, rnd: () => number): Promise<Uint8Array> => {
    const url = URL.createObjectURL(new Blob([toBlobPart(png)]));
    try {
      const img = await loadImgEl(url);
      const w = img.naturalWidth, h = img.naturalHeight;
      const { canvas } = renderGlitch({ el: img, w, h }, w, h, {
        ...DEFAULT_PARAMS,
        seed: Math.floor(rnd() * 99999),
        rgb: Math.floor((rnd() - 0.5) * 80),
        slice: Math.floor(rnd() * 55),
        crush: Math.floor(rnd() * 40),
        scan: Math.floor(rnd() * 50),
        mosaic: Math.floor(rnd() * 30),
      });
      return new Uint8Array(await new Promise<ArrayBuffer>((res, rej) =>
        canvas.toBlob(b => (b ? b.arrayBuffer().then(res) : rej(new Error('encode failed'))), 'image/png')));
    } finally { URL.revokeObjectURL(url); }
  };
  const makeThumb = async (png: Uint8Array): Promise<Uint8Array> => {
    const url = URL.createObjectURL(new Blob([toBlobPart(png)]));
    try {
      const img = await loadImgEl(url);
      const c = document.createElement('canvas');
      c.width = 256; c.height = 256;
      const x = c.getContext('2d');
      if (!x) throw new Error('no canvas');
      x.fillStyle = '#1d1912'; x.fillRect(0, 0, 256, 256);
      const sc = Math.min(232 / img.naturalWidth, 232 / img.naturalHeight);
      x.drawImage(img, (256 - img.naturalWidth * sc) / 2, (256 - img.naturalHeight * sc) / 2, img.naturalWidth * sc, img.naturalHeight * sc);
      return new Uint8Array(await new Promise<ArrayBuffer>((res, rej) =>
        c.toBlob(b => (b ? b.arrayBuffer().then(res) : rej(new Error('encode failed'))), 'image/png')));
    } finally { URL.revokeObjectURL(url); }
  };

  return (
    <main className="mx-auto max-w-[1000px] px-4 py-6 lg:px-6">
      <h2 className="font-display text-[28px] font-extrabold leading-none tracking-tight text-[var(--fg)]">BRUSH <span className="text-verm">FORGE</span></h2>
      <p className="mt-1 font-mono text-[10px] tracking-[0.2em] text-[var(--mut)]">LOAD A PROCREATE .BRUSHSET · FORGE GLITCHED COPIES</p>

      <div className="mt-4 border-2 border-dashed border-[var(--line-soft)] bg-[var(--panel)] p-6 text-center">
        <p className="font-mono text-[11px] text-[var(--fg2)]">Drop a <strong>.brushset</strong> / <strong>.brush</strong> template, or</p>
        <button type="button" onClick={() => fileRef.current?.click()}
          className="mt-2 border-2 border-verm bg-verm px-4 py-2 font-mono text-[11px] font-bold tracking-widest text-[#f5f1e3] hover:bg-[var(--fg)]">CHOOSE FILES</button>
        <input ref={fileRef} type="file" accept=".brush,.brushset,.zip" multiple className="hidden"
          onChange={e => void onFiles(e.target.files)} />
        <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void onFiles(e.dataTransfer.files); }}
          className="mt-3 border border-dashed border-[var(--line-soft)] py-4 font-mono text-[9px] tracking-widest text-[var(--mut)]">…or drop files here…</div>
        {templates.length > 0 && (
          <p className="mt-2 font-mono text-[10px] font-bold text-moss">{templates.length} template(s): {templates.map(t => t.name).slice(0, 4).join(', ')}{templates.length > 4 ? '…' : ''}</p>
        )}
      </div>

      <div className="mt-4 grid items-end gap-3 border-2 border-[var(--line)] bg-[var(--panel)] p-4 shadow-[4px_4px_0_var(--shadow-ink)] sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 flex justify-between font-mono text-[9px] font-semibold tracking-[0.2em] text-[var(--mut)]"><span>BRUSHES</span><span className="tabular-nums">{count}</span></span>
          <input type="range" min={1} max={16} value={count} onChange={e => setCount(Number(e.target.value))} className="gate-range w-full" />
        </label>
        <label className="block">
          <span className="mb-1 block font-mono text-[9px] font-semibold tracking-[0.2em] text-[var(--mut)]">SEED</span>
          <input value={seed} onChange={e => setSeed(e.target.value)} className="w-full border border-[var(--line)] bg-[var(--panel2)] px-2 py-1 font-mono text-[11px]" />
        </label>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setSeed(String(Math.floor(Math.random() * 99999)))}
            className="flex-1 border-2 border-gold py-2 font-mono text-[10px] font-bold text-[#8a5f10] hover:bg-gold hover:text-black">⟳ REROLL</button>
          <button type="button" onClick={() => void buildSet()} disabled={busy || templates.length === 0}
            className="flex-1 border-2 border-moss bg-moss py-2 font-mono text-[10px] font-bold tracking-widest text-[#f5f1e3] hover:opacity-85 disabled:opacity-30">{busy ? 'FORGING…' : '⚒ FORGE'}</button>
        </div>
      </div>
      <p className="mt-2 font-mono text-[9px] leading-relaxed text-[var(--mut)]">
        Keeps each template's <code>Brush.archive</code> intact (so names/plist stay valid) and regenerates the shape/grain textures with a seeded glitch pass. Import the resulting <code>.brushset</code> into Procreate.
      </p>
    </main>
  );
}
