import type { Box, Clip, Fx, Project, TextClip, VideoClip } from './types';
import { clipDur, neighbours, trackOf, transDur, val } from './state';
import { drawGen, media } from './media';
import { clamp } from './util';

/**
 * The compositor. Preview and export both call renderFrame, so what you see is what you export.
 * The only thing that differs is where video pixels come from (a <video> element in the preview,
 * a decoded frame during export), supplied through getVideo.
 * Anything here must depend only on the project and a time, never on the DOM or the wall clock.
 */
export type FrameSource = { src: CanvasImageSource; w: number; h: number } | null;
export type VideoGetter = (clip: VideoClip) => FrameSource;

export const fadeAt = (local: number, d: number, fi: number, fo: number) => {
  let a = 1;
  if (fi > 0) a = Math.min(a, local / fi);
  if (fo > 0) a = Math.min(a, (d - local) / fo);
  return clamp(a, 0, 1);
};

function fxString(f: Fx, H: number): string {
  let s = '';
  if (f.brightness !== 100) s += `brightness(${f.brightness}%) `;
  if (f.contrast !== 100) s += `contrast(${f.contrast}%) `;
  if (f.saturate !== 100) s += `saturate(${f.saturate}%) `;
  if (f.grayscale) s += `grayscale(${f.grayscale}%) `;
  if (f.sepia) s += `sepia(${f.sepia}%) `;
  if (f.hue) s += `hue-rotate(${f.hue}deg) `;
  if (f.blur) s += `blur(${f.blur * H / 720}px) `;   // blur is authored at 720p and scales with output size
  return s || 'none';
}

/* ---------- transitions ---------- */
interface TransState { inType: string | null; inP: number; outType: string | null; outP: number }
const NOTRANS: TransState = { inType: null, inP: 1, outType: null, outP: 0 };
/** Where a main-track clip is within its incoming and outgoing transitions at this moment. */
function transState(P: Project, c: Clip, local: number): TransState {
  const [prev, next] = neighbours(P, c);
  if (!prev && !next) return NOTRANS;
  const d = clipDur(c), din = transDur(prev, c), dout = next ? transDur(c, next) : 0;
  return {
    inType: din > 0 && local < din ? (c as VideoClip).trans!.type : null, inP: din > 0 ? clamp(local / din, 0, 1) : 1,
    outType: dout > 0 && local >= d - dout ? (next as VideoClip).trans!.type : null, outP: dout > 0 ? clamp((local - (d - dout)) / dout, 0, 1) : 0,
  };
}

/** A clip's loudness at a moment: volume (or its keyframes), fades, and the audio crossfade of any transition. */
export function gainAt(P: Project, c: Clip, local: number): number {
  if (c.kind === 'text' || (c.kind === 'video' && c.mute) || trackOf(c, P)?.off) return 0;
  const ts = transState(P, c, local);
  return Math.max(0, val(c, 'volume', local)) * fadeAt(local, clipDur(c), c.fadeIn, c.fadeOut) * (ts.inType ? ts.inP : 1) * (ts.outType ? 1 - ts.outP : 1);
}

const clampT = (t: number, end: number) => Math.min(t, Math.max(0, end - 1e-4));   // hold the last frame at the very end

/** Every video clip on a visible track that is on screen at time t. */
export function activeVideoClips(P: Project, t: number, end: number): VideoClip[] {
  const tt = clampT(t, end), off = new Set(P.tracks.filter(x => x.off).map(x => x.id));
  return P.clips.filter((c): c is VideoClip => c.kind === 'video' && !off.has(c.track) && tt >= c.start && tt < c.start + clipDur(c));
}

export function renderFrame(ctx: CanvasRenderingContext2D, W: number, H: number, P: Project, t: number, end: number, getVideo: VideoGetter, boxes?: Box[]) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.filter = 'none';
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (boxes) boxes.length = 0;
  const tt = clampT(t, end);
  // Bottom track first, so higher rows end up in front.
  for (let i = P.tracks.length - 1; i >= 0; i--) {
    const tr = P.tracks[i];
    if (tr.off || tr.kind === 'audio') continue;
    for (const c of P.clips) {
      if (c.track !== tr.id) continue;
      const local = tt - c.start;
      if (local < 0 || local >= clipDur(c)) continue;
      if (c.kind === 'video') drawVideo(ctx, W, H, c, local, getVideo, tr.main ? transState(P, c, local) : NOTRANS, boxes);
      else if (c.kind === 'text') drawText(ctx, W, H, c, local, boxes);
    }
  }
}

const ease = (p: number) => p * p * (3 - 2 * p);

function drawVideo(ctx: CanvasRenderingContext2D, W: number, H: number, c: VideoClip, local: number, getVideo: VideoGetter, ts: TransState, boxes?: Box[]) {
  const m = media.get(c.mediaId);
  let fs: FrameSource = null;
  if (m?.kind === 'gen') fs = { src: drawGen(m.gen!, c.in + local * c.speed), w: 640, h: 360 };
  else if (m?.kind === 'image' && m.img) fs = { src: m.img, w: m.img.naturalWidth, h: m.img.naturalHeight };
  else if (m?.kind === 'video') fs = getVideo(c);
  if (!fs || !fs.w || !fs.h) return;

  // Transition effect: the arriving clip is drawn over the leaving one and animated by progress.
  let a = 1, tx = 0, zoom = 1, wipe = 1;
  switch (ts.inType) {
    case 'fade': a *= ts.inP; break;
    case 'dip': a *= clamp(ts.inP * 2 - 1, 0, 1); break;
    case 'wipe': wipe = ts.inP; break;
    case 'slide': case 'push': tx = (1 - ease(ts.inP)) * W; break;
    case 'zoom': a *= ts.inP; zoom = 1.15 - .15 * ease(ts.inP); break;
  }
  if (ts.outType === 'dip') a *= clamp(1 - ts.outP * 2, 0, 1);
  else if (ts.outType === 'push') tx = -ease(ts.outP) * W;

  const x = val(c, 'x', local), y = val(c, 'y', local), scale = val(c, 'scale', local), rot = val(c, 'rot', local);
  const cw = fs.w * Math.max(.02, 1 - c.crop.l - c.crop.r), ch = fs.h * Math.max(.02, 1 - c.crop.t - c.crop.b);
  const s = (c.fit === 'cover' ? Math.max(W / cw, H / ch) : Math.min(W / cw, H / ch)) * scale, dw = cw * s, dh = ch * s;
  ctx.save();
  if (wipe < 1) { ctx.beginPath(); ctx.rect(0, 0, W * wipe, H); ctx.clip(); }
  if (zoom !== 1) { ctx.translate(W / 2, H / 2); ctx.scale(zoom, zoom); ctx.translate(-W / 2, -H / 2); }
  ctx.translate(x * W + tx, y * H); ctx.rotate(rot * Math.PI / 180);
  ctx.globalAlpha = clamp(fadeAt(local, clipDur(c), c.fadeIn, c.fadeOut) * val(c, 'opacity', local) * a, 0, 1);
  ctx.filter = fxString(c.f, H);
  ctx.drawImage(fs.src, c.crop.l * fs.w, c.crop.t * fs.h, cw, ch, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
  boxes?.push({ id: c.id, cx: x * W + tx, cy: y * H, w: dw, h: dh, rot });
}

function drawText(ctx: CanvasRenderingContext2D, W: number, H: number, x: TextClip, local: number, boxes?: Box[]) {
  const A = .35, k = Math.min(clamp(local / A, 0, 1), clamp((x.dur - local) / A, 0, 1)), e = 1 - Math.pow(1 - k, 3);
  let alpha = 1, dy = 0, sc = 1;
  if (x.anim === 'fade') alpha = k;
  else if (x.anim === 'slide') { alpha = k; dy = (1 - e) * H * .05; }
  else if (x.anim === 'pop') { alpha = k; sc = .8 + .2 * e; }

  const rot = val(x, 'rot', local) || 0;
  const px = val(x, 'size', local) / 100 * H, lines = x.text.split('\n'), lh = px * 1.18;
  ctx.save();
  ctx.font = `${x.bold ? 700 : 400} ${px}px "${x.font}", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tw = Math.max(1, ...lines.map(l => ctx.measureText(l).width)), th = lh * lines.length, pad = px * .32;
  const cx = val(x, 'x', local) * W, cy = val(x, 'y', local) * H + dy;
  ctx.translate(cx, cy); ctx.rotate(rot * Math.PI / 180); ctx.scale(sc, sc); ctx.globalAlpha = alpha;
  if (x.bg) {
    ctx.fillStyle = x.bgColor; ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-tw / 2 - pad, -th / 2 - pad, tw + pad * 2, th + pad * 2, px * .18);
    else ctx.rect(-tw / 2 - pad, -th / 2 - pad, tw + pad * 2, th + pad * 2);
    ctx.fill();
  } else { ctx.shadowColor = 'rgba(0,0,0,.65)'; ctx.shadowBlur = px * .18; ctx.shadowOffsetY = px * .04; }
  ctx.fillStyle = x.color;
  lines.forEach((l, i) => ctx.fillText(l, 0, -th / 2 + lh * (i + .5)));
  ctx.restore();
  boxes?.push({ id: x.id, cx, cy, w: tw + pad * 2, h: th + pad * 2, rot });
}

/* ---------- editing overlay (preview only, never exported) ---------- */
export const HANDLE = 9, ROT_OFFSET = 30;   // in screen pixels; k converts to canvas pixels

export function drawGizmo(ctx: CanvasRenderingContext2D, W: number, H: number, b: Box | undefined, k: number, guides: { v: boolean; h: boolean }) {
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.filter = 'none';
  ctx.lineWidth = 1.5 * k;
  if (guides.v || guides.h) {
    ctx.strokeStyle = '#3fd0ff'; ctx.beginPath();
    if (guides.v) { ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); }
    if (guides.h) { ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); }
    ctx.stroke();
  }
  if (b) {
    ctx.translate(b.cx, b.cy); ctx.rotate(b.rot * Math.PI / 180);
    ctx.strokeStyle = '#ffb224'; ctx.fillStyle = '#fff';
    ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
    ctx.beginPath(); ctx.moveTo(0, -b.h / 2); ctx.lineTo(0, -b.h / 2 - ROT_OFFSET * k); ctx.stroke();
    const dot = (x: number, y: number, round: boolean) => {
      ctx.beginPath();
      if (round) ctx.arc(x, y, HANDLE * .7 * k, 0, 7); else ctx.rect(x - HANDLE * k / 2, y - HANDLE * k / 2, HANDLE * k, HANDLE * k);
      ctx.fill(); ctx.stroke();
    };
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) dot(sx * b.w / 2, sy * b.h / 2, false);
    dot(0, -b.h / 2 - ROT_OFFSET * k, true);
  }
  ctx.restore();
}

/** A canvas point expressed in a box's own (unrotated, centred) coordinates. */
export function toLocal(b: Box, x: number, y: number): [number, number] {
  const a = -b.rot * Math.PI / 180, dx = x - b.cx, dy = y - b.cy;
  return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
}

export function dims(aspect: string, short: number): [number, number] {
  const [a, b] = aspect.split(':').map(Number);
  return a >= b ? [Math.round(short * a / b / 2) * 2, short] : [short, Math.round(short * b / a / 2) * 2];
}
