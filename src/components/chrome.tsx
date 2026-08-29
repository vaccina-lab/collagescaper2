import { useLayoutEffect, useRef, useState } from 'react';
import type { LogLine, Pace, SourceDef, SourcesState, Family } from '../lib/engine';
import { FAMILY_LABEL, gateWord } from '../lib/engine';
import type { Family as Fam } from '../lib/types';
import { FAMILY_LIST } from '../lib/types';
import { IcBolt, IcGrid, IcHammer, IcLayers, IcMoon, IcPause, IcPlay, IcSun, IcX, Led, Toggle } from './ui';

export type View = 'floor' | 'lab' | 'desk' | 'forge';

const fmtUptime = (s: number) =>
  `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

const TICKER_DOT: Record<LogLine['level'], string> = {
  sys: '#8a8270', pass: '#93b1ff', bin: '#6b6558', warn: '#e8b341', err: '#ff7a55', cut: '#8fd8c4',
};

function Readout({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-[74px]">
      <div className="font-mono text-[9px] font-medium tracking-[0.28em] text-[var(--mut)]">{label}</div>
      <div className={`font-mono text-xl font-semibold tabular-nums leading-tight ${accent ? 'text-[#ff8a5c]' : 'text-[var(--fg)]'}`}>{value}</div>
    </div>
  );
}

function TickerStrip({ lines, running }: { lines: LogLine[]; running: boolean }) {
  const seq = lines.map(l => (
    <span key={l.id} className="inline-flex items-center gap-2">
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: TICKER_DOT[l.level] }} />
      <span className="whitespace-nowrap">{l.msg}</span>
      <span className="mx-4 opacity-30">///</span>
    </span>
  ));
  if (seq.length === 0) return null;
  return (
    <div className="relative overflow-hidden border-t border-[var(--line-soft)] bg-black/20 py-1">
      <div className={`ticker-track flex w-max font-mono text-[10px] tracking-[0.06em] text-[var(--fg2)] ${running ? '' : '[animation-play-state:paused]'}`} aria-hidden="true">
        <span className="flex items-center">{seq}</span>
        <span className="flex items-center">{seq}</span>
      </div>
    </div>
  );
}

export function Header({ running, trayHeld, uptime, seen, passRate, gate, trayCount, log, night, view, onToggleRun, onToggleNight, onView }: {
  running: boolean; trayHeld: boolean; uptime: number; seen: number; passRate: number; gate: number; trayCount: number;
  log: LogLine[]; night: boolean; view: View;
  onToggleRun: () => void; onToggleNight: () => void; onView: (v: View) => void;
}) {
  const cell = (v: View, label: string, short: string, keyHint: string) => {
    const Icon = v === 'floor' ? IcGrid : v === 'lab' ? IcBolt : v === 'desk' ? IcLayers : IcHammer;
    const active = view === v;
    return (
      <button type="button" onClick={() => onView(v)} aria-pressed={active}
        className={`flex items-center gap-1.5 px-2.5 py-2 font-mono text-[10px] font-bold tracking-[0.16em] transition-colors ${
          active ? 'bg-verm text-[#f5f1e3]' : 'text-[var(--fg2)] hover:bg-[var(--line-soft)] hover:text-[var(--fg)]'}`}>
        <Icon size={13} />
        <span className="hidden sm:inline">{label}</span>
        <span className="sm:hidden">{short}</span>
        <kbd className={`hidden rounded-sm border px-1 font-mono text-[9px] leading-tight md:inline ${active ? 'border-[#f5f1e3]/40' : 'border-[var(--line-soft)]'}`}>{keyHint}</kbd>
      </button>
    );
  };
  return (
    <header className="sticky top-0 z-40 border-b-2 border-[var(--line)] bg-[var(--panel)] shadow-[0_3px_0_var(--shadow-ink)]">
      <div className={`h-[7px] ${running ? 'conveyor' : 'conveyor-held'}`} />
      <div className="mx-auto flex max-w-[1560px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 lg:px-6">
        <div className="shrink-0">
          <div className="font-mono text-[9px] font-medium tracking-[0.32em] text-[var(--mut)]">AUTONOMOUS COLLAGE HARVESTER</div>
          <h1 className="font-display text-[30px] font-extrabold leading-none tracking-tight text-[var(--fg)]">
            SALVAGE<span className="text-verm">/9</span>
          </h1>
        </div>
        <div className="hidden h-11 w-px bg-[var(--line-soft)] lg:block" />
        <div className="hidden items-center gap-6 lg:flex">
          <Readout label="UPTIME" value={fmtUptime(uptime)} />
          <Readout label="SEEN" value={seen.toLocaleString('en-US')} />
          <Readout label="PASS RATE" value={`${passRate.toFixed(1)}%`} accent />
          <Readout label="GATE" value={String(gate)} />
          <Readout label="TRAY" value={String(trayCount)} />
        </div>
        <div className="flex-1" />
        <nav aria-label="machine mode" className="flex shrink-0 overflow-hidden border-2 border-[var(--line)]">
          {cell('floor', 'FLOOR', 'FLR', 'F')}
          <span className="w-px bg-[var(--line-soft)]" aria-hidden="true" />
          {cell('lab', 'GLITCH LAB', 'LAB', 'G')}
          <span className="w-px bg-[var(--line-soft)]" aria-hidden="true" />
          {cell('desk', 'PASTE-UP', 'DESK', 'D')}
          <span className="w-px bg-[var(--line-soft)]" aria-hidden="true" />
          {cell('forge', 'FORGE', 'FRG', 'B')}
        </nav>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onToggleNight} title={night ? 'day shift' : 'night shift'} aria-label="toggle night mode"
            className={`border-2 border-[var(--line)] p-1.5 transition-colors ${night ? 'bg-ultra text-[#f5f1e3]' : 'text-[var(--fg2)] hover:bg-[var(--line-soft)]'}`}>
            {night ? <IcSun size={14} /> : <IcMoon size={14} />}
          </button>
          <span className="hidden items-center gap-2 font-mono text-[11px] font-semibold tracking-[0.22em] text-[var(--fg2)] sm:flex">
            <Led running={running} pulse={trayHeld} />
            <span className={trayHeld ? 'text-[#e8b341]' : ''}>{running ? 'CRAWLING' : trayHeld ? 'TRAY FULL' : 'HELD'}</span>
          </span>
          <button type="button" onClick={onToggleRun}
            className={`flex items-center gap-2 border-2 px-3 py-2 font-display text-[14px] font-bold tracking-wide transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0 sm:px-4 ${
              running
                ? 'border-[var(--line)] bg-[var(--fg)] text-[var(--bg)] hover:bg-verm hover:border-verm hover:text-[#f5f1e3]'
                : 'border-verm bg-verm text-[#f5f1e3] hover:bg-[var(--fg)] hover:border-[var(--line)] hover:text-[var(--bg)]'}`}>
            {running ? <IcPause size={13} /> : <IcPlay size={13} />}
            {running ? 'HOLD' : 'RESUME'}
          </button>
        </div>
      </div>
      <TickerStrip lines={log.slice(-8)} running={running} />
    </header>
  );
}

const SECTIONS = [
  { id: 'control', label: 'CONTROL' },
  { id: 'intake', label: 'INTAKE' },
  { id: 'tray', label: 'TRAY' },
] as const;

export function JumpRail({ view, onGo }: { view: View; onGo: (v: View) => void }) {
  const [active, setActive] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (view !== 'floor') return;
    const els = SECTIONS.map(s => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    if (els.length === 0) return;
    const io = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
    }, { rootMargin: '-35% 0px -55% 0px' });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [view]);
  if (view !== 'floor') return null;
  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    setActive(id);
    setFlash(id);
    window.setTimeout(() => setFlash(f => (f === id ? null : f)), 400);
  };
  return (
    <nav aria-label="jump to section" className="fixed right-3 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-1.5 lg:flex">
      {SECTIONS.map(s => (
        <button key={s.id} type="button" onClick={() => jump(s.id)} title={s.label}
          className={`group relative flex h-8 w-8 items-center justify-center border-2 transition-all duration-150 ${
            active === s.id ? 'border-verm bg-verm text-[#f5f1e3]' : 'border-[var(--line)]/40 bg-[var(--panel)]/85 text-[var(--fg2)] hover:border-[var(--line)]'
          } ${flash === s.id ? 'scale-110' : ''}`}>
          <span className="font-mono text-[9px] font-bold">{s.label[0]}</span>
          <span className="pointer-events-none absolute right-full mr-2 hidden whitespace-nowrap border border-[var(--line)] bg-[var(--fg)] px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.18em] text-[var(--bg)] group-hover:block">{s.label}</span>
        </button>
      ))}
      <button type="button" onClick={() => onGo('lab')} title="GLITCH LAB"
        className="flex h-8 w-8 items-center justify-center border-2 border-ultra/50 bg-[var(--panel)]/85 text-ultra transition-all duration-150 hover:border-ultra hover:bg-ultra hover:text-[#f5f1e3]">
        <IcBolt size={12} />
      </button>
    </nav>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="border-2 border-[var(--line)] bg-[var(--panel)] shadow-[4px_4px_0_var(--shadow-ink)]">
      <h3 className="flex items-baseline gap-2 border-b-2 border-[var(--line)] px-3 py-2">
        <span className="font-mono text-[10px] font-bold text-verm">{n}</span>
        <span className="font-display text-[15px] font-extrabold tracking-tight text-[var(--fg)]">{title}</span>
      </h3>
      <div className="px-3 py-2.5">{children}</div>
    </section>
  );
}

function PaceSwitch({ pace, onPace }: { pace: Pace; onPace: (p: Pace) => void }) {
  return (
    <div className="flex overflow-hidden border-2 border-[var(--line)]">
      {(['cruise', 'rapid'] as Pace[]).map(p => (
        <button key={p} type="button" onClick={() => onPace(p)} aria-pressed={pace === p}
          className={`flex-1 px-2 py-1.5 font-mono text-[10px] font-bold tracking-[0.18em] transition-colors ${
            pace === p ? 'bg-[var(--fg)] text-[var(--bg)]' : 'text-[var(--fg2)] hover:bg-[var(--line-soft)]'}`}>
          {p.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/* ---------------- add-your-own-tap form ---------------- */
function AddTapForm({ onAddTap }: { onAddTap: (input: { name: string; query: string; family: Family }) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState<Family>('patent');
  const submit = () => {
    if (!name.trim() && !query.trim()) return;
    onAddTap({ name: name.trim() || query.trim(), query: query.trim(), family });
    setName(''); setQuery(''); setOpen(false);
  };
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="mt-2 w-full border-2 border-dashed border-[var(--line-soft)] px-2 py-2 font-mono text-[9.5px] font-bold tracking-[0.18em] text-[var(--mut)] transition-colors hover:border-verm hover:text-verm">
        + PLUMB A NEW TAP
      </button>
    );
  }
  return (
    <div className="anim-rise mt-2 border-2 border-verm bg-[var(--panel)] p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[9px] font-bold tracking-[0.2em] text-verm">NEW TAP</span>
        <button type="button" onClick={() => setOpen(false)} aria-label="close" className="text-[var(--mut)] hover:text-verm"><IcX size={12} /></button>
      </div>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="tap name (e.g. Weird Fish)"
        className="mb-1.5 w-full border border-[var(--line-soft)] bg-[var(--bg)] px-2 py-1.5 font-mono text-[10.5px] text-[var(--fg)] outline-none focus:border-verm" />
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="search query (e.g. vintage fish illustration)"
        className="mb-1.5 w-full border border-[var(--line-soft)] bg-[var(--bg)] px-2 py-1.5 font-mono text-[10.5px] text-[var(--fg)] outline-none focus:border-verm" />
      <select value={family} onChange={e => setFamily(e.target.value as Family)}
        className="mb-2 w-full border border-[var(--line-soft)] bg-[var(--bg)] px-2 py-1.5 font-mono text-[10.5px] text-[var(--fg)] outline-none focus:border-verm">
        {FAMILY_LIST.map(f => <option key={f} value={f}>{FAMILY_LABEL[f]}</option>)}
      </select>
      <button type="button" onClick={submit} disabled={!name.trim() && !query.trim()}
        className="w-full border-2 border-verm bg-verm px-2 py-1.5 font-mono text-[10px] font-bold tracking-[0.18em] text-[#f5f1e3] hover:opacity-85 disabled:opacity-30">
        ⚒ PLUMB IT
      </button>
    </div>
  );
}

export function ControlRail(props: {
  defs: Record<string, SourceDef>; sources: SourcesState; gate: number; cutGate: number; autoCut: boolean; autoIso: boolean;
  showRejects: boolean; pace: Pace; keepAwake: boolean; log: LogLine[]; running: boolean;
  onGate: (v: number) => void; onCutGate: (v: number) => void; onToggleSource: (id: string) => void; onToggleAutoCut: () => void;
  onToggleAutoIso: () => void; onToggleKeepAwake: () => void; onShowRejects: (v: boolean) => void; onPace: (p: Pace) => void;
  onAddTap?: (input: { name: string; query: string; family: Family }) => void;
}) {
  const { defs, sources, gate, cutGate, autoCut, autoIso, showRejects, pace, keepAwake, log, running,
    onGate, onCutGate, onToggleSource, onToggleAutoCut, onToggleAutoIso, onToggleKeepAwake, onShowRejects, onPace, onAddTap } = props;
  const [frozen, setFrozen] = useState<LogLine[] | null>(null);
  const [logScrolledUp, setLogScrolledUp] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const shownLog = frozen ?? log;
  const frozenBehind = frozen ? Math.max(0, log.length - frozen.length) : 0;
  const logDocked = useRef(true);
  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el || frozen) return;
    if (logDocked.current) el.scrollTop = el.scrollHeight;
  }, [log, frozen]);
  const onLogScroll = () => {
    const el = logRef.current;
    if (!el) return;
    const up = el.scrollHeight - el.scrollTop - el.clientHeight > 48;
    logDocked.current = !up;
    setLogScrolledUp(up);
  };

  const defList = Object.values(defs);

  return (
    <div id="control" className="flex min-w-0 flex-col gap-4 scroll-mt-28">
      <Section n="01" title="TASTE GATE">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] tracking-[0.2em] text-[var(--mut)]">THRESHOLD</span>
          <span className="font-display text-lg font-extrabold text-verm">{gate} · {gateWord(gate)}</span>
        </div>
        <input type="range" min={0} max={95} step={1} value={gate} onChange={e => onGate(Number(e.target.value))}
          className="gate-range mt-1 w-full" aria-label="taste gate threshold" />
        <div className="mt-1 flex justify-between font-mono text-[8px] tracking-[0.14em] text-[var(--mut)]">
          <span>SLOP</span><span>RARITY</span>
        </div>
      </Section>

      <Section n="02" title="BEHAVIOR">
        <div className="flex flex-col gap-1">
          <Toggle on={autoCut} onClick={onToggleAutoCut} label="AUTO-CUT" hint="passes flow straight to the tray" />
          <Toggle on={autoIso} onClick={onToggleAutoIso} label="AUTO-ISOLATE" hint="cut subjects out on the way to the tray" />
          {autoIso && (
            <div className="mt-1 border-l-2 border-verm/40 pl-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] tracking-[0.2em] text-[var(--mut)]">CUT GATE</span>
                <span className="font-display text-sm font-extrabold text-verm">{cutGate}</span>
              </div>
              <input type="range" min={0} max={95} step={1} value={cutGate} onChange={e => onCutGate(Number(e.target.value))}
                className="gate-range mt-1 w-full" aria-label="cut gate — minimum isolation grade kept as a cut" />
              <div className="mt-0.5 font-mono text-[8px] leading-snug tracking-[0.08em] text-[var(--mut)]">
                isolation grades ≥ this stay cuts · below it the plate lands full-frame
              </div>
            </div>
          )}
          <Toggle on={keepAwake} onClick={onToggleKeepAwake} label="KEEP-AWAKE" hint="silent audio keeps the tab alive to harvest in the background" />
          <Toggle on={showRejects} onClick={() => onShowRejects(!showRejects)} label="SHOW BINNED" hint="show rejected plates on the belt" />
        </div>
        <div className="mt-2">
          <div className="mb-1 font-mono text-[10px] tracking-[0.2em] text-[var(--mut)]">CRAWL PACE</div>
          <PaceSwitch pace={pace} onPace={onPace} />
        </div>
      </Section>

      <Section n="03" title={`TAPS · ${defList.filter(d => sources[d.id]?.on).length}/${defList.length}`}>
        <div className="max-h-[300px] overflow-y-auto pr-1 scroll-slim">
          {defList.map(d => {
            const st = sources[d.id];
            const on = st?.on ?? false;
            return (
              <button key={d.id} type="button" onClick={() => onToggleSource(d.id)} aria-pressed={on}
                className={`group flex w-full items-center gap-2 border-b border-[var(--line-soft)] px-1 py-1.5 text-left transition-colors hover:bg-[var(--line-soft)] ${on ? '' : 'opacity-40'}`}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: `hsl(${d.hue} 72% 44%)`, boxShadow: on ? `0 0 6px hsl(${d.hue} 72% 44% / 0.9)` : 'none' }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[10.5px] font-bold text-[var(--fg)]">{d.name}</span>
                  <span className="block truncate font-mono text-[8.5px] text-[var(--mut)]">{d.blurb} · {FAMILY_LABEL[d.family]}</span>
                </span>
                <span className="shrink-0 font-mono text-[9px] tabular-nums text-[var(--mut)]">{st?.pulled ?? 0}</span>
                <span className={`shrink-0 font-mono text-[8px] font-bold tracking-widest ${on ? 'text-moss' : 'text-[var(--mut)]'}`}>{on ? 'ON' : 'OFF'}</span>
              </button>
            );
          })}
        </div>
        {onAddTap && <AddTapForm onAddTap={onAddTap} />}
      </Section>

      <Section n="04" title="CRAWL LOG">
        <div className="relative">
          <div ref={logRef} onScroll={onLogScroll}
            className="logdark h-[220px] overflow-y-auto border border-[var(--line-soft)] bg-[#15120c] p-2 scroll-slim">
            {shownLog.map(l => (
              <div key={l.id} className="flex gap-2 font-mono text-[9.5px] leading-relaxed">
                <span className="shrink-0 text-[#8a8270]">{l.t}</span>
                <span className={
                  l.level === 'pass' ? 'text-[#93b1ff]' :
                  l.level === 'bin' ? 'text-[#6b6558]' :
                  l.level === 'warn' ? 'text-[#e8b341]' :
                  l.level === 'err' ? 'text-[#ff7a55]' :
                  l.level === 'cut' ? 'text-[#8fd8c4]' : 'text-[#b8b09c]'
                }>{l.msg}</span>
              </div>
            ))}
            {running && !frozen && <span className="anim-blink inline-block h-3 w-2 bg-[#8fd8c4]" aria-hidden="true" />}
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="font-mono text-[8.5px] tracking-[0.14em] text-[var(--mut)]">
              {frozen ? `FROZEN · ${frozenBehind} new` : logScrolledUp ? 'SCROLLED UP' : 'LIVE'}
            </span>
            <div className="flex gap-1.5">
              {logScrolledUp && !frozen && (
                <button type="button" onClick={() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }}
                  className="border border-[var(--line)] px-1.5 py-0.5 font-mono text-[8.5px] font-bold text-[var(--fg)] hover:bg-[var(--fg)] hover:text-[var(--bg)]">▼ TAIL</button>
              )}
              <button type="button" onClick={() => setFrozen(f => (f ? null : [...log]))}
                className="border border-[var(--line)] px-1.5 py-0.5 font-mono text-[8.5px] font-bold text-[var(--fg)] hover:bg-[var(--fg)] hover:text-[var(--bg)]">
                {frozen ? 'THAW' : 'FREEZE'}
              </button>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
