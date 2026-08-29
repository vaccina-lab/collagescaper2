/* SALVAGE/9 — crawler engine hook.
   45 built-in taps across 12 lineages (NOT a truncated list — see HANDOFF.md;
   never shorten this). Isolation runs in a worker (see cutout.ts) and the pump
   pauses while the tab is hidden, so the main thread never hangs and the tab
   never gets killed for being unresponsive. Tray caps at 2000 and auto-HOLDs;
   clear/cull resume, single removals don't. */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Family, Specimen } from './types';
import { gradePlate, mirrorStats, queueFor, analyzePlate, photoJunk, type ProviderPolicy, type QEvent } from './remote';
import { gradeCutout, isolateFromUrl, loadImageDataUrl, onIsoProgress } from './cutout';
import { startKeepAwake, stopKeepAwake } from './keepawake';

export { mirrorStats };
export type { ProviderPolicy };
export type { Family };

export interface SourceDef {
  id: string;
  name: string;
  code: string;
  blurb: string;
  family: Family;
  spawnP: number;
  hue: number;
  builtin: boolean;
  query?: string;
  queries?: string[];
  off?: boolean; /* mounted dark by default */
  policy?: ProviderPolicy;
}

export interface SourceState {
  on: boolean;
  health: 'ok' | 'cooldown';
  until: number;
  pulled: number;
}
export type SourcesState = Record<string, SourceState>;

export interface LogLine {
  id: number;
  t: string;
  msg: string;
  level: 'sys' | 'pass' | 'bin' | 'warn' | 'err' | 'cut';
}

export type Pace = 'cruise' | 'rapid';

export const FAMILY_LABEL: Record<Family, string> = {
  patent: 'PATENT ART', anatomy: 'ANATOMY', webcore: 'WEBCORE', stars: 'CELESTIAL',
  tarot: 'ARCANA', vhs: 'TAPE SEDIMENT', dore: 'ENGRAVING', geometry: 'GEOMETRY',
  arch: 'ARCHITECTURE', retro: 'RETRO-FUTURE', grim: 'GRIM FOLIO', meme: 'MEME & FOUND TEXT',
};

export const FAMILY_TERMS: Record<Family, string[]> = {
  patent: ['vintage patent drawing', 'patent illustration mechanical', 'antique patent blueprint', 'patent diagram engraving'],
  anatomy: ['anatomical illustration vintage', 'anatomy engraving plate', 'vintage medical illustration', 'skeletal anatomy drawing'],
  webcore: ['old computer photo', 'vintage computer terminal', 'retro technology photo', 'crt monitor'],
  stars: ['star chart antique', 'celestial planisphere', 'astronomical chart engraving', 'constellation map vintage'],
  tarot: ['tarot card vintage', 'tarot deck illustration', 'oracle card art', 'playing card antique'],
  vhs: ['vhs tape photo', 'analog television static', 'retro camcorder', 'vhs glitch'],
  dore: ['gustave dore engraving', 'dore divine comedy', 'dore inferno illustration', 'dore wood engraving'],
  geometry: ['sacred geometry diagram', 'geometric pattern art', 'mathematical diagram vintage', 'polyhedron illustration'],
  arch: ['architectural etching', 'building elevation drawing', 'gothic architecture engraving', 'architectural sketch vintage'],
  retro: ['retro futurism illustration', 'space age art', 'vintage science fiction art', 'atomic age design'],
  grim: ['macabre engraving', 'gothic illustration dark', 'memento mori art', 'danse macabre engraving'],
  meme: ['vintage advertisement', 'found text photo', 'weird vintage ephemera', 'odd signage photo'],
};

const SPARSE_EXEMPT = new Set<Family>(['stars', 'geometry']);
const MEME_GATE_DISCOUNT = 18;
const isMemeFam = (f: Family) => f === 'meme';

/* ------------------------------------------------------------------ */
/*  BUILT-IN TAP MANIFEST — 45 taps. DO NOT TRUNCATE (see HANDOFF.md). */
/* ------------------------------------------------------------------ */
export const BUILTIN_DEFS: SourceDef[] = [
  /* patent */
  { id: 'dore', name: 'Doré Vault', code: 'DORE', blurb: 'gustave doré engravings', family: 'dore', spawnP: 0.24, hue: 178, builtin: true, queries: ['gustave dore engraving', 'dore divine comedy', 'dore inferno', 'dore don quixote', 'dore raven', 'dore london pilgrimage', 'wood engraving 19th century', 'dore illustration plate'] },
  { id: 'patent', name: 'Patent Machines', code: 'PAT', blurb: 'mechanical patent drawings', family: 'patent', spawnP: 0.2, hue: 30, builtin: true },
  { id: 'fringe', name: 'FRINGE BUREAU', code: 'FRNG', blurb: 'unhinged patent filings', family: 'patent', spawnP: 0.21, hue: 118, builtin: true, policy: 'open', queries: ['directed energy weapon patent drawing', 'time machine patent drawing', 'flying saucer patent drawing', 'cloaking device patent illustration', 'free energy device patent drawing', 'perpetual motion machine patent diagram', 'anti-gravity device patent drawing', 'teleportation device patent', 'death ray patent drawing Tesla', 'mind control helmet patent diagram', 'weather control machine patent', 'antique patent model artifact photograph'] },
  { id: 'spacetime', name: 'SPACETIME BUREAU', code: 'SPCT', blurb: 'antigravity, tachyons & warp filings', family: 'patent', spawnP: 0.22, hue: 150, builtin: true, policy: 'open', queries: ['antigravity patent drawing', 'gravity wave generator patent', 'wormhole generator patent drawing', 'faster than light propulsion patent', 'zero point energy device patent', 'warp drive patent drawing', 'tachyon device patent', 'reactionless drive patent', 'inertial propulsion patent drawing', 'spacetime manipulation patent', 'interdimensional portal patent', 'Boyd Bushman antigravity patent', 'vacuum energy extraction patent', 'magnetic monopole generator patent', 'craft inertial mass propulsion patent', 'levitation device patent drawing', 'gravity control device patent'] },
  /* anatomy */
  { id: 'anatomy', name: 'Anatomy Atlas', code: 'ANA', blurb: 'anatomical engravings', family: 'anatomy', spawnP: 0.18, hue: 4, builtin: true },
  { id: 'vesalius', name: 'Vesalius Bones', code: 'VESL', blurb: 'Fabrica osteology & skulls', family: 'anatomy', spawnP: 0.16, hue: 356, builtin: true, queries: ['Vesalius skeleton', 'De Humani Corporis Fabrica', 'osteology plate engraving', 'vintage skull illustration', 'skeleton engraving anatomy', 'anatomical skeleton woodcut', 'Fabrica muscle plate', 'comparative anatomy skeleton', 'bone structure vintage illustration', 'skull anatomical drawing', 'Vesalius anatomy woodcut', 'human skeleton engraving'] },
  { id: 'optic', name: 'Optic Vault', code: 'OPTC', blurb: 'eyes, real & occult', family: 'anatomy', spawnP: 0.22, hue: 28, builtin: true, policy: 'open', queries: ['eye illustration', 'eye of providence', 'all-seeing eye', 'eye of horus', 'anatomical eye', 'eye engraving', 'surreal eye', 'occult eye', 'evil eye', 'eye drawing', 'eye of god', 'third eye'] },
  { id: 'herbarium', name: 'Herbarium Vault', code: 'HERB', blurb: 'pressed-flora scans', family: 'anatomy', spawnP: 0.14, hue: 96, builtin: true, queries: ['vintage botanical illustration', 'herbarium pressed flower specimen', '19th century botanical plate', 'vintage mushroom illustration', 'fern illustration engraving'] },
  /* webcore */
  { id: 'webcore', name: 'Webcore Shrines', code: 'WEB', blurb: 'old-tech sediment', family: 'webcore', spawnP: 0.12, hue: 226, builtin: true },
  { id: 'liminal', name: 'Lost Malls', code: 'MALL', blurb: 'dead retail & dreamcore', family: 'webcore', spawnP: 0.13, hue: 262, builtin: true, queries: ['abandoned mall photo', 'dead mall', 'empty shopping mall', 'abandoned food court', 'vaporwave mall', 'empty atrium liminal', 'abandoned arcade', 'dead shopping center photo', 'liminal mall corridor', 'empty retail store photo', 'mall fountain abandoned', 'vaporwave architecture'] },
  { id: 'mail', name: 'Dead Mail', code: 'MAIL', blurb: 'handwritten ephemera', family: 'webcore', spawnP: 0.14, hue: 322, builtin: true, queries: ['vintage postcard stamp', 'handwritten letter ephemera', 'vintage postage stamp collection', 'telegraph form ephemera'] },
  /* stars */
  { id: 'starCharts', name: 'Star Charts', code: 'STC', blurb: 'celestial cartography', family: 'stars', spawnP: 0.1, hue: 218, builtin: true, off: true },
  { id: 'celestial', name: 'Celestial Atlases', code: 'CEL', blurb: 'astronomical atlases', family: 'stars', spawnP: 0.08, hue: 232, builtin: true, off: true },
  { id: 'orb', name: 'Orb Depot', code: 'ORB', blurb: 'spheres & celestial globes', family: 'stars', spawnP: 0.25, hue: 166, builtin: true, queries: ['celestial sphere illustration', 'crystal ball illustration', 'planet illustration vintage', 'glass sphere still life', 'cosmic orb art', 'armillary sphere engraving', 'sphere geometry illustration', 'moon illustration vintage engraving'] },
  /* tarot */
  { id: 'arcana', name: 'Tarot Arcana', code: 'TAR', blurb: 'tarot & ornamental cards', family: 'tarot', spawnP: 0.1, hue: 288, builtin: true, off: true },
  { id: 'minorArcana', name: 'Minor Arcana', code: 'MIN', blurb: 'playing-card suits', family: 'tarot', spawnP: 0.08, hue: 300, builtin: true, off: true },
  { id: 'chaos', name: 'CHAOS ENGINE', code: 'CHAO', blurb: 'sigils & ritual diagrams', family: 'tarot', spawnP: 0.23, hue: 312, builtin: true, queries: ['sigil', 'magic circle', 'kabbalah', 'tree of life', 'planetary seal', 'grimoire', 'occult diagram', 'talisman', 'pentagram', 'zodiac wheel'] },
  { id: 'grimoire', name: 'GRIMOIRE CUTS', code: 'GRMC', blurb: 'seals, goetia & key diagrams', family: 'tarot', spawnP: 0.17, hue: 274, builtin: true, queries: ['grimoire illustration', 'Key of Solomon diagram', 'goetic demon seal', 'Lesser Key of Solomon', 'occult seal diagram', 'magical square diagram', 'necromancy woodcut', 'demonology engraving', 'esoteric manuscript diagram', 'planetary magic seal', 'talisman engraving occult', 'witchcraft woodcut historical'] },
  { id: 'alchemy', name: 'Alembic Archive', code: 'ALMB', blurb: 'hermetic diagrams', family: 'tarot', spawnP: 0.14, hue: 84, builtin: true, queries: ['alchemy symbol engraving', 'alchemical diagram woodcut', 'Ripley Scroll', 'hermetic emblem illustration', 'distillation apparatus engraving', 'alchemical manuscript illustration', 'philosopher stone engraving'] },
  { id: 'cross', name: 'Crossworks', code: 'CRSX', blurb: 'crosses & cruciforms', family: 'tarot', spawnP: 0.14, hue: 334, builtin: true, queries: ['ornate cross engraving', 'celtic cross illustration', 'medieval cross engraving', 'crucifix illustration vintage', 'iron cross engraving', 'religious cross ornament', 'cross pattée heraldry'] },
  /* vhs */
  { id: 'crt', name: 'CRT Altars', code: 'CRTA', blurb: 'cathode shrines & terminals', family: 'vhs', spawnP: 0.1, hue: 348, builtin: true, queries: ['crt television photo', 'cathode ray tube', 'vintage computer monitor', 'old television set', 'crt screen glow', 'retro tv static screen', 'vintage oscilloscope', 'old computer terminal', 'television test pattern', 'retro electronics bench'] },
  { id: 'vhsg', name: 'VHS Ghosts', code: 'VHSG', blurb: 'found footage & analog haunts', family: 'vhs', spawnP: 0.1, hue: 0, builtin: true, queries: ['vhs tape photo', 'found footage still', 'analog horror', 'vhs glitch screen', 'retro camcorder', 'vhs rental store', 'tape deck vintage', 'betamax', 'vhs aesthetic', 'rewind tape photo', 'vhs collection shelf', 'analog video artifact'] },
  { id: 'static', name: 'Static Séances', code: 'STAT', blurb: 'test cards & dead channels', family: 'vhs', spawnP: 0.1, hue: 340, builtin: true, queries: ['television test card', 'SMPTE color bars', 'broadcast test pattern', 'tv static noise', 'dead channel', 'television static photo', 'test card retro', 'broadcast engineering chart', 'monoscope', 'indian head test pattern', 'tv noise screen', 'signal loss screen'] },
  /* geometry */
  { id: 'euclid', name: 'Sacred Geometry', code: 'S-GEO', blurb: 'mandalas, tessellations, the flower', family: 'geometry', spawnP: 0.15, hue: 248, builtin: true, queries: ['sacred geometry', 'geometric construction', 'mandala', 'tessellation', 'islamic geometric pattern', 'compass and straightedge', 'platonic solids', 'fractal pattern', 'geometric ornament', 'flower of life', 'metatrons cube', 'golden ratio spiral diagram'] },
  { id: 'nets', name: 'Polyhedra Nets', code: 'NETS', blurb: 'Kepler solids & crystal forms', family: 'geometry', spawnP: 0.14, hue: 254, builtin: true, queries: ['polyhedron net diagram', 'platonic solid net', 'Kepler polyhedra', 'Harmonices Mundi', 'crystallography diagram vintage', 'polyhedral model illustration', 'geometric solid unfolding', 'archimedean solid', 'dodecahedron illustration', 'icosahedron diagram', 'crystal form engraving', 'stella octangula'] },
  { id: 'grid', name: 'GRID CHURCH', code: 'GRID', blurb: 'lattices & modular systems', family: 'geometry', spawnP: 0.15, hue: 238, builtin: true, queries: ['geometric pattern', 'op art', 'bauhaus pattern', 'graph paper', 'lattice', 'islamic geometric pattern', 'maze pattern', 'guilloche', 'grid drawing', 'meander pattern'] },
  { id: 'plot', name: 'Plot Bureau', code: 'PLOT', blurb: 'graphs & strange attractors', family: 'geometry', spawnP: 0.15, hue: 262, builtin: true, queries: ['mathematical function graph plot', 'strange attractor fractal plot', 'mandelbrot set fractal image', 'phase portrait dynamical system', 'vintage scientific graph chart', 'polar curve mathematical plot', 'voronoi diagram', 'contour plot surface mathematics'] },
  /* arch */
  { id: 'arch', name: 'Arch Plates', code: 'ARCH', blurb: 'architectural etchings', family: 'arch', spawnP: 0.16, hue: 203, builtin: true },
  { id: 'piranesi', name: 'Piranesi Vaults', code: 'PIRA', blurb: 'imaginary prisons & roman views', family: 'arch', spawnP: 0.17, hue: 212, builtin: true, queries: ['Piranesi Carceri', 'Piranesi imaginary prison', 'Piranesi etching', 'Vedute di Roma Piranesi', 'Piranesi ruins', 'Carceri d invenzione', 'Piranesi architecture engraving', 'Piranesi vault interior', 'roman ruins Piranesi', 'Piranesi antique architecture', 'Campo Marzio Piranesi', 'Piranesi plate'] },
  /* retro */
  { id: 'retro', name: 'Retro Futures', code: 'RETR', blurb: 'space-age illustration', family: 'retro', spawnP: 0.15, hue: 14, builtin: true },
  /* grim */
  { id: 'grim', name: 'Grim Engravings', code: 'GRIM', blurb: 'macabre & gothic plates', family: 'grim', spawnP: 0.18, hue: 275, builtin: true },
  { id: 'bestiary', name: 'BESTIARY', code: 'BEST', blurb: 'woodcut beasts, wild & tame', family: 'grim', spawnP: 0.18, hue: 130, builtin: true, policy: 'open', queries: ['woodcut animal', 'vintage animal engraving', 'zoological illustration', 'natural history plate animal', 'woodcut wolf', 'woodcut bear', 'raven woodcut', 'owl woodcut', 'serpent snake engraving', 'boar woodcut', 'tiger engraving print', 'woodcut deer stag', 'hare rabbit engraving', 'fox woodcut', 'lion engraving', 'octopus engraving'] },
  /* meme & found text */
  { id: 'bosch', name: 'BOSCH WELL', code: 'BOSCH', blurb: 'grotesque & garden of earthly delights', family: 'meme', spawnP: 0.16, hue: 16, builtin: true, queries: ['Hieronymus Bosch', 'Bosch painting', 'Bosch Garden of Earthly Delights detail', 'Bosch grotesque figures', 'Bosch hell panel', 'Bosch triptych detail', 'Bosch temptation of Saint Anthony'] },
  { id: 'foundtext', name: 'FOUND TEXT', code: 'FTXT', blurb: 'screenshots, odd signage, stray words', family: 'meme', spawnP: 0.18, hue: 200, builtin: true, queries: ['weird sign photo', 'odd warning sign', 'funny road sign', 'handwritten note found', 'graffiti text', 'vandalized sign', 'absurd signage', 'stray found text photo'] },
  { id: 'greencross', name: 'GREEN CROSS', code: 'GRNX', blurb: 'apothecary, herb culture & paraphernalia', family: 'meme', spawnP: 0.18, hue: 128, builtin: true, queries: ['vintage apothecary bottle', 'cannabis illustration', 'marijuana leaf', 'antique tobacco pipe', 'vintage drugstore sign', 'absinthe bottle vintage', 'herb grinder', 'vintage poison bottle', 'smoking paraphernalia', 'tincture bottle antique', 'opium pipe historical', 'psychedelic poster vintage', 'vintage cigarette advertisement', 'hemp plant illustration', 'vintage pharmacy jar', 'cannabis botanical plate'] },
  { id: 'cursed', name: 'CURSED FEED', code: 'CURS', blurb: 'cursed images & deep-fried stupidity', family: 'meme', spawnP: 0.17, hue: 58, builtin: true, queries: ['cursed image', 'cursed stock photo', 'bad luck brian', 'deep fried meme', 'surreal meme image', 'absurd meme', 'weird cursed photo', 'unnerving image', 'cursed object photo', 'glitch meme', 'cursed animals photo', 'low quality meme image', 'eerie funny photo', 'shitpost image'] },
  { id: 'signaltext', name: 'SIGNAL TEXT', code: 'SIGT', blurb: 'neon words, ransom letters, dead screens', family: 'meme', spawnP: 0.16, hue: 190, builtin: true, queries: ['glitch text art', 'neon sign words', 'ransom note letters', 'ASCII art', 'VHS text screen', 'CRT terminal text', 'typography glitch art', 'LED sign text', 'magazine cutout letters', 'weird text image', 'vaporwave text art', 'warning label text', 'graffiti words neon', 'old computer text screen'] },
  { id: 'corposludge', name: 'CORPO-SLUDGE', code: 'CRPS', blurb: 'acid-green corporate grotesque', family: 'meme', spawnP: 0.16, hue: 110, builtin: true, queries: ['corporate surrealism', 'grotesque stock photo', 'liminal office space', 'surreal office photo', 'bio-punk art', 'neon green pink aesthetic', 'fisheye lens grotesque', 'body horror illustration', 'weird 90s computer', 'corporate hellscape', 'grotesque neon sculpture', 'surreal cubicle photo', 'vomit green aesthetic', 'HR nightmare surreal', 'corporate Memphis parody'] },
  { id: 'oddities', name: 'ODDITIES CASE', code: 'ODDC', blurb: 'wunderkammer, jars & marvels', family: 'meme', spawnP: 0.15, hue: 42, builtin: true, queries: ['wunderkammer', 'curiosity cabinet', 'cabinet of curiosities', 'specimen jar vintage', 'taxidermy oddity', 'vintage scientific specimen', 'freak show poster', 'mermaid hoax Fiji', 'two headed calf', 'antique medical oddity', 'barnum museum', 'curio shop', 'oddity collection photo', 'wax anatomical model'] },
  { id: 'cursedlore', name: 'CURSED LORE', code: 'CLORE', blurb: 'internet mysteries & haunted media', family: 'meme', spawnP: 0.15, hue: 268, builtin: true, queries: ['internet mystery', 'haunted television', 'analog horror still', 'cursed broadcast', 'lost media', 'weird archive photo', 'occult internet', 'backrooms', 'eerie found photo', 'unexplained photo vintage', 'creepypasta aesthetic', 'haunted doll photo'] },
];

/* ---------------- settings / storage ---------------- */

export const FEED_CAP = 72;
export const TRAY_CAP = 2000;
export const QUALITY_FLOOR = 20;
/* isolation: concurrent worker streams + backlog depth. IDs are cheap, so
   the queue runs deep — plates wait their turn instead of being dropped. */
const ISO_MAX_QUEUE = 400;
const ISO_WORKERS = 2;
/* how many plates may be mid-isolation on the inline (cut-time) path before
   new passes defer to the background sweep — keeps memory bounded on a hot belt */
const MAX_INLINE_ISO = 60;

interface Settings {
  gate: number; autoCut: boolean; autoIso: boolean; showRejects: boolean;
  cutGate: number;
  pace: Pace; keepAwake: boolean; sourcesOn: Record<string, boolean>;
}
const DEFAULT_SETTINGS: Settings = { gate: 72, autoCut: true, autoIso: true, showRejects: true, cutGate: 55, pace: 'rapid', keepAwake: false, sourcesOn: {} };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('salvage9.settings.v1');
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(parsed as Partial<Settings>) };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s: Settings) {
  try { localStorage.setItem('salvage9.settings.v1', JSON.stringify(s)); } catch { /* quota */ }
}
function normalizeTray(list: unknown): Specimen[] {
  if (!Array.isArray(list)) return [];
  return (list as unknown[])
    .filter((s): s is Record<string, unknown> => isPlainObject(s) && typeof (s as Record<string, unknown>).id === 'string')
    .map(s => {
      const sp = s as unknown as Specimen;
      return { ...sp, cutoutSrc: undefined, isoState: sp.cutoutSrc ? undefined : sp.isoState };
    });
}
function defsFromStorage(): Record<string, SourceDef> {
  const known = new Set<string>(Object.keys(FAMILY_LABEL));
  let customs: SourceDef[] = [];
  try {
    const raw = localStorage.getItem('salvage9.sources.v1');
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        customs = (parsed as unknown[])
          .filter((d): d is Record<string, unknown> => isPlainObject(d) && typeof (d as Record<string, unknown>).id === 'string')
          .filter(d => !d.builtin && typeof d.family === 'string' && known.has(d.family as string))
          .map(d => d as unknown as SourceDef);
      }
    }
  } catch { /* ignore */ }
  const map: Record<string, SourceDef> = {};
  BUILTIN_DEFS.forEach(d => { map[d.id] = d; });
  customs.forEach(d => { map[d.id] = { ...d, builtin: false }; });
  return map;
}
function termsFor(def: SourceDef): string[] {
  if (def.queries?.length) return def.queries;
  if (def.query?.trim()) return [def.query.trim()];
  return FAMILY_TERMS[def.family];
}

const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => r()));
const PACE_FACTOR: Record<Pace, number> = { cruise: 0.5, rapid: 1.35 };
const PULL_CAP: Record<Pace, number> = { cruise: 1, rapid: 3 };

/* ================================================================== */
/*  the hook                                                           */
/* ================================================================== */

export function useCrawler() {
  const saved = useRef(loadSettings());
  const defs0 = useRef(defsFromStorage());

  const [running, setRunning] = useState(true);
  const [gate, setGateState] = useState(saved.current.gate);
  const [autoCut, setAutoCut] = useState(saved.current.autoCut);
  const [autoIso, setAutoIsoState] = useState(saved.current.autoIso);
  const [cutGate, setCutGateState] = useState(saved.current.cutGate);
  const [showRejects, setShowRejects] = useState(saved.current.showRejects);
  const [pace, setPaceState] = useState<Pace>(saved.current.pace === 'cruise' || saved.current.pace === 'rapid' ? saved.current.pace : 'rapid');
  const [keepAwake, setKeepAwakeState] = useState(saved.current.keepAwake);
  const [defs, setDefs] = useState(defs0.current);
  const [sources, setSources] = useState<SourcesState>(() => {
    const s: SourcesState = {};
    const savedOn = isPlainObject(saved.current.sourcesOn) ? saved.current.sourcesOn : {};
    for (const d of Object.values(defs0.current)) {
      const on = savedOn[d.id] ?? !d.off;
      s[d.id] = { on, health: 'ok', until: 0, pulled: 0 };
    }
    return s;
  });

  const [feed, setFeed] = useState<Specimen[]>([]);
  const feedRef = useRef<Specimen[]>(feed);
  const [tray, setTray] = useState<Specimen[]>(() => normalizeTray(loadRawTray()).slice(0, TRAY_CAP));
  const trayRef = useRef(tray);
  const trayIdSet = useRef<Set<string>>(new Set(tray.map(t => t.id)));
  const [log, setLog] = useState<LogLine[]>([]);
  const [stats, setStats] = useState({ seen: 0, passed: 0, binned: 0 });
  const statsRef = useRef(stats);
  const [uptime, setUptime] = useState(0);
  const [spm, setSpm] = useState(0);
  const [trayHeld, setTrayHeld] = useState(false);

  const feedFlushT = useRef<number | null>(null);
  const spawnStamps = useRef<number[]>([]);
  const lastSpawnAt = useRef(Date.now());
  const timeouts = useRef<number[]>([]);
  const heldByTray = useRef(false);
  const trayFullWarned = useRef(false);
  const pulledBuf = useRef<Record<string, number>>({});
  let logSeq = useRef(0);
  const logT = useRef<number | null>(null);
  const logBuf = useRef<LogLine[]>([]);

  const cfg = useRef({ running, gate, autoCut, autoIso, cutGate, pace, keepAwake, defs, sources });
  useEffect(() => { cfg.current = { running, gate, autoCut, autoIso, cutGate, pace, keepAwake, defs, sources }; });

  /* ---------------- batched state core ---------------- */
  const dirty = () => {
    if (feedFlushT.current !== null) return;
    feedFlushT.current = window.setTimeout(() => {
      feedFlushT.current = null;
      setFeed(feedRef.current);
      setStats({ ...statsRef.current });
      const st = spawnStamps.current;
      const now = Date.now();
      while (st.length && now - st[0] > 60_000) st.shift();
      const mins = (now - (st[0] ?? now)) / 60_000;
      if (mins > 0) setSpm(Math.round((st.length - 1) / mins));
    }, 160);
  };
  const trayDirty = () => {
    window.setTimeout(() => setTray(trayRef.current), 0);
  };
  const trayCommit = () => setTray(trayRef.current);

  /* pulled counters flush at 600ms */
  useEffect(() => {
    const iv = window.setInterval(() => {
      const keys = Object.keys(pulledBuf.current);
      if (keys.length === 0) return;
      const buf = pulledBuf.current;
      pulledBuf.current = {};
      setSources(st => {
        const out = { ...st };
        for (const k of keys) if (out[k]) out[k] = { ...out[k], pulled: out[k].pulled + buf[k] };
        return out;
      });
    }, 600);
    return () => window.clearInterval(iv);
  }, []);

  /* ---------------- log ---------------- */
  const say = useCallback((level: LogLine['level'], msg: string) => {
    const t = new Date();
    const hh = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
    logBuf.current.push({ id: ++logSeq.current, t: hh, msg, level });
    if (logBuf.current.length > 60) logBuf.current = logBuf.current.slice(-60);
    if (logT.current !== null) return;
    logT.current = window.setTimeout(() => {
      logT.current = null;
      const batch = logBuf.current;
      logBuf.current = [];
      setLog(l => [...l, ...batch].slice(-140));
    }, 350);
  }, []);

  /* ---------------- settings persistence ---------------- */
  useEffect(() => {
    saveSettings({
      gate, autoCut, autoIso, showRejects, cutGate, pace, keepAwake,
      sourcesOn: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, v.on])),
    });
  }, [gate, autoCut, autoIso, showRejects, cutGate, pace, keepAwake, sources]);
  useEffect(() => {
    try {
      localStorage.setItem('salvage9.sources.v1', JSON.stringify(Object.values(defs).filter(d => !d.builtin)));
    } catch { /* quota */ }
  }, [defs]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem('salvage9.tray.v1', JSON.stringify(
          tray.slice(0, TRAY_CAP).map(({ cutoutSrc: _c, ...rest }) => rest)));
      } catch { /* quota */ }
    }, 1800);
    return () => window.clearTimeout(t);
  }, [tray]);

  /* ---------------- isolation (cut-time, worker-backed) ----------------
     Isolation now happens AS a plate is cut into the tray: try the fast
     pass, grade it, and if it clears the CUT GATE keep it; otherwise retry
     once with the fine (crop-and-refine) pass; if that still falls short,
     the plate lands as a FULL plate instead. All inference lives in the
     worker, so the tray fills with finished cuts by the time it's full. */
  const isoQueue = useRef<string[]>([]);
  const isoActive = useRef(0);
  const isoInline = useRef(0);
  const isoFirstCut = useRef(false);
  const isoOverflowWarned = useRef(false);
  /* isolation diagnostics: how many plates ended as a real cut, a full
     plate (couldn't isolate), or an outright error — surfaced periodically */
  const isoStats = useRef({ cut: 0, full: 0, threw: 0, reported: 0 });
  const reportIso = () => {
    const s = isoStats.current;
    const total = s.cut + s.full + s.threw;
    if (total - s.reported < 15) return;
    s.reported = total;
    const pct = total > 0 ? Math.round((s.cut / total) * 100) : 0;
    say('sys', `isolation: ${s.cut}/${total} cut (${pct}%) · ${s.full} full-plate · ${s.threw} errors`);
  };

  const markIso = (id: string, state: NonNullable<Specimen['isoState']>, cutoutSrc?: string, cutEngine?: 'ink' | 'flood' | 'model', cutScore?: number) => {
    const patch = (it: Specimen): Specimen =>
      it.id === id
        ? { ...it, isoState: state, ...(cutoutSrc ? { cutoutSrc } : {}), ...(cutEngine ? { cutEngine } : {}), ...(cutScore !== undefined ? { cutScore } : {}) }
        : it;
    feedRef.current = feedRef.current.map(patch);
    dirty();
    if (trayIdSet.current.has(id)) {
      trayRef.current = trayRef.current.map(patch);
      trayDirty();
    }
  };

  /* Try to isolate a plate to at least the CUT GATE. Attempt 1 is the fast
     single pass; if its grade falls short, attempt 2 is the fine pass
     (crop-and-refine). Returns the best passing cut, or null if neither
     attempt cleared the gate (caller falls back to the full plate). */
  const isolateBest = async (spec: Specimen): Promise<{ cutoutSrc: string; engine: 'ink' | 'flood' | 'model'; cutScore: number } | null> => {
    const url = spec.thumb ?? spec.fullUrl ?? (spec.remote ? spec.dataUri : undefined);
    if (!url) return null;
    const gate = cfg.current.cutGate;
    const attempt = async (quality: 'fast' | 'fine') => {
      const res = await isolateFromUrl(url, quality, 1024);
      const img = await loadImageDataUrl(res.dataUrl);
      return { res, grade: gradeCutout(img).score };
    };
    try {
      const a1 = await attempt('fast');
      if (a1.grade >= gate) return { cutoutSrc: a1.res.dataUrl, engine: a1.res.engine, cutScore: a1.grade };
      try {
        const a2 = await attempt('fine');
        if (a2.grade >= gate) return { cutoutSrc: a2.res.dataUrl, engine: a2.res.engine, cutScore: a2.grade };
      } catch { /* second attempt failed — fall through to full plate */ }
    } catch { /* first attempt failed — fall through to full plate */ }
    return null;
  };

  /* Cut a plate into the tray, isolating it first when auto-isolate is on.
     The tray entry arrives already cut (or as a full plate if isolation
     couldn't clear the cut gate after two tries). */
  const cutWithIso = async (spec: Specimen, mode: 'auto' | 'manual' | 'override') => {
    if (!cfg.current.autoIso) { doCut(spec, mode); return; }
    /* if too many plates are already mid-isolation, defer to the background
       sweep so a hot belt doesn't pile up unbounded inference jobs */
    if (isoInline.current >= MAX_INLINE_ISO) { doCut(spec, mode); enqueueIso([spec.id]); return; }
    isoInline.current += 1;
    markIso(spec.id, 'work');
    try {
      const best = await isolateBest(spec);
      if (best) {
        markIso(spec.id, 'done', best.cutoutSrc, best.engine, best.cutScore);
        if (!isoFirstCut.current) {
          isoFirstCut.current = true;
          say('cut', `✂ first cut landed (${best.engine}, grade ${best.cutScore}) — isolation is live`);
        }
        isoStats.current.cut++;
        doCut({ ...spec, cutoutSrc: best.cutoutSrc, cutEngine: best.engine, cutScore: best.cutScore, isoState: 'done' }, mode);
      } else {
        markIso(spec.id, 'fullframe');
        isoStats.current.full++;
        doCut({ ...spec, isoState: 'fullframe' }, mode);
      }
      reportIso();
    } catch {
      isoStats.current.threw++;
      markIso(spec.id, 'fullframe');
      doCut({ ...spec, isoState: 'fullframe' }, mode);
      reportIso();
    } finally {
      isoInline.current = Math.max(0, isoInline.current - 1);
    }
  };

  const enqueueIso = (ids: string[]) => {
    if (!cfg.current.autoIso) return;
    let added = 0;
    for (const id of ids) {
      if (isoQueue.current.length >= ISO_MAX_QUEUE) {
        if (!isoOverflowWarned.current) {
          isoOverflowWarned.current = true;
          say('warn', `isolation backlog full at ${ISO_MAX_QUEUE} — stragglers skipped`);
        }
        break;
      }
      if (!isoQueue.current.includes(id)) { isoQueue.current.push(id); added++; }
    }
    if (added > 0) {
      const queued = (it: Specimen): Specimen =>
        ids.includes(it.id) && !it.cutoutSrc && it.isoState !== 'work' ? { ...it, isoState: 'queue' } : it;
      feedRef.current = feedRef.current.map(queued);
      dirty();
      trayRef.current = trayRef.current.map(queued);
      trayDirty();
      void isoPump();
    }
  };

  /* The pump runs ISO_WORKERS plates concurrently. All heavy inference
     lives in the isolation WORKER (never the main thread), and the
     keep-awake audio + Web Lock keep the tab alive in the background —
     so cuts keep landing while you work in another tab. The main thread
     only composites between plates, so nothing freezes. */
  const isoPump = async () => {
    if (isoActive.current >= ISO_WORKERS) return;
    isoActive.current += 1;
    try {
      while (isoQueue.current.length > 0) {
        const id = isoQueue.current.shift()!;
        const spec = feedRef.current.find(x => x.id === id) ?? trayRef.current.find(x => x.id === id);
        if (!spec || spec.cutoutSrc) continue;
        markIso(id, 'work');
        try {
          const best = await isolateBest(spec);
          if (best) { markIso(id, 'done', best.cutoutSrc, best.engine, best.cutScore); isoStats.current.cut++; }
          else { markIso(id, 'fullframe'); isoStats.current.full++; }
        } catch {
          markIso(id, 'fullframe');
          isoStats.current.threw++;
        }
        reportIso();
        /* let the UI breathe between plates */
        await nextFrame();
      }
      isoOverflowWarned.current = false;
    } finally {
      isoActive.current = Math.max(0, isoActive.current - 1);
      /* self-reschedule: if work landed while we were winding down (e.g. a
         cut-gate re-run enqueued plates), don't strand it — restart. This
         closes the gap where the queue had items but no live pump. */
      if (isoQueue.current.length > 0 && isoActive.current < ISO_WORKERS) void isoPump();
    }
  };

  /* surface isolation-engine lifecycle in the crawl log — cold model loads
     download ~100MB of weights, and silent downloads read as "it's broken" */
  useEffect(() => {
    const off = onIsoProgress((pct, modelName) => {
      if (pct === null && modelName) say('cut', `isolation engine online: ${modelName}`);
      else if (pct === -1 && modelName) say('warn', `isolation: ${modelName}`);
      else if (typeof pct === 'number' && pct >= 0 && modelName) say('sys', `isolation engine: ${modelName} ${pct}%`);
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- tray ops ---------------- */
  const doCut = (spec: Specimen, mode: 'auto' | 'manual' | 'override') => {
    if (trayIdSet.current.has(spec.id)) return;
    if (trayRef.current.length >= TRAY_CAP) {
      if (!heldByTray.current) {
        heldByTray.current = true;
        setTrayHeld(true);
        setRunning(false);
        say('warn', `tray full at ${TRAY_CAP} — crawler held · clear or cull the tray to resume`);
      }
      return;
    }
    trayIdSet.current.add(spec.id);
    trayRef.current = [...trayRef.current, spec]; /* append: scrollbar never shoves */
    if (mode === 'auto') trayDirty(); else trayCommit();
    say('cut', `✂ ${spec.code} → tray [${mode}] grade ${spec.score}${spec.cutoutSrc ? ' · cut ✓' : spec.isoState === 'fullframe' ? ' · full plate' : ''}`);
  };

  const cut = (spec: Specimen) => doCut({ ...spec, verdict: 'pass', state: 'judged' }, spec.verdict === 'reject' ? 'override' : 'manual');

  const removeFromTray = (id: string) => {
    trayIdSet.current.delete(id);
    trayRef.current = trayRef.current.filter(x => x.id !== id);
    trayCommit();
    /* single removals don't restart the crawler */
  };

  const clearTray = () => {
    trayIdSet.current.clear();
    trayRef.current = [];
    setTray([]);
    const wasHeld = heldByTray.current;
    if (heldByTray.current) { heldByTray.current = false; setTrayHeld(false); setRunning(true); }
    trayFullWarned.current = false;
    say('warn', 'cutting tray swept clean');
    if (wasHeld) say('sys', 'space on the line — crawler resumed');
  };

  const cullTray = () => {
    const g = cfg.current.gate;
    const before = trayRef.current.length;
    trayRef.current = trayRef.current.filter(t => t.score >= g);
    trayIdSet.current.clear();
    trayRef.current.forEach(t => trayIdSet.current.add(t.id));
    trayCommit();
    if (heldByTray.current) { heldByTray.current = false; setTrayHeld(false); setRunning(true); }
    trayFullWarned.current = false;
    const n = before - trayRef.current.length;
    say(n ? 'cut' : 'sys',
      n ? `cull: swept ${n} cut${n > 1 ? 's' : ''} below grade ${g} — only the good shit remains`
        : `cull: nothing below grade ${g} — tray is already top shelf`);
  };

  const bin = (id: string, reason?: string) => {
    feedRef.current = feedRef.current.filter(it => it.id !== id);
    dirty();
    say('bin', reason ? `✗ ${reason}` : '✗ specimen purged from intake buffer');
  };

  const purgeFeed = () => {
    feedRef.current = [];
    dirty();
    say('sys', `intake buffer purged — ${FEED_CAP} slots open`);
  };

  /* ---------------- judge + sentry ---------------- */
  const judge = (spec: Specimen) => {
    const g = cfg.current.gate;
    const live = feedRef.current.find(it => it.id === spec.id);
    if (!live) return;
    const score = live.score;
    const meme = isMemeFam(live.family);
    const effGate = g - (meme ? MEME_GATE_DISCOUNT : 0);
    const verdict: 'pass' | 'reject' = score >= effGate ? 'pass' : 'reject';
    feedRef.current = feedRef.current.map(it => (it.id === spec.id ? { ...it, state: 'judged', verdict } : it));
    dirty();
    if (verdict === 'pass') {
      statsRef.current = { ...statsRef.current, passed: statsRef.current.passed + 1 };
      say('pass', `✓ PASS ${score} — ${spec.code} “${spec.archetype}”${cfg.current.autoCut ? (cfg.current.autoIso ? ' → auto-cut + isolate' : ' → auto-cut') : ''}`);
      if (cfg.current.autoCut) void cutWithIso({ ...live, verdict: 'pass', state: 'judged' }, 'auto');
    } else {
      statsRef.current = { ...statsRef.current, binned: statsRef.current.binned + 1 };
      if (Math.random() < 0.3) say('bin', `✗ bin ${score} — ${spec.code} “${spec.archetype}”`);
    }
  };

  const applyQuality = (id: string, q: number) => {
    const it = feedRef.current.find(x => x.id === id);
    if (!it) return;
    if (isMemeFam(it.family)) {
      feedRef.current = feedRef.current.map(x => (x.id === id ? { ...x, score: q, why: [...(x.why ?? []), `SENTRY ${q >= it.score ? '+' : '−'}${Math.abs(q - it.score)}`] } : x));
      dirty();
      if (it.state === 'judged') judge(it);
      return;
    }
    if (q < QUALITY_FLOOR) {
      bin(id, `sentry: weak plate (grade ${q}) binned before the gate`);
      return;
    }
    const delta = Math.max(-8, Math.min(8, q - 60));
    const newScore = Math.max(5, Math.min(97, it.score + delta));
    feedRef.current = feedRef.current.map(x => (x.id === id ? { ...x, score: newScore, why: [...(x.why ?? []), `SENTRY ${delta >= 0 ? '+' : '−'}${Math.abs(delta)}`] } : x));
    dirty();
    if (it.state === 'judged') judge(it);
  };

  /* ---------------- spawn ---------------- */
  const spawn = (def: SourceDef) => {
    const q = queueFor(def.id, termsFor(def), def.family, def.policy);
    const item = q.take();
    if (!item) return;
    let hsh = 0;
    for (let ci = 0; ci < item.id.length; ci++) hsh = (hsh * 31 + item.id.charCodeAt(ci)) >>> 0;
    const spec: Specimen = {
      id: item.id,
      code: `${(item.provider || 'XX').slice(0, 2).toUpperCase()}-${hsh.toString(36).toUpperCase().padStart(5, '0').slice(-5)}`,
      family: def.family,
      srcCode: def.code,
      srcHue: def.hue,
      archetype: item.title || 'untitled plate',
      tags: [def.family, item.provider],
      score: item.gradeScore ?? 50,
      why: item.gradeWhy,
      dataUri: item.thumb,
      w: item.w || 900,
      h: item.h || Math.round(900 * (def.family === 'vhs' || def.family === 'retro' || def.family === 'webcore' ? 0.75 : 1.25)),
      aspect: item.w && item.h ? item.w / item.h : 0.8,
      remote: true,
      thumb: item.thumb,
      fullUrl: item.fullUrl,
      pageUrl: item.pageUrl,
      credit: item.creator,
      license: item.license,
      provider: item.provider,
      sourceName: item.sourceName,
      verdict: 'pass',
      state: 'incoming',
      born: Date.now(),
    };
    feedRef.current = [...feedRef.current, spec].slice(-FEED_CAP); /* append at the tail */
    statsRef.current = { ...statsRef.current, seen: statsRef.current.seen + 1 };
    dirty();
    pulledBuf.current[def.id] = (pulledBuf.current[def.id] ?? 0) + 1;
    lastSpawnAt.current = Date.now();
    spawnStamps.current.push(Date.now());

    /* raster sentry — decides what titles can't */
    const probe = new Image();
    probe.crossOrigin = 'anonymous';
    probe.referrerPolicy = 'no-referrer';
    /* unreadable thumbnail → dead plate; drop it so it never reaches the
       belt/tray (it would render blank and download as a broken file) */
    probe.onerror = () => {
      feedRef.current = feedRef.current.filter(it => it.id !== spec.id);
      dirty();
      trayIdSet.current.delete(spec.id);
      trayRef.current = trayRef.current.filter(it => it.id !== spec.id);
      trayDirty();
      statsRef.current = { ...statsRef.current, binned: statsRef.current.binned + 1 };
      say('bin', `✗ ${spec.code} — thumbnail refused to load, dropped`);
    };
    probe.onload = () => {
      const scan = analyzePlate(probe);
      const textOk = false;
      let reason: string | null = null;
      if (scan.flat) reason = 'flat scan (blank / cloth / texture)';
      else if (scan.textPage && !textOk) reason = 'typeset page (wall of text)';
      else if (scan.sparse && !SPARSE_EXEMPT.has(spec.family)) reason = 'type-only plate (plain cover / title page)';
      else reason = photoJunk(scan, { family: spec.family, title: spec.archetype, creator: spec.credit, provider: spec.provider });
      if (reason) {
        bin(spec.id, `sentry: ${reason} auto-binned`);
        removeFromTray(spec.id);
        return;
      }
      applyQuality(spec.id, scan.quality);
    };
    probe.src = spec.thumb ?? spec.dataUri;

    const t = window.setTimeout(() => judge(spec), 160 + Math.random() * 200);
    timeouts.current.push(t);
  };

  /* ---------------- tick ---------------- */
  const tick = useCallback(() => {
    const c = cfg.current;
    if (!c.running) return;
    const now = Date.now();
    const p = PACE_FACTOR[c.pace];
    let pulled = 0;
    const cap = PULL_CAP[c.pace];
    const order = Object.values(c.defs);
    const off = Math.floor(now / 1000) % order.length;
    for (let i = 0; i < order.length; i++) {
      if (pulled >= cap) break;
      const def = order[(i + off) % order.length];
      const st = c.sources[def.id];
      if (!st?.on) continue;
      if (st.health === 'cooldown') {
        if (now > st.until) {
          setSources(s2 => ({ ...s2, [def.id]: { ...s2[def.id], health: 'ok' } }));
          say('sys', `${def.code}: back online — resuming pull`);
        }
        continue;
      }
      void queueFor(def.id, termsFor(def), def.family, def.policy).ensure(24, (msg, kind) => say(kind, msg));
      if (Math.random() < def.spawnP * p) {
        spawn(def);
        pulled += 1;
      }
    }
  }, [say]);

  const tickRef = useRef(tick);
  useEffect(() => { tickRef.current = tick; }, [tick]);
  useEffect(() => {
    const iv = window.setInterval(() => tickRef.current(), 200);
    return () => window.clearInterval(iv);
  }, []);

  /* uptime */
  useEffect(() => {
    const iv = window.setInterval(() => { if (cfg.current.running) setUptime(u => u + 1); }, 1000);
    return () => window.clearInterval(iv);
  }, []);

  /* belt watchdog */
  useEffect(() => {
    const iv = window.setInterval(() => {
      if (!cfg.current.running) return;
      if (Date.now() - lastSpawnAt.current < 45_000) return;
      const m = (k: keyof typeof mirrorStats) => {
        const s = mirrorStats[k];
        return `${k.slice(0, 2).toUpperCase()} ${s.ok > 0 ? '✓' : '✗'} ${s.ok}/${s.fail}`;
      };
      say('warn', `belt quiet 45s — mirrors: ${m('openverse')} · ${m('wikimedia')} (queues refilling or throttled)`);
      lastSpawnAt.current = Date.now();
    }, 15_000);
    return () => window.clearInterval(iv);
  }, [say]);

  /* keep-awake (optional) — nudges the tick while backgrounded */
  useEffect(() => {
    if (keepAwake) startKeepAwake(() => tickRef.current());
    else stopKeepAwake();
    return () => stopKeepAwake();
  }, [keepAwake]);

  /* boot */
  useEffect(() => {
    const lines: Array<[number, LogLine['level'], string]> = [
      [150, 'sys', 'SALVAGE/9 kernel — ok'],
      [650, 'sys', `taps mounted: ${Object.keys(defs0.current).length} live ✓`],
      [1100, 'sys', 'live mirrors mounted: openverse (trickle) ✓ wikimedia (workhorse) ✓ museums ✓'],
      [1550, 'sys', `taste gland calibrated — gate ${cfg.current.gate} (“${gateWord(cfg.current.gate)}”)`],
      [1900, 'sys', 'isolation engine: RMBG-2.0 worker armed (ink-matte for engravings, color-flood for solid backgrounds)'],
      [2200, 'sys', 'crawl engaged. only the good shit gets through.'],
    ];
    if (!cfg.current.autoCut) {
      lines.push([2600, 'warn', 'auto-cut is OFF — the tray only fills on manual cuts. flip it under BEHAVIOR if you want a hands-free tray.']);
    }
    lines.forEach(([d, lvl, msg]) => {
      const t = window.setTimeout(() => say(lvl, msg), d);
      timeouts.current.push(t);
    });
    const all = Object.values(defs0.current);
    all.forEach((def, i) => {
      const wave = Math.floor(i / 4);
      const t = window.setTimeout(() => {
        void queueFor(def.id, termsFor(def), def.family, def.policy).ensure(30, (msg, kind) => say(kind, `${def.code} · ${msg}`));
      }, 1200 + wave * 700 + (i % 4) * 120);
      timeouts.current.push(t);
    });
    return () => {
      timeouts.current.forEach(t => window.clearTimeout(t));
      timeouts.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- settings ops ---------------- */
  const setGate = (v: number) => {
    setGateState(v);
    say('sys', `taste gate → ${v} (“${gateWord(v)}”)`);
  };
  const setCutGate = (v: number) => {
    /* update the ref synchronously — the pump reads cfg.current.cutGate and
       starts before React flushes the new state below */
    cfg.current.cutGate = v;
    setCutGateState(v);
    say('sys', `cut gate → ${v} (isolation must grade ≥ ${v} to be kept as a cut; below that it lands as a full plate)`);

    /* retroactive pass: every tray plate that has NOT already cleared the new
       gate (no cutout at all, or a cut that scored below v) gets re-run at the
       new number — isolateBest gives each two attempts (fast then fine). */
    const needsRerun = trayRef.current.filter(it =>
      !it.cutoutSrc || (it.cutScore !== undefined && it.cutScore < v),
    );
    if (needsRerun.length === 0) return;
    const ids = new Set(needsRerun.map(it => it.id));
    /* clear stale cutouts so the pump re-isolates against the new gate */
    const clear = (it: Specimen): Specimen =>
      ids.has(it.id) ? { ...it, cutoutSrc: undefined, cutEngine: undefined, cutScore: undefined, isoState: 'queue' } : it;
    trayRef.current = trayRef.current.map(clear);
    feedRef.current = feedRef.current.map(clear);
    trayDirty();
    dirty();
    for (const id of ids) {
      if (isoQueue.current.length >= ISO_MAX_QUEUE) break;
      if (!isoQueue.current.includes(id)) isoQueue.current.push(id);
    }
    say('cut', `cut gate changed — re-running ${ids.size} tray plate${ids.size === 1 ? '' : 's'} that hadn't cleared ≥ ${v} (two attempts each)`);
    void isoPump();
  };
  const setPace = (p: Pace) => {
    if (p === cfg.current.pace) return;
    setPaceState(p);
    say('sys', p === 'rapid' ? 'crawl pace → RAPID — spiders on amphetamines' : 'crawl pace → CRUISE — steady, considered drip');
  };
  const toggleRun = () => {
    setRunning(r => {
      if (r) {
        const s = statsRef.current;
        const cuts = trayRef.current;
        const rate = s.seen > 0 ? ((s.passed / s.seen) * 100).toFixed(1) : '0.0';
        const best = cuts.length ? Math.max(...cuts.map(t => t.score)) : 0;
        say('warn', `HOLD — shift report: ${s.seen} plates seen · ${rate}% passed · ${cuts.length} cuts in tray${best ? ` · best ${best}` : ''}`);
      } else {
        heldByTray.current = false;
        setTrayHeld(false);
        say('sys', 'RESUME — spiders redeployed');
      }
      return !r;
    });
  };
  const toggleSource = (id: string) => {
    setSources(s => ({ ...s, [id]: { ...s[id], on: !s[id].on } }));
    const def = cfg.current.defs[id];
    const nowOn = !cfg.current.sources[id]?.on;
    if (def) say('sys', `${def.code} ${nowOn ? 'opened' : 'closed'}`);
  };
  const toggleAutoCut = () => {
    setAutoCut(a => {
      say('sys', `auto-cut ${!a ? 'engaged — passes flow straight to tray' : 'disengaged — manual cuts only'}`);
      return !a;
    });
  };
  const toggleAutoIso = () => {
    const next = !cfg.current.autoIso;
    setAutoIsoState(next);
    if (next) {
      say('sys', 'auto-isolate engaged — subjects get freed on the way to the tray');
      const pending = trayRef.current.filter(t => !t.cutoutSrc && t.remote).map(t => t.id);
      if (pending.length) {
        say('sys', `${pending.length} existing tray cut${pending.length === 1 ? '' : 's'} queued for isolation`);
        enqueueIso(pending);
      }
    } else {
      say('sys', 'auto-isolate disengaged — plates stay full-frame');
    }
  };
  const toggleKeepAwake = () => {
    const next = !cfg.current.keepAwake;
    setKeepAwakeState(next);
    say('sys', next
      ? 'keep-awake engaged — silent audio keeps the tab alive (speaker icon = proof)'
      : 'keep-awake off — the browser may slow the crawl when backgrounded');
  };

  let tapCounter = useRef(0);
  const addSource = (input: { name: string; code: string; blurb: string; family: Family; hue: number; query: string }): string | null => {
    const name = input.name.trim();
    const code = (input.code.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 18)) || 'untitled-tap';
    if (!name) return 'name the tap first';
    if (Object.values(cfg.current.defs).some(d => d.code.toLowerCase() === code.toLowerCase())) return `code “${code}” already plumbed`;
    const id = `tap-${Date.now().toString(36)}${(++tapCounter.current).toString(36)}`;
    const query = input.query.trim();
    const def: SourceDef = {
      id, name, code,
      blurb: input.blurb.trim() || `${FAMILY_LABEL[input.family].toLowerCase()}, custom tap`,
      family: input.family, spawnP: 0.26, hue: Math.round(input.hue), builtin: false,
      query: query || undefined,
    };
    setDefs(d => ({ ...d, [id]: def }));
    setSources(s => ({ ...s, [id]: { on: true, health: 'ok', until: 0, pulled: 0 } }));
    void queueFor(id, termsFor(def), def.family, def.policy).ensure(30, (msg, kind) => say(kind, `${code} · ${msg}`));
    say('sys', `new tap plumbed → ${code} (${FAMILY_LABEL[input.family]}, hue ${def.hue}°${query ? `, query "${query}"` : ''})`);
    return null;
  };
  const removeSource = (id: string) => {
    const def = cfg.current.defs[id];
    setDefs(d => {
      const { [id]: _gone, ...rest } = d;
      return rest;
    });
    setSources(s => {
      const { [id]: _gone, ...rest } = s;
      return rest;
    });
    if (def) say('warn', `tap ${def.code} ripped out of the wall`);
  };

  const passRate = stats.seen > 0 ? (stats.passed / stats.seen) * 100 : 0;

  return {
    running, gate, autoCut, autoIso, cutGate, showRejects, pace, keepAwake, defs, sources,
    feed, tray, log, stats, uptime, passRate, spm, trayHeld,
    trayIds: trayIdSet.current,
    setGate, setCutGate, setPace, toggleRun, toggleSource, toggleAutoCut, toggleAutoIso, toggleKeepAwake,
    addSource, removeSource,
    setShowRejects: (v: boolean) => setShowRejects(v),
    cut, bin, purgeFeed, clearTray, removeFromTray, cullTray, say,
  };
}

export function gateWord(g: number): string {
  if (g >= 85) return 'IMPOSSIBLE';
  if (g >= 75) return 'RUTHLESS';
  if (g >= 65) return 'PICKY';
  if (g >= 50) return 'DISCERNING';
  if (g >= 35) return 'LENIENT';
  return 'INDISCRIMINATE';
}

function loadRawTray(): unknown {
  try {
    const raw = localStorage.getItem('salvage9.tray.v1');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
