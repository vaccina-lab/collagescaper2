import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Specimen, Family } from './types';

export type { Specimen, Family };

export type Pace = 'cruise' | 'rapid';

export interface SourceDef {
  id: string; name: string; code: string; blurb: string; family: Family;
  spawnP: number; hue: number; builtin: boolean; query?: string;
}
export interface SourceState { on: boolean; health: 'ok' | 'cooldown'; until: number; pulled: number }
export type SourcesState = Record<string, SourceState>;
export interface LogLine { id: number; t: string; msg: string; level: 'sys' | 'pass' | 'bin' | 'warn' | 'err' | 'cut' }

export const FAMILY_LABEL: Record<Family, string> = {
  patent: 'PATENT ART', anatomy: 'ANATOMY', webcore: 'WEBCORE', stars: 'CELESTIAL',
  tarot: 'ARCANA', vhs: 'TAPE SEDIMENT', dore: 'ENGRAVING', geometry: 'GEOMETRY',
  arch: 'ARCHITECTURE', retro: 'RETRO-FUTURE', grim: 'GRIM FOLIO', meme: 'MEME & FOUND TEXT',
};

export function gateWord(g: number): string {
  if (g >= 85) return 'RUTHLESS';
  if (g >= 70) return 'PICKY';
  if (g >= 50) return 'STEADY';
  if (g >= 30) return 'LOOSE';
  return 'CHAOS';
}

const BUILTIN: SourceDef[] = [
  { id: 'patent', name: 'Patent Machines', code: 'PTN', blurb: 'mechanical patent line art', family: 'patent', spawnP: 0.2, hue: 30, builtin: true },
  { id: 'anatomy', name: 'Anatomy Atlas', code: 'ANT', blurb: 'anatomical engravings', family: 'anatomy', spawnP: 0.2, hue: 4, builtin: true },
  { id: 'dore', name: 'Doré Inferno', code: 'DRE', blurb: 'Gustave Doré engravings', family: 'dore', spawnP: 0.2, hue: 275, builtin: true },
  { id: 'webcore', name: 'Webcore Shrines', code: 'WBC', blurb: 'old-web relics', family: 'webcore', spawnP: 0.15, hue: 200, builtin: true },
  { id: 'tarot', name: 'Arcana Vault', code: 'ARC', blurb: 'tarot & occult', family: 'tarot', spawnP: 0.15, hue: 288, builtin: true },
];

export function useCrawler() {
  const [running, setRunning] = useState(true);
  const [gate, setGateState] = useState(72);
  const [cutGate, setCutGateState] = useState(45);
  const [autoCut, setAutoCut] = useState(true);
  const [autoIso, setAutoIso] = useState(true);
  const [showRejects, setShowRejects] = useState(true);
  const [keepAwake, setKeepAwake] = useState(false);
  const [pace, setPaceState] = useState<Pace>('rapid');
  const [feed, setFeed] = useState<Specimen[]>([]);
  const [tray, setTray] = useState<Specimen[]>([]);
  const [log, setLog] = useState<LogLine[]>([]);
  const [uptime, setUptime] = useState(0);
  const [defs, setDefs] = useState<Record<string, SourceDef>>(() => Object.fromEntries(BUILTIN.map(d => [d.id, d])));
  const [sources, setSources] = useState<SourcesState>(() => Object.fromEntries(BUILTIN.map(d => [d.id, { on: true, health: 'ok' as const, until: 0, pulled: 0 }])));

  const logId = useRef(0);
  const say = useCallback((level: LogLine['level'], msg: string) => {
    const d = new Date();
    const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    setLog(l => [...l.slice(-200), { id: ++logId.current, t, msg, level }]);
  }, []);

  useEffect(() => {
    if (!running) return;
    const iv = window.setInterval(() => setUptime(u => u + 1), 1000);
    return () => window.clearInterval(iv);
  }, [running]);

  /* lightweight demo harvest so the floor has life */
  useEffect(() => {
    if (!running) return;
    const iv = window.setInterval(() => {
      const active = Object.values(defs).filter(d => sources[d.id]?.on);
      if (active.length === 0) return;
      const def = active[Math.floor(Math.random() * active.length)];
      const score = 30 + Math.floor(Math.random() * 65);
      const sp: Specimen = {
        id: `sp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        code: `PL-${Math.floor(Math.random() * 9000 + 1000)}`,
        family: def.family, srcCode: def.code, srcHue: def.hue,
        archetype: `${def.name} plate`, tags: [def.family], score,
        dataUri: `https://picsum.photos/seed/${Math.floor(Math.random() * 1e6)}/400/${300 + Math.floor(Math.random() * 300)}`,
        w: 400, h: 400, aspect: 1, remote: true,
        thumb: `https://picsum.photos/seed/${Math.floor(Math.random() * 1e6)}/400/400`,
        verdict: score >= gate ? 'pass' : 'reject', state: 'judged', born: Date.now(),
      };
      setFeed(f => [...f.slice(-60), sp]);
      setSources(s => ({ ...s, [def.id]: { ...s[def.id], pulled: (s[def.id]?.pulled ?? 0) + 1 } }));
      if (sp.verdict === 'pass') {
        say('pass', `✓ ${sp.code} passed gate @ ${sp.score}`);
        if (autoCut) { setTray(t => (t.length >= 300 ? t : [sp, ...t])); say('cut', `✂ ${sp.code} auto-cut to tray`); }
      } else if (Math.random() < 0.3) say('bin', `✗ ${sp.code} binned @ ${sp.score}`);
    }, pace === 'rapid' ? 900 : 2200);
    return () => window.clearInterval(iv);
  }, [running, defs, sources, gate, autoCut, pace, say]);

  const passRate = useMemo(() => {
    const judged = feed.filter(f => f.state === 'judged');
    if (judged.length === 0) return 0;
    return (judged.filter(f => f.verdict === 'pass').length / judged.length) * 100;
  }, [feed]);

  const spm = useMemo(() => (pace === 'rapid' ? 40 : 16) + Math.floor(Math.random() * 10), [pace, feed.length]);

  const toggleSource = (id: string) => setSources(s => ({ ...s, [id]: { ...s[id], on: !s[id]?.on } }));
  const cut = (sp: Specimen) => { setTray(t => (t.some(x => x.id === sp.id) ? t : [sp, ...t])); say('cut', `✂ ${sp.code} cut to tray`); };
  const bin = (id: string) => setFeed(f => f.filter(x => x.id !== id));
  const removeFromTray = (id: string) => setTray(t => t.filter(x => x.id !== id));
  const clearTray = () => { setTray([]); say('warn', 'tray swept clean'); };
  const cullTray = () => { setTray(t => t.filter(x => x.score >= gate)); say('warn', `culled tray below gate ${gate}`); };
  const purgeFeed = () => setFeed([]);
  const addSource = (input: { name: string; code: string; blurb: string; family: Family; hue: number; query: string }): string | null => {
    const name = input.name.trim();
    if (!name) return 'name the tap first';
    const id = `tap-${Date.now().toString(36)}`;
    const code = input.code.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 12) || 'tap';
    if (defs[id] || Object.values(defs).some(d => d.code === code)) return `code "${code}" already plumbed`;
    setDefs(d => ({ ...d, [id]: { id, name, code, blurb: input.blurb || input.query || name, family: input.family, spawnP: 0.2, hue: input.hue, builtin: false, query: input.query } }));
    setSources(s => ({ ...s, [id]: { on: true, health: 'ok', until: 0, pulled: 0 } }));
    say('sys', `new tap plumbed → ${name} (${FAMILY_LABEL[input.family]})`);
    return null;
  };

  return {
    running, trayHeld: tray.length >= 300, uptime, stats: { seen: feed.length, passed: feed.filter(f => f.verdict === 'pass').length, binned: feed.filter(f => f.verdict === 'reject').length },
    passRate, gate, tray, log, defs, sources, cutGate, autoCut, autoIso, showRejects, pace, keepAwake, spm, feed,
    trayIds: new Set(tray.map(t => t.id)),
    setGate: (v: number) => { setGateState(v); say('sys', `taste gate → ${v} (${gateWord(v)})`); },
    setCutGate: (v: number) => { setCutGateState(v); say('sys', `cut gate → ${v}`); },
    toggleSource, toggleAutoCut: () => setAutoCut(a => !a), toggleAutoIso: () => setAutoIso(a => !a),
    toggleKeepAwake: () => setKeepAwake(a => !a), setShowRejects, setPace: (p: Pace) => setPaceState(p),
    addSource, toggleRun: () => setRunning(r => !r), say, cut, bin, removeFromTray, clearTray, cullTray, purgeFeed,
  };
}
