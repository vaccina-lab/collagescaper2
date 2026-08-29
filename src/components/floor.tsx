import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Specimen, Family } from '../lib/types';
import type { Pace } from '../lib/engine';
import { IcDown, IcPrint, IcScissors, IcTrash, Meter, SourceChip, Stamp } from './ui';

export interface BatchProgress { done: number; total: number; failed: number; mb: number }

export const SpecimenCard = memo(function SpecimenCard({ sp, inTray, onInspect, onCut, onBin, onZap, onDownload }: {
  sp: Specimen; inTray: boolean;
  onInspect: (sp: Specimen) => void; onCut: (sp: Specimen) => void; onBin: (id: string) => void;
  onZap: (sp: Specimen) => void; onDownload: (sp: Specimen) => void;
}) {
  const judged = sp.state === 'judged';
  const rejected = judged && sp.verdict === 'reject';
  return (
    <article className="anim-rise relative mb-4 break-inside-avoid border-2 border-[var(--line)] bg-[var(--panel)] shadow-[4px_4px_0_var(--shadow-ink)] transition-transform hover:-translate-y-0.5">
      <button type="button" onClick={() => onInspect(sp)} className="relative block w-full cursor-zoom-in overflow-hidden">
        <img src={sp.thumb || sp.dataUri} alt={sp.archetype} loading="lazy" referrerPolicy="no-referrer"
          className={`block w-full ${rejected ? 'opacity-50 saturate-50' : ''}`} />
        {judged && (
          <span className="absolute right-2 top-2">
            <Stamp kind={rejected ? 'reject' : inTray ? 'tray' : 'pass'} score={sp.score} />
          </span>
        )}
        <span className="absolute bottom-1.5 left-1.5"><SourceChip code={sp.srcCode} hue={sp.srcHue} /></span>
      </button>
      <div className="px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[11px] font-bold text-[var(--fg)]">{sp.code}</span>
          <span className="flex items-center gap-1.5"><Meter score={sp.score} /><span className="font-mono text-[10px] tabular-nums text-[var(--fg2)]">{sp.score}</span></span>
        </div>
        <p className="mt-0.5 truncate font-mono text-[9px] text-[var(--mut)]">{sp.archetype}</p>
      </div>
      <div className="flex border-t border-[var(--line-soft)]">
        <button type="button" onClick={() => (rejected ? onCut(sp) : onCut(sp))} disabled={inTray}
          className="flex flex-1 items-center justify-center gap-1 py-1.5 font-mono text-[9px] font-bold tracking-wider text-[var(--fg2)] hover:bg-[var(--line-soft)] disabled:opacity-30">
          <IcScissors size={11} /> {rejected ? 'OVERRIDE' : 'CUT'}
        </button>
        <button type="button" onClick={() => onZap(sp)} className="flex flex-1 items-center justify-center gap-1 border-l border-[var(--line-soft)] py-1.5 font-mono text-[9px] font-bold tracking-wider text-[var(--fg2)] hover:bg-[var(--line-soft)]">
          ⚡ ZAP
        </button>
        <button type="button" onClick={() => onDownload(sp)} className="flex flex-1 items-center justify-center gap-1 border-l border-[var(--line-soft)] py-1.5 font-mono text-[9px] font-bold tracking-wider text-[var(--fg2)] hover:bg-[var(--line-soft)]">
          <IcDown size={11} /> PNG
        </button>
        <button type="button" onClick={() => onBin(sp.id)} className="flex flex-1 items-center justify-center gap-1 border-l border-[var(--line-soft)] py-1.5 font-mono text-[9px] font-bold tracking-wider text-[var(--fg2)] hover:bg-[var(--line-soft)]">
          <IcTrash size={11} />
        </button>
      </div>
    </article>
  );
}, (a, b) => a.sp === b.sp && a.inTray === b.inTray);

export function Feed({ feed, seen, showRejects, trayIds, running, spm, onInspect, onCut, onBin, onZap, onDownload, onPurge }: {
  feed: Specimen[]; seen: number; showRejects: boolean; trayIds: Set<string>; running: boolean; spm: number;
  onInspect: (sp: Specimen) => void; onCut: (sp: Specimen) => void; onBin: (id: string) => void;
  onZap: (sp: Specimen) => void; onDownload: (sp: Specimen) => void; onPurge: () => void;
}) {
  const visible = useMemo(
    () => feed.filter(f => showRejects || f.verdict !== 'reject'),
    [feed, showRejects],
  );
  return (
    <div id="intake" className="min-w-0">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[26px] font-extrabold leading-none tracking-tight text-[var(--fg)]">LIVE INTAKE</h2>
          <p className="mt-1 font-mono text-[9px] tracking-[0.2em] text-[var(--mut)]">
            {running ? 'HARVESTING' : 'HELD'} · {seen} SEEN · ~{spm}/MIN
          </p>
        </div>
        <button type="button" onClick={onPurge}
          className="border-2 border-[var(--line)] px-2.5 py-1 font-mono text-[9px] font-bold tracking-widest text-[var(--fg)] hover:bg-[var(--fg)] hover:text-[var(--bg)]">
          PURGE
        </button>
      </div>
      {visible.length === 0 ? (
        <div className="border-2 border-dashed border-[var(--line-soft)] p-10 text-center font-mono text-[11px] text-[var(--mut)]">
          the belt is empty — let the crawler run
        </div>
      ) : (
        <div className="columns-1 gap-4 sm:columns-2 xl:columns-3">
          {visible.map(sp => (
            <SpecimenCard key={sp.id} sp={sp} inTray={trayIds.has(sp.id)}
              onInspect={onInspect} onCut={onCut} onBin={onBin} onZap={onZap} onDownload={onDownload} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TrayRail({ tray, busy, batch, archive, gate, keysEnabled, onInspect, onRemove, onClear, onCull, onExport, onBatch }: {
  tray: Specimen[]; busy: boolean; batch: BatchProgress | null; archive: { url: string; name: string } | null;
  gate: number; keysEnabled: boolean;
  onInspect: (sp: Specimen) => void; onRemove: (id: string) => void; onClear: () => void;
  onCull: () => void; onExport: () => void; onBatch: (mode: 'full' | 'jpg1400') => void;
}) {
  const pct = batch ? Math.round((batch.done / Math.max(1, batch.total)) * 100) : 0;
  return (
    <div id="tray" className="min-w-0">
      <div className="border-2 border-[var(--line)] bg-[var(--panel)] shadow-[4px_4px_0_var(--shadow-ink)]">
        <div className="flex items-center justify-between border-b-2 border-[var(--line)] px-3 py-2">
          <h2 className="font-display text-[18px] font-extrabold tracking-tight text-[var(--fg)]">CUTTING TRAY</h2>
          <span className="font-mono text-[10px] tabular-nums text-[var(--fg2)]">{tray.length}/300</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 border-b border-[var(--line-soft)] p-2.5">
          <button type="button" onClick={() => onBatch('jpg1400')} disabled={tray.length === 0 || !!batch}
            className="border-2 border-moss bg-moss px-2 py-1.5 font-mono text-[9px] font-bold tracking-wider text-[#f5f1e3] hover:opacity-85 disabled:opacity-30">
            <IcDown size={11} /> ZIP · 1400 JPG
          </button>
          <button type="button" onClick={() => onBatch('full')} disabled={tray.length === 0 || !!batch}
            className="border-2 border-[var(--line)] px-2 py-1.5 font-mono text-[9px] font-bold tracking-wider text-[var(--fg)] hover:bg-[var(--fg)] hover:text-[var(--bg)] disabled:opacity-30">
            ZIP · FULL
          </button>
          <button type="button" onClick={onExport} disabled={tray.length === 0 || busy}
            className="border-2 border-[var(--line)] px-2 py-1.5 font-mono text-[9px] font-bold tracking-wider text-[var(--fg)] hover:bg-[var(--fg)] hover:text-[var(--bg)] disabled:opacity-30">
            <IcPrint size={11} /> SHEET
          </button>
          <button type="button" onClick={onCull} disabled={tray.length === 0}
            className="border-2 border-[var(--line)] px-2 py-1.5 font-mono text-[9px] font-bold tracking-wider text-[var(--fg)] hover:bg-[var(--fg)] hover:text-[var(--bg)] disabled:opacity-30">
            CULL &lt;{gate}
          </button>
          <button type="button" onClick={onClear} disabled={tray.length === 0}
            className="col-span-2 border-2 border-verm px-2 py-1.5 font-mono text-[9px] font-bold tracking-wider text-verm hover:bg-verm hover:text-[#f5f1e3] disabled:opacity-30">
            <IcTrash size={11} /> SWEEP TRAY
          </button>
        </div>
        {batch && (
          <div className="border-b border-[var(--line-soft)] px-3 py-2">
            <div className="h-2 w-full bg-[var(--line-soft)]"><div className="h-full bg-moss transition-all" style={{ width: `${pct}%` }} /></div>
            <p className="mt-1 font-mono text-[9px] tabular-nums text-[var(--mut)]">
              packing {batch.done}/{batch.total} · {batch.mb} MB{batch.failed > 0 ? ` · ${batch.failed} failed` : ''}
            </p>
          </div>
        )}
        {archive && (
          <div className="border-b border-[var(--line-soft)] p-2.5">
            <a href={archive.url} download={archive.name}
              className="anim-led flex items-center justify-center gap-2 border-2 border-moss bg-moss px-2 py-2 font-mono text-[10px] font-bold tracking-wider text-[#f5f1e3] hover:opacity-85">
              <IcDown size={12} /> SAVE ARCHIVE · {archive.name}
            </a>
            <p className="mt-1 text-center font-mono text-[8px] text-[var(--mut)]">if it didn't auto-download, tap above</p>
          </div>
        )}
        <div className="max-h-[420px] overflow-y-auto p-2.5 scroll-slim">
          {tray.length === 0 ? (
            <p className="py-8 text-center font-mono text-[10px] text-[var(--mut)]">nothing cut yet</p>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {tray.map(sp => (
                <button key={sp.id} type="button" onClick={() => onInspect(sp)} className="group relative block overflow-hidden border border-[var(--line-soft)]">
                  <img src={sp.thumb || sp.dataUri} alt={sp.code} loading="lazy" referrerPolicy="no-referrer" className="block aspect-square w-full object-cover" />
                  <button type="button" onClick={e => { e.stopPropagation(); onRemove(sp.id); }}
                    className="absolute right-0.5 top-0.5 bg-[var(--ink)] p-0.5 text-[var(--bg)] opacity-0 group-hover:opacity-100">
                    <IcTrash size={10} />
                  </button>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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
      <div className="max-h-[90vh] max-w-3xl overflow-y-auto border-2 border-[var(--line)] bg-[var(--panel)] p-4 shadow-[8px_8px_0_var(--shadow-ink)]" onClick={e => e.stopPropagation()}>
        <img src={sp.dataUri} alt={sp.archetype} referrerPolicy="no-referrer" className="mx-auto max-h-[52vh] object-contain" />
        <div className="mt-3 flex items-center justify-between gap-2">
          <div>
            <div className="font-mono text-[12px] font-bold text-[var(--fg)]">{sp.code} · {sp.archetype}</div>
            <div className="mt-0.5 flex items-center gap-2"><Meter score={sp.score} /><span className="font-mono text-[10px] tabular-nums text-[var(--fg2)]">{sp.score}</span></div>
          </div>
          <button type="button" onClick={onClose} className="border-2 border-[var(--line)] px-2 py-1 font-mono text-[10px] font-bold text-[var(--fg)] hover:bg-[var(--fg)] hover:text-[var(--bg)]">ESC</button>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          <button type="button" onClick={onCut} className="border-2 border-[var(--line)] px-2 py-1.5 font-mono text-[9px] font-bold tracking-wider text-[var(--fg)] hover:bg-[var(--fg)] hover:text-[var(--bg)]"><IcScissors size={11} /> CUT</button>
          <button type="button" onClick={onDownload} className="border-2 border-[var(--line)] px-2 py-1.5 font-mono text-[9px] font-bold tracking-wider text-[var(--fg)] hover:bg-[var(--fg)] hover:text-[var(--bg)]"><IcDown size={11} /> PNG</button>
          <button type="button" onClick={onBin} className="border-2 border-verm px-2 py-1.5 font-mono text-[9px] font-bold tracking-wider text-verm hover:bg-verm hover:text-[#f5f1e3]"><IcTrash size={11} /> BIN</button>
          <div className="flex overflow-hidden border-2 border-[var(--line)]">
            {(['cruise', 'rapid'] as Pace[]).map(p => (
              <button key={p} type="button" onClick={() => onPace(p)}
                className={`flex-1 px-1 font-mono text-[9px] font-bold ${pace === p ? 'bg-[var(--fg)] text-[var(--bg)]' : 'text-[var(--fg2)]'}`}>
                {p === 'cruise' ? 'CRS' : 'RPD'}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
