import type { Box, VideoClip } from './types';
import { S, clipDur, one, total } from './state';
import { media } from './media';
import { dims, drawGizmo, gainAt, renderFrame, type FrameSource } from './render';
import { clamp } from './util';

/**
 * Real-time preview. One <video>/<audio> element per clip is kept in step with the timeline clock,
 * and their sound runs through a Web Audio graph so volume can go above 100% and fade smoothly.
 */
export const els = new Map<string, HTMLMediaElement>();
export const boxes: Box[] = [];   // on-canvas bounds of visible clips in draw order, for hit testing

let actx: AudioContext | null = null, master: GainNode | null = null;
const gains = new Map<HTMLMediaElement, GainNode>();

/** Must be called from a click or key press: browsers only start audio on a user gesture. */
export function ensureAudio() {
  if (actx) { if (actx.state === 'suspended') actx.resume().catch(() => {}); return; }
  try {
    actx = new (window.AudioContext || (window as any).webkitAudioContext)();
    master = actx.createGain(); master.connect(actx.destination);
    els.forEach(attach);
  } catch { actx = null; }
}
function attach(el: HTMLMediaElement) {
  if (!actx || !master || gains.has(el)) return;
  try { const s = actx.createMediaElementSource(el), g = actx.createGain(); s.connect(g); g.connect(master); gains.set(el, g); } catch { /* element stays on its own output */ }
}
function setGain(el: HTMLMediaElement, v: number) {
  const g = gains.get(el);
  if (g) g.gain.value = v; else el.volume = clamp(v, 0, 1);
}

/** Create elements for new clips and drop the ones whose clips are gone. */
export function syncEls() {
  const live = new Set<string>();
  for (const c of S.P.clips) {
    if (c.kind === 'text') continue;
    const m = media.get(c.mediaId);
    if (!m || !m.url || (m.kind !== 'video' && m.kind !== 'audio')) continue;
    live.add(c.id);
    if (!els.has(c.id)) {
      const el = document.createElement(m.kind) as HTMLMediaElement;
      el.src = m.url; el.preload = 'auto'; (el as HTMLVideoElement).playsInline = true; el.currentTime = c.in || 0;
      els.set(c.id, el); attach(el);
    }
  }
  for (const [id, el] of els) if (!live.has(id)) { el.pause(); els.delete(id); gains.delete(el); }
}

function syncPlayback() {
  const { t, playing } = S;
  for (const c of S.P.clips) {
    if (c.kind === 'text') continue;
    const el = els.get(c.id); if (!el) continue;
    const sp = c.kind === 'video' ? c.speed : 1, d = clipDur(c), local = t - c.start;
    if (local >= 0 && local < d) {
      const src = c.in + local * sp;
      setGain(el, gainAt(S.P, c, local));
      if (playing) {
        if (el.playbackRate !== sp) el.playbackRate = sp;
        if (el.paused) { el.currentTime = src; el.play().catch(() => {}); }
        else if (Math.abs(el.currentTime - src) > 0.3) el.currentTime = src;
      } else {
        if (!el.paused) el.pause();
        if (!el.seeking && Math.abs(el.currentTime - src) > 0.02) el.currentTime = src;
      }
    } else {
      if (!el.paused) el.pause();
      // Pre-roll the next clip so the cut is instant.
      if (playing && local < 0 && local > -1 && !el.seeking && Math.abs(el.currentTime - c.in) > 0.05) el.currentTime = c.in;
    }
  }
}

export function play() {
  if (!total() || S.exporting) return;
  ensureAudio();
  if (S.t >= total() - 0.02) S.t = 0;
  S.playing = true; onState();
}
export function pause() { S.playing = false; onState(); }
export function seek(v: number) { S.t = clamp(v, 0, total()); }

/* ---------- preview canvas ---------- */
let cv: HTMLCanvasElement, ctx: CanvasRenderingContext2D, view: HTMLElement;
let W = 1280, H = 720, cssW = 1280;
let onTick: () => void = () => {}, onState: () => void = () => {};

export function sizeCanvas() {
  [W, H] = dims(S.P.aspect, 720);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  fitCanvas();
}
function fitCanvas() {
  const pad = 20, s = Math.min((view.clientWidth - pad) / W, (view.clientHeight - pad) / H);
  const w = Math.max(40, W * s), hh = Math.max(40, H * s);
  cssW = w;
  cv.style.width = w + 'px'; cv.style.height = hh + 'px';
  cv.style.left = (view.clientWidth - w) / 2 + 'px'; cv.style.top = (view.clientHeight - hh) / 2 + 'px';
}
export const canvasSize = () => [W, H] as const;
/** Canvas pixels per screen pixel. */
export const canvasScale = () => W / cssW;

const previewVideo = (c: VideoClip): FrameSource => {
  const el = els.get(c.id) as HTMLVideoElement | undefined;
  return el && el.readyState >= 2 ? { src: el, w: el.videoWidth, h: el.videoHeight } : null;
};

export function initPreview(canvas: HTMLCanvasElement, viewEl: HTMLElement, tick: () => void, stateChanged: () => void) {
  cv = canvas; ctx = cv.getContext('2d')!; view = viewEl; onTick = tick; onState = stateChanged;
  new ResizeObserver(fitCanvas).observe(view);
  sizeCanvas();
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(.1, (now - last) / 1000); last = now;
    if (S.playing) { S.t += dt; if (S.t >= total()) { S.t = total(); pause(); } }
    if (!S.exporting) {
      syncPlayback();
      renderFrame(ctx, W, H, S.P, S.t, total(), previewVideo, boxes);
      if (!S.playing) { const sel = one(); drawGizmo(ctx, W, H, sel && boxes.find(b => b.id === sel.id), canvasScale(), S.guides); }
    }
    onTick();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
