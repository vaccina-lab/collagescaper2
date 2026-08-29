/* SALVAGE/9 — mirrors, filters, grading, raster sentry, paced queues.
   Six mirrors with independent rate windows. */

import type { Family } from './types';

export interface RemoteItem {
  id: string; title: string; thumb: string; fullUrl: string; pageUrl?: string;
  creator?: string; license?: string; provider: string; sourceName?: string;
  w: number; h: number; gradeScore?: number; gradeWhy?: string[];
}
export type QEvent = (msg: string, kind: 'sys' | 'pass' | 'bin' | 'warn' | 'err' | 'cut') => void;
export type ProviderPolicy = 'museum' | 'open' | 'any';

export const mirrorStats = {
  openverse: { ok: 0, fail: 0, last: 0 },
  wikimedia: { ok: 0, fail: 0, last: 0 },
  met: { ok: 0, fail: 0, last: 0 },
  cleveland: { ok: 0, fail: 0, last: 0 },
  artic: { ok: 0, fail: 0, last: 0 },
  vam: { ok: 0, fail: 0, last: 0 },
};

const OV_MIN_GAP = 4500;
const CW_MIN_GAP = 240;
const CW_FANOUT = 2;
const MV_GAPS: Record<string, number> = { met: 2000, cleveland: 2000, artic: 2000, vam: 2200 };
const MUSEUM_ORDER = ['met', 'cleveland', 'artic', 'vam'] as const;
type MuseumMirror = (typeof MUSEUM_ORDER)[number];
const mvNext: Record<MuseumMirror, number> = { met: 0, cleveland: 0, artic: 0, vam: 0 };
let museumRR = 0;
let lastMvWarn = 0;
let ovNext = 0;
let cwNext = 0;
let cwCooldownUntil = 0;
let cwFailStreak = 0;
let lastCwWarn = 0;
let inflight = 0;
const MAX_INFLIGHT = 10;

async function jfetch(url: string): Promise<Response> {
  const ctl = new AbortController();
  const t = window.setTimeout(() => ctl.abort(), 12_000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) {
      const e = new Error(`HTTP ${res.status}`) as Error & { status?: number };
      e.status = res.status;
      throw e;
    }
    return res;
  } finally { window.clearTimeout(t); }
}

/* ---------------- dedupe memory ---------------- */
const ID_CAP = 10000;
const URL_CAP = 10000;
const seenIds = new Set<string>();
const seenIdOrder: string[] = [];
const seenUrls = new Set<string>();
const seenUrlOrder: string[] = [];
function rememberIds(ids: string[]) {
  for (const id of ids) {
    if (seenIds.has(id)) continue;
    seenIds.add(id); seenIdOrder.push(id);
    if (seenIdOrder.length > ID_CAP) { const old = seenIdOrder.shift(); if (old) seenIds.delete(old); }
  }
}
function urlKey(u: string): string {
  return u.replace(/^https?:\/\//, '').replace(/\?.*$/, '').replace(/\/\d+px-/, '/').replace(/\.(jpe?g|png|gif|webp|svg|tiff?)$/i, '').toLowerCase();
}
function rememberUrls(urls: string[]) {
  for (const u of urls) {
    if (!u) continue;
    const k = urlKey(u);
    if (seenUrls.has(k)) continue;
    seenUrls.add(k); seenUrlOrder.push(k);
    if (seenUrlOrder.length > URL_CAP) { const old = seenUrlOrder.shift(); if (old) seenUrls.delete(old); }
  }
}

/* ---------------- walk cursors ---------------- */
interface Cursor { term: number; page: number }
type CursorMap = Record<string, Cursor>;
const cursors: CursorMap = (() => {
  try {
    const raw = localStorage.getItem('salvage9.cursor.v1');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as CursorMap) : {};
  } catch { return {}; }
})();
let cursorSaveT: number | null = null;
function persistCursorsSoon() {
  if (cursorSaveT !== null) return;
  cursorSaveT = window.setTimeout(() => {
    cursorSaveT = null;
    try { localStorage.setItem('salvage9.cursor.v1', JSON.stringify(cursors)); } catch { /* quota */ }
  }, 1500);
}

/* ---------------- provider policies ---------------- */
const OV_MUSEUMS = 'met,rijksmuseum,smithsonian,nypl,wellcome_images,europeana,brooklyn_museum,clevelandmuseum,digitaltmuseum,rawpixel,museumsvictoria,nasa,thorvaldsensmuseum,statensmuseum,getty,parismusees,bhl';
const OV_OPEN = 'flickr,rawpixel,europeana,wordpress,stocksnap,500px';
const POLICY_MUSEUM = new Set<Family>(['anatomy', 'dore', 'patent', 'stars', 'arch']);
const POLICY_ANY = new Set<Family>(['webcore', 'retro', 'vhs']);
function providersFor(family: Family, policy?: ProviderPolicy): string | null {
  const p = policy ?? (POLICY_ANY.has(family) ? 'any' : POLICY_MUSEUM.has(family) ? 'museum' : 'open');
  if (p === 'any') return null;
  if (p === 'museum') return OV_MUSEUMS;
  return OV_OPEN;
}
export const MUSEUM_RE = /\b(met|rijksmuseum|smithsonian|wellcome|british library|library of congress|nypl|europeana|biodiversity|victoria and albert|cleveland museum|art institute|getty|museum|gallery|collection|archive)\b/i;
export const MUSEUM_NAMES = new Set(['met', 'rijksmuseum', 'smithsonian', 'cleveland', 'artic', 'vam', 'nypl', 'wellcome_images', 'getty', 'bhl']);

/* ---------------- mirrors ---------------- */
async function openverse(term: string, page: number, sources: string | null): Promise<RemoteItem[]> {
  const srcs = sources ? `&source=${sources}` : '';
  const res = await jfetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(term)}&page=${page}&page_size=20&license_type=commercial${srcs}`);
  const json = (await res.json()) as {
    results?: Array<{ id: string; title?: string; creator?: string; license?: string; provider?: string; url?: string; thumbnail?: string; foreign_landing_url?: string; width?: number; height?: number }>;
  };
  return (json.results ?? []).filter(r => r.thumbnail).map(r => ({
    id: `ov-${r.id}`, title: r.title ?? 'untitled', thumb: r.thumbnail!,
    fullUrl: r.url || r.thumbnail!, pageUrl: r.foreign_landing_url,
    creator: r.creator, license: r.license, provider: r.provider ?? 'openverse', sourceName: r.provider ?? 'openverse',
    w: r.width ?? 0, h: r.height ?? 0,
  }));
}

async function commons(term: string, page: number): Promise<RemoteItem[]> {
  const gsroffset = (page - 1) * 50;
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*` +
    `&generator=search&gsrsearch=${encodeURIComponent(term)}&gsrnamespace=6&gsrlimit=50&gsroffset=${gsroffset}` +
    `&prop=imageinfo|info&inprop=url&iiprop=url|size|extmetadata&iiurlwidth=1200`;
  const res = await jfetch(url);
  const json = (await res.json()) as {
    query?: { pages?: Record<string, { pageid?: number; title?: string; fullurl?: string; imageinfo?: Array<{ thumburl?: string; url?: string; width?: number; height?: number; extmetadata?: Record<string, { value?: string }> }> }> };
  };
  const pages = json.query?.pages ?? {};
  const out: RemoteItem[] = [];
  for (const key of Object.keys(pages)) {
    const p = pages[key];
    const ii = p.imageinfo?.[0];
    if (!ii?.thumburl) continue;
    const meta = ii.extmetadata ?? {};
    out.push({
      id: `wm-${p.pageid ?? key}`,
      title: (p.title ?? 'untitled').replace(/^File:/, '').replace(/\.[a-z]+$/i, ''),
      thumb: ii.thumburl, fullUrl: ii.url ?? ii.thumburl, pageUrl: p.fullurl,
      creator: meta.Artist?.value?.replace(/<[^>]+>/g, ''),
      license: meta.LicenseShortName?.value,
      provider: 'commons', sourceName: 'wikimedia',
      w: ii.width ?? 0, h: ii.height ?? 0,
    });
  }
  return out;
}

const metSearchCache = new Map<string, number[]>();
async function metStrike(term: string, page: number): Promise<RemoteItem[]> {
  let ids = metSearchCache.get(term);
  if (!ids) {
    const sres = await jfetch(`https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=${encodeURIComponent(term)}`);
    const sjson = (await sres.json()) as { objectIDs?: number[] };
    ids = sjson.objectIDs ?? [];
    metSearchCache.set(term, ids);
  }
  if (ids.length === 0) return [];
  const start = ((page - 1) * 6) % ids.length;
  const slice = ids.slice(start, start + 6);
  const out: RemoteItem[] = [];
  for (const oid of slice) {
    try {
      const res = await jfetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${oid}`);
      const o = (await res.json()) as { objectID?: number; title?: string; artistDisplayName?: string; objectURL?: string; primaryImageSmall?: string; primaryImage?: string; isPublicDomain?: boolean };
      if (!o.isPublicDomain || !o.primaryImageSmall) continue;
      out.push({
        id: `met-${oid}`, title: o.title ?? 'untitled', thumb: o.primaryImageSmall,
        fullUrl: o.primaryImage ?? o.primaryImageSmall, pageUrl: o.objectURL,
        creator: o.artistDisplayName, license: 'CC0', provider: 'met', sourceName: 'met', w: 0, h: 0,
      });
    } catch { /* one bad object ≠ a bad strike */ }
  }
  return out;
}

async function cleStrike(term: string, page: number): Promise<RemoteItem[]> {
  const res = await jfetch(`https://openaccess-api.clevelandart.org/api/artworks/?q=${encodeURIComponent(term)}&cc0=1&limit=10&skip=${(page - 1) * 10}&fields=id,title,images,url,creators`);
  const json = (await res.json()) as {
    data?: Array<{ id: number; title?: string; url?: string; images?: { web?: { url?: string }; print?: { url?: string } }; creators?: Array<{ description?: string }> }>;
  };
  return (json.data ?? []).filter(o => o.images?.web?.url || o.images?.print?.url).map(o => ({
    id: `cle-${o.id}`, title: o.title ?? 'untitled',
    thumb: o.images?.web?.url ?? o.images?.print?.url ?? '',
    fullUrl: o.images?.print?.url ?? o.images?.web?.url ?? '', pageUrl: o.url,
    creator: Array.isArray(o.creators) && o.creators.length ? o.creators[0].description : undefined,
    license: 'CC0', provider: 'cleveland', sourceName: 'cleveland', w: 0, h: 0,
  }));
}

async function artStrike(term: string, page: number): Promise<RemoteItem[]> {
  const res = await jfetch(`https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(term)}&page=${page}&limit=10&fields=id,title,image_id`);
  const json = (await res.json()) as { data?: Array<{ id: number; title?: string; image_id?: string | null }> };
  return (json.data ?? []).filter(o => o.image_id).map(o => ({
    id: `aic-${o.id}`, title: o.title ?? 'untitled',
    thumb: `https://www.artic.edu/iiif/2/${o.image_id}/full/843,/0/default.jpg`,
    fullUrl: `https://www.artic.edu/iiif/2/${o.image_id}/full/1686,/0/default.jpg`,
    pageUrl: `https://www.artic.edu/artworks/${o.id}`,
    license: 'CC0', provider: 'artic', sourceName: 'artic', w: 0, h: 0,
  }));
}

async function vamStrike(term: string, page: number): Promise<RemoteItem[]> {
  const res = await jfetch(`https://api.vam.ac.uk/v2/objects/search?q=${encodeURIComponent(term)}&page=${page}&page_size=10&images_exist=1`);
  const json = (await res.json()) as {
    records?: Array<{ systemNumber?: string; objectType?: string; _primaryTitle?: string; _primaryThumbnail?: string; artistMakerPerson?: Array<{ name?: { text?: string } }> }>;
  };
  const out: RemoteItem[] = [];
  for (const o of json.records ?? []) {
    const sys = o._primaryThumbnail ?? '';
    if (!sys) continue;
    out.push({
      id: `vam-${o.systemNumber ?? ''}`, title: o._primaryTitle ?? o.objectType ?? 'untitled',
      thumb: sys, fullUrl: sys.replace('/200/', '/1200/'),
      pageUrl: `https://collections.vam.ac.uk/item/${o.systemNumber ?? ''}`,
      creator: o.artistMakerPerson?.[0]?.name?.text,
      license: 'CC-BY', provider: 'vam', sourceName: 'vam', w: 0, h: 0,
    });
  }
  return out;
}

async function museumStrike(m: MuseumMirror, term: string, page: number): Promise<RemoteItem[]> {
  if (m === 'met') return metStrike(term, page);
  if (m === 'cleveland') return cleStrike(term, page);
  if (m === 'artic') return artStrike(term, page);
  return vamStrike(term, page);
}

/* ================================================================== */
/*  FILTER STACK — order matters                                        */
/* ================================================================== */
const HARD_WORDS = [
  'classic car', 'antique car', 'vintage car', 'old car', 'automobile', 'motorcar', 'chevrolet', 'chevy',
  'cadillac', 'buick', 'pontiac', 'corvette', 'mustang', 'hot rod', 'hotrod', 'oldtimer', 'old-timer',
  'thunderbird', 'plymouth', 'car show', 'car museum', 'car collection', 'classic auto', 'vintage auto',
  'oldsmobile', 'ferrari', 'porsche', 'lamborghini', 'roadster',
  'world map', 'map of', 'road map', 'street map', 'city map', 'country map', 'nautical chart',
  'hydrographic', 'topographic', 'topographical', 'cartograph', 'globe map', 'atlas map', 'route 66',
  'guitar', 'guitarist', 'banjo', 'mandolin', 'ukulele', 'fender', 'gibson', 'stratocaster', 'telecaster',
  'les paul', 'epiphone', 'ibanez', 'amplifier', 'headstock', 'fretboard',
  'rick and morty', 'rick & morty', 'rickandmorty', 'pickle rick',
];
const BANNED_HARD = new RegExp(`\\b(${HARD_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
const BANNED_SKY = /\b(milky way|starry sky|starry night sky|star trail|astrophotography|deep sky|long exposure night|nightscape|stargazing|star cluster photo|night sky photograph)\b/i;
const AI_MARKER = /\b(ai generated|ai-generated|ai art|midjourney|dall-e|dalle|stable diffusion|stablediffusion|firefly|generative ai|machine generated|neural art|diffusion model)\b/i;
const ACTIVITY_WORDS = [
  'jogging', 'jogger', 'marathon', 'triathlon', 'cycling', 'cyclist', 'biking', 'biker',
  'swimming', 'swimmer', 'hiking', 'hiker', 'climbing wall', 'rock climber', 'dancing', 'dancer',
  'yoga', 'pilates', 'aerobics', 'crossfit', 'weightlifting', 'weightlifter', 'bodybuilding', 'bodybuilder',
  'gymnast', 'gymnastics', 'surfing', 'surfer', 'skateboarding', 'skateboarder', 'skier', 'skiing',
  'snowboarding', 'snowboarder', 'athlete', 'athletics', 'soccer', 'football match', 'basketball game',
  'tennis player', 'golfer', 'golf course', 'baseball game', 'volleyball', 'cricket match', 'rugby',
  'boxing ring', 'boxer', 'wrestling match', 'fencing', 'rowing', 'kayaking', 'canoeing', 'archery',
  'equestrian', 'rodeo', 'workout', 'working out', 'exercising', 'exercise class', 'fitness model',
  'calisthenics', 'parkour', 'zumba', 'street workout', 'gym session',
  'running man', 'running woman', 'man running', 'woman running', 'people running',
  'man jogging', 'woman jogging', 'kids playing', 'children playing', 'playing soccer', 'playing football',
  'doing yoga', 'doing pilates', 'sports team', 'sports player',
];
const BANNED_ACTIVITY = new RegExp(`\\b(${ACTIVITY_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
const ACTOR_NOUNS = /\b(runners?|joggers?|cyclists?|swimmers?|hikers?|climbers?|dancers?|surfers?|skaters?|skiers?|golfers?|boxers?|athletes?|gymnasts?|bodybuilders?|weightlifters?|marathoners?|sprinters?|triathletes?|yogis?)\b/i;
const TECH_ESCAPES = /\b(patent|drawing|diagram|schematic|cutaway|blueprint|engraving|illustration|woodcut|etching|fig\.?\s*\d|us\s?\d|machine|assembly|mechanism|gear|component|device|apparatus|model no)\b/i;
const TEXT_WORDS = [
  'letter', 'ledger', 'invoice', 'receipt', 'manuscript page', 'book page', 'newspaper', 'newsprint',
  'magazine page', 'certificate', 'diploma', 'document', 'paperwork', 'memo', 'telegram', 'postcard message',
  'handwritten letter', 'type specimen', 'typesetting', 'typography', 'font specimen', 'alphabet specimen',
  'price list', 'timetable', 'menu', 'advertisement page', 'obituary', 'correspondence', 'account book',
];
const BANNED_TEXT_WORDS = new RegExp(`\\b(${TEXT_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
const BANNED_TEXT_PATTERN = /\b(page \d+|p\. \d+|plate \d+ of|vol\. \d+|\d+ pages|arxiv:|doi:|doi\.org|isbn \d|section \d|chapter \d|table of contents|folio \d+[rv]?)\b/i;
const BANNED_COVER = /\b(book cover|blank book|notebook cover|leather cover|cloth cover|blank page|empty page|blank canvas|book binding|front cover|back cover|book jacket|dust jacket|dustjacket|cover page|title page|paperback|hardcover|hard cover|book spine|spine of book|cover design|binding)\b/i;
const BANNED_GENRE = /\b(almanac|encyclopedia|dictionary|textbook|catalog|catalogue|handbook|manual|gazette|journal issue|newsletter|yearbook|annual report|proceedings|bulletin|novel|fiction|memoir|biography|anthology|reader|primer)\b/i;
const ART_PROOF = /\b(engrav|etching|woodcut|wood-cut|illustrat|plate|drawing|print|poster|sketch|lithograph|intaglio|linocut|screen ?print|manuscript|illuminated|chromolithograph|woodblock|painting|artwork)\b/i;
const ARTIST_PROOF = /\b(attributed|studio of|engraved by|drawn by|after |school of|circle of|workshop of)\b/i;
const INSTITUTIONAL = /\b(museum|collection|library|archive|gallery|institute|society|university)\b/i;
const MILITARY_PERSON = /\b(soldier|soldiers|infantry|marine|marines|sergeant|corporal|private first class|general officer|troops|trooper|sailor|airman|guardsman|militia|paratrooper|sniper|platoon|regiment portrait|war veteran|military personnel|military portrait)\b/i;
const MILITARY_TECH = /\b(schematic|blueprint|cutaway|exploded view|technical drawing|ordnance|artillery diagram|weapon diagram|tank diagram|aircraft diagram|ship plan|engineering drawing|mechanism)\b/i;
const COSPLAY = /\b(cosplay|costume|costumed|ren ?faire|renaissance faire|larp|live-action role|reenact\w*|scadian|festival|convention|comic-con|comic con)\b/i;
const BANNED_HUMAN = /\b(portrait|headshot|selfie|pedestrians?|crowd|people walking|people standing|man standing|woman standing|street scene|group of people|family photo|politician|man in suit|woman in dress|businessman|businesswoman|tourists?|persons?|people|man|woman|boy|girl|child|children|kids|baby|infant|teenager|gentleman|lady|couple|fashion model|actor|actress|singer|musician|worker|farmer|police officer|audience|students?|celebrity|president|hands of|face of|smiling|laughing|wedding|friends)\b/i;

function allowedItem(item: RemoteItem, family: Family): boolean {
  const t = item.title;
  const blob = `${item.creator ?? ''} ${item.provider ?? ''}`;
  if (BANNED_HARD.test(t)) return false;
  if (BANNED_SKY.test(t)) return false;
  if (!TECH_ESCAPES.test(t) && (BANNED_ACTIVITY.test(t) || ACTOR_NOUNS.test(t))) return false;
  if (AI_MARKER.test(t) || AI_MARKER.test(blob)) return false;
  if (BANNED_TEXT_WORDS.test(t)) return false;
  if (BANNED_TEXT_PATTERN.test(t)) return false;
  if (BANNED_COVER.test(t) && !ART_PROOF.test(t)) return false;
  if (BANNED_GENRE.test(t) && !ART_PROOF.test(t)) return false;
  if (MILITARY_PERSON.test(t) && !MILITARY_TECH.test(t)) return false;
  if (COSPLAY.test(t) && !ART_PROOF.test(t) && !ARTIST_PROOF.test(blob)) return false;
  if (BANNED_HUMAN.test(t)) {
    if (ART_PROOF.test(t) || ARTIST_PROOF.test(blob) || INSTITUTIONAL.test(blob)) return true;
    return false;
  }
  return true;
}

/* ================================================================== */
/*  GRADING — metadata first; raster sentry refines ±8 only             */
/* ================================================================== */
const PD_RE = /\b(cc0|public domain|pdm|cc-by|creative commons)\b/i;
const FILENAME_RE = /^[a-z0-9_-]{3,}\.(jpe?g|png|gif|webp|tiff?)$/i;
const MODERN_PHOTO_WORDS = /\b(stock photo|smartphone|camera phone|instagram|selfie|bokeh|hdr photo)\b/i;

export function gradePlate(item: RemoteItem, family: Family, keywords: string[]): { score: number; why: string[] } {
  const why: string[] = [];
  let s = 36;
  why.push('BASE +36');
  const blob = `${item.creator ?? ''} ${item.provider ?? ''}`;
  const mp = item.w > 0 && item.h > 0 ? (item.w * item.h) / 1_000_000 : 0;
  if (item.w > 0 && item.h > 0) {
    if (mp >= 3) { s += 18; why.push(`RES ${mp.toFixed(1)}MP +18`); }
    else if (mp >= 1.5) { s += 15; why.push(`RES ${mp.toFixed(1)}MP +15`); }
    else if (mp >= 0.7) { s += 11; why.push(`RES ${mp.toFixed(1)}MP +11`); }
    else if (mp >= 0.3) { s += 7; why.push(`RES ${mp.toFixed(1)}MP +7`); }
    else if (mp < 0.15) { s -= 8; why.push(`RES ${mp.toFixed(2)}MP −8`); }
  } else { s += 10; why.push('RES unknown→archive +10'); }
  const src = item.sourceName ?? item.provider;
  if (MUSEUM_NAMES.has(src) || MUSEUM_RE.test(src) || MUSEUM_RE.test(item.creator ?? '')) { s += 13; why.push('SOURCE museum +13'); }
  else if (/europeana|rawpixel/.test(src)) { s += 10; why.push('SOURCE commons-tier +10'); }
  else if (/flickr/.test(src)) { s += 7; why.push('SOURCE flickr +7'); }
  else if (src === 'wikimedia' || src === 'commons') { s += 6; why.push('SOURCE commons +6'); }
  else { s += 2; why.push('SOURCE other +2'); }
  let art = 0;
  if (ART_PROOF.test(item.title)) art += 10;
  if (ARTIST_PROOF.test(blob)) art += 6;
  if (INSTITUTIONAL.test(blob)) art += 4;
  art = Math.min(art, 16);
  if (art > 0) { s += art; why.push(`ART-WORDS +${art}`); }
  const titleLow = item.title.toLowerCase();
  let matches = 0;
  for (const k of keywords) {
    const kw = k.trim().toLowerCase();
    if (kw.length >= 4 && titleLow.includes(kw)) matches++;
  }
  const rel = Math.min(matches * 3, 9);
  if (rel > 0) { s += rel; why.push(`MATCH ×${matches} +${rel}`); }
  if (PD_RE.test(item.license ?? '')) { s += 4; why.push('LICENSE archival +4'); }
  if (item.title.length >= 20) { s += 6; why.push('TITLE well-described +6'); }
  else if (item.title.length >= 12) { s += 3; why.push('TITLE descriptive +3'); }
  if (FILENAME_RE.test(item.title)) { s -= 10; why.push('FILENAME-STYLE −10'); }
  if (!POLICY_ANY.has(family) && MODERN_PHOTO_WORDS.test(item.title)) { s -= 12; why.push('MODERN-PHOTO on print −12'); }
  return { score: Math.max(5, Math.min(97, Math.round(s))), why };
}

/* ================================================================== */
/*  RASTER SENTRY                                                       */
/* ================================================================== */
export interface PlateScan {
  flat: boolean; textPage: boolean; sparse: boolean; photo: boolean; skin: number; quality: number;
}

export function analyzePlate(img: HTMLImageElement): PlateScan {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) return { flat: false, textPage: false, sparse: false, photo: false, skin: 0, quality: 55 };
  x.drawImage(img, 0, 0, S, S);
  let d: ImageData;
  try { d = x.getImageData(0, 0, S, S); } catch { return { flat: false, textPage: false, sparse: false, photo: false, skin: 0, quality: 55 }; }
  const px = d.data;
  const N = S * S;
  const lum = new Float32Array(N);
  for (let p = 0; p < N; p++) lum[p] = px[p * 4] * 0.299 + px[p * 4 + 1] * 0.587 + px[p * 4 + 2] * 0.114;
  const hist = new Float32Array(16);
  let sum = 0;
  for (let p = 0; p < N; p++) { hist[Math.min(15, Math.floor(lum[p] / 16))]++; sum += lum[p]; }
  const mean = sum / N;
  let variance = 0;
  for (let p = 0; p < N; p++) variance += (lum[p] - mean) * (lum[p] - mean);
  const std = Math.sqrt(variance / N);
  let edges = 0;
  for (let y = 1; y < S - 1; y++) {
    for (let xx = 1; xx < S - 1; xx++) {
      const i = y * S + xx;
      if (Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + S] - lum[i - S]) > 30) edges++;
    }
  }
  const edgeDensity = edges / N;
  let chromaSum = 0, satPx = 0, skinPx = 0;
  const hueMass = new Float32Array(12);
  let hueTotal = 0;
  for (let p = 0; p < N; p++) {
    const r = px[p * 4], g = px[p * 4 + 1], b = px[p * 4 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    chromaSum += mx - mn;
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    if (sat > 0.32) {
      satPx++;
      let hue: number;
      if (mx === r) hue = ((g - b) / (mx - mn)) % 6;
      else if (mx === g) hue = (b - r) / (mx - mn) + 2;
      else hue = (r - g) / (mx - mn) + 4;
      const bin = Math.floor((((hue * 60) + 360) % 360) / 30) % 12;
      hueMass[bin] += 1;
      hueTotal++;
    }
    if (r > 95 && r < 245 && g > 60 && g < 220 && b > 40 && b < 200 &&
      r > g && g > b && (r - b) > 25 && (r - g) > 8 && (r - g) < 90) skinPx++;
  }
  const avgChroma = chromaSum / N;
  const satFrac = satPx / N;
  const skinFrac = skinPx / N;
  let hueBins = 0;
  for (let b = 0; b < 12; b++) if (hueTotal > 0 && hueMass[b] / hueTotal > 0.07) hueBins++;
  const photo = satFrac > 0.26 && hueBins >= 4 && edgeDensity > 0.2 && std > 42;
  const flat = (std < 8 && edgeDensity < 0.02) || (std < 14 && edgeDensity < 0.012 && avgChroma < 12);
  let dark = 0, light = 0;
  for (let b = 0; b < 5; b++) dark += hist[b];
  for (let b = 11; b < 16; b++) light += hist[b];
  let rows = 0;
  for (let y = 2; y < S - 2; y++) {
    let runs = 0, inRun = false, runLen = 0, ink = 0;
    for (let xx = 0; xx < S; xx++) {
      const isDark = lum[y * S + xx] < 100;
      if (isDark) { ink++; if (!inRun) { inRun = true; runLen = 1; runs++; } else runLen++; }
      else if (inRun) { if (runLen > S * 0.3) runs--; inRun = false; }
    }
    if (inRun && runLen > S * 0.3) runs--;
    if (ink / S > 0.08 && ink / S < 0.6 && runs >= 3) rows++;
  }
  const textPage = light / N > 0.4 && edgeDensity > 0.1 && rows >= 6 && avgChroma < 30 && dark / N > 0.04;
  let bandL = S, bandR = -1, nonDenseInk = 0, bandInk = 0;
  for (let y = 0; y < S; y++) {
    let ink = 0, left = -1, right = -1;
    for (let xx = 0; xx < S; xx++) {
      if (lum[y * S + xx] < 100) { ink++; if (left < 0) left = xx; right = xx; }
    }
    const frac = ink / S;
    if (frac > 0.02 && frac < 0.5) {
      nonDenseInk += ink;
      if (left < bandL) bandL = left;
      if (right > bandR) bandR = right;
      bandInk += ink;
    }
  }
  const bandW = bandR >= bandL ? bandR - bandL : 0;
  const mid = 1 - (hist[5] + hist[6] + hist[7] + hist[8] + hist[9] + hist[10]) / N;
  const sparse = light / N > 0.5 && dark / N > 0.01 && dark / N < 0.3 && edgeDensity < 0.13 &&
    nonDenseInk > 0 && bandW < S * 0.62 && bandInk / nonDenseInk > 0.7 && mid < 0.42;
  let nearBlack = 0, nearWhite = 0, midMass = 0;
  for (let b = 0; b < 4; b++) nearBlack += hist[b];
  for (let b = 13; b < 16; b++) nearWhite += hist[b];
  for (let b = 5; b < 11; b++) midMass += hist[b];
  const resQ = img.naturalWidth >= 1400 || img.naturalHeight >= 1400 ? 12
    : img.naturalWidth >= 900 || img.naturalHeight >= 900 ? 8
    : img.naturalWidth >= 600 || img.naturalHeight >= 600 ? 5 : 0;
  const bimodal = (dark / N > 0.12 && light / N > 0.25) || (light / N > 0.12 && dark / N > 0.25);
  let lineEvidence = 0;
  if (bimodal) {
    if (dark > 0 && nearBlack / dark > 0.45) lineEvidence++;
    if (light > 0 && nearWhite / light > 0.35) lineEvidence++;
    if (midMass / N < 0.42) lineEvidence++;
  }
  const detailQ = lineEvidence >= 2 ? Math.min(44, edgeDensity * 240) : Math.min(38, edgeDensity * 190);
  const quality = Math.max(0, Math.min(100, Math.round(
    detailQ + Math.min(26, (std / 58) * 26) + Math.min(18, (midMass / N) * 70) + resQ,
  )));
  return { flat, textPage, sparse, photo, skin: skinFrac, quality };
}

export function photoJunk(
  scan: PlateScan,
  meta: { family: Family; title: string; creator?: string; provider?: string },
): string | null {
  if (!scan.photo) return null;
  if (meta.family === 'meme') return null;
  if (scan.skin >= 0.03) return 'flesh & blood (skin + photo signature)';
  if (BANNED_HUMAN.test(meta.title)) return 'real-person photograph';
  if (POLICY_ANY.has(meta.family)) return null;
  const blob = `${meta.title} ${meta.creator ?? ''} ${meta.provider ?? ''}`;
  if (ART_PROOF.test(blob) || ARTIST_PROOF.test(blob)) return null;
  return 'unproven photo on a print lineage';
}

/* ================================================================== */
/*  PER-SOURCE QUEUE                                                    */
/* ================================================================== */
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export class LiveQueue {
  private termIdx = 0;
  private page = 1;
  private inFlight = false;
  private preferCommonsUntil = 0;
  private museumPage: Partial<Record<MuseumMirror, number>> = {};
  private deadMuseumTerm = new Set<string>();
  items: RemoteItem[] = [];

  constructor(private terms: string[], private family: Family, private policy: ProviderPolicy | undefined, private tapId: string) {
    const cur = cursors[tapId];
    if (cur && typeof cur.term === 'number' && typeof cur.page === 'number' && cur.page > 0) {
      this.termIdx = ((cur.term % this.terms.length) + this.terms.length) % this.terms.length;
      this.page = cur.page > 60 ? 1 + Math.floor(Math.random() * 6) : cur.page;
    } else {
      this.termIdx = Math.floor(Math.random() * this.terms.length);
      this.page = 1 + Math.floor(Math.random() * 4);
    }
  }

  take(): RemoteItem | null { return this.items.shift() ?? null; }

  async ensure(threshold: number, onEvent?: QEvent): Promise<void> {
    if (this.items.length >= threshold || this.inFlight) return;
    if (inflight >= MAX_INFLIGHT) return;
    const now = Date.now();
    const museumOpen = MUSEUM_ORDER.some(m => now >= mvNext[m]);
    if (now < ovNext && now < cwNext && !museumOpen) return;
    this.inFlight = true;
    inflight++;
    const term = this.terms[this.termIdx % this.terms.length];
    const sources = providersFor(this.family, this.policy);
    const openFamily = this.policy === 'open' || (!this.policy && !POLICY_MUSEUM.has(this.family) && !POLICY_ANY.has(this.family));
    let struck = false;
    try {
      let got: RemoteItem[] = [];
      let via: 'openverse' | 'wikimedia' | MuseumMirror = 'wikimedia';
      let fannedOut = false;
      if (Date.now() >= ovNext) {
        try {
          ovNext = Date.now() + OV_MIN_GAP;
          struck = true;
          got = await openverse(term, this.page, sources);
          via = 'openverse';
          mirrorStats.openverse.ok++;
          mirrorStats.openverse.last = Date.now();
        } catch (e) {
          mirrorStats.openverse.fail++;
          const status = (e as { status?: number }).status;
          if (status === 429) {
            this.preferCommonsUntil = Date.now() + 3 * 60_000;
            onEvent?.('openverse: 429 — rerouting to wikimedia (3 min)', 'warn');
          }
          if (got.length === 0 && openFamily && sources) {
            try {
              const alt = await openverse(term, this.page, null);
              if (alt.length > 0) { got = alt; via = 'openverse'; }
            } catch { /* fall through */ }
          }
        }
      }
      if (got.length === 0 && Date.now() >= cwNext && Date.now() >= cwCooldownUntil && Date.now() >= this.preferCommonsUntil) {
        cwNext = Date.now() + CW_MIN_GAP;
        struck = true;
        const pages = Array.from({ length: CW_FANOUT }, (_, i) => this.page + i);
        const settled = await Promise.allSettled(pages.map(p => commons(term, p)));
        const merged: RemoteItem[] = [];
        const seenIdsHere = new Set<string>();
        const seenUrlsHere = new Set<string>();
        let resolved = 0;
        for (const s2 of settled) {
          if (s2.status !== 'fulfilled') { mirrorStats.wikimedia.fail++; continue; }
          resolved++;
          mirrorStats.wikimedia.ok++;
          mirrorStats.wikimedia.last = Date.now();
          for (const it of s2.value) {
            const uk = urlKey(it.fullUrl);
            if (seenIdsHere.has(it.id) || seenUrlsHere.has(uk)) continue;
            seenIdsHere.add(it.id); seenUrlsHere.add(uk);
            merged.push(it);
          }
        }
        if (resolved > 0) {
          cwFailStreak = 0;
          if (merged.length > 0) { got = merged; via = 'wikimedia'; fannedOut = true; }
        } else {
          cwFailStreak++;
          if (cwFailStreak >= 2) {
            cwCooldownUntil = Date.now() + 45_000;
            cwFailStreak = 0;
            if (Date.now() - lastCwWarn > 30_000) {
              lastCwWarn = Date.now();
              onEvent?.('wikimedia: requests rejected (throttled?) — cooling 45s, belt resumes after', 'warn');
            }
          }
        }
      }
      if (got.length === 0) {
        for (let k = 0; k < MUSEUM_ORDER.length; k++) {
          const m = MUSEUM_ORDER[(museumRR + k) % MUSEUM_ORDER.length];
          if (this.deadMuseumTerm.has(`${m}|${term}`)) continue;
          if (Date.now() < mvNext[m]) continue;
          mvNext[m] = Date.now() + MV_GAPS[m];
          museumRR = (museumRR + k + 1) % MUSEUM_ORDER.length;
          const pg = (this.museumPage[m] ?? 0) + 1;
          try {
            struck = true;
            const res = await museumStrike(m, term, pg);
            mirrorStats[m].ok++;
            mirrorStats[m].last = Date.now();
            if (res.length > 0) { via = m; got = res; this.museumPage[m] = pg; }
            else this.deadMuseumTerm.add(`${m}|${term}`);
            break;
          } catch (e) {
            mirrorStats[m].fail++;
            const status = (e as { status?: number }).status;
            mvNext[m] = Date.now() + (status === 429 ? 60_000 : MV_GAPS[m] * 4);
            if (status === 429 && Date.now() - lastMvWarn > 30_000) {
              lastMvWarn = Date.now();
              onEvent?.(`museum ${m}: 429 — easing off for a minute`, 'warn');
            }
          }
        }
      }
      const keywords = this.terms;
      const raw = got.filter(i => !seenIds.has(i.id) && !seenUrls.has(urlKey(i.fullUrl)));
      const repeats = got.length - raw.length;
      const titled = raw.filter(i => allowedItem(i, this.family));
      if (raw.length - titled.length > 0) onEvent?.(`blocklist rejected ${raw.length - titled.length} contaminant plate(s)`, 'bin');
      const fresh = shuffle(titled).map(i => {
        const g = gradePlate(i, this.family, keywords);
        return { ...i, gradeScore: g.score, gradeWhy: g.why };
      });
      rememberIds(fresh.map(i => i.id));
      rememberUrls(fresh.map(i => i.fullUrl));
      cursors[this.tapId] = { term: this.termIdx, page: this.page };
      persistCursorsSoon();
      this.items.push(...fresh);
      if (struck && via !== 'met' && via !== 'cleveland' && via !== 'artic' && via !== 'vam') {
        if (got.length === 0 || fresh.length === 0) {
          this.termIdx += 1;
          this.page = 1 + Math.floor(Math.random() * 6);
          onEvent?.(`"${term}" ran dry — rotating to next vein`, 'sys');
        } else if (repeats > 0 && repeats >= got.length * 0.85 && got.length >= 10) {
          this.page += fannedOut ? CW_FANOUT + 2 : 3;
        } else if (Math.random() < 0.1) {
          this.termIdx += 1;
          this.page = 1 + Math.floor(Math.random() * 4);
          onEvent?.(`vein hop → "${this.terms[this.termIdx % this.terms.length]}"`, 'sys');
        } else {
          this.page += fannedOut ? CW_FANOUT : 1;
        }
      }
      if (fresh.length > 0) {
        onEvent?.(`${via}: "${term}" → ${fresh.length} fresh plates queued${repeats > 0 ? ` (${repeats} repeats skipped)` : ''}`, 'sys');
      }
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 429) {
        cwCooldownUntil = Date.now() + 60_000;
        onEvent?.('wikimedia: 429 — cooling 60s', 'warn');
      } else if (Date.now() - lastCwWarn > 30_000) {
        lastCwWarn = Date.now();
        onEvent?.(`strike failed: ${e instanceof Error ? e.message : 'unknown'}`, 'warn');
      }
    } finally {
      this.inFlight = false;
      inflight--;
    }
  }
}

const queues = new Map<string, LiveQueue>();
export function queueFor(tapId: string, terms: string[], family: Family, policy?: ProviderPolicy): LiveQueue {
  let q = queues.get(tapId);
  if (!q) {
    q = new LiveQueue(terms, family, policy, tapId);
    queues.set(tapId, q);
  }
  return q;
}
