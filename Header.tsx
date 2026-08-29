import type { LogLine } from '../lib/engine';
import { IcBolt, IcGrid, IcHammer, IcLayers, IcMoon, IcPause, IcPlay, Led } from './ui';

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
      <div className={`font-mono text-xl font-semibold tabular-nums leading-tight ${accent ? 'text-[#ff8a5c]' : 'text-[var(--fg)]'}`}>
        {value}
      </div>
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
  return (
    <div className="relative overflow-hidden border-t border-[var(--line-soft)] bg-black/20 py-1">
      <div
        className={`ticker-track flex w-max font-mono text-[10px] tracking-[0.06em] text-[var(--fg2)] ${running ? '' : '[animation-play-state:paused]'}`}
        aria-hidden="true"
      >
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
      <button
        type="button"
        onClick={() => onView(v)}
        aria-pressed={active}
        className={`flex items-center gap-1.5 px-2.5 py-2 font-mono text-[10px] font-bold tracking-[0.16em] transition-colors duration-150 ${
          active
            ? 'bg-verm text-[#f5f1e3]'
            : 'text-[var(--fg2)] hover:bg-[var(--line-soft)] hover:text-[var(--fg)]'
        }`}
      >
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
          <div className="font-mono text-[9px] font-medium tracking-[0.32em] text-[var(--mut)]">
            AUTONOMOUS COLLAGE HARVESTER
          </div>
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
          <button
            type="button"
            onClick={onToggleNight}
            title={night ? 'day shift' : 'night shift'}
            className={`border-2 border-[var(--line)] p-1.5 transition-colors ${night ? 'bg-ultra text-paper' : 'text-[var(--fg2)] hover:bg-[var(--line-soft)]'}`}
          >
            <IcMoon size={14} />
          </button>
          <span className="hidden items-center gap-2 font-mono text-[11px] font-semibold tracking-[0.22em] text-[var(--fg2)] sm:flex">
            <Led running={running} pulse={trayHeld} />
            <span className={trayHeld ? 'text-[#e8b341]' : ''}>
              {running ? 'CRAWLING' : trayHeld ? 'TRAY FULL' : 'HELD'}
            </span>
          </span>
          <button
            type="button"
            onClick={onToggleRun}
            className={`flex items-center gap-2 border-2 px-3 py-2 font-display text-[14px] font-bold tracking-wide transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0 sm:px-4 ${
              running
                ? 'border-[var(--line)] bg-[var(--fg)] text-[var(--bg)] hover:bg-verm hover:border-verm hover:text-[#f5f1e3]'
                : 'border-verm bg-verm text-[#f5f1e3] hover:bg-[var(--fg)] hover:border-[var(--line)] hover:text-[var(--bg)]'
            }`}
          >
            {running ? <IcPause size={13} /> : <IcPlay size={13} />}
            {running ? 'HOLD' : 'RESUME'}
          </button>
        </div>
      </div>
      <TickerStrip lines={log.slice(-8)} running={running} />
    </header>
  );
}
