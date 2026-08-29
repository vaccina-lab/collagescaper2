import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { Specimen } from '../lib/types';
import { TRAY_CAP } from '../lib/engine';
import { IcDown, IcPrint, IcScissors, IcTrash, IcX } from './ui';

export interface BatchProgress { done: number; total: number; failed: number; mb: number }

const COLS = 4;

const TrayTile = memo(function TrayTile({ sp, selected, onInspect, onRemove }: {
  sp: Specimen; selected: boolean;
  onInspect: (sp: Specimen) => void; onRemove: (id: string) => void;
}) {
  const inspect = useCallback(() => onInspect(sp), [sp, onInspect]);
  const remove = useCallback(() => onRemove(sp.id), [sp.id, onRemove]);
  return (
    <div
      data-tile-id={sp.id}
      className={`group relative border transition-all duration-150 ${
        selected
          ? 'border-verm shadow-[2px_2px_0_var(--shadow-ink)] ring-2 ring-verm ring-offset-1 ring-offset-[var(--panel)]'
          : 'border-[var(--line)]/40 hover:border-verm'
      } bg-[var(--line-soft)]`}
    >
      <button type="button" onClick={inspect} className="block w-full cursor-zoom-in" aria-label={`inspect ${sp.code}`}>
        <span className={`block ${sp.cutoutSrc ? 'checker' : ''}`}>
          <img
            src={sp.cutoutSrc ?? (sp.remote ? sp.thumb : sp.dataUri)}
            alt={sp.code}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className={`aspect-square w-full ${sp.cutoutSrc ? 'object-contain' : 'object-cover'}`}
          />
        </span>
      </button>
      {sp.cutoutSrc && (
        <span className="pointer-events-none absolute left-0.5 top-0.5 bg-verm px-1 font-mono text-[8px] font-bold text-[#f5f1e3]">
          ✂{sp.cutScore !== undefined ? sp.cutScore : ''}
        </span>
      )}
      {(sp.isoState === 'queue' || sp.isoState === 'work') && (
        <span className="pointer-events-none absolute left-0.5 top-0.5 animate-pulse bg-ultra px-1 font-mono text-[8px] font-bold text-[#f5f1e3]">…</span>
      )}
      <button
        type="button" onClick={remove}
        aria-label={`remove ${sp.code} from tray`}
        className="absolute right-0.5 top-0.5 bg-[var(--fg)] p-0.5 text-[var(--bg)] opacity-0 transition-opacity duration-150 hover:bg-verm group-hover:opacity-100"
      >
        <IcX size={11} />
      </button>
      <span className={`pointer-events-none absolute bottom-0.5 left-0.5 bg-[var(--panel)]/90 px-1 font-mono text-[8px] font-bold text-[var(--fg)] transition-opacity ${
        selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      }`}>
        {sp.score}
      </span>
    </div>
  );
}, (a, b) => a.sp === b.sp && a.selected === b.selected);

export function TrayRail({ tray, busy, batch, archive, keysEnabled, gate, onInspect, onRemove, onClear, onCull, onExport, onBatch }: {
  tray: Specimen[]; busy: boolean; batch: BatchProgress | null;
  archive: { url: string; name: string } | null;
  keysEnabled: boolean; gate: number;
  onInspect: (sp: Specimen) => void; onRemove: (id: string) => void;
  onClear: () => void; onCull: () => void; onExport: () => void; onBatch: (mode: 'full' | 'web') => void;
}) {
  const avg = tray.length ? Math.round(tray.reduce((a, b) => a + b.score, 0) / tray.length) : 0;
  const best = tray.length ? Math.max(...tray.map(t => t.score)) : 0;
  const packing = batch !== null;
  const pct = packing && batch ? Math.round((batch.done / Math.max(1, batch.total)) * 100) : 0;

  /* ---- windowed grid: only visible tiles exist in the DOM ---- */
  const PAD = 12, GAP = 6, OVERSCAN = 2;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [tileW, setTileW] = useState(64);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(680);
  const raf = useRef(0);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewH(el.clientHeight);
    setTileW(Math.max(24, (el.clientWidth - PAD * 2 - GAP * (COLS - 1)) / COLS));
  }, []);
  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (scrollRef.current) ro.observe(scrollRef.current);
    return () => ro.disconnect();
  }, [measure]);

  const onScroll = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
    });
  }, []);
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  const [sel, setSel] = useState<number | null>(null);
  const selRef = useRef(sel);
  useEffect(() => { selRef.current = sel; }, [sel]);
  useEffect(() => {
    if (sel !== null && sel >= tray.length) setSel(tray.length ? tray.length - 1 : null);
  }, [tray.length, sel]);
  const inspectTile = useCallback((sp: Specimen) => {
    setSel(tray.findIndex(t => t.id === sp.id));
    onInspect(sp);
  }, [tray, onInspect]);

  /* arrow-key navigation scrolls by deterministic math (tiles are virtualized) */
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
      else if (e.key === 'ArrowDown') next = cur === null ? 0 : Math.min(last, cur + COLS);
      else if (e.key === 'ArrowUp') next = cur === null ? Math.max(0, last - COLS + 1) : Math.max(0, cur - COLS);
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = last;
      else if (e.key === 'Enter' && cur !== null) {
        e.preventDefault();
        onInspect(tray[cur]);
        return;
      } else if (e.key === 'Escape' && cur !== null) {
        setSel(null);
        return;
      } else return;
      e.preventDefault();
      setSel(next);
      const el = scrollRef.current;
      if (el && next !== null) {
        const rowH = tileW + GAP;
        const top = Math.floor(next / COLS) * rowH;
        const bottom = top + tileW;
        if (top < el.scrollTop) el.scrollTop = top;
        else if (bottom > el.scrollTop + viewH) el.scrollTop = bottom - viewH;
      }
    };
    window.addEventListener('keydown', move);
    return () => window.removeEventListener('keydown', move);
  }, [keysEnabled, tray, onInspect, tileW, viewH]);

  const rowH = tileW + GAP;
  const totalRows = Math.ceil(tray.length / COLS);
  const totalH = totalRows * rowH;
  const firstRow = Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN);
  const lastRow = Math.min(totalRows - 1, Math.ceil((scrollTop + viewH) / rowH) + OVERSCAN);
  const startIdx = firstRow * COLS;
  const endIdx = Math.min(tray.length - 1, lastRow * COLS + (COLS - 1));
  const slice = tray.length > 0 ? tray.slice(startIdx, endIdx + 1) : [];
  const topSpace = firstRow * rowH;
  const bottomSpace = Math.max(0, totalH - (endIdx + 1 >= tray.length ? totalH : (lastRow + 1) * rowH));

  return (
    <>
      {archive && (
        <a
          href={archive.url}
          download={archive.name}
          className="chip-pulse group fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-4 z-40 flex max-w-[72vw] items-center gap-2.5 border-2 border-verm bg-verm px-4 py-2.5 font-mono text-[11px] font-bold tracking-[0.16em] text-[#f5f1e3] shadow-[4px_4px_0_var(--shadow-ink)] transition-all duration-150 hover:-translate-y-1 hover:bg-[var(--fg)] hover:border-[var(--fg)]"
          title="your archive is packed — one tap saves it (the path iPad Safari honors)"
        >
          <IcDown size={13} className="shrink-0" />
          <span className="truncate">SAVE ARCHIVE ▾ {archive.name.replace(/^salvage9-(fullsize-)?/, '').replace('.zip', '')}</span>
        </a>
      )}
      <aside className="border-2 border-[var(--line)] bg-[var(--panel)] shadow-[4px_4px_0_var(--shadow-ink)] xl:sticky xl:top-[118px]">
        <h2 className="flex items-baseline justify-between border-b-2 border-[var(--line)] px-3 py-2.5">
          <span className="font-display text-[19px] font-extrabold tracking-tight text-[var(--fg)]">
            CUTTING <span className="text-verm">TRAY</span>
          </span>
          <span className="font-mono text-[11px] font-semibold tabular-nums text-[var(--fg2)]">
            {tray.length}<span className="text-[var(--mut)]">/{TRAY_CAP}</span>
          </span>
        </h2>

        <div className="h-1.5 w-full border-b border-[var(--line-soft)] bg-[var(--line-soft)]">
          <div
            className={`h-full transition-all duration-500 ${tray.length >= TRAY_CAP ? 'bg-verm' : tray.length >= TRAY_CAP * 0.8 ? 'bg-gold' : 'bg-ultra'}`}
            style={{ width: `${Math.min(100, (tray.length / TRAY_CAP) * 100)}%` }}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 border-b border-[var(--line-soft)] px-3 py-2.5">
          {packing && batch ? (
            <div className="col-span-2 flex items-center justify-center gap-2 bg-moss px-2 py-2 font-mono text-[11px] font-bold tracking-[0.16em] text-[#f5f1e3]">
              <IcDown size={14} className="animate-bounce" /> PACKING {batch.done}/{batch.total} · {batch.mb} MB
              {batch.failed > 0 ? <span className="text-[#ffd28a]">({batch.failed} blocked)</span> : null}
            </div>
          ) : (
            <>
              <button
                type="button" onClick={() => onBatch('full')} disabled={tray.length === 0 || busy}
                title="every plate as its untouched original file — archives run big"
                className="flex items-center justify-center gap-2 bg-moss px-2 py-2 font-mono text-[10.5px] font-bold tracking-[0.12em] text-[#f5f1e3] transition-all duration-150 hover:-translate-y-0.5 hover:bg-[var(--fg)] disabled:pointer-events-none disabled:opacity-35"
              >
                <IcDown size={13} /> ZIP · FULL
              </button>
              <button
                type="button" onClick={() => onBatch('web')} disabled={tray.length === 0 || busy}
                title="plates pressed to 1400px jpeg — collage-ready and light enough for any device"
                className="flex items-center justify-center gap-2 bg-ultra px-2 py-2 font-mono text-[10.5px] font-bold tracking-[0.12em] text-[#f5f1e3] transition-all duration-150 hover:-translate-y-0.5 hover:bg-[var(--fg)] disabled:pointer-events-none disabled:opacity-35"
              >
                <IcDown size={13} /> ZIP · 1400PX
              </button>
            </>
          )}
          <button
            type="button" onClick={onExport} disabled={tray.length === 0 || busy || packing}
            className="flex items-center justify-center gap-2 bg-[var(--fg)] px-2 py-2 font-mono text-[10.5px] font-bold tracking-[0.14em] text-[var(--bg)] transition-all duration-150 hover:-translate-y-0.5 hover:bg-ultra disabled:pointer-events-none disabled:opacity-35"
          >
            <IcPrint size={13} /> {busy ? 'PRESSING…' : 'PRINT SHEET'}
          </button>
          <button
            type="button" onClick={onClear} disabled={tray.length === 0 || packing}
            className="border-2 border-[var(--line)] px-3 py-2 font-mono text-[10.5px] font-bold tracking-[0.14em] text-[var(--fg)] transition-colors hover:bg-verm hover:border-verm hover:text-[#f5f1e3] disabled:pointer-events-none disabled:opacity-35"
          >
            <IcTrash size={13} /> SWEEP
          </button>
          <button
            type="button" onClick={onCull} disabled={tray.length === 0 || packing}
            title="remove every cut grading below the current taste gate — keep only top-shelf material"
            className="col-span-2 border-2 border-ultra px-3 py-2 font-mono text-[10.5px] font-bold tracking-[0.14em] text-ultra transition-colors hover:bg-ultra hover:text-[#f5f1e3] disabled:pointer-events-none disabled:opacity-35"
          >
            <IcScissors size={13} /> CULL BELOW GRADE {gate}
          </button>
        </div>

        {packing && batch && (
          <div className="border-b border-[var(--line-soft)] px-3 py-1.5">
            <div className="h-1 w-full bg-[var(--line-soft)]">
              <div className="h-full bg-moss transition-all duration-200" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 font-mono text-[8.5px] tracking-[0.14em] text-[var(--mut)]">
              10-WAY PULL · 12s DEADLINE PER HOST · CORS-BLOCKED SKIPPED · CORRUPT FILES RE-ENCODED
            </div>
          </div>
        )}

        {tray.length > 0 && (
          <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-3 py-1.5 font-mono text-[9.5px] tracking-[0.14em] text-[var(--mut)]">
            <span>AVG GRADE <strong className="text-ultra">{avg}</strong></span>
            <span>BEST <strong className="text-verm">{best}</strong></span>
          </div>
        )}

        {tray.length === 0 ? (
          <div className="p-3">
            <div className="grid place-items-center border-2 border-dashed border-[var(--line)]/30 px-4 py-10 text-center">
              <IcScissors size={30} className="mb-3 text-[var(--mut)]" />
              <div className="font-display text-[16px] font-bold text-[var(--fg)]">NOTHING CUT YET</div>
              <p className="mt-1.5 font-mono text-[9.5px] leading-relaxed text-[var(--mut)]">
                anything that clears the gate lands here.
                <br />pull rejects back with OVERRIDE.
              </p>
            </div>
          </div>
        ) : (
          <div ref={scrollRef} onScroll={onScroll} className="max-h-[680px] overflow-y-auto scroll-slim">
            <div style={{ height: topSpace }} aria-hidden="true" />
            <div className="grid grid-cols-4 gap-1.5 px-3">
              {slice.map(sp => (
                <TrayTile
                  key={sp.id}
                  sp={sp}
                  selected={sel !== null && tray[sel]?.id === sp.id}
                  onInspect={inspectTile}
                  onRemove={onRemove}
                />
              ))}
            </div>
            <div style={{ height: bottomSpace }} aria-hidden="true" />
          </div>
        )}

        <p className="border-t border-[var(--line-soft)] px-3 py-2 font-mono text-[9px] leading-relaxed tracking-wide text-[var(--mut)]">
          tray holds {TRAY_CAP} cuts · <strong className="text-[var(--fg2)]">ZIP · FULL</strong> packs untouched originals,
          <strong className="text-[var(--fg2)]"> ZIP · 1400PX</strong> packs collage-ready jpegs · PRINT SHEET presses a composite PNG.
          <br />ARROW KEYS walk the grid · ENTER inspects.
        </p>
      </aside>
    </>
  );
}
