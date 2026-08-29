import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Specimen } from '../lib/types';
import { FEED_CAP } from '../lib/engine';
import { IcDown, IcScissors, IcTrash, Meter, SourceChip, Stamp } from './ui';

const jitter = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return { rot: ((h % 9) - 4) * 0.32, taped: h % 3 === 0 };
};

const SpecimenCard = memo(function SpecimenCard({ sp, inTray, onInspect, onCut, onBin, onZap, onDownload }: {
  sp: Specimen; inTray: boolean;
  onInspect: (sp: Specimen) => void; onCut: (sp: Specimen) => void;
  onBin: (id: string) => void; onZap: (sp: Specimen) => void; onDownload: (sp: Specimen) => void;
}) {
  const judged = sp.state === 'judged';
  const rejected = judged && sp.verdict === 'reject';
  const { rot, taped } = jitter(sp.id);

  return (
    <article
      data-plate-id={sp.id}
      style={{ transform: `rotate(${rot}deg)` }}
      className="cv-card anim-rise group relative mb-5 break-inside-avoid border-2 border-[var(--line)] bg-[var(--panel)] transition-all duration-200 hover:-translate-y-1 hover:shadow-[6px_6px_0_var(--shadow-ink)]"
    >
      {taped && <span className="tape" aria-hidden="true" />}
      <button type="button" onClick={() => onInspect(sp)} className="relative block w-full cursor-zoom-in overflow-hidden border-b-2 border-[var(--line-soft)]"
        aria-label={`inspect ${sp.code}`}>
        <div style={{ aspectRatio: String(sp.aspect) }} className={`relative w-full bg-[var(--line-soft)] ${sp.cutoutSrc ? 'checker' : ''}`}>
          <img
            src={sp.cutoutSrc ?? (sp.remote ? sp.thumb : sp.dataUri)}
            alt={`${sp.archetype} — ${sp.code}`}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className={`absolute inset-0 h-full w-full ${sp.cutoutSrc ? 'object-contain' : 'object-cover'} transition-transform duration-500 group-hover:scale-[1.03] ${
              rejected ? 'opacity-60 grayscale-[0.75]' : ''
            } ${judged ? '' : 'opacity-40'}`}
          />
          {!judged && (
            <div className="shimmer-block absolute inset-0 grid place-items-center">
              <div className="scan-bar" />
              <span className="relative z-10 border-2 border-[var(--line)]/50 bg-[var(--panel)]/85 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.2em] text-[var(--fg2)]">
                FETCHING ▒▒
              </span>
            </div>
          )}
        </div>
        {judged && (
          <span className="anim-stamp absolute right-2 top-2"><Stamp kind={rejected ? 'reject' : 'pass'} score={sp.score} /></span>
        )}
        {inTray && <span className="absolute left-2 top-2"><Stamp kind="tray" /></span>}
        <span
          className={`absolute bottom-1.5 left-1.5 border px-1 py-px font-mono text-[8px] font-bold tracking-[0.18em] ${
            sp.remote ? 'border-moss/60 bg-[#10150b]/85 text-[#a8d887]' : 'border-gold/70 bg-[#181206]/85 text-[#e8c26a]'
          }`}
        >
          {sp.remote ? '● LIVE' : '◇ LOCAL'}
        </span>
        {(sp.isoState === 'queue' || sp.isoState === 'work') && (
          <span className="absolute bottom-1.5 right-1.5 animate-pulse border border-ultra/60 bg-[#10122a]/85 px-1 py-px font-mono text-[8px] font-bold tracking-[0.18em] text-[#9fb2ff]">
            ✂ {sp.isoState === 'queue' ? 'QUEUED' : 'CUTTING'}
          </span>
        )}
        {sp.cutoutSrc && (
          <span className="absolute bottom-1.5 right-1.5 border border-verm/70 bg-[#2a120c]/85 px-1 py-px font-mono text-[8px] font-bold tracking-[0.18em] text-[#ff9d7a]">
            ✂ ISO
          </span>
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
          <span className="truncate font-display text-[12px] font-medium italic text-[var(--fg2)]">
            “{sp.archetype}”
          </span>
        </div>
        <div className="mt-1 truncate font-mono text-[9px] tracking-wide text-[var(--mut)]">
          {sp.remote && sp.credit ? `${sp.credit} · ` : ''}
          {sp.remote ? (sp.sourceName || sp.provider || '') : sp.tags.join(' · ')}
        </div>
      </div>

      <div className="flex border-t-2 border-[var(--line-soft)]">
        {rejected ? (
          <button type="button" disabled={!judged} onClick={() => onCut(sp)}
            className="flex flex-1 items-center justify-center gap-1.5 py-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-verm transition-colors hover:bg-verm hover:text-[#f5f1e3] disabled:opacity-30">
            <IcScissors size={12} /> OVERRIDE
          </button>
        ) : inTray ? (
          <span className="flex flex-1 cursor-default items-center justify-center gap-1.5 py-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-ultra">
            <IcScissors size={12} /> CUT ✓
          </span>
        ) : (
          <button type="button" disabled={!judged} onClick={() => onCut(sp)}
            className="flex flex-1 items-center justify-center gap-1.5 py-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-[var(--fg)] transition-colors hover:bg-[var(--fg)] hover:text-[var(--bg)] disabled:opacity-30">
            <IcScissors size={12} /> CUT
          </button>
        )}
        <button type="button" onClick={() => onBin(sp.id)}
          className="flex flex-1 items-center justify-center gap-1.5 border-l border-[var(--line-soft)] py-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-[var(--fg2)] transition-colors hover:bg-[var(--fg)] hover:text-[var(--bg)]">
          <IcTrash size={12} /> BIN
        </button>
        <button type="button" disabled={!judged} onClick={() => onZap(sp)}
          title="send to the glitch lab"
          className="flex flex-1 items-center justify-center gap-1.5 border-l border-[var(--line-soft)] py-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-[var(--fg2)] transition-colors hover:bg-gold hover:text-black disabled:opacity-30">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M13 2 4.5 14H11l-1.5 8L18 10h-6.5L13 2Z" />
          </svg>
          ZAP
        </button>
        <button type="button" disabled={!judged} onClick={() => onDownload(sp)}
          className="flex flex-1 items-center justify-center gap-1.5 border-l border-[var(--line-soft)] py-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-[var(--fg2)] transition-colors hover:bg-ultra hover:text-[#f5f1e3] disabled:opacity-30">
          <IcDown size={12} /> PNG
        </button>
      </div>
    </article>
  );
}, (a, b) => a.sp === b.sp && a.inTray === b.inTray);

export function Feed({ feed, seen, showRejects, trayIds, running, spm, onInspect, onCut, onBin, onZap, onDownload, onPurge }: {
  feed: Specimen[]; seen: number; showRejects: boolean; trayIds: Set<string>; running: boolean; spm: number;
  onInspect: (sp: Specimen) => void; onCut: (sp: Specimen) => void;
  onBin: (id: string) => void; onZap: (sp: Specimen) => void; onDownload: (sp: Specimen) => void; onPurge: () => void;
}) {
  const visible = showRejects ? feed : feed.filter(f => f.state === 'incoming' || f.verdict === 'pass');

  /* ---- stable manual columns: append-only, the reader owns the scroll ----
     New plates join the SHORTEST column's bottom (prefix-stable greedy),
     so existing cards never move when plates arrive. */
  const colCountFor = (w: number) => (w < 640 ? 1 : w < 1536 ? 2 : 3);
  const [colCount, setColCount] = useState(() => colCountFor(window.innerWidth));
  useEffect(() => {
    const onResize = () => setColCount(colCountFor(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const columns = useMemo(() => {
    const cols: Specimen[][] = Array.from({ length: colCount }, () => []);
    const heights = new Array(colCount).fill(0);
    const CHROME = 150;
    for (const sp of visible) {
      const h = (1 / Math.max(0.05, sp.aspect)) * 100 + CHROME;
      let best = 0;
      for (let i = 1; i < colCount; i++) if (heights[i] < heights[best]) best = i;
      cols[best].push(sp);
      heights[best] += h;
    }
    return cols;
  }, [visible, colCount]);

  /* fresh-plates beacon: counts arrivals while you read elsewhere */
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
    window.addEventListener('resize', onScroll);
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
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
          <h2 className="font-display text-[30px] font-extrabold leading-none tracking-tight text-[var(--fg)]">
            LIVE INTAKE
          </h2>
          <div className="mt-1.5 flex items-center gap-2">
            <span className={`inline-block h-[5px] w-16 ${running ? 'dash-live' : 'bg-[var(--line-soft)]'}`} />
            <span className="font-mono text-[10px] font-bold tracking-[0.24em] text-[var(--fg2)]">
              {running ? 'CHEWING' : 'HELD'}
            </span>
            <span className="font-mono text-[10px] tracking-[0.14em] text-[var(--mut)]">
              ≈{spm}/MIN · BUFFER {feed.length}/{FEED_CAP}
            </span>
          </div>
        </div>
        <button
          type="button" onClick={onPurge}
          className="border-2 border-[var(--line)] px-3 py-1.5 font-mono text-[11px] font-bold tracking-[0.18em] text-[var(--fg)] transition-all duration-150 hover:-translate-y-0.5 hover:bg-verm hover:border-verm hover:text-[#f5f1e3]"
        >
          PURGE BUFFER
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="grid place-items-center border-2 border-dashed border-[var(--line)]/40 bg-[var(--panel)]/60 px-6 py-20 text-center">
          <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className="mb-4 text-[var(--mut)]">
            <circle cx="6" cy="6.5" r="2.7" /><circle cx="6" cy="17.5" r="2.7" /><path d="M8.3 8 20 18M8.3 16 20 6" />
          </svg>
          <div className="font-display text-2xl font-extrabold text-[var(--fg)]">THE HOPPER IS EMPTY.</div>
          <p className="mt-2 max-w-[380px] font-mono text-[11px] leading-relaxed text-[var(--fg2)]">
            {running
              ? 'Spiders are out on the mirrors — specimens drop here the moment they clear intake.'
              : 'Machine is on HOLD. Resume the crawl to feed the intake.'}
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-4">
            {columns.map((col, ci) => (
              <div key={ci} className="flex min-w-0 flex-1 flex-col">
                {col.map(sp => (
                  <SpecimenCard
                    key={sp.id}
                    sp={sp}
                    inTray={trayIds.has(sp.id)}
                    onInspect={onInspect}
                    onCut={onCut}
                    onBin={onBin}
                    onZap={onZap}
                    onDownload={onDownload}
                  />
                ))}
              </div>
            ))}
          </div>
          <div ref={tailRef} className="h-px" aria-hidden="true" />
        </>
      )}

      {freshBelow > 0 && (
        <button
          type="button"
          onClick={() => tailRef.current?.scrollIntoView({
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
            block: 'end',
          })}
          className="group fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2.5 border-2 border-verm bg-[var(--fg)] px-4 py-2.5 font-mono text-[11px] font-bold tracking-[0.18em] text-[var(--bg)] shadow-[4px_4px_0_var(--shadow-ink)] transition-all duration-150 hover:-translate-y-1 hover:bg-verm hover:text-[#f5f1e3]"
        >
          <span className="anim-led inline-block h-2 w-2 rounded-full bg-[#7ebe5c]" />
          {freshBelow} FRESH ON THE BELT
          <span className="text-verm transition-colors group-hover:text-[#f5f1e3]">▾</span>
        </button>
      )}
    </div>
  );
}
