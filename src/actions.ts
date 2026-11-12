import type { AudioClip, Clip, Kind, Media, TextClip, VideoClip } from './types';
import { NOFX, NOXF, S, addTrack, clipDur, clipEnd, commit, emptyProject, freeTrack, mainTrack, noCrop, notify, resetHistory, resolveOverlap, selected, shiftedKf, total, trackOf } from './state';
import { enrich, media, probe } from './media';
import { pause, seek } from './playback';
import { clearAll, saveMedia } from './storage';
import { $, uid } from './util';

/** Editing commands. Each one mutates the project and commits, which makes it undoable and autosaved. */

export function toast(msg: string) {
  const el = $('#toast'); el.textContent = msg;
  clearTimeout((toast as any).h); (toast as any).h = setTimeout(() => { el.textContent = ''; }, 5000);
}
const own = () => { S.own = true; };

/** overlay=false puts picture clips on the main track; overlay=true layers them above it as picture-in-picture. */
export function addMediaToTimeline(id: string, overlay = false) {
  const m = media.get(id); if (!m) return;
  let c: Clip;
  if (m.kind === 'audio') {
    c = { id: uid(), kind: 'audio', track: freeTrack('audio', S.t, m.duration), mediaId: id, start: S.t, in: 0, out: m.duration, volume: 1, fadeIn: 0, fadeOut: 0 } as AudioClip;
  } else {
    const out = isFinite(m.duration) ? m.duration : 4;
    const v: VideoClip = { id: uid(), kind: 'video', track: mainTrack()!.id, mediaId: id, start: 0, in: 0, out, speed: 1, volume: 1, mute: false, fit: 'contain', fadeIn: 0, fadeOut: 0, f: { ...NOFX }, ...NOXF, crop: noCrop() };
    if (overlay) Object.assign(v, { track: freeTrack('video', S.t, out), start: S.t, scale: .4, x: .76, y: .74 });
    c = v;
  }
  S.P.clips.push(c); S.sel = [c.id]; own(); commit();
}

export function addText() {
  const start = Math.min(S.t, Math.max(0, total() - .5));
  const c: TextClip = { id: uid(), kind: 'text', track: freeTrack('text', start, 3), text: 'Your text', start, dur: 3, x: .5, y: .5, size: 9, rot: 0, font: 'Figtree', bold: true, color: '#ffffff', bg: false, bgColor: '#000000', anim: 'fade' };
  S.P.clips.push(c); S.sel = [c.id]; own(); commit();
}

export function del() {
  if (!S.sel.length) return toast('Select a clip first.');
  S.P.clips = S.P.clips.filter(c => !S.sel.includes(c.id));
  S.sel = []; own(); commit(); seek(S.t);
}

export function duplicate() {
  const src = selected(); if (!src.length) return toast('Select a clip first.');
  const copies: string[] = [];
  for (const c of src) {
    const b: Clip = JSON.parse(JSON.stringify(c)); b.id = uid();
    if (trackOf(c)?.main) S.P.clips.splice(S.P.clips.indexOf(c) + 1, 0, b);
    else { b.start = clipEnd(c); S.P.clips.push(b); resolveOverlap(b); }
    copies.push(b.id);
  }
  S.sel = copies; own(); commit();
}

export function split() {
  const t = S.t, inside = (c: Clip) => t > c.start + .05 && t < clipEnd(c) - .05;
  // Split the selected clips under the playhead; with nothing suitable selected, split the main track.
  let targets = selected().filter(inside);
  if (!targets.length) targets = S.P.clips.filter(c => c.track === mainTrack()?.id && inside(c));
  if (!targets.length) return toast('Move the playhead over a clip, then split.');
  const made: string[] = [];
  for (const c of targets) {
    const b: any = JSON.parse(JSON.stringify(c)), a: any = c, local = t - c.start;
    b.id = uid(); b.start = t; b.kf = shiftedKf(a.kf, local); if (!b.kf) delete b.kf; delete b.trans;
    if (c.kind === 'text') { b.dur = c.dur - local; a.dur = local; }
    else { const cut = a.in + local * (c.kind === 'video' ? c.speed : 1); a.out = cut; b.in = cut; a.fadeOut = 0; b.fadeIn = 0; }
    S.P.clips.splice(S.P.clips.indexOf(c) + 1, 0, b); made.push(b.id);
  }
  S.sel = made; own(); commit();
}

export function addTrackOf(kind: Kind) { addTrack(kind); own(); commit(); }
export function toggleTrack(id: string) { const t = S.P.tracks.find(x => x.id === id); if (!t) return; t.off = !t.off; own(); commit(); }
export function removeTrack(id: string) {
  const t = S.P.tracks.find(x => x.id === id);
  if (!t || t.main) return;
  if (S.P.clips.some(c => c.track === id)) return toast('Remove the clips on this track first.');
  S.P.tracks = S.P.tracks.filter(x => x !== t); own(); commit();
}

export function newProject() {
  pause();
  for (const [id, m] of media) if (m.kind !== 'gen') { if (m.url) URL.revokeObjectURL(m.url); media.delete(id); }
  S.P = emptyProject(S.P.aspect); S.sel = []; S.t = 0; own();
  resetHistory(); clearAll().then(() => commit());
}

/** Filmstrips and waveforms are built in the background after import, then stored with the media. */
export function enrichLater(m: Media) {
  enrich(m).then(changed => { if (changed) { saveMedia(m); notify(); } });
}

export async function importFiles(files: File[]) {
  let n = 0, unsaved = 0;
  for (const f of files) {
    let m: Media;
    try { m = await probe(f); }
    catch (e) {
      toast((e as Error).message === 'type' ? `${f.name} is not a video, audio or image file.` : `Your browser cannot play ${f.name}. Try an MP4 or WebM file.`);
      continue;
    }
    // Relink: the project already refers to this file but it was not stored on this device.
    const lost = [...media.values()].find(x => x.missing && x.name === m.name && x.kind === m.kind);
    if (lost) { Object.assign(lost, m, { id: lost.id, missing: false }); m = lost; }
    else media.set(m.id, m);
    if (!(await saveMedia(m))) unsaved++;
    n++;
    if (lost) commit();
    else {
      if (!S.own) { S.P = emptyProject(S.P.aspect); S.t = 0; S.sel = []; resetHistory(); }   // replace the sample project
      addMediaToTimeline(m.id);
    }
    enrichLater(m);
  }
  if (unsaved) toast('Added, but the browser has no room to keep a copy. You will need to import the file again next time.');
  else if (n) toast(n + (n > 1 ? ' files' : ' file') + ' added to the timeline.');
}

export { clipDur };
