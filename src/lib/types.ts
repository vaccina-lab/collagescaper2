/* SALVAGE/9 — shared types */

export type Family =
  | 'patent' | 'anatomy' | 'webcore' | 'stars' | 'tarot' | 'vhs'
  | 'dore' | 'geometry' | 'arch' | 'retro' | 'grim' | 'meme';

export const FAMILY_LIST: Family[] = [
  'patent', 'anatomy', 'webcore', 'stars', 'tarot', 'vhs',
  'dore', 'geometry', 'arch', 'retro', 'grim', 'meme',
];

export type CutEngine = 'ink' | 'flood' | 'model';

export interface Specimen {
  id: string;
  code: string;
  family: Family;
  srcCode: string;   /* the tap's chip code, denormalized so taps can die safely */
  srcHue: number;
  archetype: string; /* human-facing subject label */
  tags: string[];
  score: number;     /* taste-gate grade (metadata at pull, refined by raster sentry) */
  why?: string[];    /* visible scoring breakdown */
  dataUri: string;
  w: number;
  h: number;
  aspect: number;
  remote: boolean;
  thumb?: string;
  fullUrl?: string;
  pageUrl?: string;
  credit?: string;
  license?: string;
  provider?: string;
  sourceName?: string;
  verdict: 'pass' | 'reject';
  state: 'incoming' | 'judged';
  born: number;
  /* isolation */
  isoState?: 'queue' | 'work' | 'done' | 'fail' | 'fullframe';
  cutoutSrc?: string;          /* isolated subject dataURL (memory only) */
  cutEngine?: CutEngine;       /* which engine produced the cutout */
  cutScore?: number;           /* grade of the isolation on its own scale */
}
