import { useCallback, useEffect, useRef, useState } from 'react';
import type { Specimen } from '../lib/types';
import { FAMILY_LABEL } from '../lib/engine';
import { IcDown, IcScissors, IcTrash, IcX, Meter, SourceChip, Stamp } from './ui';

/* interactive pan/zoom viewer */
function ZoomStage({ sp }: { sp: Specimen }) {
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  useEffect(() => {
    setZoom(1);
    setPos({ x: 0, y: 0 });
  }, [sp.id]);

  const clampZoom = (z: number) => Math.max(0.4, Math.min(10, z));
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => clampZoom(z * (e.deltaY > 0 ? 0.9 : 1.1)));
  }, []);
  const onDouble = () => setZoom(z => (z > 1.4 ? 1 : 2.6));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '=') setZoom(z => clampZoom(z * 1.2));
      else if (e.key === '-') setZoom(z => clampZoom(z / 1.2));
      else if (e.key === '0') { setZoom(1); setPos({ x: 0, y: 0 }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const src = sp.cutoutSrc ?? (sp.remote ? sp.fullUrl || sp.thumb : sp.dataUri);

  return (
    <div
      className="relative grid h-full min-h-[320px] w-full cursor-grab place-items-center overflow-hidden bg-[#15120c] active:cursor-grabbing"
      onWheel={onWheel}
      onDoubleClick={onDouble}
      onPointerDown={e => {
        drag.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y };
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={e => {
        if (!drag.current) return;
        setPos({ x: drag.current.x + (e.clientX - drag.current.px), y: drag.current.y + (e.clientY - drag.current.py) });
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
    >
      <img
        src={src}
        alt={`${sp.archetype} — ${sp.code}`}
        referrerPolicy="no-referrer"
        draggable={false}
        onError={e => {
          const el = e.target as HTMLImageElement;
          if (sp.thumb && el.src !== sp.thumb) el.src = sp.thumb;
        }}
        className={`max-h-full max-w-full select-none ${sp.cutoutSrc ? 'checker' : ''}`}
        style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})`, transition: drag.current ? 'none' : 'transform 120ms ease-out' }}
      />
      <div className="pointer-events-none absolute bottom-2 left-2 border border-paper/25 bg-ink/70 px-2 py-1 font-mono text-[9px] tracking-[0.18em] text-paper/80">
        {Math.round(zoom * 100)}% · {sp.w}×{sp.h} · {(sp.sourceName || sp.provider || 'MIRROR').toUpperCase()}
      </div>
      <div className="pointer-events-none absolute right-2 top-2 flex gap-1">
        {[['−', () => setZoom(z => clampZoom(z / 1.2))], ['+', () => setZoom(z => clampZoom(z * 1.2))], ['FIT', () => { setZoom(1); setPos({ x: 0, y: 0 }); }]].map(([label, fn]) => (
          <button
            key={label as string}
            type="button"
            onClick={fn as () => void}
            className="pointer-events-auto border border-paper/30 bg-ink/70 px-2 py-1 font-mono text-[9px] font-bold text-paper/90 hover:bg-verm"
          >
            {label as string}
          </button>
        ))}
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--line-soft)] py-1.5">
      <span className="shrink-0 font-mono text-[9px] font-semibold tracking-[0.24em] text-[var(--mut)]">{k}</span>
      <span className="min-w-0 break-words text-right font-mono text-[12px] font-semibold text-[var(--fg)]">{children}</span>
    </div>
  );
}

export function Lightbox({ sp, inTray, onClose, onCut, onBin, onDownload }: {
  sp: Specimen; inTray: boolean;
  onClose: () => void; onCut: () => void; onBin: () => void; onDownload: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', h);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const rejected = sp.verdict === 'reject';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true">
      <button type="button" aria-label="close" onClick={onClose} className="absolute inset-0 cursor-zoom-out bg-ink/85" />
      <div className="anim-rise relative grid max-h-[92vh] w-full max-w-4xl grid-cols-1 overflow-y-auto border-2 border-paper bg-[var(--panel)] text-[var(--fg)] shadow-[8px_8px_0_rgba(0,0,0,0.4)] md:grid-cols-[1.35fr_1fr] scroll-slim">
        <ZoomStage sp={sp} />

        <div className="flex flex-col p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-mono text-[19px] font-bold tracking-tight">{sp.code}</div>
              <div className="mt-0.5 font-display text-[14px] font-medium italic text-[var(--fg2)]">“{sp.archetype}”</div>
            </div>
            <button type="button" onClick={onClose} aria-label="close"
              className="border-2 border-[var(--line)] p-1.5 text-[var(--fg)] transition-colors hover:bg-[var(--fg)] hover:text-[var(--bg)]">
              <IcX size={14} />
            </button>
          </div>

          <div className="mt-3">
            <Row k="SOURCE">
              {sp.srcCode} <span className="text-[var(--mut)]">· {FAMILY_LABEL[sp.family] ?? sp.family.toUpperCase()}</span>
            </Row>
            <Row k="INTAKE">
              <span className={sp.remote ? 'text-moss' : 'text-gold'}>
                {sp.remote ? `LIVE PULL · ${(sp.sourceName || sp.provider || '').toUpperCase()}` : 'LOCAL'}
              </span>
            </Row>
            <Row k="QUALITY">
              <span className="inline-flex items-center gap-2">
                <Meter score={sp.score} />
                <span className={`tabular-nums ${sp.score >= 80 ? 'text-ultra' : sp.score >= 60 ? 'text-moss' : 'text-verm'}`}>{sp.score}</span>
                <span className="text-[8px] font-medium tracking-[0.1em] text-[var(--mut)]">MEASURED</span>
              </span>
            </Row>
            {sp.cutScore !== undefined && (
              <Row k="CUT GRADE">
                <span className={`tabular-nums ${sp.cutScore >= 60 ? 'text-ultra' : 'text-gold'}`}>{sp.cutScore}</span>
                <span className="ml-1 text-[8px] font-medium tracking-[0.1em] text-[var(--mut)]">ISOLATION SCALE</span>
              </Row>
            )}
            <Row k="ISOLATION">
              <span className={sp.cutoutSrc ? 'text-verm' : sp.isoState === 'fullframe' ? 'text-gold' : 'text-[var(--mut)]'}>
                {sp.cutoutSrc
                  ? 'SUBJECT FREED ✂'
                  : sp.isoState === 'work' ? 'CUTTING…'
                  : sp.isoState === 'queue' ? 'QUEUED'
                  : sp.isoState === 'fullframe' ? 'KEPT WHOLE — WOULDN’T ISOLATE CLEANLY'
                  : 'FULL FRAME'}
              </span>
            </Row>
            <Row k="VERDICT">
              <span className={rejected ? 'text-verm' : 'text-ultra'}>
                {sp.state === 'incoming' ? 'PENDING…' : rejected ? 'BINNED' : 'PASSED THE GATE'}
              </span>
            </Row>
            <Row k="PLATE">{sp.w} × {sp.h}px</Row>
            {sp.credit && <Row k="CREDIT">{sp.credit}</Row>}
            {sp.license && <Row k="LICENSE">{sp.license}</Row>}
            {sp.pageUrl && (
              <Row k="ORIGIN">
                <a href={sp.pageUrl} target="_blank" rel="noopener noreferrer"
                  className="text-ultra underline decoration-2 underline-offset-2 hover:text-verm">
                  open original ↗
                </a>
              </Row>
            )}
          </div>

          {sp.why && sp.why.length > 0 && (
            <div className="mt-3 border border-[var(--line-soft)] bg-[var(--bg)]/50 px-2 py-1.5">
              <div className="font-mono text-[8.5px] font-bold tracking-[0.24em] text-[var(--mut)]">METRICS</div>
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[9.5px] text-[var(--fg2)]">
                {sp.why.map((w, i) => <span key={i}>{w}</span>)}
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            <SourceChip code={sp.srcCode} hue={sp.srcHue} />
            {sp.tags.map(t => (
              <span key={t} className="border border-[var(--line)]/30 px-1.5 py-px font-mono text-[9px] tracking-[0.12em] text-[var(--fg2)]">
                {t.toUpperCase()}
              </span>
            ))}
          </div>

          <div className="flex-1" />

          <div className="mt-5 flex flex-col gap-2">
            {rejected ? (
              <button type="button" onClick={onCut}
                className="flex items-center justify-center gap-2 border-2 border-verm bg-verm px-3 py-2.5 font-mono text-[12px] font-bold tracking-[0.18em] text-[#f5f1e3] transition-all hover:-translate-y-0.5 hover:bg-[var(--panel)] hover:text-verm">
                <IcScissors size={14} /> OVERRIDE → CUT TO TRAY
              </button>
            ) : inTray ? (
              <div className="flex items-center justify-center gap-2 border-2 border-ultra/50 bg-ultra/10 px-3 py-2.5 font-mono text-[12px] font-bold tracking-[0.18em] text-ultra">
                <IcScissors size={14} /> SITTING IN THE TRAY
              </div>
            ) : (
              <button type="button" onClick={onCut}
                className="flex items-center justify-center gap-2 border-2 border-[var(--line)] bg-[var(--fg)] px-3 py-2.5 font-mono text-[12px] font-bold tracking-[0.18em] text-[var(--bg)] transition-all hover:-translate-y-0.5 hover:bg-ultra hover:border-ultra hover:text-[#f5f1e3]">
                <IcScissors size={14} /> CUT TO TRAY
              </button>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={onDownload}
                className="flex flex-1 items-center justify-center gap-2 border-2 border-[var(--line)] px-3 py-2 font-mono text-[11px] font-bold tracking-[0.16em] text-[var(--fg)] transition-colors hover:bg-ultra hover:border-ultra hover:text-[#f5f1e3]">
                <IcDown size={13} /> PNG
              </button>
              <button type="button" onClick={onBin}
                className="flex flex-1 items-center justify-center gap-2 border-2 border-[var(--line)] px-3 py-2 font-mono text-[11px] font-bold tracking-[0.16em] text-[var(--fg)] transition-colors hover:bg-verm hover:border-verm hover:text-[#f5f1e3]">
                <IcTrash size={13} /> BIN
              </button>
            </div>
            {sp.state === 'judged' && (
              <div className="mt-1 flex justify-center">
                <Stamp kind={rejected ? 'reject' : 'pass'} score={sp.score} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
