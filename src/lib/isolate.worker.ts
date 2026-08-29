/* SALVAGE/9 — inference worker. Runs RMBG matting off the main thread so
   the UI never stalls and the tab is never killed for being unresponsive.
   Ladder: RMBG-2.0 fp16 (webgpu → wasm) → RMBG-1.4 (fp16 → default).
   Posts grayscale matte buffers back; emits download progress events. */

/* eslint-disable @typescript-eslint/no-explicit-any */
let model: any = null;
let processor: any = null;
let modelName = '';
let device: 'webgpu' | 'wasm' = 'wasm';

const post = (msg: unknown) => (self as unknown as Worker).postMessage(msg);

async function ensureModel(): Promise<void> {
  if (model && processor) return;
  const tf: any = await import('@huggingface/transformers');
  tf.env.allowLocalModels = false;
  tf.env.useBrowserCache = true;

  let lastStatus = -1;
  const opts = (dev: 'webgpu' | 'wasm') => ({
    ...(dev === 'webgpu' ? { device: 'webgpu' as const } : {}),
    progress_callback: (e: { status?: string; progress?: number }) => {
      if (e.status === 'initiate') { lastStatus = -1; post({ type: 'progress', progress: 0, model: `${modelName} · fetching` }); }
      else if (e.status === 'progress' && typeof e.progress === 'number') {
        const p = Math.round(e.progress);
        if (p !== lastStatus && p % 5 === 0) { lastStatus = p; post({ type: 'progress', progress: p, model: modelName }); }
      }
      else if (e.status === 'done') post({ type: 'progress', progress: 100, model: modelName });
      else if (e.status === 'ready') post({ type: 'progress', progress: null, model: `${modelName} · ${device}` });
    },
  });

  const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const ladder: Array<{ repo: string; dtype?: 'fp16'; dev: 'webgpu' | 'wasm' }> = [];
  if (hasGpu) ladder.push({ repo: 'briaai/RMBG-2.0', dtype: 'fp16', dev: 'webgpu' });
  ladder.push({ repo: 'briaai/RMBG-2.0', dtype: 'fp16', dev: 'wasm' });
  ladder.push({ repo: 'briaai/RMBG-1.4', dtype: 'fp16', dev: 'wasm' });
  ladder.push({ repo: 'briaai/RMBG-1.4', dev: 'wasm' });

  let lastErr: unknown = null;
  for (const rung of ladder) {
    modelName = rung.repo === 'briaai/RMBG-2.0' ? 'RMBG-2.0' : 'RMBG-1.4';
    device = rung.dev;
    try {
      const o = opts(rung.dev);
      (o as any).dtype = rung.dtype ?? 'fp32';
      const [m, p] = await Promise.all([
        tf.AutoModel.from_pretrained(rung.repo, o),
        tf.AutoProcessor.from_pretrained(rung.repo, o),
      ]);
      model = m; processor = p;
      post({ type: 'progress', progress: null, model: `${modelName} ${rung.dtype ?? 'fp32'} · ${rung.dev}` });
      return;
    } catch (e) { lastErr = e; }
  }
  throw lastErr instanceof Error ? lastErr : new Error('no matting model could load');
}

async function run(url: string): Promise<{ dims: number[]; data: Float32Array }> {
  await ensureModel();
  const tf: any = await import('@huggingface/transformers');
  const img = await tf.RawImage.fromURL(url);
  const { pixel_values } = await processor(img);
  const out = await model({ input: pixel_values });
  const output = out.output ?? out.logits;
  if (!output) throw new Error('model returned no matte');
  const dims = output.dims as number[];
  return { dims, data: output.data as Float32Array };
}

self.onmessage = async (e: MessageEvent) => {
  const { id, url } = e.data as { id: number; url: string };
  try {
    const { dims, data } = await run(url);
    /* transfer a copy — transformers may reuse its buffers */
    const copy = new Float32Array(data);
    post({ type: 'result', id, dims, buffer: copy.buffer });
  } catch (err) {
    post({ type: 'error', id, message: err instanceof Error ? err.message : 'inference failed' });
  }
};
