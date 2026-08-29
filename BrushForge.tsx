import { useRef, useState } from 'react';
import type { LogLine } from '../lib/engine';
import {
  S, VIBES, buildBrushset, canvasPng, cyrb53, downloadBytes, extractTemplates, forgeBrush,
  makeThumbnail, mulberry, renderGrain, renderShape, renderStroke,
  type ForgedBrush, type Template,
} from '../lib/forge';
import { IcHammer } from './ui';

interface Card {
  id: number;
  name: string;
  shapeId: string;
  grainId: string;
  strokeUrl: string;
  thumbUrl: string;
  templateName: string;
  kept: boolean;
  brush: ForgedBrush | null;
}

const EMBER = '#e6392b';
const STEEL = '#6b8f9e';

function makeName(vibe: { words: string[] }, rnd: () => number): string {
  const w = vibe.words[Math.floor(rnd() * vibe.words.length)];
  const n = Math.floor(rnd() * 900) + 100;
  return `${w} ${n}`;
}

export function BrushForge({ onLog }: { onLog: (level: LogLine['level'], msg: string) => void }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [vibeId, setVibeId] = useState(VIBES[0].id);
  const [count, setCount] = useState(6);
  const [seedStr, setSeedStr] = useState('');
  const [lum, setLum] = useState(0.5);
  const [cards, setCards] = useState<Card[]>([]);
  const [forging, setForging] = useState(false);
  const [logLines, setLogLines] = useState<Array<{ id: number; msg: string; kind: string }>>([]);
  const [sealed, setSealed] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const logSeq = useRef(0);
  const lastSeed = useRef(0);

  const push = (msg: string, kind = 'sys') => {
    setLogLines(l => [...l.slice(-40), { id: ++logSeq.current, msg, kind }]);
    onLog(kind === 'err' ? 'err' : 'sys', `forge: ${msg}`);
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setForging(true);
    try {
      const found: Template[] = [];
      for (const f of Array.from(files)) {
        try {
          const ts = await extractTemplates(f);
          found.push(...ts);
          push(`${f.name} → ${ts.length} template${ts.length === 1 ? '' : 's'} unpacked`);
        } catch (e) {
          push(`${f.name}: ${e instanceof Error ? e.message : 'unreadable'}`, 'err');
        }
      }
      if (found.length > 0) {
        setTemplates(prev => {
          const seen = new Set(prev.map(t => t.name));
          return [...prev, ...found.filter(t => !seen.has(t.name))];
        });
      }
    } finally {
      setForging(false);
    }
  };

  const forge = () => {
    if (templates.length === 0) {
      push('drop a .brush or .brushset exported from Procreate first — templates supply the dynamics', 'err');
      return;
    }
    setForging(true);
    setSealed(false);
    try {
      const seed = seedStr.trim() === '' ? Math.floor(Math.random() * 1e9) : /^\d+$/.test(seedStr.trim()) ? Number(seedStr.trim()) : cyrb53(seedStr.trim());
      lastSeed.current = seed;
      push(`forge lit — seed ${seed} · ${count} brushes · ${VIBES.find(v => v.id === vibeId)?.label}`);
      const vibe = VIBES.find(v => v.id === vibeId) ?? VIBES[0];
      const rnd = mulberry(seed);
      const made: Card[] = [];
      for (let i = 0; i < count; i++) {
        const sub = seed + i * 101;
        const srnd = mulberry(sub);
        const shapeId = vibe.shapes[Math.floor(srnd() * vibe.shapes.length)];
        const grainId = vibe.grains[Math.floor(srnd() * vibe.grains.length)];
        const shape = renderShape(shapeId, mulberry(sub + 11));
        const grain = renderGrain(grainId, mulberry(sub + 23));
        const stroke = renderStroke(shape, grain, mulberry(sub + 37), lum);
        const thumb = makeThumbnail(stroke);
        const strokePng = canvasPng(stroke);
        const thumbPng = canvasPng(thumb);
        const name = makeName(vibe, mulberry(sub + 53));
        const template = templates[Math.floor(rnd() * templates.length)];
        let brush: ForgedBrush | null = null;
        try {
          brush = forgeBrush(template, { name, shapeId, grainId, strokePng, thumbPng }, seed, i);
        } catch (e) {
          push(`${name}: splice failed (${e instanceof Error ? e.message : 'unknown'})`, 'err');
        }
        made.push({
          id: i, name, shapeId, grainId,
          strokeUrl: stroke.toDataURL('image/png'),
          thumbUrl: thumb.toDataURL('image/png'),
          templateName: template.name,
          kept: true,
          brush,
        });
      }
      setCards(made);
      push(`${made.filter(c => c.brush).length} brushes forged · SKIP the weak ones, then BUILD THE SET`);
    } finally {
      setForging(false);
    }
  };

  const buildSet = () => {
    const kept = cards.filter(c => c.kept && c.brush);
    if (kept.length === 0) {
      push('nothing kept — forge some brushes first', 'err');
      return;
    }
    try {
      const vibe = VIBES.find(v => v.id === vibeId) ?? VIBES[0];
      const setName = `SALVAGE-${vibe.label.replace(/\s+/g, '')}-${kept.length}`;
      push(`pressing .brushset — ${kept.length} brushes → "${setName}.brushset"`);
      const res = buildBrushset(kept.map(c => c.brush!), setName, m => push(m));
      downloadBytes(res.bytes, `${res.name}.brushset`);
      setSealed(true);
      push(`SEALED ✓ ${res.count} brushes → ${res.name}.brushset (${Math.round(res.bytes.length / 1024)} KB)`);
    } catch (e) {
      push(`press failed: ${e instanceof Error ? e.message : 'unknown'}`, 'err');
    }
  };

  const toggleKeep = (id: number) => {
    setCards(cs => cs.map(c => (c.id === id ? { ...c, kept: !c.kept } : c)));
  };

  const downloadOne = (c: Card) => {
    if (!c.brush) return;
    try {
      const res = buildBrushset([c.brush], `single-${c.name.replace(/\s+/g, '-')}`, () => {});
      downloadBytes(res.bytes, `${c.name.replace(/[^a-z0-9.-]/gi, '_')}.brushset`);
      push(`"${c.name}" downloaded`);
    } catch (e) {
      push(`download failed: ${e instanceof Error ? e.message : 'unknown'}`, 'err');
    }
  };

  const inputCls = 'border border-white/20 bg-black/40 px-2 py-1.5 font-mono text-[11px] text-[#f2ede2] outline-none focus:border-[#e6392b]';

  return (
    <main className="mx-auto max-w-[1560px] px-4 py-5 lg:px-6" style={{ color: '#f2ede2' }}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[34px] font-extrabold leading-none tracking-tight">
            BRUSH <span style={{ color: EMBER }}>FORGE</span>
          </h2>
          <p className="mt-1 font-mono text-[10px] tracking-[0.2em] text-[#9a937f]">
            TEMPLATES SUPPLY DYNAMICS · THE FORGE SUPPLIES LOOKS · {S}² GRAYSCALE
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${templates.length > 0 ? 'anim-led bg-[#7ebe5c]' : 'bg-verm'}`} />
          <span className="font-mono text-[10px] font-bold tracking-[0.18em] text-[#9a937f]">
            {templates.length} TEMPLATE{templates.length === 1 ? '' : 'S'}
          </span>
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[320px_minmax(0,1fr)_300px]">
        {/* left rail: dropzone + controls */}
        <section className="border border-white/15 bg-[#141210] p-3 shadow-[4px_4px_0_rgba(0,0,0,0.5)]">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="grid w-full place-items-center border-2 border-dashed border-white/25 px-3 py-8 text-center transition-colors hover:border-[#e6392b] hover:bg-[#e6392b]/5"
          >
            <IcHammer size={26} className="mb-2 text-[#e6392b]" />
            <span className="font-display text-[15px] font-extrabold">DROP .brush / .brushset</span>
            <span className="mt-1 font-mono text-[9px] leading-relaxed tracking-[0.12em] text-[#9a937f]">
              export a brush from Procreate first —
              <br />its dynamics ride along byte-for-byte
            </span>
          </button>
          <input ref={fileRef} type="file" multiple accept=".brush,.brushset,.zip" className="hidden" onChange={e => void onFiles(e.target.files)} />

          {templates.length > 0 && (
            <div className="mt-2 max-h-[120px] overflow-y-auto scroll-slim">
              {templates.map(t => (
                <div key={t.name} className="flex items-center justify-between border-b border-white/10 px-1 py-1">
                  <span className="truncate font-mono text-[10px] text-[#f2ede2]">{t.name}</span>
                  <button type="button" onClick={() => setTemplates(ts => ts.filter(x => x.name !== t.name))}
                    className="font-mono text-[9px] font-bold text-[#9a937f] hover:text-[#e6392b]">✗</button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3">
            <div className="mb-1 font-mono text-[8.5px] font-bold tracking-[0.22em] text-[#9a937f]">VIBE</div>
            <div className="flex flex-wrap gap-1">
              {VIBES.map(v => (
                <button key={v.id} type="button" onClick={() => setVibeId(v.id)}
                  className={`border px-1.5 py-0.5 font-mono text-[8.5px] font-bold tracking-[0.1em] transition-colors ${
                    vibeId === v.id ? 'border-[#e6392b] bg-[#e6392b] text-black' : 'border-white/20 text-[#9a937f] hover:border-white/50'
                  }`}>
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-0.5 block font-mono text-[8.5px] font-bold tracking-[0.22em] text-[#9a937f]">BRUSHES {count}</span>
              <input type="range" min={1} max={16} value={count} onChange={e => setCount(Number(e.target.value))} className="gate-range w-full" />
            </label>
            <label className="block">
              <span className="mb-0.5 block font-mono text-[8.5px] font-bold tracking-[0.22em] text-[#9a937f]">LUMINOSITY</span>
              <input type="range" min={0} max={100} value={Math.round(lum * 100)} onChange={e => setLum(Number(e.target.value) / 100)} className="gate-range w-full" />
            </label>
          </div>
          <label className="mt-2 block">
            <span className="mb-0.5 block font-mono text-[8.5px] font-bold tracking-[0.22em] text-[#9a937f]">SEED (blank = random)</span>
            <input value={seedStr} onChange={e => setSeedStr(e.target.value)} placeholder="salvage or 424242" className={`${inputCls} w-full`} />
          </label>

          <button type="button" onClick={forge} disabled={forging}
            className="mt-3 w-full border-2 border-[#e6392b] bg-[#e6392b] px-3 py-2.5 font-display text-[16px] font-extrabold tracking-wide text-black transition-all hover:-translate-y-0.5 hover:bg-[#f2ede2] hover:border-[#f2ede2] disabled:pointer-events-none disabled:opacity-40">
            {forging ? 'FORGING…' : '⚒ FORGE'}
          </button>

          <p className="mt-3 border-t border-white/10 pt-2 font-mono text-[8.5px] leading-relaxed tracking-[0.1em] text-[#9a937f]">
            never re-serializes the archive — byte-splices the name, stitches
            fresh UUIDs + timestamps, round-trip verifies every brush.
          </p>
        </section>

        {/* the anvil: keep/skip cards */}
        <section className="border border-white/15 bg-[#141210] p-3 shadow-[4px_4px_0_rgba(0,0,0,0.5)]">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-display text-[16px] font-extrabold tracking-tight">THE ANVIL</span>
            <span className="font-mono text-[9px] tracking-[0.16em] text-[#9a937f]">
              {cards.filter(c => c.kept).length}/{cards.length} KEPT
            </span>
          </div>
          {cards.length === 0 ? (
            <div className="grid place-items-center border-2 border-dashed border-white/15 px-6 py-20 text-center">
              <div className="font-display text-2xl font-extrabold text-[#f2ede2]/80">COLD ANVIL.</div>
              <p className="mx-auto mt-2 max-w-[360px] font-mono text-[10px] leading-relaxed text-[#9a937f]">
                drop a Procreate brush, pick a vibe, hit FORGE. strokes land here —
                stamp KEEP or SKIP, then press the set.
              </p>
            </div>
          ) : (
            <div className="grid max-h-[640px] grid-cols-2 gap-3 overflow-y-auto pr-1 scroll-slim md:grid-cols-3">
              {cards.map(c => (
                <div key={c.id} className={`relative border-2 transition-all duration-150 ${c.kept ? 'border-[#e6392b] bg-[#1c1916]' : 'border-white/15 opacity-45'}`}>
                  <img src={c.strokeUrl} alt={c.name} className="w-full border-b border-white/10 bg-black" />
                  <div className="px-2 py-1.5">
                    <div className="truncate font-display text-[12px] font-bold">{c.name}</div>
                    <div className="truncate font-mono text-[8px] tracking-[0.12em] text-[#9a937f]">
                      {c.shapeId} × {c.grainId} · {c.templateName}
                    </div>
                  </div>
                  <div className="flex border-t border-white/10">
                    <button type="button" onClick={() => toggleKeep(c.id)}
                      className={`flex-1 py-1.5 font-mono text-[9.5px] font-bold tracking-[0.18em] transition-colors ${
                        c.kept ? 'bg-[#e6392b] text-black' : 'text-[#9a937f] hover:text-[#f2ede2]'
                      }`}>
                      {c.kept ? 'KEEP' : 'SKIP'}
                    </button>
                    <button type="button" onClick={() => downloadOne(c)} disabled={!c.brush}
                      className="flex-1 border-l border-white/10 py-1.5 font-mono text-[9.5px] font-bold tracking-[0.18em] text-[#9a937f] transition-colors hover:bg-white/10 hover:text-[#f2ede2] disabled:opacity-30">
                      ↓ .brush
                    </button>
                  </div>
                  {c.kept && (
                    <span className="stamp absolute right-2 top-2 border-[#e6392b] text-[10px] text-[#e6392b]">KEEP</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {cards.length > 0 && (
            <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3">
              <button type="button" onClick={buildSet}
                className={`flex-1 border-2 px-3 py-2.5 font-display text-[15px] font-extrabold tracking-wide transition-all hover:-translate-y-0.5 ${
                  sealed ? 'border-[#7ebe5c] bg-[#7ebe5c] text-black' : 'border-[#6b8f9e] bg-[#6b8f9e] text-black hover:bg-[#f2ede2] hover:border-[#f2ede2]'
                }`}>
                {sealed ? '✓ SEALED — PRESS AGAIN TO REBUILD' : `⚒ BUILD THE SET · ${cards.filter(c => c.kept).length}`}
              </button>
              {lastSeed.current > 0 && (
                <span className="font-mono text-[9px] tracking-[0.14em] text-[#9a937f]">SEED {lastSeed.current}</span>
              )}
            </div>
          )}
        </section>

        {/* terminal log */}
        <section className="flex flex-col border border-white/15 bg-[#0c0b09] shadow-[4px_4px_0_rgba(0,0,0,0.5)]">
          <h3 className="flex items-center justify-between border-b border-white/10 px-3 py-2 font-display text-[15px] font-extrabold tracking-tight">
            FORGE LOG
            <span className={`inline-block h-2 w-2 rounded-full ${forging ? 'anim-led bg-gold' : 'bg-[#7ebe5c]'}`} />
          </h3>
          <div className="h-[300px] overflow-y-auto px-3 py-2 scroll-slim">
            {logLines.length === 0 && (
              <p className="font-mono text-[9.5px] leading-relaxed text-[#9a937f]">
                the fire is waiting. templates in, vibes set, hammer down.
              </p>
            )}
            {logLines.map(l => (
              <div key={l.id} className="anim-rise py-px font-mono text-[9.5px] leading-snug">
                <span className={l.kind === 'err' ? 'text-[#ff7a55]' : l.kind === 'warn' ? 'text-gold' : 'text-[#f2ede2]/75'}>
                  {l.msg}
                </span>
              </div>
            ))}
            <span className="anim-blink inline-block h-3 w-2 bg-[#7ebe5c]" aria-hidden="true" />
          </div>
          <div className="border-t border-white/10 px-3 py-2 font-mono text-[8.5px] leading-relaxed tracking-[0.1em] text-[#9a937f]">
            same seed + same templates = byte-identical pack.
            <br />import the .brushset via Procreate → share → import brush.
          </div>
        </section>
      </div>
    </main>
  );
}
