import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Family } from '../lib/types';
import type { LogLine, Pace, SourceDef, SourcesState } from '../lib/engine';
import { FAMILY_LABEL, gateWord } from '../lib/engine';
import { HueDot, Toggle } from './ui';

const fmtUptime = (s: number) => s; // unused helper guard
void fmtUptime;

function TapRow({ def, st, onToggle }: { def: SourceDef; st: { on: boolean; health: 'ok' | 'cooldown'; pulled: number }; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`group flex w-full items-center gap-2 border-b border-[var(--line-soft)] px-2 py-1.5 text-left transition-colors hover:bg-[var(--line-soft)] ${st.on ? '' : 'opacity-40'}`}
    >
      <HueDot hue={def.hue} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[12.5px] font-bold leading-tight text-[var(--fg)]">{def.name}</span>
        <span className="block truncate font-mono text-[8.5px] tracking-[0.12em] text-[var(--mut)]">
          {def.code} · {def.blurb}
        </span>
      </span>
      <span className="shrink-0 font-mono text-[9px] font-bold tabular-nums text-[var(--fg2)]">{st.pulled}</span>
      <span
        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${st.health === 'cooldown' ? 'bg-gold' : st.on ? 'bg-[#7ebe5c]' : 'bg-[var(--mut)]'}`}
        title={st.health === 'cooldown' ? 'cooling off' : st.on ? 'open' : 'closed'}
      />
    </button>
  );
}

function AddSourceForm({ onAdd, onDone }: {
  onAdd: (input: { name: string; code: string; blurb: string; family: Family; hue: number; query: string }) => string | null;
  onDone: () => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [blurb, setBlurb] = useState('');
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState<Family>('patent');
  const [hue, setHue] = useState(300);
  const [err, setErr] = useState<string | null>(null);
  const field = 'w-full border-2 border-[var(--line)] bg-[var(--panel)] px-2 py-1 font-mono text-[11px] text-[var(--fg)] outline-none focus:border-verm';
  const label = 'mb-0.5 block font-mono text-[8.5px] font-bold tracking-[0.22em] text-[var(--mut)]';
  const submit = () => {
    const e = onAdd({ name, code, blurb, family, hue, query });
    if (e) { setErr(e); return; }
    onDone();
  };
  return (
    <div className="border-b-2 border-[var(--line)] bg-black/5 px-2 py-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={label}>NAME *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="ZINE ARCHIVE" className={field} maxLength={24} />
        </div>
        <div>
          <label className={label}>CODE</label>
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="auto" className={field} maxLength={18} />
        </div>
        <div>
          <label className={label}>BLURB</label>
          <input value={blurb} onChange={e => setBlurb(e.target.value)} placeholder="what it spits" className={field} maxLength={30} />
        </div>
        <div>
          <label className={label}>HUE {hue}°</label>
          <input type="range" min={0} max={360} value={hue} onChange={e => setHue(Number(e.target.value))} className="gate-range w-full" />
        </div>
        <div className="col-span-2">
          <label className={label}>LIVE SEARCH QUERY</label>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder='e.g. "vintage seed catalog"' className={field} maxLength={60} />
        </div>
      </div>
      <div className="mt-2">
        <div className={label}>MIRROR FAMILY *</div>
        <div className="mt-1 grid grid-cols-4 gap-1">
          {(Object.keys(FAMILY_LABEL) as Family[]).map(f => (
            <button
              key={f} type="button" onClick={() => setFamily(f)} title={FAMILY_LABEL[f]}
              className={`border-2 px-0.5 py-1 font-mono text-[8px] font-bold leading-tight tracking-wide transition-colors ${
                family === f ? 'border-[var(--line)] bg-[var(--fg)] text-[var(--bg)]' : 'border-[var(--line-soft)] text-[var(--fg2)] hover:border-[var(--line)]'
              }`}
            >
              {FAMILY_LABEL[f].split(' ')[0]}
            </button>
          ))}
        </div>
      </div>
      {err && <p className="mt-1.5 font-mono text-[9.5px] font-bold text-verm">✗ {err}</p>}
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={submit} className="flex-1 border-2 border-moss bg-moss px-2 py-1.5 font-mono text-[10px] font-bold tracking-[0.18em] text-[#f5f1e3] transition-colors hover:bg-[var(--line)] hover:border-[var(--line)]">
          PLUMB IT
        </button>
        <button type="button" onClick={onDone} className="border-2 border-[var(--line)] px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.18em] text-[var(--fg2)] transition-colors hover:bg-[var(--line-soft)]">
          ✗
        </button>
      </div>
    </div>
  );
}

export function ControlRail({ defs, states, gate, autoCut, autoIso, keepAwake, showRejects, log, running, pace,
  onGate, onToggleSource, onToggleAutoCut, onToggleAutoIso, onToggleKeepAwake, onShowRejects, onPace, onAddSource, onRemoveSource }: {
  defs: Record<string, SourceDef>; states: SourcesState;
  gate: number; autoCut: boolean; autoIso: boolean; keepAwake: boolean; showRejects: boolean;
  log: LogLine[]; running: boolean; pace: Pace;
  onGate: (v: number) => void; onToggleSource: (id: string) => void;
  onToggleAutoCut: () => void; onToggleAutoIso: () => void; onToggleKeepAwake: () => void; onShowRejects: (v: boolean) => void;
  onPace: (p: Pace) => void;
  onAddSource: (input: { name: string; code: string; blurb: string; family: Family; hue: number; query: string }) => string | null;
  onRemoveSource: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);

  /* the crawl log obeys the reader: auto-scroll ONLY while docked at the
     bottom; FREEZE pins a snapshot and counts arrivals behind it */
  const logRef = useRef<HTMLDivElement>(null);
  const logDocked = useRef(true);
  const [frozen, setFrozen] = useState<LogLine[] | null>(null);
  const shownLog = frozen ?? log;
  const frozenBehind = frozen ? Math.max(0, log.length - frozen.length) : 0;
  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el || frozen) return;
    if (logDocked.current) el.scrollTop = el.scrollHeight;
  }, [log, frozen]);
  const onLogScroll = () => {
    const el = logRef.current;
    if (!el) return;
    logDocked.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 48;
  };

  const all = Object.values(defs);
  const onCount = all.filter(d => states[d.id]?.on).length;

  return (
    <div className="flex flex-col gap-4 xl:sticky xl:top-[118px]">
      {/* 01 — sources */}
      <section className="border-2 border-[var(--line)] bg-[var(--panel)] shadow-[4px_4px_0_var(--shadow-ink)]">
        <h2 className="flex items-baseline justify-between border-b-2 border-[var(--line)] px-3 py-2.5">
          <span className="font-display text-[19px] font-extrabold tracking-tight text-[var(--fg)]">
            01 · <span className="text-verm">TAPS</span>
          </span>
          <span className="font-mono text-[10px] font-semibold tabular-nums text-[var(--fg2)]">{onCount}/{all.length} OPEN</span>
        </h2>
        <div className="max-h-[380px] overflow-y-auto scroll-slim">
          {all.map(def => {
            const st = states[def.id];
            if (!st) return null;
            return (
              <div key={def.id} className="group/tap relative">
                <TapRow def={def} st={st} onToggle={() => onToggleSource(def.id)} />
                {!def.builtin && (
                  <button
                    type="button"
                    onClick={() => onRemoveSource(def.id)}
                    title="rip this tap out"
                    className="absolute right-8 top-1/2 hidden -translate-y-1/2 border border-verm bg-verm px-1 font-mono text-[9px] font-bold text-[#f5f1e3] group-hover/tap:block hover:bg-[var(--line)]"
                  >
                    ✗
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {adding ? (
          <AddSourceForm onAdd={onAddSource} onDone={() => setAdding(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="w-full border-t-2 border-[var(--line)] px-3 py-2 text-left font-mono text-[10px] font-bold tracking-[0.18em] text-ultra transition-colors hover:bg-ultra hover:text-[#f5f1e3]"
          >
            + PLUMB A SOURCE
          </button>
        )}
      </section>

      {/* 02 — taste gate */}
      <section className="border-2 border-[var(--line)] bg-[var(--panel)] shadow-[4px_4px_0_var(--shadow-ink)]">
        <h2 className="flex items-baseline justify-between border-b-2 border-[var(--line)] px-3 py-2.5">
          <span className="font-display text-[19px] font-extrabold tracking-tight text-[var(--fg)]">
            02 · <span className="text-verm">TASTE GATE</span>
          </span>
          <span className="font-mono text-[10px] font-bold tabular-nums text-verm">{gateWord(gate)}</span>
        </h2>
        <div className="px-3 py-3">
          <input
            type="range" min={0} max={95} value={gate}
            onChange={e => onGate(Number(e.target.value))}
            className="gate-range"
            aria-label="taste gate"
          />
          <div className="mt-1 flex justify-between font-mono text-[8.5px] tracking-[0.14em] text-[var(--mut)]">
            <span>INDISCRIMINATE</span>
            <span className="font-bold text-[var(--fg2)]">{gate}</span>
            <span>IMPOSSIBLE</span>
          </div>
          <p className="mt-2 border-t border-[var(--line-soft)] pt-2 font-mono text-[9px] leading-relaxed text-[var(--mut)]">
            plates grade on resolution, source tier, art-words & title — the sentry
            raster refines ±8. everything under the gate is binned on sight.
          </p>
        </div>
      </section>

      {/* 03 — behavior */}
      <section className="border-2 border-[var(--line)] bg-[var(--panel)] shadow-[4px_4px_0_var(--shadow-ink)]">
        <h2 className="border-b-2 border-[var(--line)] px-3 py-2.5 font-display text-[19px] font-extrabold tracking-tight text-[var(--fg)]">
          03 · <span className="text-verm">BEHAVIOR</span>
        </h2>
        <div className="px-3 py-2">
          <div className="mb-2 flex gap-1.5">
            {(['cruise', 'rapid'] as Pace[]).map(p => (
              <button
                key={p} type="button" onClick={() => onPace(p)}
                className={`flex-1 border-2 px-2 py-1.5 font-mono text-[10px] font-bold tracking-[0.16em] transition-colors ${
                  pace === p ? 'border-[var(--line)] bg-[var(--fg)] text-[var(--bg)]' : 'border-[var(--line-soft)] text-[var(--fg2)] hover:border-[var(--line)]'
                }`}
              >
                {p === 'cruise' ? 'CRUISE' : 'RAPID'}
              </button>
            ))}
          </div>
          <Toggle on={autoCut} onClick={onToggleAutoCut} label="AUTO-CUT PASSES ✂" title="passes flow straight to the tray" />
          <Toggle on={autoIso} onClick={onToggleAutoIso} label="AUTO-ISOLATE ✂" title="RMBG-1.4 frees the subject on the way to the tray" />
          <Toggle on={keepAwake} onClick={onToggleKeepAwake} label="KEEP AWAKE ⏻" title="harvests in the background (silent audio)" />
          <Toggle on={showRejects} onClick={() => onShowRejects(!showRejects)} label="SHOW REJECTS" title="leave binned plates on the belt" />
        </div>
      </section>

      {/* 04 — crawl log */}
      <section className="flex flex-col border-2 border-[var(--line)] bg-[var(--fg)] text-[var(--bg)] shadow-[4px_4px_0_var(--shadow-ink)]">
        <h2 className="flex items-center justify-between border-b border-[var(--line-soft)] px-3 py-2">
          <span className="font-display text-[15px] font-extrabold tracking-tight">04 · CRAWL LOG</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFrozen(f => (f ? null : log))}
              className={`border px-1.5 py-0.5 font-mono text-[8.5px] font-bold tracking-[0.14em] transition-colors ${
                frozen ? 'border-gold bg-gold text-black' : 'border-[var(--line-soft)] text-[var(--fg2)] hover:border-[var(--fg2)]'
              }`}
            >
              {frozen ? `THAW · ${frozenBehind} NEW` : 'FREEZE'}
            </button>
            <span className={`inline-block h-2 w-2 rounded-full ${running ? 'anim-led bg-[#7ebe5c]' : 'bg-verm'}`} />
          </div>
        </h2>
        <div ref={logRef} onScroll={onLogScroll} className="h-[260px] overflow-y-auto px-3 py-2 scroll-slim">
          {shownLog.map(l => (
            <div key={l.id} className="anim-rise flex gap-2 py-px font-mono text-[9.5px] leading-snug">
              <span className="shrink-0 tabular-nums opacity-50">{l.t}</span>
              <span className={
                l.level === 'pass' ? 'text-[#9fb6ff]' :
                l.level === 'bin' ? 'text-[#8d8677]' :
                l.level === 'warn' ? 'text-[#e8b341]' :
                l.level === 'err' ? 'text-[#ff7a55]' :
                l.level === 'cut' ? 'text-[#8fd8c4]' : 'text-[var(--bg)]/75'
              }>{l.msg}</span>
            </div>
          ))}
          <span className="anim-blink inline-block h-3 w-2 bg-[#7ebe5c]" aria-hidden="true" />
        </div>
        {!frozen && (
          <button
            type="button"
            onClick={() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }}
            className="border-t border-[var(--line-soft)] px-3 py-1 text-left font-mono text-[8.5px] font-bold tracking-[0.16em] text-[var(--fg2)] transition-colors hover:text-[#7ebe5c]"
          >
            ▼ TAIL
          </button>
        )}
      </section>
    </div>
  );
}
