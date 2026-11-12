/// <reference lib="webworker" />
import { pipeline } from '@huggingface/transformers';

/**
 * Speech recognition worker. Runs Whisper through transformers.js so the page stays responsive.
 * The model is downloaded from the Hugging Face hub on first use and then kept in the browser cache.
 * It runs on the GPU (WebGPU) when the browser has one available, otherwise on the CPU (WebAssembly).
 */
let pipe: any = null, loaded = '', device = '';

async function load(model: string, id: number, forceCpu = false) {
  const gpu = !forceCpu && !!(navigator as any).gpu && !!(await (navigator as any).gpu.requestAdapter().catch(() => null));
  device = gpu ? 'webgpu' : 'wasm';
  pipe = await pipeline('automatic-speech-recognition', model, {
    device: device as any,
    dtype: (gpu ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8') as any,
    progress_callback: (p: any) => { if (p.status === 'progress') postMessage({ id, type: 'load', file: p.file, progress: p.progress }); },
  });
  loaded = model;
}

self.onmessage = async (e: MessageEvent) => {
  const { id, model, lang, pcm } = e.data as { id: number; model: string; lang: string; pcm: Float32Array };
  const opts: any = { return_timestamps: 'word' };
  if (lang !== 'auto') { opts.language = lang; opts.task = 'transcribe'; }
  try {
    if (loaded !== model) await load(model, id);
    let out: any;
    try { out = await pipe(pcm, opts); }
    catch (err) {
      if (device !== 'webgpu') throw err;
      await load(model, id, true);            // some GPU drivers fail on Whisper: retry once on the CPU
      out = await pipe(pcm, opts);
    }
    postMessage({ id, type: 'done', device, chunks: out.chunks || [] });
  } catch (err: any) {
    loaded = ''; pipe = null;
    postMessage({ id, type: 'error', message: String(err?.message || err) });
  }
};
