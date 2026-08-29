export type Family =
  | 'patent' | 'anatomy' | 'webcore' | 'stars' | 'tarot' | 'vhs'
  | 'dore' | 'geometry' | 'arch' | 'retro' | 'grim' | 'meme';

export const FAMILY_LIST: Family[] = [
  'patent', 'anatomy', 'webcore', 'stars', 'tarot', 'vhs',
  'dore', 'geometry', 'arch', 'retro', 'grim', 'meme',
];

export interface Specimen {
  id: string;
  code: string;
  family: Family;
  srcCode: string;
  srcHue: number;
  archetype: string;
  tags: string[];
  score: number;
  why?: string[];
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
  isoState?: 'queue' | 'work' | 'done' | 'fail' | 'fullframe';
  cutoutSrc?: string;
  cutEngine?: 'ink' | 'flood' | 'model';
  cutScore?: number;
}
