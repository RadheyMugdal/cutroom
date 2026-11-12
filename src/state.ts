import type { Aspect, Clip, Fx, Kf, Kind, Project, TrackDef } from './types';

export const NOFX: Fx = { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, sepia: 0, hue: 0, blur: 0 };
export const NOXF = { x: .5, y: .5, scale: 1, rot: 0, opacity: 1 };
export const noCrop = () => ({ l: 0, t: 0, r: 0, b: 0 });

export const emptyProject = (aspect: Aspect = '16:9'): Project => ({
  v: 2, aspect, clips: [],
  tracks: [
    { id: 't1', kind: 'text', name: 'Text 1' },
    { id: 'v2', kind: 'video', name: 'Overlay 1' },
    { id: 'v1', kind: 'video', name: 'Main', main: true },
    { id: 'a1', kind: 'audio', name: 'Audio 1' },
  ],
});

/** The single mutable app state. Mutate it, then call commit() (undoable) or notify() (view only). */
export const S = {
  P: emptyProject(),
  sel: [] as string[],              // selected clip ids
  t: 0,
  playing: false,
  pps: 80,                          // timeline zoom, pixels per second
  exporting: false,
  own: false,                       // false while the sample project is still showing
  snapX: null as number | null,     // time of the active timeline snap line
  guides: { v: false, h: false },   // centre guides shown while dragging on the preview
};

export const clipDur = (c: Clip): number => c.kind === 'text' ? c.dur : c.kind === 'video' ? (c.out - c.in) / c.speed : c.out - c.in;
export const clipEnd = (c: Clip) => c.start + clipDur(c);
export const mainTrack = (P: Project = S.P) => P.tracks.find(t => t.main);
export const trackOf = (c: Clip, P: Project = S.P) => P.tracks.find(t => t.id === c.track);
export const selected = () => S.P.clips.filter(c => S.sel.includes(c.id));
export const one = (): Clip | undefined => { const a = selected(); return a.length === 1 ? a[0] : undefined; };

/** Length of the transition into c from the clip before it. Each clip can give up at most half its length. */
export const transDur = (prev: Clip | undefined, c: Clip): number => {
  const tr = c.kind === 'video' ? c.trans : undefined;
  if (!prev || !tr || tr.type === 'none') return 0;
  return Math.max(0, Math.min(tr.dur, clipDur(prev) / 2, clipDur(c) / 2));
};
/** The clips before and after c on the main track (undefined for clips on other tracks). */
export function neighbours(P: Project, c: Clip): [Clip | undefined, Clip | undefined] {
  const m = mainTrack(P); if (!m || c.track !== m.id) return [undefined, undefined];
  const mains = P.clips.filter(x => x.track === m.id), i = mains.indexOf(c);
  return [mains[i - 1], mains[i + 1]];
}

/** Main-track clips sit end to end, in array order, overlapping only for a transition. Other clips keep their own start. */
export function layout(P: Project = S.P) {
  const m = mainTrack(P); if (!m) return;
  let s = 0, prev: Clip | undefined;
  for (const c of P.clips) if (c.track === m.id) { c.start = Math.max(0, s - transDur(prev, c)); s = c.start + clipDur(c); prev = c; }
}
export function total(P: Project = S.P): number {
  let e = 0;
  for (const c of P.clips) e = Math.max(e, clipEnd(c));
  return e;
}

export function addTrack(kind: Kind): TrackDef {
  const n = S.P.tracks.filter(t => t.kind === kind && !t.main).length + 1;
  const tr: TrackDef = { id: 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), kind, name: (kind === 'video' ? 'Overlay ' : kind === 'text' ? 'Text ' : 'Audio ') + n };
  // Text goes on top, new overlays just above the other video tracks, audio at the bottom.
  const firstVideo = S.P.tracks.findIndex(t => t.kind === 'video');
  if (kind === 'text') S.P.tracks.unshift(tr);
  else if (kind === 'video') S.P.tracks.splice(firstVideo < 0 ? 0 : firstVideo, 0, tr);
  else S.P.tracks.push(tr);
  return tr;
}

/** Pick a track of this kind that is free for [start, start+dur), creating one if none is. */
export function freeTrack(kind: Kind, start: number, dur: number): string {
  const free = S.P.tracks.filter(t => t.kind === kind && !t.main)
    .find(t => !S.P.clips.some(c => c.track === t.id && c.start < start + dur - 1e-3 && clipEnd(c) > start + 1e-3));
  return (free || addTrack(kind)).id;
}

/** If a moved clip landed on top of another on the same track, slide it right to the next gap. */
export function resolveOverlap(c: Clip) {
  if (trackOf(c)?.main) return;
  for (let i = 0; i < 50; i++) {
    const hit = S.P.clips.find(o => o !== c && o.track === c.track && o.start < clipEnd(c) - 1e-3 && clipEnd(o) > c.start + 1e-3);
    if (!hit) break;
    c.start = clipEnd(hit);
  }
}

/** Upgrade projects saved by earlier versions (separate video/text/audio lists, single tracks). */
export function migrate(p: any): Project {
  if (p?.v === 2) return p;
  const n = emptyProject(p?.aspect || '16:9');
  for (const c of p?.text || []) n.clips.push({ rot: 0, ...c, kind: 'text', track: 't1' });
  for (const c of p?.video || []) n.clips.push({ ...NOXF, crop: noCrop(), ...c, kind: 'video', track: 'v1' });
  for (const c of p?.audio || []) n.clips.push({ ...c, kind: 'audio', track: 'a1' });
  return n;
}

/* ---------- keyframes ---------- */
const LINEAR = new Set(['opacity', 'volume']);   // everything else eases in and out
const NEAR = 1 / 45;                              // a keyframe within this many seconds counts as "at the playhead"

/** A property's value at a time inside the clip: the plain value, or interpolated between keyframes. */
export function val(c: any, prop: string, local: number): number {
  const k: Kf[] | undefined = c.kf?.[prop];
  if (!k || !k.length) return c[prop];
  if (local <= k[0].t) return k[0].v;
  if (local >= k[k.length - 1].t) return k[k.length - 1].v;
  let i = 1; while (k[i].t < local) i++;
  const a = k[i - 1], b = k[i];
  let u = (local - a.t) / (b.t - a.t || 1);
  if (!LINEAR.has(prop)) u = u * u * (3 - 2 * u);
  return a.v + (b.v - a.v) * u;
}
export const localT = (c: Clip) => Math.min(clipDur(c), Math.max(0, S.t - c.start));
export const isAnimated = (c: any, prop: string) => !!c.kf?.[prop]?.length;
export const kfIndex = (c: any, prop: string, local: number) => (c.kf?.[prop] as Kf[] | undefined)?.findIndex(q => Math.abs(q.t - local) < NEAR) ?? -1;

/** Change a property. If it is animated, this writes a keyframe at the given time instead of the plain value. */
export function setProp(c: any, prop: string, v: number, local: number) {
  const k: Kf[] | undefined = c.kf?.[prop];
  if (!k || !k.length) { c[prop] = v; return; }
  const i = kfIndex(c, prop, local);
  if (i >= 0) k[i].v = v; else { k.push({ t: local, v }); k.sort((a, b) => a.t - b.t); }
}
/** Add a keyframe at this time, or remove the one that is there. Removing the last one makes the property static again. */
export function toggleKf(c: any, prop: string, local: number) {
  c.kf ??= {}; const k: Kf[] = (c.kf[prop] ??= []);
  const i = kfIndex(c, prop, local);
  if (i >= 0) { const v = k[i].v; k.splice(i, 1); if (!k.length) { delete c.kf[prop]; c[prop] = v; } }
  else { k.push({ t: local, v: val(c, prop, local) }); k.sort((a, b) => a.t - b.t); }
  if (!Object.keys(c.kf).length) delete c.kf;
}
/** Keep keyframes attached to the same content when the start of a clip is trimmed or split off. */
export function shiftedKf(kf: Record<string, Kf[]> | undefined, d: number) {
  if (!kf) return undefined;
  const out: Record<string, Kf[]> = {};
  for (const p in kf) out[p] = kf[p].map(q => ({ t: q.t - d, v: q.v }));
  return out;
}
export function kfTimes(c: Clip): number[] {
  const set = new Set<number>();
  for (const p in c.kf || {}) for (const q of c.kf![p]) set.add(Math.round(q.t * 1000) / 1000);
  return [...set].sort((a, b) => a - b);
}

type Fn = () => void;
const subs: Fn[] = [];
export const onChange = (f: Fn) => { subs.push(f); };
export const notify = () => subs.forEach(f => f());

let hist: string[] = [], hi = -1;
export function commit() {
  layout();
  const s = JSON.stringify(S.P);
  if (hist[hi] !== s) {
    hist = hist.slice(0, hi + 1); hist.push(s);
    if (hist.length > 150) hist.shift();
    hi = hist.length - 1;
  }
  notify();
}
function restore(i: number) {
  if (i < 0 || i >= hist.length) return;
  hi = i; S.P = JSON.parse(hist[i]);
  S.sel = S.sel.filter(id => S.P.clips.some(c => c.id === id));
  layout(); notify();
}
export const undo = () => restore(hi - 1);
export const redo = () => restore(hi + 1);
export const canUndo = () => hi > 0;
export const canRedo = () => hi < hist.length - 1;
export function resetHistory() { hist = []; hi = -1; }
