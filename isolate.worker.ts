/* SALVAGE/9 — isolation inference WORKER.
   Runs RMBG-2.0 (fallback RMBG-1.4) OFF the main thread so crawling and the
   UI never freeze while a plate is being matted. The main thread sends an
   image URL; the worker decodes → processes → infers and transfers back the
   raw alpha matte as a Float32Array. */

import { AutoModel, AutoProcessor, RawImage, env } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

/* eslint-disable @typescript-eslint/no-explicit-any */
let model: any = null;
let processor: any = null;
let modelName = '';
let device: 'webgpu' | 'wasm' = 'wasm';

async function ensure(): Promise<void> {
  if (model && processor) return;
  let lastStatus = -1;
  const opts = {
    progress_callback: (e: { status?: string; progress?: number }) => {
      if (e.status === 'initiate') {
        lastStatus = -1;
        (self as unknown as Worker).postMessage({ type: 'progress', progress: 0, model: `${modelName} · fetching` });
      }
      if (e.status === 'progress' && typeof e.progress === 'number') {
        /* throttle: report on whole-10s of a percent so the log isn't spammed */
        const p = Math.round(e.progress);
        if (p >= 100 || p - lastStatus >= 10 || p === 0) {
          lastStatus = p;
          (self as unknown as Worker).postMessage({ type: 'progress', progress: p, model: `${modelName}${device === 'webgpu' ? ' · gpu' : ' · wasm'}` });
        }
      }
      if (e.status === 'done' || e.status === 'ready') {
        (self as unknown as Worker).postMessage({ type: 'progress', progress: 100, model: `${modelName}${device === 'webgpu' ? ' · gpu' : ' · wasm'}` });
      }
    },
  };
  /* Model ladder. fp16 variants first — RMBG-2.0's fp32 export is ~900 MB,
     which is why cold loads looked "deadly slow"; fp16 is ~10× smaller.
     WebGPU runs 2–4× faster than wasm when the browser has it. */
  const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const attempts: Array<{ id: string; device: 'webgpu' | 'wasm'; dtype?: 'fp16' | 'q8' }> = [];
  if (hasGpu) attempts.push({ id: 'briaai/RMBG-2.0', device: 'webgpu', dtype: 'fp16' });
  attempts.push({ id: 'briaai/RMBG-2.0', device: 'wasm', dtype: 'fp16' });
  attempts.push({ id: 'briaai/RMBG-1.4', device: 'wasm', dtype: 'fp16' });
  attempts.push({ id: 'briaai/RMBG-1.4', device: 'wasm' });
  let lastErr: unknown = null;
  for (const a of attempts) {
    try {
      device = a.device;
      modelName = a.id.includes('2.0') ? 'RMBG-2.0' : 'RMBG-1.4';
      const loadOpts: Record<string, unknown> = { ...opts };
      if (a.device === 'webgpu') loadOpts.device = 'webgpu';
      if (a.dtype) loadOpts.dtype = a.dtype;
      (self as unknown as Worker).postMessage({ type: 'progress', progress: 0, model: `${modelName}${a.dtype ? ' · ' + a.dtype : ''}${device === 'webgpu' ? ' · gpu' : ' · wasm'} · loading` });
      model = await AutoModel.from_pretrained(a.id, loadOpts);
      processor = await AutoProcessor.from_pretrained(a.id, opts);
      (self as unknown as Worker).postMessage({ type: 'progress', progress: null, model: `${modelName}${a.dtype ? ' ' + a.dtype : ''}${device === 'webgpu' ? ' · gpu' : ' · wasm'}` });
      return;
    } catch (e) {
      lastErr = e;
      model = null;
      processor = null;
      (self as unknown as Worker).postMessage({ type: 'progress', progress: -1, model: `${modelName}${a.dtype ? ' ' + a.dtype : ''} unavailable — trying next` });
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('could not load any isolation model');
}

self.onmessage = async (e: MessageEvent) => {
  const { id, url } = e.data as { id: number; url: string };
  try {
    await ensure();
    const raw = await RawImage.fromURL(url);
    const { pixel_values } = await processor(raw);
    const out = await model({ input: pixel_values });
    const output = (out as { output?: { data: Float32Array; dims: number[] }; logits?: { data: Float32Array; dims: number[] } }).output
      ?? (out as { logits?: { data: Float32Array; dims: number[] } }).logits;
    if (!output) throw new Error('model returned no matte');
    const data = output.data as Float32Array;
    const dims = output.dims as number[];
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    (self as unknown as Worker).postMessage({ type: 'result', id, dims, buffer: buf, model: modelName }, [buf]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', id, message: err instanceof Error ? err.message : 'inference failed' });
  }
};
