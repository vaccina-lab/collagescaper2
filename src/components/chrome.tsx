import { useEffect, useRef, useState } from 'react';
import type { Family } from '../lib/types';
import type { LogLine, Pace, SourceDef, SourcesState } from '../lib/engine';
import { FAMILY_LABEL, gateWord } from '../lib/engine';
import { IcBolt, IcGrid, IcHammer, IcLayers, IcMoon, IcPause, IcPlay, IcSun, Led, Toggle } from './ui';

export type View = 'floor' | 'lab' | 'desk' | 'forge';

const fmtUptime = (s: number) =>
  `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

const TICKER_DOT: Record<LogLine['level'], string> = {
  sys: '#8a8270', pass: '#93b1ff', bin: '#6b6558', warn: '#e8b341', err: '#ff7a55', cut: '#8fd8c4',
};

function Readout({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-[70px]">
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
    <div className="relative overflow-hidden border-t border-[var(--line-soft)] bg-black/15 py-1">
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
        className={`flex items-center gap-1.5 px-2.5 py-2 font-mono text-[10px] font-bold tracking-[0.14em] transition-colors ${
          active ? 'bg-verm text-[#f5f1e3]' : 'text-[var(--fg2)] hover:bg-[var(--line-soft)] hover:text-[var(--fg)]'}`}>
        <Icon size={13} />
        <span className="hidden md:inline">{label}</span>
        <span className="md:hidden">{short}</span>
        <kbd className={`hidden rounded-sm border px-1 font-mono text-[9px] leading-tight lg:inline ${active ? 'border-[#f5f1e3]/40' : 'border-[var(--line-soft)]'}`}>{keyHint}</kbd>
      </button>
    );
  };
  return (
    <header className="sticky top-0 z-40 border-b-2 border-[var(--line)] bg-[var(--panel)] shadow-[0_3px_0_var(--shadow-ink)]">
      <div className={`h-[7px] ${running ? 'conveyor' : 'conveyor-held'}`} />
      <div className="mx-auto flex max-w-[1560px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 lg:px-6">
        <div className="shrink-0">
          <div className="font-mono text-[9px] font-medium tracking-[0.3em] text-[var(--mut)]">AUTONOMOUS COLLAGE HARVESTER</div>
          <h1 className="font-display text-[28px] font-extrabold leading-none tracking-tight text-[var(--fg)]">
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
          <span className="hidden items-center gap-2 font-mono text-[11px] font-semibold tracking-[0.2em] text-[var(--fg2)] sm:flex">
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

function SectionHead({ n, title, right }: { n: string; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b-2 border-[var(--line)] px-3 py-2">
      <span className="font-display text-[15px] font-extrabold tracking-tight text-[var(--fg)]">
        <span className="mr-1.5 text-verm">{n}</span>{title}
      </span>
      {right}
    </div>
  );
}

export function ControlRail(props: {
  defs: Record<string, SourceDef>; sources: SourcesState; gate: number; cutGate: number;
  autoCut: boolean; autoIso: boolean; keepAwake: boolean; showRejects: boolean; pace: Pace; log: LogLine[];
  onGate: (v: number) => void; onCutGate: (v: number) => void; onPace: (p: Pace) => void;
  onToggleSource: (id: string) => void; onToggleAutoCut: () => void; onToggleAutoIso: () => void;
  onToggleKeepAwake: () => void; onShowRejects: (v: boolean) => void;
  onAddTap: (input: { name: string; code: string; blurb: string; family: Family; hue: number; query: string }) => string | null;
  onRemoveTap: (id: string) => void;
}) {
  const { defs, sources, gate, cutGate, autoCut, autoIso, keepAwake, showRejects, pace, log,
    onGate, onCutGate, onPace, onToggleSource, onToggleAutoCut, onToggleAutoIso, onToggleKeepAwake, onShowRejects, onAddTap, onRemoveTap } = props;
  const [tapsOpen, setTapsOpen] = useState(true);
  const [logOpen, setLogOpen] = useState(true);
  const [logFrozen, setLogFrozen] = useState<LogLine[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [fName, setFName] = useState(''); const [fCode, setFCode] = useState(''); const [fQuery, setFQuery] = useState('');
  const [fFamily, setFFamily] = useState<Family>('meme'); const [fHue, setFHue] = useState(200);
  const [err, setErr] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const logDocked = useRef(true);
  const shownLog = logFrozen ?? log;
  const behind = logFrozen ? Math.max(0, log.length - logFrozen.length) : 0;

  useEffect(() => {
    const el = logRef.current;
    if (!el || logFrozen) return;
    if (logDocked.current) el.scrollTop = el.scrollHeight;
  }, [log, logFrozen]);

  const submitTap = () => {
    const e = onAddTap({ name: fName, code: fCode, blurb: '', family: fFamily, hue: fHue, query: fQuery });
    if (e) { setErr(e); return; }
    setErr(null); setAdding(false); setFName(''); setFCode(''); setFQuery('');
  };

  const entries = Object.values(defs);

  return (
    <div className="flex flex-col gap-4 xl:sticky xl:top-[118px]">
      <section className="border-2 border-[var(--line)] bg-[var(--panel)] shadow-[4px_4px_0_var(--shadow-ink)]">
        <SectionHead n="01" title="TASTE GLAND" right={
          <span className="font-mono text-[10px] font-bold tracking-widest text-verm">“{gateWord(gate)}”</span>} />
        <div className="space-y-3 p-3">
          <label className="block">
            <span className="mb-1 flex justify-between font-mono text-[9px] font-semibold tracking-[0.22em] text-[var(--mut)]">
              <span>TASTE GATE</span><span className="tabular-nums text-[var(--fg)]">{gate}</span>
            </span>
            <input type="range" min={0} max={95} value={gate} onChange={e => onGate(Number(e.target.value))} className="gate-range w-full" />
          </label>
          <label className="block">
            <span className="mb-1 flex justify-between font-mono text-[9px] font-semibold tracking-[0.22em] text-[var(--mut)]">
              <span>CUT GATE · ISOLATION</span><span className="tabular-nums text-[var(--fg)]">{cutGate}</span>
            </span>
            <input type="range" min={0} max={95} value={cutGate} onChange={e => onCutGate(Number(e.target.value))} className="gate-range w-full" />
          </label>
          <div>
            <span className="mb-1 block font-mono text-[9px] font-semibold tracking-[0.22em] text-[var(--mut)]">CRAWL PACE</span>
            <div className="grid grid-cols-2 overflow-hidden border-2 border-[var(--line)]">
              {(['cruise', 'rapid'] as Pace[]).map(p => (
                <button key={p} type="button" onClick={() => onPace(p)}
                  className={`px-2 py-1.5 font-mono text-[10px] font-bold tracking-widest transition-colors ${pace === p ? 'bg-[var(--fg)] text-[var(--bg)]' : 'text-[var(--fg2)] hover:bg-[var(--line-soft)]'}`}>
                  {p === 'cruise' ? 'CRUISE' : 'RAPID'}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-0.5 border-t border-[var(--line-soft)] pt-2">
            <Toggle on={autoCut} onClick={onToggleAutoCut} label="AUTO-CUT" hint="passes flow straight to the tray" />
            <Toggle on={autoIso} onClick={onToggleAutoIso} label="AUTO-ISOLATE" hint="free the subject on the way to the tray" />
            <Toggle on={keepAwake} onClick={onToggleKeepAwake} label="KEEP-AWAKE" hint="harvest while the tab is backgrounded" />
            <Toggle on={showRejects} onClick={() => onShowRejects(!showRejects)} label="SHOW BINNED" hint="show rejected plates on the belt" />
          </div>
        </div>
      </section>

      <section className="border-2 border-[var(--line)] bg-[var(--panel)] shadow-[4px_4px_0_var(--shadow-ink)]">
        <SectionHead n="02" title="TAPS" right={
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setAdding(a => !a)}
              className="border border-[var(--line)] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[var(--fg2)] hover:bg-[var(--fg)] hover:text-[var(--bg)]">+ ADD</button>
            <button type="button" onClick={() => setTapsOpen(o => !o)}
              className="border border-[var(--line)] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[var(--fg2)] hover:bg-[var(--fg)] hover:text-[var(--bg)]">{tapsOpen ? 'HIDE' : 'SHOW'}</button>
          </div>} />
        {tapsOpen && (
          <div className="max-h-[340px] overflow-y-auto p-2 scroll-slim">
            {adding && (
              <div className="mb-2 space-y-1.5 border-2 border-dashed border-[var(--line)] p-2">
                <input value={fName} onChange={e => setFName(e.target.value)} placeholder="tap name" className="w-full border border-[var(--line)] bg-[var(--panel2)] px-2 py-1 font-mono text-[11px]" />
                <input value={fQuery} onChange={e => setFQuery(e.target.value)} placeholder="search query (optional)" className="w-full border border-[var(--line)] bg-[var(--panel2)] px-2 py-1 font-mono text-[11px]" />
                <div className="flex items-center gap-2">
                  <select value={fFamily} onChange={e => setFFamily(e.target.value as Family)} className="flex-1 border border-[var(--line)] bg-[var(--panel2)] px-1 py-1 font-mono text-[10px]">
                    {Object.entries(FAMILY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <input type="range" min={0} max={360} value={fHue} onChange={e => setFHue(Number(e.target.value))} className="gate-range w-16" />
                  <span className="h-4 w-4 shrink-0 border border-[var(--line)]" style={{ background: `hsl(${fHue} 72% 44%)` }} />
                </div>
                {err && <p className="font-mono text-[9px] font-bold text-verm">{err}</p>}
                <button type="button" onClick={submitTap} className="w-full border-2 border-verm bg-verm py-1 font-mono text-[10px] font-bold tracking-widest text-[#f5f1e3] hover:bg-[var(--fg)]">PLUMB TAP</button>
              </div>
            )}
            {entries.map(d => {
              const st = sources[d.id];
              return (
                <div key={d.id} key-title={d.name}
                  className={`group flex items-center gap-2 border-b border-[var(--line-soft)] px-1 py-1.5 last:border-b-0 ${st?.on ? '' : 'opacity-45'}`}>
                  <button type="button" onClick={() => onToggleSource(d.id)} aria-pressed={st?.on}
                    className="flex flex-1 items-center gap-2 text-left">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: `hsl(${d.hue} 72% 44%)` }} />
                    <span className="flex-1">
                      <span className="block font-mono text-[10px] font-bold tracking-wide text-[var(--fg)]">{d.name}</span>
                      <span className="block font-mono text-[8px] tracking-wider text-[var(--mut)]">{d.code} · {d.blurb}</span>
                    </span>
                  </button>
                  <span className="font-mono text-[9px] tabular-nums text-[var(--mut)]">{st?.pulled ?? 0}</span>
                  {!d.builtin && (
                    <button type="button" onClick={() => onRemoveTap(d.id)} aria-label={`remove ${d.name}`}
                      className="font-mono text-[10px] font-bold text-verm opacity-0 hover:text-[#f5f1e3] hover:bg-verm px-1 group-hover:opacity-100">✕</button>
                  )}
                  <span className={`h-1.5 w-1.5 rounded-full ${st?.health === 'cooldown' ? 'bg-[#e8b341]' : st?.on ? 'bg-[#7ebe5c]' : 'bg-[var(--mut)]'}`} />
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="logdark border-2 border-[var(--line)] bg-[#171310] shadow-[4px_4px_0_var(--shadow-ink)]">
        <SectionHead n="03" title="CRAWL LOG" right={
          <div className="flex items-center gap-1.5">
            {logFrozen ? (
              <button type="button" onClick={() => setLogFrozen(null)}
                className="border border-[#e8b341] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#e8b341]">THAW{behind > 0 ? ` · ${behind}` : ''}</button>
            ) : (
              <button type="button" onClick={() => setLogFrozen(log)}
                className="border border-[var(--line-soft)] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[var(--fg2)] hover:text-[var(--fg)]">FREEZE</button>
            )}
            <button type="button" onClick={() => setTapsOpen(o => o)} className="hidden" aria-hidden="true">.</button>
            <button type="button" onClick={() => { setLogFrozen(null); const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }}
              className="border border-[var(--line-soft)] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[var(--fg2)] hover:text-[var(--fg)]">▼ TAIL</button>
          </div>} />
        {logOpen && (
          <div ref={logRef} onScroll={e => { const el = e.currentTarget; logDocked.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}
            className="h-[220px] overflow-y-auto bg-[#171310] p-2 font-mono text-[9.5px] leading-relaxed scroll-slim">
            {shownLog.length === 0 ? (
              <p className="text-[var(--mut)]">— log idle —</p>
            ) : shownLog.map(l => (
              <div key={l.id} className="flex gap-2">
                <span className="shrink-0 text-[var(--mut)]">{l.t}</span>
                <span style={{ color: TICKER_DOT[l.level] }}>{l.msg}</span>
              </div>
            ))}
          </div>
        )}
        <button type="button" onClick={() => setLogOpen(o => !o)} className="w-full border-t border-[var(--line-soft)] py-1 font-mono text-[9px] font-bold tracking-widest text-[var(--mut)] hover:text-[var(--fg)]">
          {logOpen ? 'COLLAPSE LOG' : 'EXPAND LOG'}
        </button>
      </section>
    </div>
  );
}

export function JumpRail({ view, onGoLab }: { view: View; onGoLab: () => void }) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (view !== 'floor') return;
    const ids = ['control', 'intake', 'tray'];
    const els = ids.map(id => document.getElementById(id)).filter(Boolean) as HTMLElement[];
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
  };
  const SECTIONS = [{ id: 'control', label: 'CONTROL' }, { id: 'intake', label: 'INTAKE' }, { id: 'tray', label: 'TRAY' }];
  return (
    <nav aria-label="jump to section" className="fixed right-3 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-1.5 lg:flex">
      {SECTIONS.map(s => (
        <button key={s.id} type="button" onClick={() => jump(s.id)} title={s.label}
          className={`group relative flex h-8 w-8 items-center justify-center border-2 transition-all duration-150 ${
            active === s.id ? 'border-verm bg-verm text-[#f5f1e3]' : 'border-[var(--line)]/40 bg-[var(--panel)]/85 text-[var(--fg2)] hover:border-[var(--line)]'}`}>
          <span className="font-mono text-[9px] font-bold">{s.label[0]}</span>
          <span className="pointer-events-none absolute right-full mr-2 hidden whitespace-nowrap border border-[var(--line)] bg-[var(--fg)] px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.18em] text-[var(--bg)] group-hover:block">{s.label}</span>
        </button>
      ))}
      <button type="button" onClick={onGoLab} title="GLITCH LAB"
        className="flex h-8 w-8 items-center justify-center border-2 border-ultra/50 bg-[var(--panel)]/85 text-ultra transition-all duration-150 hover:border-ultra hover:bg-ultra hover:text-[#f5f1e3]">
        <IcBolt size={13} />
      </button>
    </nav>
  );
}
