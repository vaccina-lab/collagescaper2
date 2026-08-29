import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { Specimen } from '../lib/types';
import { FEED_CAP, TRAY_CAP, type Pace } from '../lib/engine';
import { IcBolt, IcChevL, IcChevR, IcDown, IcScissors, IcTrash, IcX, Meter, SourceChip, Stamp } from './ui';

const jitter = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return { rot: ((h % 9) - 4) * 0.32, taped: h % 3 === 0 };
};

export const SpecimenCard = memo(function SpecimenCard({ sp, inTray, onInspect, onCut, onBin, onZap, onDownload }: {
  sp: Specimen; inTray: boolean;
  onInspect: (sp: Specimen) => void; onCut: (sp: Specimen) => void; onBin: (id: string) => void;
  onZap: (sp: Specimen) => void; onDownload: (sp: Specimen) => void;
}) {
  const judged = sp.state === 'judged';
  const rejected = judged && sp.verdict === 'reject';
  const { rot, taped } = jitter(sp.id);
  return (
    <article data-plate-id={sp.id} style={{ transform: `rotate(${rot}deg)` }}
      className="cv-card anim-rise group relative mb-5 break-inside-avoid border-2 border-[var(--line)] bg-[var(--panel)] transition-all duration-200 hover:-translate-y-1 hover:shadow-[6px_6px_0_var(--shadow-ink)]">
      {taped && <span className="tape" aria-hidden="true" />}
      <button type="button" onClick={() => onInspect(sp)} aria-label={`inspect ${sp.code}`}
        className="relative block w-full cursor-zoom-in overflow-hidden border-b-2 border-[var(--line-soft)]">
        <div style={{ aspectRatio: String(sp.aspect) }} className={`relative w-full bg-[var(--line-soft)] ${sp.cutoutSrc ? 'checker' : ''}`}>
          <img src={sp.cutoutSrc ?? (sp.remote ? sp.thumb : sp.dataUri)} alt={`${sp.archetype} — ${sp.code}`} loading="lazy" decoding="async" referrerPolicy="no-referrer"
            className={`absolute inset-0 h-full w-full ${sp.cutoutSrc ? 'object-contain' : 'object-cover'} transition-transform duration-500 group-hover:scale-[1.03] ${rejected ? 'opacity-60 grayscale-[0.75]' : ''} ${judged ? '' : 'opacity-40'}`} />
          {!judged && (
            <div className="shimmer-block absolute inset-0 grid place-items-center">
              <div className="scan-bar" />
              <span className="relative z-10 border-2 border-[var(--line)]/50 bg-[var(--panel)]/85 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.2em] text-[var(--fg2)]">FETCHING ▒▒</span>
            </div>
          )}
        </div>
        {judged && <span className="anim-stamp absolute right-2 top-2"><Stamp kind={rejected ? 'reject' : 'pass'} score={sp.score} /></span>}
        {inTray && <span className="absolute left-2 top-2"><Stamp kind="tray" /></span>}
        {(sp.isoState === 'queue' || sp.isoState === 'work') && (
          <span className="absolute bottom-1.5 right-1.5 animate-pulse border border-ultra/60 bg-[#10122a]/85 px-1 py-px font-mono text-[8px] font-bold tracking-[0.18em] text-[#9fb2ff]">✂ {sp.isoState === 'queue' ? 'QUEUED' : 'CUTTING'}</span>
        )}
        {sp.cutoutSrc && (
          <span className="absolute bottom-1.5 left-1.5 border border-verm/70 bg-[#2a120c]/85 px-1 py-px font-mono text-[8px] font-bold tracking-[0.18em] text-[#ff9d7a]">✂ {sp.cutEngine === 'ink' ? 'INK' : sp.cutEngine === 'flood' ? 'FLD' : 'ISO'}</span>
        )}
      </button>
      <div className="px-2.5 pb-2 pt-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[12px] font-bold tracking-tight text-[var(--fg)]">{sp.code}</span>
          <SourceChip code={sp.srcCode} hue={sp.srcHue} />
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2" title={sp.why?.join(' · ')}>
          <span className="flex items-center gap-1.5">
            <Meter score={sp.score} />
            <span className="font-mono text-[11px] font-semibold tabular-nums text-[var(--fg2)]">{sp.score}</span>
          </span>
          <span className="truncate font-display text-[12px] font-medium italic text-[var(--fg2)]">“{sp.archetype}”</span>
        </div>
      </div>
      <div className="flex border-t-2 border-[var(--line-soft)]">
        {rejected ? (
          <button type="button" disabled={!judged} onClick={() => onCut(sp)} className="flex flex-1 items-center justify-center gap-1.5 py-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-verm transition-colors hover:bg-verm hover:text-[#f5f1e3] disabled:opacity-30"><IcScissors size={12} /> OVERRIDE</button>
        ) : inTray ? (
          <span className="flex flex-1 cursor-default items-center justify-center gap-1.5 py-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-ultra"><IcScissors size={12} /> CUT ✓</span>
        ) : (
          <button type="button" disabled={!judged} onClick={() => onCut(sp)} className="flex flex-1 items-center justify-center gap-1.5 py-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-[var(--fg)] transition-colors hover:bg-[var(--fg)] hover:text-[var(--bg)] disabled:opacity-30"><IcScissors size={12} /> CUT</button>
        )}
        <button type="button" onClick={() => onBin(sp.id)} className="flex flex-1 items-center justify-center gap-1.5 border-l border-[var(--line-soft)] py-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-[var(--fg2)] transition-colors hover:bg-[var(--fg)] hover:text-[var(--bg)]"><IcTrash size={12} /> BIN</button>
        <button type="button" disabled={!judged} onClick={() => onZap(sp)} title="send to the glitch lab" className="flex flex-1 items-center justify-center gap-1.5 border-l border-[var(--line-soft)] py-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-[var(--fg2)] transition-colors hover:bg-gold hover:border-gold hover:text-black disabled:opacity-30"><IcBolt size={12} /> ZAP</button>
        <button type="button" disabled={!judged} onClick={() => onDownload(sp)} title="save this plate as a 1400px .jpg" className="flex flex-1 items-center justify-center gap-1.5 border-l border-[var(--line-soft)] py-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-[var(--fg2)] transition-colors hover:bg-ultra hover:text-[#f5f1e3] disabled:opacity-30"><IcDown size={12} /> JPG</button>
      </div>
    </article>
  );
}, (a, b) => a.sp === b.sp && a.inTray === b.inTray);

export function Feed({ feed, seen, showRejects, trayIds, running, spm, onInspect, onCut, onBin, onZap, onDownload, onPurge }: {
  feed: Specimen[]; seen: number; showRejects: boolean; trayIds: Set<string>; running: boolean; spm: number;
  onInspect: (sp: Specimen) => void; onCut: (sp: Specimen) => void; onBin: (id: string) => void;
  onZap: (sp: Specimen) => void; onDownload: (sp: Specimen) => void; onPurge: () => void;
}) {
  const visible = showRejects ? feed : feed.filter(f => f.state === 'incoming' || f.verdict === 'pass');
  const colCountFor = (w: number) => (w < 640 ? 1 : w < 1536 ? 2 : 3);
  const [colCount, setColCount] = useState(() => colCountFor(window.innerWidth));
  useEffect(() => {
    const onResize = () => setColCount(colCountFor(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const columns = (() => {
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
  })();
  const tailRef = useRef<HTMLDivElement | null>(null);
  const nearRef = useRef(true);
  const [freshBelow, setFreshBelow] = useState(0);
  const prevSeen = useRef(seen);
  useEffect(() => {
    const onScroll = () => {
      const el = tailRef.current;
      if (!el) { nearRef.current = true; return; }
      const near = el.getBoundingClientRect().bottom < window.innerHeight + 520;
      nearRef.current = near;
      if (near) setFreshBelow(0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    const delta = seen - prevSeen.current;
    prevSeen.current = seen;
    if (delta > 0 && !nearRef.current) setFreshBelow(f => f + delta);
  }, [seen]);
  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[30px] font-extrabold leading-none tracking-tight text-[var(--fg)]">LIVE INTAKE</h2>
          <div className="mt-1.5 flex items-center gap-2">
            <span className={`inline-block h-[5px] w-16 ${running ? 'dash-live' : 'bg-[var(--line-soft)]'}`} />
            <span className="font-mono text-[10px] font-bold tracking-[0.24em] text-[var(--fg2)]">{running ? 'CHEWING' : 'HELD'}</span>
            <span className="font-mono text-[10px] tracking-[0.14em] text-[var(--mut)]">≈{spm}/MIN · BUFFER {feed.length}/{FEED_CAP}</span>
          </div>
        </div>
        <button type="button" onClick={onPurge} className="border-2 border-[var(--line)] px-3 py-1.5 font-mono text-[11px] font-bold tracking-[0.18em] text-[var(--fg)] transition-all hover:-translate-y-0.5 hover:bg-verm hover:border-verm hover:text-[#f5f1e3]">PURGE BUFFER</button>
      </div>
      {visible.length === 0 ? (
        <div className="grid place-items-center border-2 border-dashed border-[var(--line)]/40 bg-[var(--panel)]/60 px-6 py-20 text-center">
          <IcScissors size={40} className="mb-4 text-[var(--mut)]" />
          <div className="font-display text-2xl font-extrabold text-[var(--fg)]">THE HOPPER IS EMPTY.</div>
          <p className="mt-2 max-w-[380px] font-mono text-[11px] leading-relaxed text-[var(--fg2)]">
            {running ? 'Spiders are out on the mirrors — specimens drop here the moment they clear intake.' : 'Machine is on HOLD. Resume the crawl to feed the intake.'}
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
      {freshBelow > 0 && (
        <button type="button" onClick={() => tailRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'end' })}
          className="group fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2.5 border-2 border-verm bg-[var(--fg)] px-4 py-2.5 font-mono text-[11px] font-bold tracking-[0.18em] text-[var(--bg)] shadow-[4px_4px_0_var(--shadow-ink)] transition-all hover:-translate-y-1 hover:bg-verm hover:text-[#f5f1e3]">
          <span className="anim-led inline-block h-2 w-2 rounded-full bg-[#7ebe5c]" />
          {freshBelow} FRESH ON THE BELT <span>▾</span>
        </button>
      )}
    </div>
  );
}

export interface BatchProgress { done: number; total: number; failed: number; mb: number }
const TrayTile = memo(function TrayTile({ sp, selected, onInspect, onRemove }: {
  sp: Specimen; selected: boolean; onInspect: (sp: Specimen) => void; onRemove: (id: string) => void;
}) {
  const inspect = useCallback(() => onInspect(sp), [sp, onInspect]);
  const remove = useCallback(() => onRemove(sp.id), [sp.id, onRemove]);
  return (
    <div data-tile-id={sp.id} className={`group relative border transition-all duration-150 ${selected ? 'border-verm ring-2 ring-verm ring-offset-1 ring-offset-[var(--panel)]' : 'border-[var(--line)]/40 hover:border-verm'} bg-[var(--line-soft)]`}>
      <button type="button" onClick={inspect} aria-label={`inspect ${sp.code}`} className="block w-full cursor-zoom-in">
        <span className={`block ${sp.cutoutSrc ? 'checker' : ''}`}>
          <img src={sp.cutoutSrc ?? (sp.remote ? sp.thumb : sp.dataUri)} alt={sp.code} loading="lazy" decoding="async" referrerPolicy="no-referrer" className={`aspect-square w-full ${sp.cutoutSrc ? 'object-contain' : 'object-cover'}`} />
        </span>
      </button>
      {sp.cutoutSrc && <span className="pointer-events-none absolute left-0.5 top-0.5 bg-verm px-1 font-mono text-[8px] font-bold text-[#f5f1e3]">✂</span>}
      <button type="button" onClick={remove} aria-label={`remove ${sp.code}`} className="absolute right-0.5 top-0.5 bg-[var(--fg)] p-0.5 text-[var(--bg)] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-verm"><IcX size={11} /></button>
      <span className={`pointer-events-none absolute bottom-0.5 left-0.5 bg-[var(--panel)]/90 px-1 font-mono text-[8px] font-bold text-[var(--fg)] transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>{sp.score}</span>
    </div>
  );
}, (a, b) => a.sp === b.sp && a.selected === b.selected);

export function TrayRail({ tray, busy, batch, archive, gate, keysEnabled, onInspect, onRemove, onClear, onCull, onExport, onBatch }: {
  tray: Specimen[]; busy: boolean; batch: BatchProgress | null; archive: { url: string; name: string } | null; gate: number; keysEnabled: boolean;
  onInspect: (sp: Specimen) => void; onRemove: (id: string) => void; onClear: () => void; onCull: () => void; onExport: () => void;
  onBatch: (mode: 'full' | 'jpg1400') => void;
}) {
  const avg = tray.length ? Math.round(tray.reduce((a, b) => a + b.score, 0) / tray.length) : 0;
  const best = tray.length ? Math.max(...tray.map(t => t.score)) : 0;
  const packing = batch !== null;
  const pct = packing && batch ? Math.round((batch.done / Math.max(1, batch.total)) * 100) : 0;
  const [sel, setSel] = useState<number | null>(null);
  const selRef = useRef(sel);
  useEffect(() => { selRef.current = sel; }, [sel]);
  useEffect(() => { if (sel !== null && sel >= tray.length) setSel(tray.length ? tray.length - 1 : null); }, [tray.length, sel]);
  /* arrow keys walk the tray grid; ENTER inspects (opens lightbox, which then
     takes over arrow navigation). Disabled while the lightbox is open. */
  useEffect(() => {
    if (!keysEnabled || tray.length === 0) return;
    const move = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const cur = selRef.current;
      const last = tray.length - 1;
      let next: number | null = null;
      if (e.key === 'ArrowRight') next = cur === null ? 0 : Math.min(last, cur + 1);
      else if (e.key === 'ArrowLeft') next = cur === null ? last : Math.max(0, cur - 1);
      else if (e.key === 'ArrowDown') next = cur === null ? 0 : Math.min(last, cur + 4);
      else if (e.key === 'ArrowUp') next = cur === null ? Math.max(0, last - 3) : Math.max(0, cur - 4);
      else if (e.key === 'Enter' && cur !== null) { e.preventDefault(); onInspect(tray[cur]); return; }
      else if (e.key === 'Escape' && cur !== null) { setSel(null); return; }
      else return;
      e.preventDefault();
      setSel(next);
      const el = document.querySelector(`[data-tile-id="${tray[next].id}"]`);
      el?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    };
    window.addEventListener('keydown', move);
    return () => window.removeEventListener('keydown', move);
  }, [keysEnabled, tray, onInspect]);
  return (
    <>
      {archive && (
        <a href={archive.url} download={archive.name}
          className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-4 z-40 flex max-w-[72vw] items-center gap-2.5 border-2 border-verm bg-verm px-4 py-2.5 font-mono text-[11px] font-bold tracking-[0.16em] text-[#f5f1e3] shadow-[4px_4px_0_var(--shadow-ink)] transition-all hover:-translate-y-1 hover:bg-[var(--fg)] hover:border-[var(--fg)]"
          title="your archive is packed — one tap saves it">
          <IcDown size={13} className="shrink-0" />
          <span className="truncate">SAVE ARCHIVE ▾ {archive.name}</span>
        </a>
      )}
      <aside className="border-2 border-[var(--line)] bg-[var(--panel)] shadow-[4px_4px_0_var(--shadow-ink)] xl:sticky xl:top-[118px]">
        <h2 className="flex items-baseline justify-between border-b-2 border-[var(--line)] px-3 py-2.5">
          <span className="font-display text-[19px] font-extrabold tracking-tight text-[var(--fg)]">CUTTING <span className="text-verm">TRAY</span></span>
          <span className="font-mono text-[11px] font-semibold tabular-nums text-[var(--fg2)]">{tray.length}<span className="text-[var(--mut)]">/{TRAY_CAP}</span></span>
        </h2>
        <div className="h-1.5 w-full border-b border-[var(--line-soft)] bg-[var(--line-soft)]">
          <div className={`h-full transition-all duration-500 ${tray.length >= TRAY_CAP ? 'bg-verm' : tray.length >= TRAY_CAP * 0.8 ? 'bg-gold' : 'bg-ultra'}`} style={{ width: `${Math.min(100, (tray.length / TRAY_CAP) * 100)}%` }} />
        </div>
        <div className="grid grid-cols-2 gap-2 border-b border-[var(--line-soft)] px-3 py-2.5">
          {packing && batch ? (
            <div className="col-span-2 flex items-center justify-center gap-2 bg-moss px-2 py-2 font-mono text-[11px] font-bold tracking-[0.16em] text-[#f5f1e3]">
              <IcDown size={14} className="animate-bounce" /> PACKING {batch.done}/{batch.total} · {batch.mb} MB
              {batch.failed > 0 ? <span className="text-[#ffd28a]">({batch.failed} blocked)</span> : null}
            </div>
          ) : (
            <>
              <button type="button" onClick={() => onBatch('jpg1400')} disabled={tray.length === 0 || busy}
                title="every plate as a 1400px .jpg — cutouts flattened on white. low-spec friendly"
                className="flex items-center justify-center gap-2 bg-moss px-2 py-2 font-mono text-[10.5px] font-bold tracking-[0.1em] text-[#f5f1e3] transition-all hover:-translate-y-0.5 hover:bg-[var(--fg)] disabled:pointer-events-none disabled:opacity-35">
                <IcDown size={13} /> ZIP · JPG 1400
              </button>
              <button type="button" onClick={() => onBatch('full')} disabled={tray.length === 0 || busy}
                title="untouched originals, whatever the host serves"
                className="flex items-center justify-center gap-2 bg-[var(--fg)] px-2 py-2 font-mono text-[10.5px] font-bold tracking-[0.1em] text-[var(--bg)] transition-all hover:-translate-y-0.5 hover:bg-ultra hover:text-[#f5f1e3] disabled:pointer-events-none disabled:opacity-35">
                <IcDown size={13} /> ZIP · FULL
              </button>
            </>
          )}
          <button type="button" onClick={onExport} disabled={tray.length === 0 || busy || packing} className="flex items-center justify-center gap-2 bg-[var(--fg)] px-2 py-2 font-mono text-[10.5px] font-bold tracking-[0.14em] text-[var(--bg)] transition-all hover:-translate-y-0.5 hover:bg-ultra disabled:pointer-events-none disabled:opacity-35">
            <IcScissors size={13} /> {busy ? 'PRESSING…' : 'PRINT SHEET'}
          </button>
          <button type="button" onClick={onCull} disabled={tray.length === 0 || packing} className="border-2 border-ultra px-3 py-2 font-mono text-[10.5px] font-bold tracking-[0.14em] text-ultra transition-colors hover:bg-ultra hover:text-[#f5f1e3] disabled:pointer-events-none disabled:opacity-35">CULL &lt;{gate}</button>
          <button type="button" onClick={onClear} disabled={tray.length === 0 || packing} className="col-span-2 border-2 border-[var(--line)] px-3 py-2 font-mono text-[10.5px] font-bold tracking-[0.14em] text-[var(--fg)] transition-colors hover:bg-verm hover:border-verm hover:text-[#f5f1e3] disabled:pointer-events-none disabled:opacity-35">
            <IcTrash size={13} /> SWEEP TRAY
          </button>
        </div>
        {tray.length > 0 && (
          <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-3 py-1.5 font-mono text-[9.5px] tracking-[0.14em] text-[var(--mut)]">
            <span>AVG <strong className="text-ultra">{avg}</strong></span>
            <span>BEST <strong className="text-verm">{best}</strong></span>
            <span className="hidden sm:inline">← → WALK · ENTER INSPECT</span>
          </div>
        )}
        {tray.length === 0 ? (
          <div className="p-3">
            <div className="grid place-items-center border-2 border-dashed border-[var(--line)]/30 px-4 py-10 text-center">
              <IcScissors size={30} className="mb-3 text-[var(--mut)]" />
              <div className="font-display text-[16px] font-bold text-[var(--fg)]">NOTHING CUT YET</div>
              <p className="mt-1.5 font-mono text-[9.5px] leading-relaxed text-[var(--mut)]">anything that clears the gate lands here.<br />pull rejects back with OVERRIDE.</p>
            </div>
          </div>
        ) : (
          <div className="max-h-[680px] overflow-y-auto scroll-slim">
            <div className="grid grid-cols-4 gap-1.5 p-3">
              {tray.map((sp, i) => <TrayTile key={sp.id} sp={sp} selected={sel === i} onInspect={onInspect} onRemove={onRemove} />)}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

/* Lightbox with arrow-key browsing through the tray:
   ← previous · → next (wraps). Only active when the plate is in the tray. */
export function Lightbox({ sp, tray, pace, onPace, onClose, onCut, onBin, onDownload, onSelect }: {
  sp: Specimen; tray: Specimen[]; pace: Pace; onPace: (p: Pace) => void;
  onClose: () => void; onCut: () => void; onBin: () => void; onDownload: () => void; onSelect: (sp: Specimen) => void;
}) {
  const idx = tray.findIndex(t => t.id === sp.id);
  const inTray = idx >= 0;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (!inTray || tray.length === 0) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); onSelect(tray[(idx + 1) % tray.length]); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); onSelect(tray[(idx - 1 + tray.length) % tray.length]); }
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [idx, inTray, tray, onClose, onSelect]);
  const rejected = sp.verdict === 'reject';
  const go = (d: number) => { if (inTray && tray.length) onSelect(tray[(idx + d + tray.length) % tray.length]); };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true">
      <button type="button" aria-label="close" onClick={onClose} className="absolute inset-0 cursor-zoom-out bg-[var(--bg)]/85" />
      <div className="anim-rise relative grid max-h-[92vh] w-full max-w-4xl grid-cols-1 overflow-y-auto border-2 border-[var(--line)] bg-[var(--panel)] text-[var(--fg)] shadow-[8px_8px_0_var(--shadow-ink)] md:grid-cols-[1.35fr_1fr] scroll-slim">
        <div className="relative grid min-h-[320px] place-items-center bg-[#15120c] p-4">
          <img src={sp.cutoutSrc ?? (sp.remote ? sp.fullUrl || sp.thumb : sp.dataUri)} alt={`${sp.archetype} — ${sp.code}`} referrerPolicy="no-referrer"
            className={`max-h-[70vh] max-w-full ${sp.cutoutSrc ? 'checker' : ''}`} />
          {inTray && (
            <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-3">
              <button type="button" onClick={() => go(-1)} aria-label="previous in tray" className="flex items-center gap-1 border-2 border-[#e9e4d4]/60 bg-[#15120c]/80 px-2.5 py-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-[#e9e4d4] transition-colors hover:bg-verm hover:border-verm"><IcChevL size={13} /> PREV</button>
              <span className="border border-[#e9e4d4]/40 bg-[#15120c]/80 px-2 py-1 font-mono text-[10px] font-bold tabular-nums tracking-[0.14em] text-[#e9e4d4]">{idx + 1} / {tray.length}</span>
              <button type="button" onClick={() => go(1)} aria-label="next in tray" className="flex items-center gap-1 border-2 border-[#e9e4d4]/60 bg-[#15120c]/80 px-2.5 py-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-[#e9e4d4] transition-colors hover:bg-verm hover:border-verm">NEXT <IcChevR size={13} /></button>
            </div>
          )}
        </div>
        <div className="flex flex-col p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-mono text-[19px] font-bold tracking-tight">{sp.code}</div>
              <div className="mt-0.5 font-display text-[14px] font-medium italic text-[var(--fg2)]">“{sp.archetype}”</div>
            </div>
            <button type="button" onClick={onClose} aria-label="close" className="border-2 border-[var(--line)] p-1.5 text-[var(--fg)] transition-colors hover:bg-[var(--fg)] hover:text-[var(--bg)]"><IcX size={14} /></button>
          </div>
          <div className="mt-3">
            <Row k="SOURCE"><span className="inline-flex items-center gap-1.5"><SourceChip code={sp.srcCode} hue={sp.srcHue} /></span></Row>
            <Row k="GRADE"><span className="inline-flex items-center gap-2"><Meter score={sp.score} /><span className="tabular-nums">{sp.score}</span></span></Row>
            {sp.cutScore !== undefined && <Row k="CUT GRADE"><span className="tabular-nums text-verm">{sp.cutScore}</span>{sp.cutEngine === 'ink' ? <span className="ml-2 font-mono text-[9px] font-bold tracking-[0.14em] text-moss">INK-MATTE</span> : sp.cutEngine === 'flood' ? <span className="ml-2 font-mono text-[9px] font-bold tracking-[0.14em] text-ultra">COLOR-FLOOD</span> : null}</Row>}
            {sp.cutoutSrc && <Row k="ISOLATION"><span className="font-mono text-[10px] font-bold tracking-[0.14em] text-verm">SUBJECT FREED ✂</span></Row>}
            <Row k="VERDICT"><span className={rejected ? 'text-verm' : 'text-ultra'}>{sp.state === 'incoming' ? 'PENDING…' : rejected ? 'BINNED' : 'PASSED THE GATE'}</span></Row>
            <Row k="PLATE">{sp.w}×{sp.h}px</Row>
            {sp.credit && <Row k="CREDIT">{sp.credit}</Row>}
            {sp.pageUrl && <Row k="ORIGIN"><a href={sp.pageUrl} target="_blank" rel="noopener noreferrer" className="text-ultra underline decoration-2 underline-offset-2 hover:text-verm">open ↗</a></Row>}
          </div>
          {sp.why && sp.why.length > 0 && (
            <div className="mt-3 border border-[var(--line)]/20 bg-[var(--bg)] px-2 py-1.5">
              <div className="font-mono text-[8.5px] font-bold tracking-[0.24em] text-[var(--mut)]">METRICS</div>
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[9.5px] text-[var(--fg2)]">{sp.why.map((w, i) => <span key={i}>{w}</span>)}</div>
            </div>
          )}
          <div className="mt-3">
            <div className="mb-1 font-mono text-[9px] font-semibold tracking-[0.24em] text-[var(--mut)]">CRAWL PACE</div>
            <div className="flex overflow-hidden border-2 border-[var(--line)]">
              {(['cruise', 'rapid'] as Pace[]).map(p => (
                <button key={p} type="button" onClick={() => onPace(p)} aria-pressed={pace === p}
                  className={`flex-1 px-2 py-1.5 font-mono text-[10px] font-bold tracking-[0.18em] transition-colors ${
                    pace === p ? 'bg-[var(--fg)] text-[var(--bg)]' : 'text-[var(--fg2)] hover:bg-[var(--line-soft)]'}`}>
                  {p.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1" />
          <div className="mt-5 flex flex-col gap-2">
            {rejected ? (
              <button type="button" onClick={onCut} className="flex items-center justify-center gap-2 border-2 border-verm bg-verm px-3 py-2.5 font-mono text-[12px] font-bold tracking-[0.18em] text-[#f5f1e3] transition-all hover:-translate-y-0.5 hover:bg-[var(--panel)] hover:text-verm"><IcScissors size={14} /> OVERRIDE → CUT</button>
            ) : inTray ? (
              <div className="flex items-center justify-center gap-2 border-2 border-ultra/50 bg-ultra/10 px-3 py-2.5 font-mono text-[12px] font-bold tracking-[0.18em] text-ultra"><IcScissors size={14} /> SITTING IN THE TRAY</div>
            ) : (
              <button type="button" onClick={onCut} className="flex items-center justify-center gap-2 border-2 border-[var(--line)] bg-[var(--fg)] px-3 py-2.5 font-mono text-[12px] font-bold tracking-[0.18em] text-[var(--bg)] transition-all hover:-translate-y-0.5 hover:bg-ultra hover:border-ultra"><IcScissors size={14} /> CUT TO TRAY</button>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={onDownload} title="save this plate as a 1400px .jpg" className="flex flex-1 items-center justify-center gap-2 border-2 border-[var(--line)] px-3 py-2 font-mono text-[11px] font-bold tracking-[0.16em] text-[var(--fg)] transition-colors hover:bg-ultra hover:border-ultra hover:text-[#f5f1e3]"><IcDown size={13} /> JPG</button>
              <button type="button" onClick={onBin} className="flex flex-1 items-center justify-center gap-2 border-2 border-[var(--line)] px-3 py-2 font-mono text-[11px] font-bold tracking-[0.16em] text-[var(--fg)] transition-colors hover:bg-verm hover:border-verm hover:text-[#f5f1e3]"><IcTrash size={13} /> BIN</button>
            </div>
            {inTray && <div className="text-center font-mono text-[9px] tracking-[0.2em] text-[var(--mut)]">← → BROWSE THE TRAY · ESC CLOSE</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--line)]/15 py-1.5">
      <span className="shrink-0 font-mono text-[9px] font-semibold tracking-[0.24em] text-[var(--mut)]">{k}</span>
      <span className="min-w-0 break-words text-right font-mono text-[12px] font-semibold text-[var(--fg)]">{children}</span>
    </div>
  );
}
