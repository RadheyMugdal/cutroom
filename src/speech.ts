import type { Media, Word } from './types';

/**
 * Speech tools: pull the audio out of a file, find the silent parts, and turn speech into timed words.
 * All times are seconds in the source file, so results survive any amount of trimming and cutting.
 */
const RATE = 16000;   // what Whisper expects; also plenty for silence detection

const pcmCache = new Map<string, Float32Array>();
/** A file's sound as mono 16 kHz samples. Decoded in memory, so very long files can fail. */
export async function audio16k(m: Media): Promise<Float32Array> {
  const hit = pcmCache.get(m.id); if (hit) return hit;
  if (!m.file) throw new Error('This file is not stored on this device.');
  const buf = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(await m.file.arrayBuffer());
  const out = new Float32Array(buf.length), n = buf.numberOfChannels;
  for (let ch = 0; ch < n; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++) out[i] += d[i] / n; }
  pcmCache.clear(); pcmCache.set(m.id, out);   // keep only the latest: these are large
  return out;
}

export type Range = [number, number];

/**
 * The parts of a recording that contain sound. A stretch counts as silence when it stays well below
 * the recording's own speaking level for at least minSilence seconds; pad keeps a little air around speech.
 */
export function speechRanges(pcm: Float32Array, minSilence = .6, pad = .12): Range[] {
  const hop = Math.round(RATE * .02), n = Math.floor(pcm.length / hop), dur = pcm.length / RATE;
  if (!n) return [];
  const rms = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = i * hop, e = j + hop; j < e; j++) s += pcm[j] * pcm[j]; rms[i] = Math.sqrt(s / hop); }
  const sorted = Float32Array.from(rms).sort(), level = sorted[Math.floor(n * .95)];   // the loud end: the speaking level
  if (level < 1e-4) return [];                                                          // nothing but silence
  const thr = Math.max(level * .08, 4e-4);                                              // about 22 dB under the speaking level
  const ranges: Range[] = []; let start = -1;
  for (let i = 0; i <= n; i++) {
    const loud = i < n && rms[i] >= thr;
    if (loud && start < 0) start = i;
    else if (!loud && start >= 0) { ranges.push([start * .02, i * .02]); start = -1; }
  }
  // Join speech separated by pauses shorter than minSilence, then pad.
  const merged: Range[] = [];
  for (const r of ranges) { const last = merged[merged.length - 1]; if (last && r[0] - last[1] < minSilence) last[1] = r[1]; else merged.push([r[0], r[1]]); }
  return merged.filter(r => r[1] - r[0] >= .06).map(r => [Math.max(0, r[0] - pad), Math.min(dur, r[1] + pad)] as Range);
}

/** Cut a recording into pieces of at most maxLen seconds, breaking at pauses, for the recogniser's 30-second window. */
export function windows(pcm: Float32Array, maxLen = 28): Range[] {
  const out: Range[] = [];
  let cur: Range | null = null;
  const push = (r: Range) => { for (let a = r[0]; a < r[1]; a += maxLen) out.push([a, Math.min(r[1], a + maxLen)]); };
  for (const r of speechRanges(pcm, .3, .1)) {
    if (cur && r[1] - cur[0] <= maxLen) cur[1] = r[1];
    else { if (cur) push(cur); cur = [r[0], r[1]]; }
  }
  if (cur) push(cur);
  return out;
}

/* ---------- recognition ---------- */
export interface Engine {
  /** Transcribe up to 30 seconds of 16 kHz mono audio. Word times are relative to the start of pcm. */
  run(pcm: Float32Array, opts: { model: string; lang: string }, onLoad: (file: string, progress: number) => void): Promise<{ text: string; timestamp: [number, number | null] }[]>;
}

let worker: Worker | null = null, seq = 0;
const workerEngine: Engine = {
  run(pcm, opts, onLoad) {
    worker ??= new Worker(new URL('./asrWorker.ts', import.meta.url), { type: 'module' });
    const id = ++seq, w = worker;
    return new Promise((ok, no) => {
      const onMsg = (e: MessageEvent) => {
        if (e.data.id !== id) return;
        if (e.data.type === 'load') return onLoad(e.data.file, e.data.progress);
        w.removeEventListener('message', onMsg); w.removeEventListener('error', onErr);
        if (e.data.type === 'done') ok(e.data.chunks); else no(new Error(e.data.message));
      };
      const onErr = (e: ErrorEvent) => { w.removeEventListener('message', onMsg); w.removeEventListener('error', onErr); worker = null; no(new Error(e.message || 'The speech worker could not start.')); };
      w.addEventListener('message', onMsg); w.addEventListener('error', onErr);
      w.postMessage({ id, ...opts, pcm }, [pcm.buffer]);
    });
  },
};
let engine: Engine = workerEngine;
/** Swap the recogniser (used by tests, and the hook for other models later). */
export const setEngine = (e: Engine) => { engine = e; };

export const MODELS: [string, string][] = [
  ['onnx-community/whisper-base_timestamped', 'Balanced'],
  ['onnx-community/whisper-tiny_timestamped', 'Fastest, least accurate'],
  ['onnx-community/whisper-small_timestamped', 'Most accurate, largest download'],
];
export const LANGS: [string, string][] = [['auto', 'Detect language'], ['en', 'English'], ['hi', 'Hindi'], ['bn', 'Bengali'], ['ta', 'Tamil'], ['te', 'Telugu'], ['mr', 'Marathi'], ['gu', 'Gujarati'], ['ur', 'Urdu'],
  ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['pt', 'Portuguese'], ['ar', 'Arabic'], ['ru', 'Russian'], ['id', 'Indonesian'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese']];

/** Transcribe a whole file into timed words. status(text, fraction) reports progress. */
export async function transcribe(m: Media, opts: { model: string; lang: string }, status: (text: string, p: number) => void): Promise<Word[]> {
  status('Reading audio', 0);
  const pcm = await audio16k(m), wins = windows(pcm), words: Word[] = [];
  for (let i = 0; i < wins.length; i++) {
    const [a, b] = wins[i];
    status(`Transcribing ${m.name}`, i / wins.length);
    const chunks = await engine.run(pcm.slice(Math.floor(a * RATE), Math.ceil(b * RATE)), opts,
      (file, p) => status(`Downloading speech model (${file.split('/').pop()})`, p / 100));
    for (const c of chunks) {
      const w = c.text.trim(); if (!w) continue;
      const s = a + c.timestamp[0], e = a + (c.timestamp[1] ?? c.timestamp[0] + .25);
      words.push({ s, e: Math.max(e, s + .05), w });
    }
  }
  return words;
}

/** Group words into caption lines: a new line after a pause, at the end of a sentence, or when the line is full. */
export function captionLines<T extends { a: number; b: number; w: string }>(words: T[], maxChars = 30, maxWords = 7): T[][] {
  const lines: T[][] = []; let cur: T[] = [], chars = 0;
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && (w.a - prev.b > .7 || chars + w.w.length + 1 > maxChars || cur.length >= maxWords || (/[.?!।]$/.test(prev.w) && cur.length >= 3))) { lines.push(cur); cur = []; chars = 0; }
    cur.push(w); chars += w.w.length + 1;
  }
  if (cur.length) lines.push(cur);
  return lines;
}
