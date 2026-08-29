import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Specimen } from '../lib/types';
import type { LogLine } from '../lib/engine';
import {
  BLEND_LABELS, SIZE_IDS, SIZE_PRESETS,
  colorLayer, drawScene, fxActive, hitHandle, hitLayer, inkLayer, layerFromSpecimen, layerH,
  newId, primeImages, renderComposition, snapTargets, strokeBounds, textLayer, toLocal,
  type Blend, type CollageLayer, type DeskDoc, type Handle, type InkStroke, type SizeId, type StrokePoint,
} from '../lib/collage';
import { CHANNELS, DEFAULT_PARAMS, type GlitchParams } from '../lib/glitch';
import { isolateFromUrl, onIsoProgress } from '../lib/cutout';
import { IcDown, IcScissors, IcTrash, IcX } from './ui';

type Mode = 'arrange' | 'ink';
type DragState =
  | { kind: 'move'; id: string; ox: number; oy: number; lx: number; ly: number; snap: { xs: number[]; ys: number[] } }
  | { kind: 'scale'; id: string; handle: Exclude<Handle, null | 'rot'>; startW: number; startH: number; startDist: number; ratioLock: boolean }
  | { kind: 'rot'; id: string; startRot: number; startAngle: number; ratioLock: boolean }
  | { kind: 'draw'; points: StrokePoint[] }
  | null;

const SNAP_R = 14;

function freshDoc(): DeskDoc {
  return { size: 'square', bg: '#e9e4d4', layers: [] };
}

export function CollageDesk({ feed, tray, onLog }: {
  feed: Specimen[]; tray: Specimen[];
  onLog: (level: LogLine['level'], msg: string) => void;
}) {
  /* doc + autosave (corrupted saves coerce to a fresh desk) */
  const [doc, setDoc] = useState<DeskDoc>(() => {
    try {
      const raw = localStorage.getItem('salvage9.desk.v1');
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<DeskDoc>;
        return {
          size: SIZE_IDS.includes(parsed.size as SizeId) ? (parsed.size as SizeId) : 'square',
          bg: typeof parsed.bg === 'string' ? parsed.bg : '#e9e4d4',
          layers: Array.isArray(parsed.layers) ? parsed.layers.filter(l => l && l.id && l.kind) : [],
        };
      }
    } catch { /* fresh desk */ }
    return freshDoc();
  });
  const docRef = useRef(doc);
  const mutate = useCallback((fn: (d: DeskDoc) => DeskDoc) => {
    setDoc(d => {
      const next = fn(d);
      docRef.current = next;
      return next;
    });
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => {
      try { localStorage.setItem('salvage9.desk.v1', JSON.stringify(doc)); } catch { /* quota */ }
    }, 600);
    return () => window.clearTimeout(t);
  }, [doc]);

  const [mode, setMode] = useState<Mode>('arrange');
  const [selId, setSelId] = useState<string | null>(null);
  const [scale, setScale] = useState(0.4);
  const [fitScale, setFitScale] = useState(0.4);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  const [liveGuides, setLiveGuides] = useState<{ xs: number[]; ys: number[] } | null>(null);
  const [brushColor, setBrushColor] = useState('#1d1912');
  const [brushSize, setBrushSize] = useState(14);
  const [cutBusy, setCutBusy] = useState(false);
  const [enginePct, setEnginePct] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [hist, setHist] = useState<DeskDoc[]>([]);

  useEffect(() => onIsoProgress(p => setEnginePct(p)), []);

  const stageRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ d0: number; s0: number } | null>(null);

  const size = SIZE_PRESETS[(doc.size as SizeId) ?? 'square'];
  const selLayer = doc.layers.find(l => l.id === selId) ?? null;

  /* prime + history push */
  useEffect(() => { primeImages(doc.layers); }, [doc.layers]);
  const pushHist = useCallback((d: DeskDoc) => {
    setHist(h => [...h.slice(-24), d]);
  }, []);

  /* fit on mount/resize (epsilon-guarded: no feedback loops) */
  useLayoutEffect(() => {
    const measure = () => {
      const el = wrapRef.current;
      if (!el) return;
      const s = Math.min((el.clientWidth - 24) / size.w, (window.innerHeight - 280) / size.h);
      const next = Math.max(0.08, Math.min(1.2, s));
      setFitScale(next);
      setScale(prev => (Math.abs(prev - next) < 0.002 ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [size.w, size.h]);

  /* render loop — one bad frame never escapes */
  useEffect(() => {
    const cvs = stageRef.current;
    if (!cvs) return;
    const cw = Math.round(size.w * scale);
    const ch = Math.round(size.h * scale);
    if (cvs.width !== cw) cvs.width = cw;
    if (cvs.height !== ch) cvs.height = ch;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    const raf = requestAnimationFrame(() => {
      try {
        drawScene(ctx, doc, scale, { selectedId: selId, guides: liveGuides });
      } catch (e) {
        console.error('[SALVAGE/9] desk frame skipped:', e);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [doc, scale, selId, liveGuides, size.w, size.h]);

  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const cvs = stageRef.current;
    const r = cvs?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  /* ---------------- pointer ops ---------------- */
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    /* two fingers → pinch the VIEW */
    if (pointersRef.current.size === 2) {
      const [p1, p2] = [...pointersRef.current.values()];
      pinchRef.current = { d0: Math.max(1, Math.hypot(p1.x - p2.x, p1.y - p2.y)), s0: scale };
      dragRef.current = null;
      return;
    }

    const pt = toCanvas(e);
    if (mode === 'ink') {
      pushHist(docRef.current);
      dragRef.current = { kind: 'draw', points: [{ x: pt.x, y: pt.y, p: e.pressure || 0.5 }] };
      return;
    }

    /* handle on selection first */
    if (selLayer) {
      const h = hitHandle(selLayer, pt.x, pt.y, 17 / scale);
      if (h === 'rot') {
        pushHist(docRef.current);
        dragRef.current = {
          kind: 'rot', id: selLayer.id, startRot: selLayer.rot, ratioLock: e.shiftKey || e.altKey,
          startAngle: (Math.atan2(pt.y - selLayer.y, pt.x - selLayer.x) * 180) / Math.PI,
        };
        return;
      }
      if (h) {
        pushHist(docRef.current);
        dragRef.current = {
          kind: 'scale', id: selLayer.id, handle: h, startW: selLayer.w, startH: layerH(selLayer),
          startDist: Math.max(4, Math.hypot(pt.x - selLayer.x, pt.y - selLayer.y)),
          ratioLock: e.shiftKey || e.altKey,
        };
        return;
      }
    }

    /* pick topmost hit */
    let picked: CollageLayer | null = null;
    for (let i = doc.layers.length - 1; i >= 0; i--) {
      if (hitLayer(doc.layers[i], pt.x, pt.y)) { picked = doc.layers[i]; break; }
    }
    setSelId(picked?.id ?? null);
    if (picked) {
      pushHist(docRef.current);
      const snap = snapTargets(doc.layers, picked.id, size.w, size.h);
      dragRef.current = { kind: 'move', id: picked.id, ox: picked.x - pt.x, oy: picked.y - pt.y, lx: pt.x, ly: pt.y, snap };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    const pn = pinchRef.current;
    if (pn && pointersRef.current.size >= 2) {
      const [p1, p2] = [...pointersRef.current.values()];
      const d1 = Math.max(1, Math.hypot(p1.x - p2.x, p1.y - p2.y));
      setScale(Math.max(0.08, Math.min(3, pn.s0 * (d1 / pn.d0))));
      return;
    }
    const dr = dragRef.current;
    if (!dr) return;
    const pt = toCanvas(e);

    if (dr.kind === 'draw') {
      dr.points.push({ x: pt.x, y: pt.y, p: e.pressure || 0.5 });
      /* live preview */
      const stroke: InkStroke = { brush: 'pen', color: brushColor, size: brushSize, points: dr.points, bounds: strokeBounds(dr.points, brushSize) };
      mutate(d => {
        const layers = d.layers.filter(l => l.id !== '__live_stroke');
        return { ...d, layers: [...layers, { ...inkLayer(stroke), id: '__live_stroke' }] };
      });
      return;
    }
    if (dr.kind === 'move') {
      let nx = pt.x + dr.ox, ny = pt.y + dr.oy;
      const gxs: number[] = [], gys: number[] = [];
      for (const gx of dr.snap.xs) if (Math.abs(nx - gx) < SNAP_R) { nx = gx; gxs.push(gx); }
      for (const gy of dr.snap.ys) if (Math.abs(ny - gy) < SNAP_R) { ny = gy; gys.push(gy); }
      setLiveGuides(gxs.length || gys.length ? { xs: gxs, ys: gys } : null);
      const id = dr.id;
      mutate(d => ({ ...d, layers: d.layers.map(l => (l.id === id ? { ...l, x: nx, y: ny } : l)) }));
      return;
    }
    if (dr.kind === 'scale') {
      const L = docRef.current.layers.find(l => l.id === dr.id);
      if (!L) return;
      const local = toLocal(L, pt.x, pt.y);
      const dist = Math.max(4, Math.hypot(local.x, local.y));
      let w = dr.startW * (dist / dr.startDist);
      let h = dr.startH * (dist / dr.startDist);
      if (dr.ratioLock) h = w / Math.max(0.05, L.aspect);
      w = Math.max(14, w);
      h = Math.max(14, h);
      const id = dr.id;
      mutate(d => ({
        ...d,
        layers: d.layers.map(l => (l.id === id ? { ...l, w, hStretch: h / (w / Math.max(0.05, l.aspect)) } : l)),
      }));
      return;
    }
    if (dr.kind === 'rot') {
      const L = docRef.current.layers.find(l => l.id === dr.id);
      if (!L) return;
      const ang = (Math.atan2(pt.y - L.y, pt.x - L.x) * 180) / Math.PI;
      let rot = dr.startRot + (ang - dr.startAngle);
      /* 15° snap near cardinals */
      const near = Math.round(rot / 15) * 15;
      if (Math.abs(rot - near) < (dr.ratioLock ? 10 : 5)) rot = near;
      const id = dr.id;
      mutate(d => ({ ...d, layers: d.layers.map(l => (l.id === id ? { ...l, rot: Math.round(rot * 10) / 10 } : l)) }));
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    const dr = dragRef.current;
    dragRef.current = null;
    setLiveGuides(null);
    if (dr?.kind === 'draw' && dr.points.length > 1) {
      const stroke: InkStroke = { brush: 'pen', color: brushColor, size: brushSize, points: dr.points, bounds: strokeBounds(dr.points, brushSize) };
      mutate(d => ({ ...d, layers: [...d.layers.filter(l => l.id !== '__live_stroke'), inkLayer(stroke)] }));
    } else if (dr?.kind === 'draw') {
      mutate(d => ({ ...d, layers: d.layers.filter(l => l.id !== '__live_stroke') }));
    }
  };

  /* ---------------- layer ops ---------------- */
  const patchLayer = (id: string, patch: Partial<CollageLayer>) =>
    mutate(d => ({ ...d, layers: d.layers.map(l => (l.id === id ? { ...l, ...patch } : l)) }));
  const removeLayer = (id: string) => {
    pushHist(docRef.current);
    mutate(d => ({ ...d, layers: d.layers.filter(l => l.id !== id) }));
    if (selId === id) setSelId(null);
  };
  const duplicateLayer = (id: string) => {
    const L = doc.layers.find(l => l.id === id);
    if (!L) return;
    pushHist(docRef.current);
    const copy = { ...L, id: newId(), x: L.x + 26, y: L.y + 26, spawnAt: Date.now() };
    mutate(d => ({ ...d, layers: [...d.layers, copy] }));
    setSelId(copy.id);
  };
  const moveZ = (id: string, dir: 1 | -1) => {
    mutate(d => {
      const i = d.layers.findIndex(l => l.id === id);
      if (i < 0) return d;
      const j = i + dir;
      if (j < 0 || j >= d.layers.length) return d;
      const layers = [...d.layers];
      [layers[i], layers[j]] = [layers[j], layers[i]];
      return { ...d, layers };
    });
  };
  const undo = () => {
    setHist(h => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      docRef.current = prev;
      setDoc(prev);
      return h.slice(0, -1);
    });
  };

  /* keyboard: del / ctrl+d / ctrl+z */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        if (selId) { e.preventDefault(); duplicateLayer(selId); }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selId) { e.preventDefault(); removeLayer(selId); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId]);

  /* ---------------- add plates ---------------- */
  const addSpecimen = (sp: Specimen) => {
    pushHist(docRef.current);
    const cx = size.w / 2 + (Math.random() - 0.5) * size.w * 0.2;
    const cy = size.h / 2 + (Math.random() - 0.5) * size.h * 0.2;
    const L = layerFromSpecimen(sp, cx, cy);
    mutate(d => ({ ...d, layers: [...d.layers, L] }));
    setSelId(L.id);
  };

  /* ---------------- cutout press ---------------- */
  const runCutout = async () => {
    if (!selLayer || selLayer.kind !== 'image' || cutBusy) return;
    const url = selLayer.cutoutSrc ? undefined : (selLayer.src ?? selLayer.fullUrl);
    if (!url) return;
    setCutBusy(true);
    try {
      const res = await isolateFromUrl(url, 'fast', 1800);
      const cutId = selLayer.id;
      pushHist(docRef.current);
      mutate(d => ({
        ...d,
        layers: d.layers.map(l => (l.id === cutId ? { ...l, cutoutSrc: res.dataUrl, aspect: res.width / res.height, name: `✂ ${l.name}`.slice(0, 42) } : l)),
      }));
      onLog('cut', `desk: subject freed from “${selLayer.name}”`);
    } catch {
      onLog('err', `desk: cutout refused — “${selLayer.name}” host blocks pixel reads`);
    } finally {
      setCutBusy(false);
    }
  };

  /* ---------------- FX rack ---------------- */
  const patchFx = (patch: Partial<GlitchParams>) => {
    if (!selId) return;
    mutate(d => ({
      ...d,
      layers: d.layers.map(l => (l.id === selId ? { ...l, fx: { ...(l.fx ?? {}), ...patch } } : l)),
    }));
  };

  /* ---------------- export ---------------- */
  const exportPng = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const canvas = await renderComposition(docRef.current, (i, n) => {
        if (i % 5 === 0 || i === n) onLog('sys', `desk: pressing ${i}/${n} layers…`);
      });
      const a = document.createElement('a');
      a.download = `salvage9-pasteup-${doc.layers.length}layers.png`;
      a.href = canvas.toDataURL('image/png');
      document.body.appendChild(a);
      a.click();
      a.remove();
      onLog('cut', `desk: paste-up pressed — ${canvas.width}×${canvas.height} ✓`);
    } catch {
      onLog('err', 'desk: press failed — canvas refused');
    } finally {
      setExporting(false);
    }
  };

  const rackOptions = tray.length > 0 ? tray.slice(-40).reverse() : feed.filter(f => f.verdict === 'pass').slice(-40).reverse();

  return (
    <main className="mx-auto max-w-[1560px] px-4 py-5 lg:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[34px] font-extrabold leading-none tracking-tight text-[var(--fg)]">
            PASTE-UP <span className="text-verm">DESK</span>
          </h2>
          <p className="mt-1 font-mono text-[10px] tracking-[0.2em] text-[var(--mut)]">
            {doc.layers.length} LAYERS · {SIZE_PRESETS[(doc.size as SizeId) ?? 'square'].label} · AUTOSAVES
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex overflow-hidden border-2 border-[var(--line)]">
            {(['arrange', 'ink'] as Mode[]).map(m => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={`px-3 py-2 font-mono text-[10.5px] font-bold tracking-[0.16em] transition-colors ${
                  mode === m ? 'bg-[var(--fg)] text-[var(--bg)]' : 'text-[var(--fg2)] hover:bg-[var(--line-soft)]'
                }`}>
                {m === 'arrange' ? '⌖ ARRANGE' : '✎ INK'}
              </button>
            ))}
          </div>
          <button type="button" onClick={undo} className="border-2 border-[var(--line)] px-3 py-2 font-mono text-[10.5px] font-bold tracking-[0.16em] text-[var(--fg2)] transition-colors hover:bg-[var(--line-soft)]">
            ↩ UNDO
          </button>
          <button type="button" onClick={() => { mutate(d => ({ ...d, layers: [...d.layers, textLayer('ANGEL TECH', '#1d1912', size.w / 2, size.h / 2)] })); }}
            className="border-2 border-[var(--line)] px-3 py-2 font-mono text-[10.5px] font-bold tracking-[0.16em] text-[var(--fg)] transition-colors hover:bg-gold hover:border-gold hover:text-black">
            + TYPE
          </button>
          <button type="button" onClick={() => { mutate(d => ({ ...d, layers: [...d.layers, colorLayer('#c6401e', size.w / 2, size.h / 2)] })); }}
            className="border-2 border-[var(--line)] px-3 py-2 font-mono text-[10.5px] font-bold tracking-[0.16em] text-[var(--fg)] transition-colors hover:bg-verm hover:border-verm hover:text-[#f5f1e3]">
            + BLOCK
          </button>
          <button type="button" onClick={exportPng} disabled={exporting || doc.layers.length === 0}
            className="border-2 border-moss bg-moss px-3 py-2 font-mono text-[10.5px] font-bold tracking-[0.16em] text-[#f5f1e3] transition-all hover:-translate-y-0.5 hover:bg-[var(--fg)] hover:border-[var(--fg)] hover:text-[var(--bg)] disabled:pointer-events-none disabled:opacity-35">
            <IcDown size={13} /> {exporting ? 'PRESSING…' : 'PRESS PNG'}
          </button>
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[280px_minmax(0,1fr)_300px]">
        {/* plate rack */}
        <section className="border-2 border-[var(--line)] bg-[var(--panel)] shadow-[4px_4px_0_var(--shadow-ink)]">
          <h3 className="border-b-2 border-[var(--line)] px-3 py-2 font-display text-[15px] font-extrabold tracking-tight text-[var(--fg)]">
            PLATE RACK · {rackOptions.length}
          </h3>
          <p className="border-b border-[var(--line-soft)] px-3 py-1.5 font-mono text-[8.5px] tracking-[0.14em] text-[var(--mut)]">
            {tray.length > 0 ? 'FROM THE TRAY' : 'FROM THE BELT'} — CLICK TO DROP ON THE MAT
          </p>
          <div className="grid max-h-[520px] grid-cols-3 gap-1.5 overflow-y-auto p-2 scroll-slim">
            {rackOptions.length === 0 ? (
              <p className="col-span-3 border border-dashed border-[var(--line)]/30 px-2 py-8 text-center font-mono text-[9px] leading-relaxed text-[var(--mut)]">
                nothing cut yet — run the crawler first
              </p>
            ) : rackOptions.map(sp => (
              <button key={sp.id} type="button" onClick={() => addSpecimen(sp)} title={sp.archetype}
                className="border-2 border-[var(--line)]/40 transition-all hover:-translate-y-0.5 hover:border-verm">
                <img src={sp.cutoutSrc ?? (sp.remote ? sp.thumb : sp.dataUri)} alt={sp.code} loading="lazy" referrerPolicy="no-referrer"
                  className={`aspect-square w-full object-cover ${sp.cutoutSrc ? 'checker' : ''}`} />
              </button>
            ))}
          </div>
        </section>

        {/* the mat */}
        <section className="desk-mat border-2 border-[var(--line)] bg-[var(--panel)] p-3 shadow-[4px_4px_0_var(--shadow-ink)]">
          <div ref={wrapRef} className="grid place-items-center overflow-hidden">
            <canvas
              ref={stageRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onContextMenu={e => e.preventDefault()}
              className="desk-stage max-w-full border border-[var(--line)]/40 shadow-[0_10px_30px_rgba(0,0,0,0.18)]"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <select
                value={doc.size}
                onChange={e => mutate(d => ({ ...d, size: e.target.value }))}
                className="border-2 border-[var(--line)] bg-[var(--panel)] px-2 py-1 font-mono text-[10px] font-bold text-[var(--fg)] outline-none"
              >
                {SIZE_IDS.map(s => <option key={s} value={s}>{SIZE_PRESETS[s].label}</option>)}
              </select>
              <label className="flex items-center gap-1.5 font-mono text-[9px] font-bold tracking-[0.14em] text-[var(--mut)]">
                MAT
                <input type="color" value={doc.bg} onChange={e => mutate(d => ({ ...d, bg: e.target.value }))}
                  className="h-6 w-8 cursor-pointer border border-[var(--line)] bg-transparent p-0" />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setScale(s => Math.max(0.08, s / 1.2))} className="border border-[var(--line)] px-2 py-1 font-mono text-[10px] font-bold text-[var(--fg2)] hover:bg-[var(--line-soft)]">−</button>
              <span className="min-w-[44px] text-center font-mono text-[9.5px] font-bold tabular-nums text-[var(--fg2)]">{Math.round(scale * 100)}%</span>
              <button type="button" onClick={() => setScale(s => Math.min(3, s * 1.2))} className="border border-[var(--line)] px-2 py-1 font-mono text-[10px] font-bold text-[var(--fg2)] hover:bg-[var(--line-soft)]">+</button>
              <button type="button" onClick={() => setScale(fitScale)} className="border border-[var(--line)] px-2 py-1 font-mono text-[9px] font-bold tracking-[0.14em] text-[var(--fg2)] hover:bg-[var(--line-soft)]">FIT</button>
            </div>
          </div>
          {mode === 'ink' && (
            <div className="mt-2 flex items-center gap-3 border-t border-[var(--line-soft)] pt-2">
              <label className="flex items-center gap-1.5 font-mono text-[9px] font-bold tracking-[0.14em] text-[var(--mut)]">
                INK
                <input type="color" value={brushColor} onChange={e => setBrushColor(e.target.value)}
                  className="h-6 w-8 cursor-pointer border border-[var(--line)] bg-transparent p-0" />
              </label>
              <label className="flex flex-1 items-center gap-2 font-mono text-[9px] font-bold tracking-[0.14em] text-[var(--mut)]">
                {brushSize}px
                <input type="range" min={2} max={60} value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} className="gate-range w-full" />
              </label>
            </div>
          )}
          <p className="mt-2 font-mono text-[8.5px] leading-relaxed tracking-[0.12em] text-[var(--mut)]">
            {mode === 'arrange'
              ? 'DRAG move · CORNERS free-stretch (SHIFT locks ratio) · STEM rotates (15° snap) · PINCH zoom view · DEL removes · CTRL+D duplicates · CTRL+Z undo'
              : 'draw directly on the mat — strokes become layers. two fingers zoom the view.'}
          </p>
        </section>

        {/* layer stack + inspector */}
        <section className="border-2 border-[var(--line)] bg-[var(--panel)] shadow-[4px_4px_0_var(--shadow-ink)]">
          <h3 className="border-b-2 border-[var(--line)] px-3 py-2 font-display text-[15px] font-extrabold tracking-tight text-[var(--fg)]">
            LAYER STACK
          </h3>
          <div className="max-h-[220px] overflow-y-auto scroll-slim">
            {doc.layers.length === 0 && (
              <p className="px-3 py-6 text-center font-mono text-[9px] leading-relaxed text-[var(--mut)]">
                the mat is bare — drop a plate or draw on it
              </p>
            )}
            {[...doc.layers].reverse().map(L => (
              <button key={L.id} type="button" onClick={() => setSelId(L.id)}
                className={`flex w-full items-center gap-2 border-b border-[var(--line-soft)] px-3 py-1.5 text-left transition-colors ${
                  selId === L.id ? 'bg-verm/15' : 'hover:bg-[var(--line-soft)]'
                }`}>
                <span className="w-9 shrink-0 border border-[var(--line)]/40 bg-[var(--bg)] font-mono text-[8px] font-bold uppercase text-[var(--fg2)]">
                  {L.kind === 'image' ? (L.cutoutSrc ? '✂img' : 'img') : L.kind === 'ink' ? 'ink' : L.kind.slice(0, 3)}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-semibold text-[var(--fg)]">
                  {L.name}{fxActive(L.fx) ? ' · FX' : ''}
                </span>
                <span className="flex shrink-0 gap-1">
                  <span role="button" tabIndex={-1} onClick={e => { e.stopPropagation(); moveZ(L.id, 1); }}
                    className="cursor-pointer border border-[var(--line)]/40 px-1 font-mono text-[8px] font-bold text-[var(--fg2)] hover:bg-[var(--line-soft)]" title="raise">▲</span>
                  <span role="button" tabIndex={-1} onClick={e => { e.stopPropagation(); moveZ(L.id, -1); }}
                    className="cursor-pointer border border-[var(--line)]/40 px-1 font-mono text-[8px] font-bold text-[var(--fg2)] hover:bg-[var(--line-soft)]" title="lower">▼</span>
                  <span role="button" tabIndex={-1} onClick={e => { e.stopPropagation(); removeLayer(L.id); }}
                    className="cursor-pointer border border-verm/50 px-1 font-mono text-[8px] font-bold text-verm hover:bg-verm hover:text-[#f5f1e3]" title="remove"><IcX size={8} /></span>
                </span>
              </button>
            ))}
          </div>

          {selLayer && (
            <div className="border-t-2 border-[var(--line)] px-3 py-2.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="truncate font-display text-[13px] font-bold text-[var(--fg)]">{selLayer.name}</span>
                <span className="shrink-0 font-mono text-[8.5px] font-bold tracking-[0.16em] text-[var(--mut)]">
                  {Math.round(selLayer.w)}×{Math.round(layerH(selLayer))} · {selLayer.rot}°
                </span>
              </div>

              {selLayer.kind === 'image' && !selLayer.cutoutSrc && (
                <button type="button" onClick={runCutout} disabled={cutBusy}
                  className="mb-2 w-full border-2 border-verm bg-verm px-2 py-1.5 font-mono text-[9.5px] font-bold tracking-[0.16em] text-[#f5f1e3] transition-colors hover:bg-[var(--fg)] hover:border-[var(--fg)] disabled:pointer-events-none disabled:opacity-40">
                  {cutBusy ? (enginePct !== null ? `⚙ ENGINE ${enginePct}%` : '✂ CUTTING…') : '✂ AUTO CUTOUT'}
                </button>
              )}
              {selLayer.kind === 'image' && selLayer.cutoutSrc && (
                <div className="mb-2 flex items-center gap-1.5 border border-verm/50 bg-verm/10 px-2 py-1 font-mono text-[8.5px] font-bold tracking-[0.16em] text-verm">
                  <IcScissors size={11} /> SUBJECT ISOLATED
                </div>
              )}

              <label className="mb-1 flex items-center justify-between font-mono text-[9px] font-bold tracking-[0.18em] text-[var(--mut)]">
                OPACITY <span className="tabular-nums text-[var(--fg2)]">{Math.round(selLayer.opacity * 100)}%</span>
              </label>
              <input type="range" min={5} max={100} value={Math.round(selLayer.opacity * 100)}
                onChange={e => patchLayer(selLayer.id, { opacity: Number(e.target.value) / 100 })}
                className="gate-range mb-2 w-full" />

              <div className="mb-2 flex flex-wrap gap-1">
                {(Object.keys(BLEND_LABELS) as Blend[]).map(b => (
                  <button key={b} type="button" onClick={() => patchLayer(selLayer.id, { blend: b })}
                    className={`border px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-[0.1em] transition-colors ${
                      selLayer.blend === b ? 'border-ultra bg-ultra text-[#f5f1e3]' : 'border-[var(--line)]/40 text-[var(--fg2)] hover:border-ultra'
                    }`}>
                    {BLEND_LABELS[b]}
                  </button>
                ))}
              </div>

              {selLayer.kind === 'image' && (
                <div className="border-t border-[var(--line-soft)] pt-2">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="font-mono text-[9px] font-bold tracking-[0.22em] text-[var(--mut)]">
                      FX BENCH {fxActive(selLayer.fx) ? `· SEED ${selLayer.fx?.seed ?? 7}` : ''}
                    </span>
                    <span className="flex gap-1">
                      <button type="button" onClick={() => patchFx({ seed: Math.floor(Math.random() * 99999) })}
                        className="border border-[var(--line)]/40 px-1.5 py-0.5 font-mono text-[8px] font-bold text-[var(--fg2)] hover:bg-gold hover:border-gold hover:text-black">⟳</button>
                      <button type="button" onClick={() => patchLayer(selLayer.id, { fx: undefined })}
                        className="border border-[var(--line)]/40 px-1.5 py-0.5 font-mono text-[8px] font-bold text-[var(--fg2)] hover:bg-verm hover:border-verm hover:text-[#f5f1e3]">CLEAR</button>
                    </span>
                  </div>
                  <div className="grid max-h-[300px] grid-cols-2 gap-x-3 gap-y-1.5 overflow-y-auto pr-1 scroll-slim">
                    {CHANNELS.slice(1, 13).map(c => (
                      <label key={c.key} className="block">
                        <span className="mb-0.5 flex justify-between font-mono text-[8px] font-bold tracking-[0.12em] text-[var(--mut)]">
                          {c.label}
                          <span className="tabular-nums text-[var(--fg2)]">{(selLayer.fx?.[c.key] as number) ?? 0}</span>
                        </span>
                        <input type="range" min={c.min} max={c.max} value={(selLayer.fx?.[c.key] as number) ?? 0}
                          onChange={e => patchFx({ [c.key]: Number(e.target.value) } as Partial<GlitchParams>)}
                          className="gate-range w-full" />
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-2 flex gap-1.5 border-t border-[var(--line-soft)] pt-2">
                <button type="button" onClick={() => duplicateLayer(selLayer.id)}
                  className="flex-1 border-2 border-[var(--line)] px-2 py-1.5 font-mono text-[9px] font-bold tracking-[0.14em] text-[var(--fg)] transition-colors hover:bg-ultra hover:border-ultra hover:text-[#f5f1e3]">
                  DUPLICATE
                </button>
                <button type="button" onClick={() => removeLayer(selLayer.id)}
                  className="flex-1 border-2 border-verm px-2 py-1.5 font-mono text-[9px] font-bold tracking-[0.14em] text-verm transition-colors hover:bg-verm hover:text-[#f5f1e3]">
                  <IcTrash size={11} /> REMOVE
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
