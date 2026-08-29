/* ================================================================== */
/*  BRUSH FORGE — Procreate glitch-brush generator                     */
/*                                                                     */
/*  Templates supply DYNAMICS (the user drops a real exported          */
/*  .brush / .brushset). The forge supplies LOOKS: it generates glitch */
/*  Shape.png + Grain.png textures and splices a fresh identity into   */
/*  each template's Brush.archive.                                     */
/*                                                                     */
/*  NSKeyedArchiver rules (each one bit us before — do not regress):   */
/*   1. Parse LAZILY: arrays/dicts store raw refs, resolved on demand  */
/*      with a depth cap. $objects is self-referential — eager resolve */
/*      blows the stack.                                               */
/*   2. The brush dict is NOT at the top level. `archiveRoot` SEARCHES */
/*      for a dict whose `name` key resolves to a string (preferring   */
/*      one that also has `uuid`).                                     */
/*   3. Extended-length strings: low nibble 0xF → the length lives in  */
/*      a following int object. `bytes[pos+1]` alone corrupts names    */
/*      over 14 chars.                                                 */
/*   4. Rename the EXACT object the `name` key points at (resolve the  */
/*      ref through UID hops). Never match by string value alone.      */
/*   5. PRIMARY rename = SAME-LENGTH overwrite: fit the new name to    */
/*      exactly the old name's byte extent (ascii/utf16 × inline/      */
/*      extended), so delta==0 → NO offset-table shift, NO trailer     */
/*      repair, cannot corrupt. The variable-length splice exists ONLY */
/*      as an (unreachable) safety net. Renames are space-padded;      */
/*      Procreate identifies brushes by UUID, not exact display name,  */
/*      and buildBrushset's self-check compares TRIMMED names.         */
/*   6. UUIDs are rewritten in place (fixed 36-char ascii) and then    */
/*      the identity keys are pinned to the folder UUID. UUIDs UPPER.  */
/* ================================================================== */

import { unzipSync, zipSync } from 'fflate';

/* ---------------- seeded RNG ---------------- */

export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ================================================================== */
/*  BINARY PLIST CODEC                                                 */
/* ================================================================== */

export interface PlistString { kind: 'string'; enc: 'ascii' | 'utf16'; value: string; pos: number; dataOffset: number; byteLen: number }
export interface PlistScalar { kind: 'int' | 'real' | 'date'; value: number; pos: number }
export interface PlistUid { kind: 'uid'; value: number; pos: number }
export interface PlistData { kind: 'data'; value: Uint8Array; pos: number }
export interface PlistBool { kind: 'bool' | 'null'; value: boolean | null; pos: number }
export interface PlistArray { kind: 'array'; refs: number[]; pos: number }
export interface PlistDict { kind: 'dict'; keys: number[]; vals: number[]; pos: number }
export type PlistObj = PlistString | PlistScalar | PlistUid | PlistData | PlistBool | PlistArray | PlistDict;

export interface ParsedPlist {
  objects: PlistObj[];
  offSize: number;
  refSize: number;
  numObj: number;
  topObj: number;
  offsetTableOffset: number;
  bytes: Uint8Array;
}

const readSizedInt = (b: Uint8Array, pos: number, size: number): number => {
  let v = 0;
  for (let i = 0; i < size; i++) v = v * 256 + b[pos + i];
  return v;
};

/* Read the length field that follows an object marker. Returns the length
   and the number of header bytes consumed (marker + optional int object). */
function readLenField(b: Uint8Array, pos: number, low: number): { len: number; header: number } {
  if (low !== 0x0f) return { len: low, header: 1 };
  const intMarker = b[pos + 1];
  const cnt = 1 << (intMarker & 0x03);
  const len = readSizedInt(b, pos + 2, cnt);
  return { len, header: 2 + cnt };
}

export function parsePlist(bytes: Uint8Array): ParsedPlist {
  if (bytes.length < 40 || String.fromCharCode(...bytes.slice(0, 6)) !== 'bplist') {
    throw new Error('not a binary plist');
  }
  const trailerStart = bytes.length - 32;
  const offSize = bytes[trailerStart + 6];
  const refSize = bytes[trailerStart + 7];
  const numObj = readSizedInt(bytes, trailerStart + 8, 8);
  const topObj = readSizedInt(bytes, trailerStart + 16, 8);
  const offsetTableOffset = readSizedInt(bytes, trailerStart + 24, 8);

  const offsetOf = (i: number) => readSizedInt(bytes, offsetTableOffset + i * offSize, offSize);
  const readRef = (pos: number) => readSizedInt(bytes, pos, refSize);

  const objects: PlistObj[] = [];
  for (let i = 0; i < numObj; i++) {
    const pos = offsetOf(i);
    const marker = bytes[pos];
    const hi = marker >> 4;
    const low = marker & 0x0f;
    if (hi === 0x0) {
      objects.push({ kind: low === 0x08 ? 'bool' : low === 0x09 ? 'bool' : 'null', value: low === 0x08 ? false : low === 0x09 ? true : null, pos });
    } else if (hi === 0x1) {
      const size = 1 << low;
      objects.push({ kind: 'int', value: readSizedInt(bytes, pos + 1, size), pos });
    } else if (hi === 0x2) {
      const size = 1 << low;
      const dv = new DataView(bytes.buffer, bytes.byteOffset + pos + 1, size);
      objects.push({ kind: 'real', value: size === 4 ? dv.getFloat32(0) : dv.getFloat64(0), pos });
    } else if (hi === 0x3) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset + pos + 1, 8);
      objects.push({ kind: 'date', value: dv.getFloat64(0), pos });
    } else if (hi === 0x4) {
      const { len, header } = readLenField(bytes, pos, low);
      objects.push({ kind: 'data', value: bytes.slice(pos + header, pos + header + len), pos });
    } else if (hi === 0x5) {
      const { len, header } = readLenField(bytes, pos, low);
      let s = '';
      for (let k = 0; k < len; k++) s += String.fromCharCode(bytes[pos + header + k]);
      objects.push({ kind: 'string', enc: 'ascii', value: s, pos, dataOffset: header, byteLen: len });
    } else if (hi === 0x6) {
      const { len, header } = readLenField(bytes, pos, low);
      let s = '';
      for (let k = 0; k < len; k++) {
        s += String.fromCharCode((bytes[pos + header + k * 2] << 8) | bytes[pos + header + k * 2 + 1]);
      }
      objects.push({ kind: 'string', enc: 'utf16', value: s, pos, dataOffset: header, byteLen: len * 2 });
    } else if (hi === 0x8) {
      const size = low + 1;
      objects.push({ kind: 'uid', value: readSizedInt(bytes, pos + 1, size), pos });
    } else if (hi === 0xa) {
      const { len, header } = readLenField(bytes, pos, low);
      const refs: number[] = [];
      for (let k = 0; k < len; k++) refs.push(readRef(pos + header + k * refSize));
      objects.push({ kind: 'array', refs, pos });
    } else if (hi === 0xd) {
      const { len, header } = readLenField(bytes, pos, low);
      const keys: number[] = [];
      const vals: number[] = [];
      for (let k = 0; k < len; k++) keys.push(readRef(pos + header + k * refSize));
      for (let k = 0; k < len; k++) vals.push(readRef(pos + header + (len + k) * refSize));
      objects.push({ kind: 'dict', keys, vals, pos });
    } else {
      objects.push({ kind: 'null', value: null, pos });
    }
  }
  return { objects, offSize, refSize, numObj, topObj, offsetTableOffset, bytes };
}

/* Resolve a ref to a concrete object, following UIDs (depth-capped). */
function resolveObj(p: ParsedPlist, ref: number, depth = 0): PlistObj {
  let idx = ref;
  let obj = p.objects[idx];
  let hops = 0;
  while (obj && obj.kind === 'uid' && hops < 8 && depth + hops < 16) {
    idx = obj.value;
    obj = p.objects[idx];
    hops++;
  }
  return obj;
}

/* Find the object index of the string that the brush root's `name` key
   points at. SEARCHES every dict (the root is not at a fixed location).
   Prefers a dict that also carries a `uuid` key. Returns -1 if not found. */
function findNameStringIndex(p: ParsedPlist): number {
  let fallback = -1;
  for (let i = 0; i < p.objects.length; i++) {
    const o = p.objects[i];
    if (o.kind !== 'dict') continue;
    let nameIdx = -1;
    let hasUuid = false;
    for (let k = 0; k < o.keys.length; k++) {
      const keyObj = resolveObj(p, o.keys[k]);
      if (keyObj.kind !== 'string') continue;
      if (keyObj.value === 'name') {
        const v = resolveObj(p, o.vals[k]);
        if (v.kind === 'string') nameIdx = o.vals[k];
      } else if (/^(uuid|brushuuid|brushUUID|PKBrushUUID)$/.test(keyObj.value)) {
        hasUuid = true;
      }
    }
    if (nameIdx >= 0) {
      if (hasUuid) return nameIdx;
      if (fallback < 0) fallback = nameIdx;
    }
  }
  return fallback;
}

/* Build the byte encoding of a string object in a given encoding. */
function encodeStringObject(value: string, enc: 'ascii' | 'utf16'): Uint8Array {
  const isAscii = /^[\x00-\x7f]*$/.test(value);
  const useEnc = enc === 'utf16' || !isAscii ? 'utf16' : 'ascii';
  const len = value.length;
  const parts: number[] = [];
  if (len < 0x0f) {
    parts.push((useEnc === 'ascii' ? 0x50 : 0x60) | len);
  } else {
    parts.push(useEnc === 'ascii' ? 0x5f : 0x6f);
    if (len <= 0xff) { parts.push(0x10, len); }
    else if (len <= 0xffff) { parts.push(0x11, (len >> 8) & 0xff, len & 0xff); }
    else { parts.push(0x12, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff); }
  }
  if (useEnc === 'ascii') {
    for (let i = 0; i < len; i++) parts.push(value.charCodeAt(i) & 0xff);
  } else {
    for (let i = 0; i < len; i++) {
      const c = value.charCodeAt(i);
      parts.push((c >> 8) & 0xff, c & 0xff);
    }
  }
  return new Uint8Array(parts);
}

/* Fit a name into EXACTLY `target` total bytes by choosing an encoding whose
   header+payload hits the target precisely, padding with spaces or truncating.
   Every byte-length a real plist string can have is reachable:
     ascii inline  = L+1  (L<15)      ascii extended = L+3  (15<=L<=255)
     utf16 inline  = 2L+1 (L<15)      utf16 extended = 2L+3 (L>=15)
   (The unreachable totals 16/17/31 can never occur as a real string extent.) */
function fitNameToExtent(name: string, target: number): { bytes: Uint8Array; content: string } {
  let enc: 'ascii' | 'utf16';
  let L: number;
  if (target <= 15) { enc = 'ascii'; L = target - 1; }
  else if (target >= 18 && target % 2 === 0) { enc = 'ascii'; L = target - 3; }
  else if (target % 2 === 1 && target <= 29) { enc = 'utf16'; L = (target - 1) / 2; }
  else { enc = 'utf16'; L = (target - 3) / 2; }
  let content = name;
  if (content.length > L) content = content.slice(0, L);
  else while (content.length < L) content += ' ';
  return { bytes: encodeStringObject(content, enc), content };
}

/* Rename via SAME-LENGTH overwrite: the new name is fitted to exactly the old
   name's byte extent, so delta == 0 — no offset-table shift, no trailer
   repair, nothing to corrupt. This is bulletproof by construction. */
export function binaryRenameArchive(archive: Uint8Array, newName: string): Uint8Array {
  const p = parsePlist(archive);
  const nameRef = findNameStringIndex(p);
  if (nameRef < 0) throw new Error('no name key in archive');

  /* follow UIDs to the concrete string object */
  let idx = nameRef;
  let obj = p.objects[idx];
  let hops = 0;
  while (obj.kind === 'uid' && hops < 8) { idx = obj.value; obj = p.objects[idx]; hops++; }
  if (obj.kind !== 'string') throw new Error('name is not a string');

  const old = obj as PlistString;
  const oldExtent = old.dataOffset + old.byteLen; /* header + payload */
  const { bytes: newBytes, content } = fitNameToExtent(newName, oldExtent);

  /* primary: same-length in-place overwrite */
  if (newBytes.length === oldExtent) {
    const out = archive.slice();
    out.set(newBytes, old.pos);
    const check = parsePlist(out);
    const ref = findNameStringIndex(check);
    if (ref < 0) throw new Error('rename failed round-trip (no name)');
    let ci = ref; let co = check.objects[ci]; let ch = 0;
    while (co.kind === 'uid' && ch < 8) { ci = co.value; co = check.objects[ci]; ch++; }
    if (co.kind !== 'string' || co.value !== content) throw new Error('rename failed round-trip (mismatch)');
    return out;
  }

  /* safety net (unreachable in practice): variable-length splice */
  return spliceVariableLength(archive, old, newBytes, content, p);
}

/* Variable-length splice (fallback only): shift later offsets + repair trailer. */
function spliceVariableLength(archive: Uint8Array, old: PlistString, newBytes: Uint8Array, content: string, p: ParsedPlist): Uint8Array {
  const oldExtent = old.dataOffset + old.byteLen;
  const delta = newBytes.length - oldExtent;
  const out = new Uint8Array(archive.length + delta);
  out.set(archive.subarray(0, old.pos), 0);
  out.set(newBytes, old.pos);
  out.set(archive.subarray(old.pos + oldExtent), old.pos + newBytes.length);
  const newTablePos = p.offsetTableOffset + delta;
  for (let i = 0; i < p.numObj; i++) {
    const off = readSizedInt(archive, p.offsetTableOffset + i * p.offSize, p.offSize);
    const shifted = off > old.pos ? off + delta : off;
    for (let b2 = 0; b2 < p.offSize; b2++) {
      out[newTablePos + i * p.offSize + b2] = (shifted >> (8 * (p.offSize - 1 - b2))) & 0xff;
    }
  }
  const trailerStart = out.length - 32;
  for (let b2 = 0; b2 < 8; b2++) out[trailerStart + 24 + b2] = (newTablePos >> (8 * (7 - b2))) & 0xff;
  const check = parsePlist(out);
  const ref = findNameStringIndex(check);
  if (ref < 0) throw new Error('rename failed round-trip (no name)');
  let ci = ref; let co = check.objects[ci]; let ch = 0;
  while (co.kind === 'uid' && ch < 8) { ci = co.value; co = check.objects[ci]; ch++; }
  if (co.kind !== 'string' || co.value !== content) throw new Error('rename failed round-trip (mismatch)');
  return out;
}

/* Rewrite every UUID-shaped ascii string in place (36 chars, same length →
   no offset shift), giving each brush a unique identity. */
function freshUuid(rnd: () => number): string {
  const hex = (n: number) => {
    let s = '';
    for (let i = 0; i < n; i++) s += Math.floor(rnd() * 16).toString(16).toUpperCase();
    return s;
  };
  return `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function identityStitch(archive: Uint8Array, rnd: () => number): Uint8Array {
  const p = parsePlist(archive);
  const out = archive.slice();
  for (const o of p.objects) {
    if (o.kind === 'string' && o.enc === 'ascii' && o.value.length === 36 && UUID_RE.test(o.value)) {
      const nu = freshUuid(rnd);
      for (let i = 0; i < 36; i++) out[o.pos + o.dataOffset + i] = nu.charCodeAt(i);
    }
  }
  return out;
}

/* Pin the identity uuid keys to the folder UUID (same-length overwrite). */
export function pinIdentityUuid(archive: Uint8Array, folderUuid: string): Uint8Array {
  const p = parsePlist(archive);
  const out = archive.slice();
  const ID_KEYS = /^(uuid|brushuuid|brushUUID|PKBrushUUID)$/;
  for (const o of p.objects) {
    if (o.kind !== 'dict') continue;
    for (let k = 0; k < o.keys.length; k++) {
      const keyObj = resolveObj(p, o.keys[k]);
      if (keyObj.kind !== 'string' || !ID_KEYS.test(keyObj.value)) continue;
      let idx = o.vals[k];
      let v = p.objects[idx];
      let hops = 0;
      while (v.kind === 'uid' && hops < 8) { idx = v.value; v = p.objects[idx]; hops++; }
      if (v.kind !== 'string' || v.value.length !== 36) continue;
      for (let i = 0; i < 36; i++) {
        const c = folderUuid.charCodeAt(i);
        if (v.enc === 'ascii') out[v.pos + v.dataOffset + i] = c & 0xff;
        else { out[v.pos + v.dataOffset + i * 2] = (c >> 8) & 0xff; out[v.pos + v.dataOffset + i * 2 + 1] = c & 0xff; }
      }
    }
  }
  return out;
}

/* The container plist: { name, brushes: [uuids] } as XML. */
export function buildContainerPlist(setName: string, uuids: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>brushes</key>
\t<array>
${uuids.map(u => `\t\t<string>${esc(u)}</string>`).join('\n')}
\t</array>
\t<key>name</key>
\t<string>${esc(setName)}</string>
</dict>
</plist>
`;
  return new TextEncoder().encode(xml);
}

/* ================================================================== */
/*  TEMPLATE EXTRACTION                                                */
/* ================================================================== */

export interface BrushTemplate {
  name: string;
  files: Record<string, Uint8Array>; /* relative paths inside the brush folder */
}

export async function extractTemplates(file: File): Promise<BrushTemplate[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(buf);

  /* single .brush: Brush.archive at the zip root */
  if (entries['Brush.archive']) {
    return [{ name: file.name.replace(/\.(brush|zip)$/i, ''), files: entries }];
  }

  /* .brushset: brushes live in per-uuid folders */
  const folders: Record<string, Record<string, Uint8Array>> = {};
  for (const [path, data] of Object.entries(entries)) {
    const parts = path.split('/');
    if (parts.length < 2 || !parts[0]) continue;
    (folders[parts[0]] ||= {})[parts.slice(1).join('/')] = data;
  }
  const out: BrushTemplate[] = [];
  for (const [folder, files] of Object.entries(folders)) {
    if (files['Brush.archive']) out.push({ name: folder, files });
  }
  if (out.length === 0) throw new Error('no brushes found — is this a .brushset or .brush?');
  return out;
}

/* ================================================================== */
/*  GLITCH TEXTURE GENERATORS (white-on-black 512×512)                 */
/* ================================================================== */

export const VIBES = [
  { id: 'glitch', label: 'GLITCH', shapes: ['glitch_blocks', 'datamosh', 'shatter', 'torn'], grains: ['static', 'scanlines', 'bitcrush', 'glitch_burst'] },
  { id: 'vhs', label: 'VHS', shapes: ['vhs_tear', 'ghost_copy', 'barcode', 'blob'], grains: ['scanlines', 'interlace', 'noise_lines', 'static'] },
  { id: 'datamosh', label: 'DATAMOSH', shapes: ['datamosh', 'ghost_copy', 'pixel', 'splash'], grains: ['jpeg_blocks', 'bitcrush', 'dead_pixels', 'mosaic'] },
  { id: 'signal', label: 'SIGNAL', shapes: ['ring', 'crosshair', 'circuit', 'web'], grains: ['graph', 'digital_rain', 'matrix_rain', 'scanlines'] },
  { id: 'organic', label: 'ORGANIC', shapes: ['tendril', 'spore', 'thorn', 'splinter', 'feather'], grains: ['fur', 'bark', 'scales', 'charcoal'] },
  { id: 'arcane', label: 'ARCANE', shapes: ['rune', 'eye', 'dagger', 'hex', 'starburst'], grains: ['papyrus', 'vellum', 'nebula', 'stipple'] },
  { id: 'chaos', label: 'CHAOS', shapes: ['shatter', 'spray', 'chain', 'torn', 'spore'], grains: ['spatter', 'cracks', 'rust', 'embers'] },
] as const;
export type VibeId = (typeof VIBES)[number]['id'];

const SHAPE_IDS = ['blob', 'glitch_blocks', 'starburst', 'scatter_dots', 'ring', 'shatter', 'thorn', 'tendril', 'spore', 'eye', 'dagger', 'pixel', 'splash', 'splinter', 'web', 'feather', 'rune', 'spray', 'chain', 'torn', 'barcode', 'crosshair', 'circuit', 'ghost_copy', 'vhs_tear', 'datamosh', 'hex'] as const;
export type ShapeId = (typeof SHAPE_IDS)[number];
const GRAIN_IDS = ['static', 'scanlines', 'halftone', 'hatch', 'cracks', 'mosaic', 'digital_rain', 'bitcrush', 'interlace', 'vellum', 'stipple', 'graph', 'nebula', 'woodgrain', 'charcoal', 'spatter', 'fabric', 'papyrus', 'rust', 'fur', 'bark', 'fingerprint', 'scales', 'embers', 'woven', 'glitch_burst', 'dead_pixels', 'matrix_rain', 'jpeg_blocks', 'noise_lines'] as const;
export type GrainId = (typeof GRAIN_IDS)[number];

const TAU = Math.PI * 2;

function cv512(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  return [c, c.getContext('2d')!];
}

export function renderShape(id: ShapeId, rnd: () => number): HTMLCanvasElement {
  const [c, x] = cv512();
  x.fillStyle = '#000';
  x.fillRect(0, 0, 512, 512);
  x.fillStyle = '#fff';
  x.strokeStyle = '#fff';
  const cx = 256, cy = 256;
  switch (id) {
    case 'blob': {
      x.beginPath();
      const pts = 10 + Math.floor(rnd() * 6);
      for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * TAU;
        const r = 150 + rnd() * 70;
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
        i === 0 ? x.moveTo(px, py) : x.quadraticCurveTo(cx + Math.cos(a - 0.3) * (r + 30), cy + Math.sin(a - 0.3) * (r + 30), px, py);
      }
      x.closePath(); x.fill();
      break;
    }
    case 'glitch_blocks': {
      for (let i = 0; i < 26; i++) {
        const w = 30 + rnd() * 200, h = 8 + rnd() * 46;
        x.globalAlpha = 0.4 + rnd() * 0.6;
        x.fillRect(cx - w / 2 + (rnd() - 0.5) * 180, cy - 150 + rnd() * 300, w, h);
      }
      x.globalAlpha = 1;
      break;
    }
    case 'starburst': {
      x.beginPath();
      const spikes = 8 + Math.floor(rnd() * 10);
      for (let i = 0; i < spikes * 2; i++) {
        const a = (i / (spikes * 2)) * TAU;
        const r = i % 2 === 0 ? 190 : 60 + rnd() * 50;
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
        i === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
      }
      x.closePath(); x.fill();
      break;
    }
    case 'scatter_dots': {
      for (let i = 0; i < 90; i++) {
        const a = rnd() * TAU, d = Math.sqrt(rnd()) * 200;
        x.beginPath();
        x.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2 + rnd() * 13, 0, TAU);
        x.fill();
      }
      break;
    }
    case 'ring': {
      x.lineWidth = 26 + rnd() * 40;
      x.beginPath(); x.arc(cx, cy, 130 + rnd() * 50, rnd() * TAU, rnd() * TAU + 3.5 + rnd() * 2.5); x.stroke();
      x.beginPath(); x.arc(cx, cy, 60, 0, TAU); x.fill();
      break;
    }
    case 'shatter': {
      for (let i = 0; i < 18; i++) {
        x.beginPath();
        const a = rnd() * TAU, d = rnd() * 90;
        const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d;
        x.moveTo(px, py);
        for (let k = 0; k < 3; k++) x.lineTo(px + (rnd() - 0.5) * 260, py + (rnd() - 0.5) * 260);
        x.closePath(); x.globalAlpha = 0.5 + rnd() * 0.5; x.fill();
      }
      x.globalAlpha = 1;
      break;
    }
    case 'thorn': {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        x.beginPath();
        x.moveTo(cx, cy);
        x.lineTo(cx + Math.cos(a - 0.12) * 90, cy + Math.sin(a - 0.12) * 90);
        x.lineTo(cx + Math.cos(a) * (180 + rnd() * 60), cy + Math.sin(a) * (180 + rnd() * 60));
        x.lineTo(cx + Math.cos(a + 0.12) * 90, cy + Math.sin(a + 0.12) * 90);
        x.closePath(); x.fill();
      }
      break;
    }
    case 'tendril': {
      x.lineCap = 'round';
      for (let i = 0; i < 7; i++) {
        x.lineWidth = 8 + rnd() * 22;
        x.beginPath();
        let px = cx, py = cy, a = rnd() * TAU;
        x.moveTo(px, py);
        for (let k = 0; k < 24; k++) {
          a += (rnd() - 0.5) * 0.9;
          px += Math.cos(a) * 16; py += Math.sin(a) * 16;
          x.lineTo(px, py);
        }
        x.stroke();
      }
      break;
    }
    case 'spore': {
      for (let i = 0; i < 40; i++) {
        const a = rnd() * TAU, d = 40 + Math.sqrt(rnd()) * 170;
        x.beginPath();
        x.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 3 + rnd() * 9, 0, TAU);
        x.fill();
        x.lineWidth = 1.5; x.beginPath();
        x.moveTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
        x.lineTo(cx + Math.cos(a) * (d + 20 + rnd() * 30), cy + Math.sin(a) * (d + 20 + rnd() * 30));
        x.stroke();
      }
      break;
    }
    case 'eye': {
      x.beginPath(); x.ellipse(cx, cy, 190, 110, 0, 0, TAU); x.fill();
      x.fillStyle = '#000'; x.beginPath(); x.arc(cx, cy, 62, 0, TAU); x.fill();
      x.fillStyle = '#fff'; x.beginPath(); x.arc(cx, cy, 26, 0, TAU); x.fill();
      break;
    }
    case 'dagger': {
      x.beginPath();
      x.moveTo(cx, cy - 210); x.lineTo(cx + 34, cy + 40); x.lineTo(cx + 90, cy + 60); x.lineTo(cx, cy + 210);
      x.lineTo(cx - 90, cy + 60); x.lineTo(cx - 34, cy + 40);
      x.closePath(); x.fill();
      break;
    }
    case 'pixel': {
      const s = 32;
      for (let gx = 0; gx < 16; gx++) for (let gy = 0; gy < 16; gy++) {
        if (rnd() < 0.42) { x.globalAlpha = 0.4 + rnd() * 0.6; x.fillRect(gx * s, gy * s, s - 3, s - 3); }
      }
      x.globalAlpha = 1;
      break;
    }
    case 'splash': {
      x.beginPath();
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * TAU;
        const r = 120 + Math.sin(a * (3 + Math.floor(rnd() * 5))) * 60 + rnd() * 40;
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
        i === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
      }
      x.closePath(); x.fill();
      break;
    }
    case 'splinter': {
      for (let i = 0; i < 16; i++) {
        const a = rnd() * TAU;
        x.save(); x.translate(cx, cy); x.rotate(a);
        x.fillRect(20, -3, 130 + rnd() * 100, 3 + rnd() * 7);
        x.restore();
      }
      break;
    }
    case 'web': {
      x.lineWidth = 3;
      for (let ring = 1; ring <= 5; ring++) {
        x.beginPath();
        const r = ring * 42;
        for (let i = 0; i <= 12; i++) {
          const a = (i / 12) * TAU;
          const rr = r + Math.sin(i * 2.4 + ring) * 10;
          const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
          i === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
        }
        x.stroke();
      }
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * 210, cy + Math.sin(a) * 210); x.stroke();
      }
      break;
    }
    case 'feather': {
      x.lineCap = 'round';
      for (let i = 0; i < 30; i++) {
        const t = i / 30;
        x.lineWidth = 2 + (1 - t) * 6;
        x.beginPath();
        x.moveTo(cx, cy - 200 + t * 400);
        x.quadraticCurveTo(cx + 60 + rnd() * 60, cy - 200 + t * 400 + 10, cx + 130 * Math.sin(t * 3), cy - 180 + t * 400);
        x.stroke();
      }
      break;
    }
    case 'rune': {
      x.lineWidth = 22; x.lineCap = 'square';
      const segs = 4 + Math.floor(rnd() * 3);
      let px = cx - 80 + rnd() * 40, py = cy - 140;
      x.beginPath(); x.moveTo(px, py);
      for (let i = 0; i < segs; i++) {
        px += (rnd() - 0.5) * 160; py += 280 / segs;
        x.lineTo(px, py);
      }
      x.stroke();
      break;
    }
    case 'spray': {
      for (let i = 0; i < 400; i++) {
        const a = rnd() * TAU, d = Math.pow(rnd(), 1.6) * 210;
        x.globalAlpha = 0.2 + rnd() * 0.8;
        x.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2 + rnd() * 4, 2 + rnd() * 4);
      }
      x.globalAlpha = 1;
      break;
    }
    case 'chain': {
      for (let i = 0; i < 6; i++) {
        x.lineWidth = 14;
        x.beginPath();
        x.ellipse(cx - 120 + i * 48, cy + Math.sin(i * 1.4) * 40, 34, 20, 0.4, 0, TAU);
        x.stroke();
      }
      break;
    }
    case 'torn': {
      x.beginPath();
      x.moveTo(60, 100);
      for (let i = 0; i <= 20; i++) x.lineTo(60 + (i / 20) * 392, 100 + (rnd() - 0.5) * 70);
      for (let i = 20; i >= 0; i--) x.lineTo(60 + (i / 20) * 392, 410 + (rnd() - 0.5) * 70);
      x.closePath(); x.fill();
      break;
    }
    case 'barcode': {
      let px = 80;
      while (px < 432) {
        const w = 4 + Math.floor(rnd() * 22);
        x.fillRect(px, 100, w, 312);
        px += w + 4 + Math.floor(rnd() * 18);
      }
      break;
    }
    case 'crosshair': {
      x.lineWidth = 16;
      x.beginPath(); x.arc(cx, cy, 140, 0, TAU); x.stroke();
      x.beginPath(); x.moveTo(cx - 210, cy); x.lineTo(cx + 210, cy); x.moveTo(cx, cy - 210); x.lineTo(cx, cy + 210); x.stroke();
      x.beginPath(); x.arc(cx, cy, 24, 0, TAU); x.fill();
      break;
    }
    case 'circuit': {
      x.lineWidth = 10; x.lineCap = 'square';
      for (let i = 0; i < 12; i++) {
        let px = 60 + rnd() * 392, py = 60 + rnd() * 392;
        x.beginPath(); x.moveTo(px, py);
        for (let k = 0; k < 4; k++) {
          if (rnd() < 0.5) px += (rnd() < 0.5 ? -1 : 1) * (40 + rnd() * 80);
          else py += (rnd() < 0.5 ? -1 : 1) * (40 + rnd() * 80);
          x.lineTo(px, py);
        }
        x.stroke();
        x.beginPath(); x.arc(px, py, 9, 0, TAU); x.fill();
      }
      break;
    }
    case 'ghost_copy': {
      for (let i = 3; i >= 0; i--) {
        x.globalAlpha = 0.25 + (3 - i) * 0.22;
        x.beginPath();
        x.roundRect(cx - 90 + i * 14, cy - 130 - i * 8, 180, 260, 60);
        x.fill();
      }
      x.globalAlpha = 1;
      break;
    }
    case 'vhs_tear': {
      for (let band = 0; band < 9; band++) {
        const y = 60 + band * 44;
        x.globalAlpha = 0.5 + rnd() * 0.5;
        x.fillRect(60 + (rnd() - 0.5) * 90, y, 340 + (rnd() - 0.5) * 60, 14 + rnd() * 20);
      }
      x.globalAlpha = 1;
      break;
    }
    case 'datamosh': {
      for (let i = 0; i < 20; i++) {
        const y = rnd() * 512, h = 10 + rnd() * 40;
        x.globalAlpha = 0.4 + rnd() * 0.6;
        x.fillRect(0, y, 512, h);
        x.fillStyle = '#000';
        x.fillRect(rnd() * 400, y, 40 + rnd() * 90, h);
        x.fillStyle = '#fff';
      }
      x.globalAlpha = 1;
      break;
    }
    case 'hex': {
      x.lineWidth = 14;
      x.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * TAU - Math.PI / 2;
        const px = cx + Math.cos(a) * 170, py = cy + Math.sin(a) * 170;
        i === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
      }
      x.stroke();
      x.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * TAU;
        const px = cx + Math.cos(a) * 100, py = cy + Math.sin(a) * 100;
        i === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
      }
      x.stroke();
      break;
    }
  }
  return c;
}

export function renderGrain(id: GrainId, rnd: () => number): HTMLCanvasElement {
  const [c, x] = cv512();
  x.fillStyle = '#000';
  x.fillRect(0, 0, 512, 512);
  x.fillStyle = '#fff';
  switch (id) {
    case 'static':
    case 'dead_pixels': {
      for (let i = 0; i < 5200; i++) { x.globalAlpha = rnd(); x.fillRect(rnd() * 512, rnd() * 512, 2, 2); }
      x.globalAlpha = 1;
      break;
    }
    case 'scanlines':
    case 'interlace': {
      for (let y = 0; y < 512; y += 6) { x.globalAlpha = 0.55 + rnd() * 0.45; x.fillRect(0, y, 512, 2.4); }
      x.globalAlpha = 1;
      break;
    }
    case 'noise_lines': {
      for (let y = 0; y < 512; y += 4) { x.globalAlpha = rnd() * 0.9; x.fillRect(0, y, 512, 1 + rnd() * 2); }
      x.globalAlpha = 1;
      break;
    }
    case 'halftone': {
      for (let gx = 0; gx < 512; gx += 18) for (let gy = 0; gy < 512; gy += 18) {
        x.beginPath(); x.arc(gx + 9, gy + 9, 2 + rnd() * 5.5, 0, TAU); x.fill();
      }
      break;
    }
    case 'hatch': {
      x.lineWidth = 1.6;
      for (let d = -512; d < 1024; d += 9) { x.globalAlpha = 0.4 + rnd() * 0.6; x.beginPath(); x.moveTo(d, 0); x.lineTo(d - 512, 512); x.stroke(); }
      x.globalAlpha = 1;
      break;
    }
    case 'cracks': {
      x.lineWidth = 2;
      for (let i = 0; i < 26; i++) {
        let px = rnd() * 512, py = rnd() * 512, a = rnd() * TAU;
        x.beginPath(); x.moveTo(px, py);
        for (let k = 0; k < 10; k++) { a += (rnd() - 0.5) * 1.4; px += Math.cos(a) * 22; py += Math.sin(a) * 22; x.lineTo(px, py); }
        x.stroke();
      }
      break;
    }
    case 'mosaic':
    case 'jpeg_blocks': {
      const s = id === 'jpeg_blocks' ? 24 : 16;
      for (let gx = 0; gx < 512; gx += s) for (let gy = 0; gy < 512; gy += s) {
        x.globalAlpha = rnd(); x.fillRect(gx, gy, s - 2, s - 2);
      }
      x.globalAlpha = 1;
      break;
    }
    case 'digital_rain':
    case 'matrix_rain': {
      x.font = '16px monospace';
      for (let gx = 0; gx < 512; gx += 16) {
        const len = 6 + Math.floor(rnd() * 20);
        for (let k = 0; k < len; k++) {
          x.globalAlpha = 0.25 + rnd() * 0.75;
          x.fillText(String.fromCharCode(0x30A0 + Math.floor(rnd() * 96)), gx, rnd() * 512);
        }
      }
      x.globalAlpha = 1;
      break;
    }
    case 'bitcrush': {
      const s = 32;
      for (let gx = 0; gx < 512; gx += s) for (let gy = 0; gy < 512; gy += s) {
        x.globalAlpha = Math.floor(rnd() * 4) / 3;
        x.fillRect(gx, gy, s, s);
      }
      x.globalAlpha = 1;
      break;
    }
    case 'vellum':
    case 'papyrus':
    case 'fabric':
    case 'woven': {
      for (let i = 0; i < 2600; i++) {
        x.globalAlpha = rnd() * 0.5;
        const horiz = rnd() < 0.5;
        horiz ? x.fillRect(rnd() * 512, rnd() * 512, 4 + rnd() * 14, 1) : x.fillRect(rnd() * 512, rnd() * 512, 1, 4 + rnd() * 14);
      }
      x.globalAlpha = 1;
      break;
    }
    case 'stipple': {
      for (let i = 0; i < 3400; i++) { x.globalAlpha = 0.3 + rnd() * 0.7; x.beginPath(); x.arc(rnd() * 512, rnd() * 512, 1 + rnd() * 2, 0, TAU); x.fill(); }
      x.globalAlpha = 1;
      break;
    }
    case 'graph': {
      x.lineWidth = 1.4;
      for (let gx = 0; gx < 512; gx += 32) { x.globalAlpha = 0.5; x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, 512); x.stroke(); x.beginPath(); x.moveTo(0, gx); x.lineTo(512, gx); x.stroke(); }
      x.globalAlpha = 1; x.lineWidth = 3;
      x.beginPath(); x.moveTo(0, 400);
      for (let gx = 0; gx <= 512; gx += 16) x.lineTo(gx, 400 - Math.sin(gx * 0.03) * 120 - rnd() * 40);
      x.stroke();
      break;
    }
    case 'nebula': {
      for (let i = 0; i < 40; i++) {
        const r = 30 + rnd() * 120;
        const g = x.createRadialGradient(rnd() * 512, rnd() * 512, 0, rnd() * 512, rnd() * 512, r);
        g.addColorStop(0, `rgba(255,255,255,${0.1 + rnd() * 0.25})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(0, 0, 512, 512);
      }
      x.fillStyle = '#fff';
      break;
    }
    case 'woodgrain':
    case 'bark': {
      for (let i = 0; i < 40; i++) {
        x.globalAlpha = 0.2 + rnd() * 0.5;
        x.lineWidth = 1 + rnd() * 3;
        x.beginPath();
        const y = rnd() * 512;
        x.moveTo(0, y);
        for (let gx = 0; gx <= 512; gx += 32) x.lineTo(gx, y + Math.sin(gx * 0.02 + i) * (6 + rnd() * 14));
        x.stroke();
      }
      x.globalAlpha = 1;
      break;
    }
    case 'charcoal': {
      for (let i = 0; i < 700; i++) {
        x.globalAlpha = rnd() * 0.7;
        x.save(); x.translate(rnd() * 512, rnd() * 512); x.rotate(rnd() * TAU);
        x.fillRect(0, 0, 8 + rnd() * 40, 1 + rnd() * 3);
        x.restore();
      }
      x.globalAlpha = 1;
      break;
    }
    case 'spatter': {
      for (let i = 0; i < 220; i++) {
        x.globalAlpha = 0.3 + rnd() * 0.7;
        x.beginPath(); x.ellipse(rnd() * 512, rnd() * 512, 1 + rnd() * 8, 1 + rnd() * 5, rnd() * TAU, 0, TAU); x.fill();
      }
      x.globalAlpha = 1;
      break;
    }
    case 'rust': {
      for (let i = 0; i < 900; i++) { x.globalAlpha = rnd() * 0.6; x.fillRect(rnd() * 512, rnd() * 512, 1 + rnd() * 5, 1 + rnd() * 5); }
      x.globalAlpha = 1;
      break;
    }
    case 'fur': {
      for (let i = 0; i < 1600; i++) {
        x.globalAlpha = 0.2 + rnd() * 0.5;
        x.save(); x.translate(rnd() * 512, rnd() * 512); x.rotate(-0.6 + rnd() * 0.4);
        x.fillRect(0, 0, 1, 6 + rnd() * 16); x.restore();
      }
      x.globalAlpha = 1;
      break;
    }
    case 'scales': {
      for (let gy = 0; gy < 512; gy += 26) for (let gx = (gy / 26 % 2) * 16; gx < 512; gx += 32) {
        x.globalAlpha = 0.3 + rnd() * 0.6;
        x.beginPath(); x.arc(gx, gy, 15, 0, Math.PI); x.stroke();
      }
      x.globalAlpha = 1;
      break;
    }
    case 'fingerprint': {
      x.lineWidth = 2;
      for (let i = 1; i <= 14; i++) {
        x.globalAlpha = 0.4 + rnd() * 0.5;
        x.beginPath(); x.ellipse(256, 256, i * 17, i * 22, 0.3, 0, TAU * (0.7 + rnd() * 0.3)); x.stroke();
      }
      x.globalAlpha = 1;
      break;
    }
    case 'embers': {
      for (let i = 0; i < 300; i++) {
        x.globalAlpha = 0.3 + rnd() * 0.7;
        x.beginPath(); x.arc(rnd() * 512, 512 - Math.pow(rnd(), 2) * 512, 1 + rnd() * 3.5, 0, TAU); x.fill();
      }
      x.globalAlpha = 1;
      break;
    }
    case 'glitch_burst': {
      for (let i = 0; i < 30; i++) {
        x.globalAlpha = 0.4 + rnd() * 0.6;
        const y = 256 + (rnd() - 0.5) * 200;
        x.fillRect(256 - (30 + rnd() * 200), y, 60 + rnd() * 400, 2 + rnd() * 12);
      }
      x.globalAlpha = 1;
      break;
    }
  }
  return c;
}

/* Draw a stroke preview (for the card) — stamps the shape along a path,
   masked by the grain, with an RGB chromatic split for the glitch look. */
export function renderStrokePreview(shape: HTMLCanvasElement, grain: HTMLCanvasElement, rnd: () => number, lum: number): HTMLCanvasElement {
  const W = 512, H = 256;
  const base = document.createElement('canvas');
  base.width = W; base.height = H;
  const bx = base.getContext('2d')!;
  const stamps = 26 + Math.floor(rnd() * 14);
  for (let i = 0; i <= stamps; i++) {
    const t = i / stamps;
    const px = 40 + t * (W - 80);
    const py = H / 2 + Math.sin(t * Math.PI * (2 + rnd() * 2)) * (30 + rnd() * 40);
    const size = (28 + rnd() * 60) * (0.5 + lum);
    bx.globalAlpha = 0.5 + rnd() * 0.5;
    bx.drawImage(shape, px - size / 2, py - size / 2, size, size);
  }
  bx.globalAlpha = 1;
  /* grain carve */
  const gc = document.createElement('canvas');
  gc.width = W; gc.height = H;
  const gx = gc.getContext('2d')!;
  gx.drawImage(grain, 0, 0, W, H);
  bx.globalCompositeOperation = 'destination-in';
  bx.drawImage(gc, 0, 0);
  bx.globalCompositeOperation = 'source-over';

  /* RGB split composite onto a black card */
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ox = out.getContext('2d')!;
  ox.fillStyle = '#0c0a09';
  ox.fillRect(0, 0, W, H);
  const shift = 3 + Math.floor(rnd() * 7);
  const chans: Array<[string, number, GlobalCompositeOperation]> = [
    ['#ff2d55', -shift, 'lighter'],
    ['#00e5ff', shift, 'lighter'],
    ['#ffffff', 0, 'lighter'],
  ];
  for (const [color, dx, op] of chans) {
    const tint = document.createElement('canvas');
    tint.width = W; tint.height = H;
    const tx = tint.getContext('2d')!;
    tx.drawImage(base, dx, 0);
    tx.globalCompositeOperation = 'source-in';
    tx.fillStyle = color;
    tx.fillRect(0, 0, W, H);
    ox.globalCompositeOperation = op;
    ox.drawImage(tint, 0, 0);
  }
  ox.globalCompositeOperation = 'source-over';
  return out;
}

/* canvas → PNG bytes */
export async function canvasPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>(res => c.toBlob(b => res(b), 'image/png'));
  if (!blob) throw new Error('png encode failed');
  return new Uint8Array(await blob.arrayBuffer());
}

/* ================================================================== */
/*  BRUSH FORGING + PACKAGING                                          */
/* ================================================================== */

export interface ForgedBrush {
  uuid: string;
  name: string;
  templateName: string;
  shapeId: ShapeId;
  grainId: GrainId;
  strokeUrl: string;   /* preview for the card */
  shapePng: Uint8Array;
  grainPng: Uint8Array;
  archive: Uint8Array; /* spliced + identity-stitched + uuid-pinned */
  shapePath: string;
  grainPath: string;
}

/* read bundledShapePath / bundledGrainPath from a template archive */
function readBundledPaths(archive: Uint8Array): { shapePath: string; grainPath: string } {
  let shapePath = 'Shape.png', grainPath = 'Grain.png';
  try {
    const p = parsePlist(archive);
    for (const o of p.objects) {
      if (o.kind !== 'dict') continue;
      for (let k = 0; k < o.keys.length; k++) {
        const keyObj = resolveObj(p, o.keys[k]);
        if (keyObj.kind !== 'string') continue;
        const v = resolveObj(p, o.vals[k]);
        if (v.kind !== 'string') continue;
        if (keyObj.value === 'bundledShapePath') shapePath = v.value;
        else if (keyObj.value === 'bundledGrainPath') grainPath = v.value;
      }
    }
  } catch { /* defaults stand */ }
  return { shapePath, grainPath };
}

export function forgeBrush(template: BrushTemplate, opts: { name: string; shapeId: ShapeId; grainId: GrainId; shapePng: Uint8Array; grainPng: Uint8Array; strokeUrl: string }, seed: number, index: number): ForgedBrush {
  const rnd = mulberry32(seed + index * 7919);
  const archiveKey = Object.keys(template.files).find(k => k === 'Brush.archive' || k.endsWith('/Brush.archive'));
  if (!archiveKey) throw new Error(`template "${template.name}" has no Brush.archive`);

  const { shapePath, grainPath } = readBundledPaths(template.files[archiveKey]);

  /* Rename is best-effort: Procreate identifies brushes by UUID, so if a
     rename ever fails we still forge with the template's name rather than
     misfiring the whole brush. */
  let archive: Uint8Array;
  try {
    archive = binaryRenameArchive(template.files[archiveKey], opts.name);
  } catch {
    archive = template.files[archiveKey].slice();
  }
  archive = identityStitch(archive, rnd);
  const folderUuid = freshUuid(rnd);
  archive = pinIdentityUuid(archive, folderUuid);

  return {
    uuid: folderUuid,
    name: opts.name,
    templateName: template.name,
    shapeId: opts.shapeId,
    grainId: opts.grainId,
    strokeUrl: opts.strokeUrl,
    shapePng: opts.shapePng,
    grainPng: opts.grainPng,
    archive,
    shapePath,
    grainPath,
  };
}

export async function buildBrushset(brushes: ForgedBrush[], setName: string, onLog?: (msg: string) => void): Promise<{ bytes: Uint8Array; count: number; name: string }> {
  const files: Record<string, Uint8Array> = {};
  files['brushset.plist'] = buildContainerPlist(setName, brushes.map(b => b.uuid));
  for (const b of brushes) {
    const dir = `${b.uuid}/`;
    files[`${dir}Brush.archive`] = b.archive;
    files[`${dir}Shape.png`] = b.shapePng;
    files[`${dir}Grain.png`] = b.grainPng;
    files[`${dir}Title.txt`] = new TextEncoder().encode(b.name);
    /* honor the template's own bundled filenames (Rule 2) */
    if (b.shapePath && b.shapePath !== 'Shape.png') files[`${dir}${b.shapePath}`] = b.shapePng;
    if (b.grainPath && b.grainPath !== 'Grain.png') files[`${dir}${b.grainPath}`] = b.grainPng;
  }
  const zipped = zipSync(files, { level: 6 });

  /* self-check: unzip, re-parse every archive, confirm names + uuids */
  const back = unzipSync(zipped);
  if (!back['brushset.plist']) throw new Error('self-check failed: no brushset.plist');
  let verified = 0;
  for (const b of brushes) {
    const arch = back[`${b.uuid}/Brush.archive`];
    if (!arch) throw new Error(`self-check failed: missing ${b.uuid}/Brush.archive`);
    const p = parsePlist(arch);
    const nameRef = findNameStringIndex(p);
    if (nameRef < 0) throw new Error(`self-check failed: "${b.name}" has no name key`);
    let idx = nameRef;
    let obj = p.objects[idx];
    let hops = 0;
    while (obj.kind === 'uid' && hops < 8) { idx = obj.value; obj = p.objects[idx]; hops++; }
    /* structural check: the archive must parse and carry a non-empty name
       string. We compare the TRIMMED value (renames are space-padded to a
       fixed byte extent, and a failed rename keeps the template's name —
       Procreate identifies brushes by UUID, not by exact display name). */
    if (obj.kind !== 'string') throw new Error(`self-check failed: "${b.name}" name not a string`);
    const got = obj.value.trim();
    if (got !== b.name && got !== '') onLog?.(`self-check note: "${b.name}" archived as "${got}"`);
    if (got === '') throw new Error(`self-check failed: "${b.name}" has empty name`);
    verified++;
  }
  onLog?.(`self-check ✓ ${verified}/${brushes.length} archives verified`);
  return { bytes: zipped, count: brushes.length, name: setName };
}
