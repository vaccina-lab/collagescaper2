import { useCallback, useEffect, useRef, useState } from 'react';
import type { Specimen } from '../lib/types';
import type { LogLine } from '../lib/engine';
import { renderGlitch, stageDims, DEFAULT_PARAMS, CHANNELS, PRESETS, type GlitchParams } from '../lib/glitch';
import { IcDown } from './ui';

export function GlitchLab({ feed, tray, zap, onLog }: {
  feed: Specimen[]; tray: Specimen[]; zap: { sp: Specimen; n: number } | null; onLog: (level: LogLine['level'], msg: string) => void;
}) {
  const sources = tray.length > 0 ? tray : feed.filter(f => f.verdict === 'pass');
  const [srcId, setSrcId] = useState<string | null>(null);
  const [params, setParams] = useState<GlitchParams>(DEFAULT_PARAMS);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const src = sources.find(s => s.id === srcId) ?? sources[0] ?? null;

  useEffect(() => { if (zap?.sp) setSrcId(zap.sp.id); }, [zap]);

  const draw = useCallback(() => {
    const cvs = canvasRef.current;
    const img = imgRef.current;
    if (!cvs || !img) return;
    const { w, h } = stageDims(img.naturalWidth, img.naturalHeight);
    cvs.width = w; cvs.height = h;
    const { canvas } = renderGlitch({ el: img, w: img.naturalWidth, h: img.naturalHeight }, w, h, params);
    const ctx = cvs.getContext('2d');
    if (ctx) { ctx.clearRect(0, 0, w, h); ctx.drawImage(canvas, 0, 0); }
  }, [params, srcId, src]);

  useEffect(() => {
    if (!src) { imgRef.current = null; return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imgRef.current = img; draw(); };
    img.src = src.thumb || src.dataUri;
  }, [src, draw]);

  useEffect(() => { draw(); }, [draw]);

  const set = (patch: Partial<GlitchParams>) => setParams(p => ({ ...p, ...patch }));
  const reroll = () => set({ seed: Math.floor(Math.random() * 1e6) });
  const chaos = () => {
    const next = { ...DEFAULT_PARAMS, seed: Math.floor(Math.random() * 1e6) };
    for (const ch of CHANNELS) {
      if (ch.key === 'seed') continue;
      next[ch.key] = Math.random() < 0.4 ? 0 : Math.floor((Math.random() * 2 - 1) * 90);
    }
    setParams(next);
    onLog('sys', 'glitch lab: full chaos rolled');
  };
  const exportPng = () => {
    const cvs = canvasRef.current;
    if (!cvs || !src) return;
    const a = document.createElement('a');
    a.download = `${src.code}-glitch.png`;
    a.href = cvs.toDataURL('image/png');
    document.body.appendChild(a); a.click(); a.remove();
    onLog('cut', `glitch lab: exported ${src.code}`);
  };

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6 lg:px-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[28px] font-extrabold leading-none tracking-tight text-[var(--fg)]">GLITCH LAB</h2>
          <p className="mt-1 font-mono text-[9px] tracking-[0.2em] text-[var(--mut)]">16 SIGNED CHANNELS · SEEDED</p>
        </div>
        <div className="flex gap-1.5">
          <button type="button" onClick={reroll} className="border-2 border-[var(--line)] px-2.5 py-1.5 font-mono text-[9px] font-bold tracking-widest text-[var(--fg)] hover:bg-[var(--fg)] hover:text-[var(--bg)]">⟳ SEED</button>
          <button type="button" onClick={chaos} className="border-2 border-verm bg-verm px-2.5 py-1.5 font-mono text-[9px] font-bold tracking-widest text-[#f5f1e3] hover:opacity-85">CHAOS</button>
          <button type="button" onClick={exportPng} className="border-2 border-moss bg-moss px-2.5 py-1.5 font-mono text-[9px] font-bold tracking-widest text-[#f5f1e3] hover:opacity-85"><IcDown size={11} /> PNG</button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="border-2 border-[var(--line)] bg-[var(--panel)] p-3 shadow-[4px_4px_0_var(--shadow-ink)]">
          <div className="mb-2 font-mono text-[9px] font-bold tracking-[0.2em] text-[var(--mut)]">SOURCE</div>
          <div className="mb-3 flex max-h-40 flex-wrap gap-1 overflow-y-auto scroll-slim">
            {sources.slice(0, 24).map(s => (
              <button key={s.id} type="button" onClick={() => setSrcId(s.id)}
                className={`h-12 w-12 overflow-hidden border-2 ${src?.id === s.id ? 'border-verm' : 'border-transparent opacity-60 hover:opacity-100'}`}>
                <img src={s.thumb || s.dataUri} alt={s.code} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
          <div className="mb-1 flex flex-wrap gap-1">
            {PRESETS.map(pr => (
              <button key={pr.name} type="button" onClick={() => setParams({ ...DEFAULT_PARAMS, ...pr.p, seed: params.seed })}
                className="border border-[var(--line)] px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-wider text-[var(--fg2)] hover:bg-[var(--fg)] hover:text-[var(--bg)]">
                {pr.name}
              </button>
            ))}
          </div>
          <div className="mt-3 flex max-h-[46vh] flex-col gap-2 overflow-y-auto pr-1 scroll-slim">
            {CHANNELS.map(ch => (
              <label key={ch.key} className="block">
                <div className="flex justify-between font-mono text-[8.5px] font-bold tracking-wider text-[var(--fg2)]">
                  <span>{ch.label}</span>
                  <span className="tabular-nums text-[var(--mut)]">{params[ch.key]}</span>
                </div>
                <input type="range" min={ch.min} max={ch.max} step={1} value={params[ch.key]}
                  onChange={e => set({ [ch.key]: Number(e.target.value) } as Partial<GlitchParams>)}
                  className="gate-range w-full" />
              </label>
            ))}
          </div>
        </div>
        <div className="flex min-h-[420px] items-center justify-center border-2 border-[var(--line)] bg-[#15120c] p-4 shadow-[4px_4px_0_var(--shadow-ink)]">
          {src ? <canvas ref={canvasRef} className="max-h-[70vh] max-w-full" /> : (
            <p className="font-mono text-[11px] text-[#8a8270]">cut something to the tray, then zap it here</p>
          )}
        </div>
      </div>
    </main>
  );
}

export function CollageDesk({ tray, onLog }: { tray: Specimen[]; onLog: (level: LogLine['level'], msg: string) => void }) {
  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6 lg:px-6">
      <h2 className="font-display text-[28px] font-extrabold leading-none tracking-tight text-[var(--fg)]">PASTE-UP DESK</h2>
      <p className="mt-1 font-mono text-[9px] tracking-[0.2em] text-[var(--mut)]">{tray.length} CUTS AVAILABLE · DRAG TO COMPOSE</p>
      <div className="mt-4 flex min-h-[420px] items-center justify-center border-2 border-dashed border-[var(--line-soft)] bg-[var(--panel)]">
        <p className="font-mono text-[11px] text-[var(--mut)]">compose layer · isolate · export</p>
      </div>
    </main>
  );
}

export function BrushForge({ onLog }: { onLog: (level: LogLine['level'], msg: string) => void }) {
  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6 lg:px-6">
      <h2 className="font-display text-[28px] font-extrabold leading-none tracking-tight text-[var(--fg)]">BRUSH FORGE</h2>
      <p className="mt-1 font-mono text-[9px] tracking-[0.2em] text-[var(--mut)]">DROP A PROCREATE .BRUSHSET · FORGE GLITCH BRUSHES</p>
      <div className="mt-4 flex min-h-[420px] items-center justify-center border-2 border-dashed border-[var(--line-soft)] bg-[var(--panel)]">
        <p className="font-mono text-[11px] text-[var(--mut)]">drop a .brushset template to begin</p>
      </div>
    </main>
  );
}
