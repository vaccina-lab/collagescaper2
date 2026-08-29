import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Specimen } from '../lib/types';
import type { LogLine } from '../lib/engine';
import {
  CHANNELS, DEFAULT_PARAMS, PRESETS, exportDims, renderGlitch, stageDims,
  type GlitchParams, type Pipeline,
} from '../lib/glitch';

type Mode = 'belt' | 'tray' | 'file';

function Slider({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 flex items-center justify-between font-mono text-[9px] font-bold tracking-[0.18em] text-[var(--mut)]">
        {label}
        <span className={`tabular-nums ${value > 0 ? 'text-verm' : value < 0 ? 'text-ultra' : 'text-[var(--fg2)]'}`}>
          {value > 0 ? `+${value}` : value}
        </span>
      </span>
      <input
        type="range" min={min} max={max} step={1} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="gate-range w-full"
      />
    </label>
  );
}

export function GlitchLab({ feed, tray, zap, onLog }: {
  feed: Specimen[]; tray: Specimen[];
  zap: { sp: Specimen; n: number } | null;
  onLog: (level: LogLine['level'], msg: string) => void;
}) {
  const [mode, setMode] = useState<Mode>('belt');
  const [src, setSrc] = useState<{ el: HTMLImageElement; w: number; h: number; label: string } | null>(null);
  const [params, setParams] = useState<GlitchParams>(DEFAULT_PARAMS);
  const [pipe, setPipe] = useState<Pipeline>('pixel');
  const [flick, setFlick] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const beltOptions = useMemo(
    () => feed.filter(f => f.state === 'judged' && f.verdict === 'pass').slice(-60),
    [feed],
  );
  const trayOptions = tray;

  const adopt = useCallback((sp: Specimen) => {
    const url = sp.cutoutSrc ?? (sp.remote ? sp.thumb || sp.dataUri : sp.dataUri);
    const img = new Image();
    if (/^https?:/i.test(url)) { img.crossOrigin = 'anonymous'; }
    img.referrerPolicy = 'no-referrer';
    img.onload = () => setSrc({ el: img, w: img.naturalWidth, h: img.naturalHeight, label: sp.code });
    img.onerror = () => onLog('err', `lab: ${sp.code} refused to load (host blocks pixel reads)`);
    img.src = url;
  }, [onLog]);

  /* a ZAP from the belt lands here pre-loaded */
  useEffect(() => {
    if (zap) {
      setMode('belt');
      adopt(zap.sp);
    }
  }, [zap, adopt]);

  const onFile = (f: File | undefined) => {
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      setSrc({ el: img, w: img.naturalWidth, h: img.naturalHeight, label: f.name });
      setMode('file');
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  /* render — one bad frame must never escape */
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
      } catch (e) {
        console.error('[SALVAGE/9] lab frame skipped:', e);
      }
      const wrap = stageWrapRef.current;
      if (wrap && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        wrap.animate(
          [
            { transform: 'translateX(-2px) skewX(-0.4deg)', filter: 'brightness(1.35) saturate(1.4)' },
            { transform: 'translateX(1px)', filter: 'brightness(0.9)' },
            { transform: 'none', filter: 'none' },
          ],
          { duration: 170, easing: 'steps(2, end)' },
        );
      }
      setFlick(f => (f + 1) % 1000);
    });
    return () => cancelAnimationFrame(raf);
  }, [src, params]);
  void flick;

  const set = (patch: Partial<GlitchParams>) => setParams(p => ({ ...p, ...patch }));
  const reroll = () => set({ seed: Math.floor(Math.random() * 99999) });
  const signed = (span: number) => Math.floor((Math.random() * 2 - 1) * span);
  const chaos = () => setParams({
    damage: 20 + Math.floor(Math.random() * 80),
    rgb: signed(100), slice: signed(100), block: signed(100), grain: signed(80),
    scan: signed(80), sort: signed(70), wave: signed(80), smear: signed(80),
    echo: signed(70), crush: signed(60), hue: signed(100), chem: signed(70),
    drain: signed(90), mosaic: signed(70), mirror: signed(60),
    warp: signed(70), liquify: signed(70), swirl: signed(70), melt: signed(70),
    bloom: signed(60), vig: signed(60), duo: signed(60), emboss: signed(60),
    seed: Math.floor(Math.random() * 99999),
  });

  const exportPng = () => {
    if (!src) return;
    try {
      const { w, h } = exportDims(src.w, src.h);
      const { canvas } = renderGlitch(src, w, h, params);
      const a = document.createElement('a');
      a.download = `glitch-${src.label.replace(/[^a-z0-9.-]/gi, '_')}-s${params.seed}.png`;
      a.href = canvas.toDataURL('image/png');
      document.body.appendChild(a);
      a.click();
      a.remove();
      onLog('sys', `lab: ${src.label} damaged & exported @ ${w}×${h} (seed ${params.seed})`);
    } catch {
      onLog('err', 'lab: export failed — canvas refused');
    }
  };

  const thumbBtn = (sp: Specimen, key: string) => {
    const active = src?.label === sp.code;
    return (
      <button
        key={key}
        type="button"
        onClick={() => adopt(sp)}
        className={`relative border-2 transition-all duration-150 hover:-translate-y-0.5 ${
          active ? 'border-verm shadow-[2px_2px_0_var(--shadow-ink)]' : 'border-[var(--line)]/40 hover:border-[var(--line)]'
        }`}
        title={sp.archetype}
      >
        <img
          src={sp.cutoutSrc ?? (sp.remote ? sp.thumb : sp.dataUri)}
          alt={sp.code}
          loading="lazy"
          referrerPolicy="no-referrer"
          className={`aspect-square w-full object-cover ${sp.cutoutSrc ? 'checker' : ''}`}
        />
        <span className="absolute bottom-0 left-0 right-0 truncate bg-[var(--fg)]/80 px-1 py-px text-left font-mono text-[7.5px] font-bold text-[var(--bg)]">
          {sp.code}
        </span>
      </button>
    );
  };

  return (
    <main className="mx-auto max-w-[1560px] px-4 py-5 lg:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[34px] font-extrabold leading-none tracking-tight text-[var(--fg)]">
            GLITCH <span className="text-verm">LAB</span>
          </h2>
          <p className="mt-1 font-mono text-[10px] tracking-[0.2em] text-[var(--mut)]">
            24 SIGNED CHANNELS · SEEDED · {pipe === 'pixel' ? 'PIXEL PIPE' : 'COMPOSITE PIPE'}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={reroll} className="border-2 border-[var(--line)] px-3 py-1.5 font-mono text-[10.5px] font-bold tracking-[0.16em] text-[var(--fg)] transition-all hover:-translate-y-0.5 hover:bg-gold hover:border-gold hover:text-black">
            ⟳ SEED {params.seed}
          </button>
          <button type="button" onClick={chaos} className="border-2 border-verm bg-verm px-3 py-1.5 font-mono text-[10.5px] font-bold tracking-[0.16em] text-[#f5f1e3] transition-all hover:-translate-y-0.5 hover:bg-[var(--fg)] hover:border-[var(--fg)] hover:text-[var(--bg)]">
            FULL CHAOS
          </button>
          <button type="button" onClick={exportPng} disabled={!src} className="border-2 border-moss bg-moss px-3 py-1.5 font-mono text-[10.5px] font-bold tracking-[0.16em] text-[#f5f1e3] transition-all hover:-translate-y-0.5 hover:bg-[var(--fg)] hover:border-[var(--fg)] hover:text-[var(--bg)] disabled:pointer-events-none disabled:opacity-35">
            EXPORT PNG
          </button>
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        {/* source rack */}
        <section className="border-2 border-[var(--line)] bg-[var(--panel)] shadow-[4px_4px_0_var(--shadow-ink)]">
          <div className="flex border-b-2 border-[var(--line)]">
            {(['belt', 'tray', 'file'] as Mode[]).map(m => (
              <button
                key={m} type="button" onClick={() => { setMode(m); if (m === 'file') fileRef.current?.click(); }}
                className={`flex-1 px-2 py-2 font-mono text-[10px] font-bold tracking-[0.16em] transition-colors ${
                  mode === m ? 'bg-[var(--fg)] text-[var(--bg)]' : 'text-[var(--fg2)] hover:bg-[var(--line-soft)]'
                }`}
              >
                {m === 'belt' ? 'BELT' : m === 'tray' ? `TRAY · ${trayOptions.length}` : 'PC FILE'}
              </button>
            ))}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
          <div className="grid max-h-[560px] grid-cols-3 gap-1.5 overflow-y-auto p-2 scroll-slim">
            {(mode === 'tray' ? trayOptions : beltOptions).length === 0 ? (
              <p className="col-span-3 border border-dashed border-[var(--line)]/30 px-2 py-8 text-center font-mono text-[9px] leading-relaxed text-[var(--mut)]">
                {mode === 'tray' ? 'the tray is empty — cut something first' : 'nothing judged on the belt yet'}
              </p>
            ) : (
              (mode === 'tray' ? trayOptions : beltOptions).map(sp => thumbBtn(sp, sp.id))
            )}
          </div>
        </section>

        {/* stage */}
        <section className="border-2 border-[var(--line)] bg-[#15120c] shadow-[4px_4px_0_var(--shadow-ink)]">
          <div ref={stageWrapRef} className="grid min-h-[420px] place-items-center p-4">
            {src ? (
              <canvas ref={canvasRef} className="max-w-full border border-paper/20" />
            ) : (
              <div className="px-6 py-16 text-center">
                <div className="font-display text-2xl font-extrabold text-paper/85">FEED ME A PLATE.</div>
                <p className="mx-auto mt-2 max-w-[380px] font-mono text-[10.5px] leading-relaxed text-paper/50">
                  pick one from the belt or tray, zap it from the intake, or drop a file
                  from your machine. then start twisting.
                </p>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-paper/15 px-3 py-1.5 font-mono text-[8.5px] tracking-[0.18em] text-paper/45">
            <span>{src ? src.label.toUpperCase() : 'NO SIGNAL'}</span>
            <span className={pipe === 'pixel' ? 'text-[#7ebe5c]' : 'text-gold'}>
              {pipe === 'pixel' ? 'PIXEL PIPE' : 'COMPOSITE PIPE · SORT/CRUSH/DUO/EMBOSS DEGRADED'}
            </span>
          </div>
        </section>

        {/* channel rack */}
        <section className="border-2 border-[var(--line)] bg-[var(--panel)] shadow-[4px_4px_0_var(--shadow-ink)]">
          <h3 className="border-b-2 border-[var(--line)] px-3 py-2 font-display text-[15px] font-extrabold tracking-tight text-[var(--fg)]">
            CHANNEL RACK
          </h3>
          <div className="flex flex-wrap gap-1.5 border-b border-[var(--line-soft)] px-3 py-2">
            {PRESETS.map(p => (
              <button
                key={p.name} type="button"
                onClick={() => setParams(prev => ({ ...DEFAULT_PARAMS, ...p.p, seed: prev.seed }))}
                className="border border-[var(--line)]/50 px-1.5 py-0.5 font-mono text-[8.5px] font-bold tracking-[0.12em] text-[var(--fg2)] transition-colors hover:border-verm hover:bg-verm hover:text-[#f5f1e3]"
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="grid max-h-[520px] grid-cols-1 gap-x-4 gap-y-2 overflow-y-auto px-3 py-3 scroll-slim sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {CHANNELS.map(c => (
              <Slider
                key={c.key}
                label={c.label}
                value={params[c.key]}
                min={c.min}
                max={c.max}
                onChange={v => set({ [c.key]: v } as Partial<GlitchParams>)}
              />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
