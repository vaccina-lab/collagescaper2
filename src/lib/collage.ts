import type { Specimen } from './types';
import { renderGlitch, type GlitchParams, DEFAULT_PARAMS } from './glitch';

export type Blend = 'source-over' | 'multiply' | 'screen' | 'overlay' | 'difference';
export const BLEND_LABELS: Record<Blend, string> = {
  'source-over': 'NORMAL', 'multiply': 'MULTIPLY', 'screen': 'SCREEN', 'overlay': 'OVERLAY', 'difference': 'DIFFERENCE',
};
export const BLEND_KEYS = Object.keys(BLEND_LABELS) as Blend[];

export interface DeskLayer {
  id: string;
  kind: 'image' | 'color' | 'text';
  name: string;
  x: number; y: number; w: number; aspect: number; rot: number;
  opacity: number;
  blend: Blend;
  src?: string;
  fullUrl?: string;
  cutoutSrc?: string;
  color?: string;
  text?: string;
  fontSize?: number;
  fx?: Partial<GlitchParams>;
}
export interface DeskDoc { w: number; h: number; bg: string; layers: DeskLayer[] }

export const DESK_PALETTE = ['#1d1912', '#e9e4d4', '#c6401e', '#2c46c8', '#61703f', '#d99a2b', '#0e0b1c', '#8e3823'];
export const SIZE_PRESETS = [
  { id: 'square', label: 'SQUARE 1080', w: 1080, h: 1080 },
  { id: 'story', label: 'STORY 1080×1920', w: 1080, h: 1920 },
  { id: 'wide', label: 'WIDE 1920×1080', w: 1920, h: 1080 },
  { id: 'print', label: 'PRINT 2400×3000', w: 2400, h: 3000 },
] as const;
export type SizeId = (typeof SIZE_PRESETS)[number]['id'];

export const layerH = (L: DeskLayer) => L.w / Math.max(0.05, L.aspect);
export function layerFromSpecimen(sp: Specimen, cx: number, cy: number): DeskLayer {
  return {
    id: `ly-${sp.id}-${Date.now().toString(36)}`,
    kind: 'image',
    name: sp.archetype || sp.code,
    x: cx, y: cy,
    w: 420,
    aspect: sp.cutoutSrc ? sp.w / sp.h : sp.aspect || 1,
    rot: (Math.random() - 0.5) * 8,
    opacity: 1,
    blend: 'source-over',
    src: sp.thumb, fullUrl: sp.fullUrl, cutoutSrc: sp.cutoutSrc,
  };
}
export function colorLayer(color: string, cx: number, cy: number): DeskLayer {
  return { id: `ly-c-${Date.now().toString(36)}`, kind: 'color', name: 'color block', x: cx, y: cy, w: 360, aspect: 1, rot: 0, opacity: 1, blend: 'source-over', color };
}
export function textLayer(text: string, cx: number, cy: number): DeskLayer {
  return { id: `ly-t-${Date.now().toString(36)}`, kind: 'text', name: text.slice(0, 18), x: cx, y: cy, w: 520, aspect: 520 / 120, rot: 0, opacity: 1, blend: 'source-over', text, fontSize: 96 } as DeskLayer;
}

const imgCache = new Map<string, HTMLImageElement>();
export function primeImages(layers: DeskLayer[]) {
  for (const L of layers) {
    const url = L.cutoutSrc ?? L.src;
    if (url && !imgCache.has(url)) {
      const img = new Image();
      if (/^https?:/i.test(url)) img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      img.src = url;
      imgCache.set(url, img);
    }
  }
}

export interface SceneOpts { selectedId?: string | null; scale?: number }

function TYPE_FONT(size: number): string { return `800 ${size}px "Bricolage Grotesque", sans-serif`; }

function drawLayerImage(ctx: CanvasRenderingContext2D, L: DeskLayer, fxCanvas: HTMLCanvasElement | null, img: HTMLImageElement | undefined) {
  const h = layerH(L);
  if (L.cutoutSrc || L.fx) {
    if (fxCanvas) { ctx.drawImage(fxCanvas, -L.w / 2, -h / 2, L.w, h); return; }
  }
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, -L.w / 2, -h / 2, L.w, h);
  } else {
    ctx.fillStyle = 'rgba(29,25,18,0.12)';
    ctx.fillRect(-L.w / 2, -h / 2, L.w, h);
  }
}

const fxLayerCache = new Map<string, HTMLCanvasElement>();
const fxBaseCache = new Map<string, HTMLCanvasElement>();
function layerFxCanvas(L: DeskLayer, base: HTMLCanvasElement): HTMLCanvasElement | null {
  if (!L.fx) return null;
  const key = `${L.id}|${JSON.stringify(L.fx)}|${base.width}`;
  const hit = fxLayerCache.get(key);
  if (hit) return hit;
  try {
    const params: GlitchParams = { ...DEFAULT_PARAMS, ...L.fx };
    const { canvas } = renderGlitch({ el: base, w: base.width, h: base.height }, base.width, base.height, params);
    fxLayerCache.set(key, canvas);
    if (fxLayerCache.size > 40) { const first = fxLayerCache.keys().next().value; if (first) fxLayerCache.delete(first); }
    return canvas;
  } catch { return null; }
}

export function drawScene(ctx: CanvasRenderingContext2D, doc: DeskDoc, scale: number, opts: SceneOpts = {}) {
  const { w, h } = doc;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.scale(scale, scale);
  ctx.fillStyle = doc.bg;
  ctx.fillRect(0, 0, w, h);
  for (const L of doc.layers) {
    ctx.save();
    ctx.translate(L.x, L.y);
    ctx.rotate((L.rot * Math.PI) / 180);
    ctx.globalAlpha = Math.max(0, Math.min(1, L.opacity));
    ctx.globalCompositeOperation = L.blend as GlobalCompositeOperation;
    if (L.kind === 'color') {
      ctx.fillStyle = L.color ?? '#1d1912';
      const hh = layerH(L);
      ctx.fillRect(-L.w / 2, -hh / 2, L.w, hh);
    } else if (L.kind === 'text') {
      ctx.fillStyle = L.color ?? '#1d1912';
      const fs = (L as { fontSize?: number }).fontSize ?? 96;
      ctx.font = TYPE_FONT(fs);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(L.text ?? '', 0, 0);
    } else {
      const url = L.cutoutSrc ?? L.src;
      const img = url ? imgCache.get(url) : undefined;
      let fxCanvas: HTMLCanvasElement | null = null;
      if (L.fx && img && img.complete && img.naturalWidth > 0) {
        if (!fxBaseCache.has(L.id)) {
          const b = document.createElement('canvas');
          b.width = 640; b.height = Math.round(640 / L.aspect);
          b.getContext('2d')?.drawImage(img, 0, 0, b.width, b.height);
          fxBaseCache.set(L.id, b);
        }
        const base = fxBaseCache.get(L.id);
        if (base) fxCanvas = layerFxCanvas(L, base);
      }
      drawLayerImage(ctx, L, fxCanvas, img);
    }
    ctx.restore();
    if (opts.selectedId === L.id) {
      ctx.save();
      ctx.translate(L.x, L.y);
      ctx.rotate((L.rot * Math.PI) / 180);
      const hh = layerH(L);
      ctx.strokeStyle = '#c6401e';
      ctx.lineWidth = 2 / scale;
      ctx.setLineDash([8 / scale, 6 / scale]);
      ctx.strokeRect(-L.w / 2, -hh / 2, L.w, hh);
      ctx.setLineDash([]);
      const hs = 8 / scale;
      ctx.fillStyle = '#c6401e';
      for (const [hx, hy] of [[-L.w / 2, -hh / 2], [L.w / 2, -hh / 2], [-L.w / 2, hh / 2], [L.w / 2, hh / 2]]) {
        ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      }
      ctx.restore();
    }
  }
  ctx.restore();
}

/* hit-testing (inverse transform) */
export function hitLayer(L: DeskLayer, px: number, py: number): boolean {
  const rad = (-L.rot * Math.PI) / 180;
  const dx = px - L.x, dy = py - L.y;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  const hh = layerH(L);
  return Math.abs(lx) <= L.w / 2 + 8 && Math.abs(ly) <= hh / 2 + 8;
}
export function hitHandle(L: DeskLayer, px: number, py: number, tol: number): 'nw' | 'ne' | 'sw' | 'se' | null {
  const rad = (-L.rot * Math.PI) / 180;
  const dx = px - L.x, dy = py - L.y;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  const hh = layerH(L);
  const corners: Array<[number, number, 'nw' | 'ne' | 'sw' | 'se']> = [
    [-L.w / 2, -hh / 2, 'nw'], [L.w / 2, -hh / 2, 'ne'], [-L.w / 2, hh / 2, 'sw'], [L.w / 2, hh / 2, 'se'],
  ];
  for (const [hx, hy, id] of corners) if (Math.abs(lx - hx) < tol && Math.abs(ly - hy) < tol) return id;
  return null;
}

export async function renderComposite(doc: DeskDoc, scale = 1): Promise<HTMLCanvasElement> {
  const c = document.createElement('canvas');
  c.width = Math.round(doc.w * scale);
  c.height = Math.round(doc.h * scale);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  await new Promise(res => setTimeout(res, 50)); /* let images settle */
  drawScene(ctx, doc, scale, {});
  return c;
}
