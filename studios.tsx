import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Specimen } from '../lib/types';
import type { LogLine } from '../lib/engine';
import { CHANNELS, DEFAULT_PARAMS, PRESETS, exportDims, renderGlitch, stageDims, type GlitchParams } from '../lib/glitch';
import { BLEND_KEYS, BLEND_LABELS, DESK_PALETTE, SIZE_PRESETS, colorLayer, drawScene, hitHandle, hitLayer, layerFromSpecimen, layerH, primeImages, renderComposite, textLayer, type Blend, type DeskDoc, type DeskLayer, type SizeId } from '../lib/collage';
import { exportSingle } from '../lib/exporter';
import { isolateFromUrl } from '../lib/cutout';
import {
  VIBES, mulberry32, renderShape, renderGrain, renderStrokePreview, canvasPng,
  extractTemplates, forgeBrush, buildBrushset,
  type BrushTemplate, type ForgedBrush, type ShapeId, type GrainId, type VibeId,
} from '../lib/forge';

/* ================= GLITCH LAB ================= */
export function GlitchLab({ feed, tray, zap, onLog }: {
  feed: Specimen[]; tray: Specimen[]; zap: { sp: Specimen; n: number } | null; onLog: (level: LogLine['level'], msg: string) => void;
}) {
  const [mode, setMode] = useState<'belt' | 'tray' | 'file'>('belt');
  const [src, setSrc] = useState<{ el: HTMLImageElement; w: number; h: number; label: string } | null>(null);
  const [params, setParams] = useState<GlitchParams>(DEFAULT_PARAMS);
  const [pipe, setPipe] = useState<'pixel' | 'composite'>('pixel');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const options = mode === 'tray' ? tray : feed.filter(f => f.state === 'judged' && f.verdict === 'pass').slice(-60);
  const adopt = useCallback((sp: Specimen) => {
    const url = sp.cutoutSrc ?? (sp.remote ? sp.thumb || sp.dataUri : sp.dataUri);
    const img = new Image();
    if (/^https?:/i.test(url)) img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => setSrc({ el: img, w: img.naturalWidth, h: img.naturalHeight, label: sp.code });
    img.onerror = () => onLog('err', `lab: ${sp.code} refused to load`);
    img.src = url;
  }, [onLog]);
  useEffect(() => { if (zap) { setMode('belt'); adopt(zap.sp); } }, [zap, adopt]);
  const onFile = (f: File | undefined) => {
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => { setSrc({ el: img, w: img.naturalWidth, h: img.naturalHeight, label: f.name }); setMode('file'); URL.revokeObjectURL(url); };
    img.src = url;
  };
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs || !src) return;
    const { w, h } = stageDims(src.w, src.h);
    if (cvs.width !== w) cvs.width = w;
    if (cvs.height !== h) cvs.height = h;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    const raf = requestAnimationFrame(() => {
      try {
        const { canvas, pipe: p } = renderGlitch(src, w, h, params);
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(canvas, 0, 0);
        setPipe(p);
      } catch (e) { console.error('[SALVAGE/9] lab frame skipped:', e); }
    });
    return () => cancelAnimationFrame(raf);
  }, [src, params]);
  const set = (patch: Partial<GlitchParams>) => setParams(p => ({ ...p, ...patch }));

  /* randomize the effect channels but KEEP the seed — a fresh combo that's
     still reproducible. Lights up a random subset so it reads as a coherent
     glitch rather than uniform noise. */
  const rerollFx = () => {
    setParams(p => {
      const next: GlitchParams = { ...p };
      for (const ch of CHANNELS) {
        if (ch.key === 'seed') continue;
        /* ~55% of channels stay dark; the rest get a signed intensity */
        if (Math.random() < 0.45) { next[ch.key] = 0; continue; }
        const mag = Math.round(12 + Math.random() * 80);
        next[ch.key] = Math.random() < 0.5 ? -mag : mag;
      }
      /* guarantee at least one channel is on so it never goes flat */
      if (CHANNELS.every(ch => ch.key === 'seed' || next[ch.key] === 0)) {
        const pick = CHANNELS[Math.floor(Math.random() * CHANNELS.length)];
        if (pick.key !== 'seed') next[pick.key] = Math.random() < 0.5 ? -60 : 60;
      }
      return next;
    });
  };

  const exportPng = () => {
    if (!src) return;
    try {
      const { w, h } = exportDims(src.w, src.h);
      const { canvas } = renderGlitch(src, w, h, params);
      const a = document.createElement('a');
      a.download = `glitch-${src.label.replace(/[^a-z0-9.-]/gi, '_')}-s${params.seed}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
      onLog('sys', `lab: ${src.label} exported @ ${w}×${h}`);
    } catch { onLog('err', 'lab: export failed'); }
  };
  return (
    <main className="mx-auto max-w-[1560px] px-4 py-5 lg:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[34px] font-extrabold leading-none tracking-tight text-[var(--fg)]">GLITCH <span className="text-verm">LAB</span></h2>
          <p className="mt-1 font-mono text-[10px] tracking-[0.2em] text-[var(--mut)]">16 SIGNED CHANNELS · SEEDED · {pipe === 'pixel' ? 'PIXEL PIPE' : 'COMPOSITE PIPE'}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => rerollFx()} disabled={!src} title="randomize the effect channels (keeps the seed)" className="border-2 border-verm bg-verm px-3 py-1.5 font-mono text-[10.5px] font-bold tracking-[0.16em] text-[#f5f1e3] transition-all hover:-translate-y-0.5 hover:bg-[var(--fg)] disabled:pointer-events-none disabled:opacity-35">⟳ REROLL FX</button>
          <button type="button" onClick={() => set({ seed: Math.floor(Math.random() * 99999) })} disabled={!src} className="border-2 border-[var(--line)] px-3 py-1.5 font-mono text-[10.5px] font-bold tracking-[0.16em] text-[var(--fg)] transition-all hover:-translate-y-0.5 hover:bg-gold hover:border-gold hover:text-black disabled:pointer-events-none disabled:opacity-35">SEED {params.seed}</button>
          <button type="button" onClick={exportPng} disabled={!src} className="border-2 border-moss bg-moss px-3 py-1.5 font-mono text-[10.5px] font-bold tracking-[0.16em] text-[#f5f1e3] transition-all hover:-translate-y-0.5 hover:bg-[var(--fg)] disabled:pointer-events-none disabled:opacity-35">EXPORT PNG</button>
        </div>
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        <section className="border-2 border-[var(--line)] bg-[var(--panel)] shadow-[4px_4px_0_var(--shadow-ink)]">
          <div className="flex border-b-2 border-[var(--line)]">
            {(['belt', 'tray', 'file'] as const).map(m => (
              <button key={m} type="button" onClick={() => { setMode(m); if (m === 'file') fileRef.current?.click(); }}
                className={`flex-1 px-2 py-2 font-mono text-[10px] font-bold tracking-[0.16em] transition-colors ${mode === m ? 'bg-[var(--fg)] text-[var(--bg)]' : 'text-[var(--fg2)] hover:bg-[var(--line-soft)]'}`}>
                {m === 'belt' ? 'BELT' : m === 'tray' ? `TRAY·${tray.length}` : 'FILE'}
              </button>
            ))}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
          <div className="grid max-h-[560px] grid-cols-3 gap-1.5 overflow-y-auto p-2 scroll-slim">
            {options.length === 0 ? <p className="col-span-3 border border-dashed border-[var(--line)]/30 px-2 py-8 text-center font-mono text-[9px] text-[var(--mut)]">nothing here yet</p> :
              options.map(sp => (
                <button key={sp.id} type="button" onClick={() => adopt(sp)} title={sp.archetype}
                  className={`border-2 transition-all hover:-translate-y-0.5 ${src?.label === sp.code ? 'border-verm' : 'border-[var(--line)]/40 hover:border-[var(--line)]'}`}>
                  <img src={sp.cutoutSrc ?? (sp.remote ? sp.thumb : sp.dataUri)} alt={sp.code} loading="lazy" referrerPolicy="no-referrer" className={`aspect-square w-full object-cover ${sp.cutoutSrc ? 'checker' : ''}`} />
                </button>
              ))}
          </div>
        </section>
        <section className="border-2 border-[var(--line)] bg-[#15120c] shadow-[4px_4px_0_var(--shadow-ink)]">
          <div className="grid min-h-[420px] place-items-center p-4">
            {src ? <canvas ref={canvasRef} className="max-w-full border border-[#e9e4d4]/20" /> : (
              <div className="px-6 py-16 text-center">
                <div className="font-display text-2xl font-extrabold text-[#e9e4d4]/85">FEED ME A PLATE.</div>
                <p className="mx-auto mt-2 max-w-[380px] font-mono text-[10.5px] leading-relaxed text-[#e9e4d4]/50">pick one from the belt or tray, or drop a file. then start twisting.</p>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-[#e9e4d4]/15 px-3 py-1.5 font-mono text-[8.5px] tracking-[0.18em] text-[#e9e4d4]/45">
            <span>{src ? src.label.toUpperCase() : 'NO SIGNAL'}</span>
            <span className={pipe === 'pixel' ? 'text-[#7ebe5c]' : 'text-gold'}>{pipe === 'pixel' ? 'PIXEL PIPE' : 'COMPOSITE'}</span>
          </div>
        </section>
        <section className="border-2 border-[var(--line)] bg-[var(--panel)] shadow-[4px_4px_0_var(--shadow-ink)]">
          <h3 className="border-b-2 border-[var(--line)] px-3 py-2 font-display text-[15px] font-extrabold tracking-tight text-[var(--fg)]">CHANNEL RACK</h3>
          <div className="flex flex-wrap gap-1.5 border-b border-[var(--line-soft)] px-3 py-2">
            {PRESETS.map(p => (
              <button key={p.name} type="button" onClick={() => setParams(prev => ({ ...DEFAULT_PARAMS, ...p.p, seed: prev.seed }))}
                className="border border-[var(--line)]/50 px-1.5 py-0.5 font-mono text-[8.5px] font-bold tracking-[0.12em] text-[var(--fg2)] transition-colors hover:border-verm hover:bg-verm hover:text-[#f5f1e3]">{p.name}</button>
            ))}
          </div>
          <div className="grid max-h-[520px] grid-cols-1 gap-x-4 gap-y-2 overflow-y-auto px-3 py-3 scroll-slim sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {CHANNELS.map(c => (
              <label key={c.key} className="block">
                <span className="mb-0.5 flex items-center justify-between font-mono text-[9px] font-bold tracking-[0.18em] text-[var(--mut)]">
                  {c.label}
                  <span className={`tabular-nums ${params[c.key] > 0 ? 'text-verm' : params[c.key] < 0 ? 'text-ultra' : 'text-[var(--fg2)]'}`}>{params[c.key] > 0 ? `+${params[c.key]}` : params[c.key]}</span>
                </span>
                <input type="range" min={c.min} max={c.max} step={1} value={params[c.key]} onChange={e => set({ [c.key]: Number(e.target.value) } as Partial<GlitchParams>)} className="gate-range w-full" />
              </label>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

/* ================= PASTE-UP DESK ================= */
export function CollageDesk({ tray, onLog }: { tray: Specimen[]; onLog: (level: LogLine['level'], msg: string) => void }) {
  const [sizeId, setSizeId] = useState<SizeId>('square');
  const preset = SIZE_PRESETS.find(s => s.id === sizeId) ?? SIZE_PRESETS[0];
  const [doc, setDoc] = useState<DeskDoc>(() => {
    try {
      const raw = localStorage.getItem('salvage9.desk.v1');
      if (raw) { const d = JSON.parse(raw) as DeskDoc; if (d && Array.isArray(d.layers)) return d; }
    } catch { /* fresh */ }
    return { w: preset.w, h: preset.h, bg: '#e9e4d4', layers: [] };
  });
  const docRef = useRef(doc);
  useEffect(() => { docRef.current = doc; }, [doc]);
  const [selId, setSelId] = useState<string | null>(null);
  const [busyCut, setBusyCut] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.3);
  const dragRef = useRef<{ id: string; mode: 'move' | 'resize'; dx: number; dy: number; w0: number; px: number; py: number } | null>(null);
  const selLayer = useMemo(() => doc.layers.find(l => l.id === selId) ?? null, [doc, selId]);

  useEffect(() => { primeImages(doc.layers); }, [doc.layers]);
  useEffect(() => {
    const measure = () => {
      const el = wrapRef.current;
      if (!el) return;
      const avail = el.clientWidth - 24;
      setScale(Math.max(0.05, Math.min(1, avail / docRef.current.w)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    cvs.width = Math.round(doc.w * scale);
    cvs.height = Math.round(doc.h * scale);
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    const raf = requestAnimationFrame(() => { try { drawScene(ctx, doc, scale, { selectedId: selId }); } catch (e) { console.error('[SALVAGE/9] desk frame skipped:', e); } });
    return () => cancelAnimationFrame(raf);
  }, [doc, scale, selId]);
  useEffect(() => {
    const t = window.setTimeout(() => { try { localStorage.setItem('salvage9.desk.v1', JSON.stringify(doc)); } catch {} }, 800);
    return () => window.clearTimeout(t);
  }, [doc]);

  const toDoc = (e: { clientX: number; clientY: number }) => {
    const cvs = canvasRef.current;
    const r = cvs?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };
  const addFromTray = (sp: Specimen) => {
    const L = layerFromSpecimen(sp, doc.w / 2 + (Math.random() - 0.5) * 120, doc.h / 2 + (Math.random() - 0.5) * 120);
    primeImages([L]);
    setDoc(d => ({ ...d, layers: [...d.layers, L] }));
    setSelId(L.id);
    onLog('sys', `desk: added “${sp.archetype}”`);
  };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toDoc(e);
    for (let i = doc.layers.length - 1; i >= 0; i--) {
      const L = doc.layers[i];
      const h = hitHandle(L, p.x, p.y, 14 / scale);
      if (h) { setSelId(L.id); dragRef.current = { id: L.id, mode: 'resize', dx: 0, dy: 0, w0: L.w, px: p.x, py: p.y }; (e.target as HTMLElement).setPointerCapture(e.pointerId); return; }
      if (hitLayer(L, p.x, p.y)) { setSelId(L.id); dragRef.current = { id: L.id, mode: 'move', dx: p.x - L.x, dy: p.y - L.y, w0: L.w, px: p.x, py: p.y }; (e.target as HTMLElement).setPointerCapture(e.pointerId); return; }
    }
    setSelId(null);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const dr = dragRef.current;
    if (!dr) return;
    const p = toDoc(e);
    setDoc(d => ({
      ...d,
      layers: d.layers.map(L => {
        if (L.id !== dr.id) return L;
        if (dr.mode === 'move') return { ...L, x: p.x - dr.dx, y: p.y - dr.dy };
        const dw = Math.abs(p.x - L.x) * 2;
        return { ...L, w: Math.max(30, dw) };
      }),
    }));
  };
  const onPointerUp = () => { dragRef.current = null; };
  const patchSel = (patch: Partial<DeskLayer>) => { if (selId) setDoc(d => ({ ...d, layers: d.layers.map(L => L.id === selId ? { ...L, ...patch } : L) })); };
  const removeSel = () => { if (selId) { setDoc(d => ({ ...d, layers: d.layers.filter(L => L.id !== selId) })); setSelId(null); } };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selId) { e.preventDefault(); removeSel(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId]);
  const cutSel = async () => {
    if (!selLayer || selLayer.kind !== 'image' || busyCut) return;
    const url = selLayer.src ?? selLayer.fullUrl;
    if (!url) return;
    setBusyCut(true);
    try {
      const res = await isolateFromUrl(url, 'fast', 1400);
      const img = new Image();
      img.src = res.dataUrl;
      patchSel({ cutoutSrc: res.dataUrl, aspect: res.width / res.height });
      onLog('cut', `desk: freed subject from “${selLayer.name}” (${res.engine === 'ink' ? 'ink-matte' : res.engine === 'flood' ? 'color-flood' : 'model'})`);
    } catch { onLog('err', `desk: cutout refused “${selLayer.name}”`); }
    finally { setBusyCut(false); }
  };
  const exportDesk = async () => {
    try {
      const c = await renderComposite(doc, Math.min(2, 2400 / doc.w));
      const a = document.createElement('a');
      a.download = 'salvage9-collage.png';
      a.href = c.toDataURL('image/png');
      a.click();
      onLog('sys', 'desk: collage exported');
    } catch { onLog('err', 'desk: export failed'); }
  };
  return (
    <main className="mx-auto max-w-[1560px] px-4 py-5 lg:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[34px] font-extrabold leading-none tracking-tight text-[var(--fg)]">PASTE-UP <span className="text-verm">DESK</span></h2>
          <p className="mt-1 font-mono text-[10px] tracking-[0.2em] text-[var(--mut)]">{doc.layers.length} LAYERS · {preset.label} · AUTOSAVES</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={sizeId} onChange={e => { setSizeId(e.target.value as SizeId); const s = SIZE_PRESETS.find(x => x.id === e.target.value)!; setDoc(d => ({ ...d, w: s.w, h: s.h })); }}
            className="border-2 border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 font-mono text-[10px] font-bold text-[var(--fg)]">
            {SIZE_PRESETS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button type="button" onClick={() => { if (selLayer) patchSel({ color: DESK_PALETTE[Math.floor(Math.random() * DESK_PALETTE.length)] }); }} className="border-2 border-[var(--line)] px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-[var(--fg)] hover:bg-gold hover:border-gold">RECOLOR</button>
          <button type="button" onClick={() => setDoc(d => ({ ...d, layers: [...d.layers, colorLayer(DESK_PALETTE[Math.floor(Math.random() * DESK_PALETTE.length)], d.w / 2, d.h / 2)] }))} className="border-2 border-[var(--line)] px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-[var(--fg)] hover:bg-ultra hover:border-ultra hover:text-[#f5f1e3]">+ BLOCK</button>
          <button type="button" onClick={() => setDoc(d => ({ ...d, layers: [...d.layers, textLayer('CUT HERE', d.w / 2, d.h / 2)] }))} className="border-2 border-[var(--line)] px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-[var(--fg)] hover:bg-ultra hover:border-ultra hover:text-[#f5f1e3]">+ TYPE</button>
          <button type="button" onClick={exportDesk} className="border-2 border-moss bg-moss px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-[#f5f1e3] hover:bg-[var(--fg)]">EXPORT PNG</button>
        </div>
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <section className="border-2 border-[var(--line)] bg-[var(--panel)] shadow-[4px_4px_0_var(--shadow-ink)]">
          <h3 className="border-b-2 border-[var(--line)] px-3 py-2 font-display text-[15px] font-extrabold tracking-tight text-[var(--fg)]">FROM THE TRAY · {tray.length}</h3>
          <div className="grid max-h-[520px] grid-cols-3 gap-1.5 overflow-y-auto p-2 scroll-slim">
            {tray.length === 0 && <p className="col-span-3 px-2 py-8 text-center font-mono text-[9px] text-[var(--mut)]">cut some plates first</p>}
            {tray.map(sp => (
              <button key={sp.id} type="button" onClick={() => addFromTray(sp)} title={`add ${sp.archetype}`} className="border-2 border-[var(--line)]/40 transition-all hover:-translate-y-0.5 hover:border-verm">
                <img src={sp.cutoutSrc ?? (sp.remote ? sp.thumb : sp.dataUri)} alt={sp.code} loading="lazy" referrerPolicy="no-referrer" className={`aspect-square w-full object-cover ${sp.cutoutSrc ? 'checker' : ''}`} />
              </button>
            ))}
          </div>
        </section>
        <div className="flex flex-col gap-4">
          <section className="border-2 border-[var(--line)] bg-[#15120c] p-3 shadow-[4px_4px_0_var(--shadow-ink)]">
            <div ref={wrapRef} className="w-full overflow-hidden">
              <canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
                className="mx-auto block max-w-full border border-[#e9e4d4]/20" style={{ touchAction: 'none' }} />
            </div>
          </section>
          {selLayer && (
            <section className="border-2 border-[var(--line)] bg-[var(--panel)] p-3 shadow-[4px_4px_0_var(--shadow-ink)]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] font-bold tracking-[0.16em] text-[var(--fg)]">{selLayer.name.toUpperCase()}</span>
                <select value={selLayer.blend} onChange={e => patchSel({ blend: e.target.value as Blend })} className="border border-[var(--line)]/40 bg-[var(--bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg)]">
                  {BLEND_KEYS.map(b => <option key={b} value={b}>{BLEND_LABELS[b]}</option>)}
                </select>
                <label className="flex items-center gap-1.5 font-mono text-[9px] font-bold tracking-[0.14em] text-[var(--mut)]">OP
                  <input type="range" min={10} max={100} value={Math.round(selLayer.opacity * 100)} onChange={e => patchSel({ opacity: Number(e.target.value) / 100 })} className="gate-range w-24" />
                </label>
                {selLayer.kind === 'image' && (
                  <button type="button" onClick={cutSel} disabled={busyCut} className="border-2 border-verm bg-verm px-2 py-1 font-mono text-[10px] font-bold tracking-[0.14em] text-[#f5f1e3] hover:bg-[var(--fg)] disabled:opacity-50">
                    {busyCut ? 'CUTTING…' : selLayer.cutoutSrc ? 'RE-CUTOUT' : '✂ CUTOUT'}
                  </button>
                )}
                {selLayer.kind === 'text' && (
                  <input value={selLayer.text ?? ''} onChange={e => patchSel({ text: e.target.value })} className="border border-[var(--line)]/40 bg-[var(--bg)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--fg)]" />
                )}
                <button type="button" onClick={removeSel} className="ml-auto border-2 border-[var(--line)] px-2 py-1 font-mono text-[10px] font-bold tracking-[0.14em] text-[var(--fg)] hover:bg-verm hover:border-verm hover:text-[#f5f1e3]">DELETE</button>
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

/* ================= BRUSH FORGE (Procreate glitch-brush generator) ================= */

const NAME_A = ['GHOST', 'STATIC', 'VHS', 'SIGNAL', 'NEON', 'ACID', 'RASTER', 'PIXEL', 'GLITCH', 'ANALOG', 'CRT', 'NOISE', 'SCAN', 'BURN', 'TAPE', 'WIRE', 'CHROME', 'RUST', 'ECHO', 'PHASE'];
const NAME_B = ['DRIP', 'TEAR', 'BLEED', 'SHIFT', 'BLOOM', 'SCAR', 'HAZE', 'SPLIT', 'MELT', 'WARP', 'CRUSH', 'GHOST', 'MOTH', 'VEIN', 'PULSE', 'SHARD', 'FOG', 'RIFT', 'STAIN', 'FLUX'];

interface ForgedCard extends ForgedBrush {
  id: number;
  kept: boolean;
  seed: number;
}

export function BrushForge({ onLog }: { onLog: (level: LogLine['level'], msg: string) => void }) {
  const [templates, setTemplates] = useState<BrushTemplate[]>([]);
  const [templateName, setTemplateName] = useState('');
  const [vibe, setVibe] = useState<VibeId>('glitch');
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const [count, setCount] = useState(8);
  const [busy, setBusy] = useState(false);
  const [cards, setCards] = useState<ForgedCard[]>([]);
  const [building, setBuilding] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'warn' | 'err'; msg: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const onTemplateFile = async (f: File | undefined) => {
    if (!f) return;
    setStatus({ kind: 'ok', msg: `reading ${f.name}…` });
    try {
      const t = await extractTemplates(f);
      if (t.length === 0) {
        setStatus({ kind: 'err', msg: `${f.name} unpacked but contained no brushes — is it a Procreate export?` });
        return;
      }
      setTemplates(t);
      setTemplateName(f.name);
      setCards([]);
      setStatus({ kind: 'ok', msg: `${f.name} → ${t.length} template${t.length > 1 ? 's' : ''} unpacked — FORGE is armed` });
      onLog('cut', `forge: ${f.name} → ${t.length} template${t.length > 1 ? 's' : ''} unpacked`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'could not read template';
      setStatus({ kind: 'err', msg: `${f.name}: ${msg}` });
      onLog('err', `forge: ${msg}`);
    }
  };

  const makeOne = (index: number, s: number, v: VibeId): ForgedCard => {
    const rnd = mulberry32(s + index * 101);
    const vb = VIBES.find(x => x.id === v) ?? VIBES[0];
    const shapeId = vb.shapes[Math.floor(rnd() * vb.shapes.length)] as ShapeId;
    const grainId = vb.grains[Math.floor(rnd() * vb.grains.length)] as GrainId;
    const lum = 0.55 + rnd() * 0.4;
    const shape = renderShape(shapeId, mulberry32(s + index * 101 + 1));
    const grain = renderGrain(grainId, mulberry32(s + index * 101 + 2));
    const stroke = renderStrokePreview(shape, grain, mulberry32(s + index * 101 + 3), lum);
    const name = `${NAME_A[Math.floor(rnd() * NAME_A.length)]} ${NAME_B[Math.floor(rnd() * NAME_B.length)]} ${100 + Math.floor(rnd() * 900)}`;
    const tpl = templates[index % templates.length];
    const forged = forgeBrush(tpl, {
      name, shapeId, grainId,
      shapePng: new Uint8Array(0), grainPng: new Uint8Array(0),
      strokeUrl: stroke.toDataURL('image/png'),
    }, s, index);
    /* stash real pngs lazily — encoded only when building the set */
    (forged as unknown as { _shape: HTMLCanvasElement; _grain: HTMLCanvasElement })._shape = shape;
    (forged as unknown as { _shape: HTMLCanvasElement; _grain: HTMLCanvasElement })._grain = grain;
    return { ...forged, id: index, kept: true, seed: s + index * 101 };
  };

  const forge = () => {
    if (templates.length === 0) {
      setStatus({ kind: 'warn', msg: 'drop a .brushset / .brush template above first — the forge needs real dynamics to splice into' });
      onLog('warn', 'forge: drop a .brushset / .brush template first');
      return;
    }
    setBusy(true);
    setStatus({ kind: 'ok', msg: `forging ${count} ${vibe} brushes…` });
    try {
      const out: ForgedCard[] = [];
      for (let i = 0; i < count; i++) out.push(makeOne(i, seed, vibe));
      setCards(out);
      setStatus({ kind: 'ok', msg: `${count} ${vibe} brushes lit · seed ${seed} — skip the weak, keep the keepers` });
      onLog('sys', `forge: lit ${count} ${vibe} brushes · seed ${seed}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'forge misfired';
      setStatus({ kind: 'err', msg: `forge misfired: ${msg}` });
      onLog('err', `forge: ${msg}`);
    } finally { setBusy(false); }
  };

  const rerollOne = (id: number) => {
    setCards(prev => prev.map(card => {
      if (card.id !== id) return card;
      const fresh = makeOne(card.id, Math.floor(Math.random() * 1_000_000), vibe);
      onLog('sys', `forge: ⟳ rerolled ${card.name} → ${fresh.name}`);
      return { ...fresh, kept: card.kept };
    }));
  };

  const buildSet = async () => {
    const kept = cards.filter(c => c.kept);
    if (kept.length === 0) { onLog('warn', 'forge: nothing kept — un-skip some brushes'); return; }
    setBuilding(true);
    try {
      /* encode real pngs now */
      for (const c of kept) {
        const stash = c as unknown as { _shape?: HTMLCanvasElement; _grain?: HTMLCanvasElement };
        if (stash._shape) c.shapePng = await canvasPng(stash._shape);
        if (stash._grain) c.grainPng = await canvasPng(stash._grain);
      }
      const vb = VIBES.find(x => x.id === vibe)?.label ?? 'GLITCH';
      const setName = `SALVAGE-${vb}-${kept.length}`;
      const res = await buildBrushset(kept, setName, m => onLog('sys', `forge: ${m}`));
      const a = document.createElement('a');
      a.download = `${res.name}.brushset`;
      const bytes = res.bytes;
      const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'application/octet-stream' });
      a.href = URL.createObjectURL(blob);
      a.click();
      onLog('cut', `forge: ⬇ ${res.name}.brushset (${kept.length} brushes, ${(res.bytes.length / 1024).toFixed(0)} KB)`);
    } catch (e) {
      onLog('err', `forge: ${e instanceof Error ? e.message : 'build failed'}`);
    } finally { setBuilding(false); }
  };

  const keptCount = cards.filter(c => c.kept).length;

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-5 lg:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[34px] font-extrabold leading-none tracking-tight text-[var(--fg)]">BRUSH <span className="text-verm">FORGE</span></h2>
          <p className="mt-1 font-mono text-[10px] tracking-[0.2em] text-[var(--mut)]">PROCREAT GLITCH BRUSHES · TEMPLATES SUPPLY DYNAMICS · FORGE SUPPLY LOOKS</p>
        </div>
        {status && (
          <div
            role="status"
            className={`border-2 px-3 py-2 font-mono text-[10.5px] font-bold tracking-[0.1em] transition-colors ${
              status.kind === 'ok' ? 'border-moss text-moss' : status.kind === 'warn' ? 'border-gold text-gold' : 'border-verm text-verm'
            }`}
          >
            {status.kind === 'ok' ? '▸ ' : status.kind === 'warn' ? '▲ ' : '✕ '}{status.msg}
          </div>
        )}
      </div>

      {/* template dropzone */}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className={`mb-4 block w-full border-2 border-dashed px-5 py-4 text-left transition-all hover:-translate-y-0.5 ${
          templates.length ? 'border-moss bg-moss/10' : 'anim-led border-verm/70 bg-verm/5 hover:border-verm hover:bg-verm/10'
        }`}
      >
        <input ref={fileRef} type="file" accept=".brushset,.brush,.zip" className="hidden" onChange={e => onTemplateFile(e.target.files?.[0])} />
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[11px] font-bold tracking-[0.2em] text-[var(--fg)]">
              {templates.length ? `TEMPLATE LOADED · ${templateName}` : 'DROP A PROCREATE .BRUSHSET / .BRUSH TEMPLATE'}
            </div>
            <div className="mt-0.5 font-mono text-[9.5px] tracking-[0.12em] text-[var(--mut)]">
              {templates.length
                ? `${templates.length} brush template${templates.length > 1 ? 's' : ''} unpacked — their dynamics are inherited, looks get glitched`
                : 'the forge splices fresh glitch looks into your real brush dynamics'}
            </div>
          </div>
          <span className="font-mono text-[10px] font-bold tracking-[0.16em] text-verm">{templates.length ? '↻ REPLACE' : '+ BROWSE'}</span>
        </div>
      </button>

      <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* controls */}
        <div className="flex flex-col gap-4">
          <section className="border-2 border-[var(--line)] bg-[var(--panel)] shadow-[4px_4px_0_var(--shadow-ink)]">
            <h3 className="border-b-2 border-[var(--line)] px-3 py-2 font-display text-[15px] font-extrabold tracking-tight text-[var(--fg)]">CATEGORY</h3>
            <div className="grid grid-cols-2 gap-1.5 p-3">
              {VIBES.map(v => (
                <button key={v.id} type="button" onClick={() => setVibe(v.id)}
                  className={`border px-2 py-1.5 font-mono text-[10px] font-bold tracking-[0.14em] transition-all ${
                    vibe === v.id ? 'border-verm bg-verm text-[#f5f1e3]' : 'border-[var(--line)]/50 text-[var(--fg2)] hover:border-verm hover:text-verm'
                  }`}>{v.label}</button>
              ))}
            </div>
          </section>

          <section className="border-2 border-[var(--line)] bg-[var(--panel)] shadow-[4px_4px_0_var(--shadow-ink)]">
            <h3 className="border-b-2 border-[var(--line)] px-3 py-2 font-display text-[15px] font-extrabold tracking-tight text-[var(--fg)]">SEED</h3>
            <div className="flex flex-col gap-2 p-3">
              <div className="flex items-center gap-2">
                <input
                  type="number" value={seed}
                  onChange={e => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                  className="w-full border-2 border-[var(--line)] bg-[var(--bg)] px-2 py-1.5 font-mono text-[12px] font-bold tabular-nums text-[var(--fg)] outline-none focus:border-verm"
                />
                <button type="button" onClick={() => setSeed(Math.floor(Math.random() * 1_000_000))}
                  className="shrink-0 border-2 border-[var(--line)] px-2.5 py-1.5 font-mono text-[11px] font-bold text-[var(--fg)] transition-colors hover:bg-gold hover:border-gold hover:text-black" title="random seed">⟳</button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[9.5px] tracking-[0.16em] text-[var(--mut)]">BRUSHES</span>
                <div className="flex items-center gap-2">
                  <input type="range" min={1} max={24} value={count} onChange={e => setCount(Number(e.target.value))} className="gate-range w-28" />
                  <span className="font-mono text-[11px] font-bold tabular-nums text-[var(--fg)]">{count}</span>
                </div>
              </div>
              <button type="button" onClick={forge} disabled={busy || templates.length === 0}
                title={templates.length === 0 ? 'load a .brushset / .brush template first' : `forge ${count} brushes`}
                className="border-2 border-verm bg-verm px-3 py-2 font-mono text-[11px] font-bold tracking-[0.18em] text-[#f5f1e3] transition-all hover:-translate-y-0.5 hover:bg-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-35">
                {busy ? '⚒ FORGING…' : templates.length === 0 ? '⚒ FORGE — NEEDS TEMPLATE' : `⚒ FORGE ${count}`}
              </button>
            </div>
          </section>

          <button type="button" onClick={buildSet} disabled={building || keptCount === 0}
            className="border-2 border-moss bg-moss px-3 py-2.5 font-mono text-[11.5px] font-bold tracking-[0.18em] text-[#f5f1e3] transition-all hover:-translate-y-0.5 hover:bg-[var(--fg)] disabled:pointer-events-none disabled:opacity-35">
            {building ? '⬇ PRESSING…' : `⬇ BUILD .BRUSHSET (${keptCount})`}
          </button>
        </div>

        {/* cards */}
        <div>
          {cards.length === 0 ? (
            <div className="grid min-h-[320px] place-items-center border-2 border-dashed border-[var(--line)]/40 bg-[var(--panel)]/60 px-6 text-center">
              <div>
                <div className="font-display text-2xl font-extrabold text-[var(--fg)]">{templates.length ? 'HIT FORGE.' : 'FEED ME A TEMPLATE.'}</div>
                <p className="mx-auto mt-2 max-w-[420px] font-mono text-[10px] leading-relaxed text-[var(--mut)]">
                  {templates.length
                    ? 'pick a category, set a seed, and strike. skip the weak ones, keep the keepers, then build the set.'
                    : 'drop a Procreate .brushset or .brush above. the forge keeps each brush\u2019s dynamics and swaps in a glitched shape + grain.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {cards.map(card => (
                <div key={card.id} className={`group border-2 transition-all hover:-translate-y-1 ${
                  card.kept ? 'border-[var(--line)] bg-[#15120c] hover:border-verm' : 'border-[var(--line)]/30 bg-[#15120c]/50 opacity-45'
                }`}>
                  <img src={card.strokeUrl} alt={card.name} className="aspect-[2/1] w-full" />
                  <div className="border-t border-[var(--line-soft)] px-2 py-1.5">
                    <div className="truncate font-mono text-[10px] font-bold tracking-[0.08em] text-[#f5f1e3]">{card.name}</div>
                    <div className="mt-0.5 flex items-center justify-between gap-1">
                      <span className="truncate font-mono text-[8px] tracking-[0.1em] text-[var(--mut)]">{card.shapeId}×{card.grainId}</span>
                      <span className="font-mono text-[8px] tabular-nums text-[var(--mut)]">#{card.seed}</span>
                    </div>
                  </div>
                  <div className="flex border-t border-[var(--line-soft)]">
                    <button type="button" onClick={() => setCards(prev => prev.map(c2 => c2.id === card.id ? { ...c2, kept: !c2.kept } : c2))}
                      className={`flex-1 py-1.5 font-mono text-[9.5px] font-bold tracking-[0.14em] transition-colors ${
                        card.kept ? 'text-moss hover:bg-moss hover:text-[#f5f1e3]' : 'text-[var(--mut)] hover:bg-[var(--line-soft)]'
                      }`}>{card.kept ? 'KEEP ✓' : 'SKIP'}</button>
                    <button type="button" onClick={() => rerollOne(card.id)}
                      className="flex-1 border-l border-[var(--line-soft)] py-1.5 font-mono text-[9.5px] font-bold tracking-[0.14em] text-gold transition-colors hover:bg-gold hover:text-black" title="reroll this brush">⟳ REROLL</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
