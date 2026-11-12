import type { AudioClip, Clip, Media, TextClip, VideoClip } from './types';
import { S, addTrack, clipDur, commit, mainTrack, notify, selected, shiftedKf, trackOf } from './state';
import { media } from './media';
import { saveMedia } from './storage';
import { audio16k, captionLines, speechRanges, transcribe, type Range } from './speech';
import { toast } from './actions';
import { uid } from './util';

/** Editing commands built on speech: silence removal, transcription, captions and cutting by transcript. */

type Spoken = VideoClip | AudioClip;
/** Clips that carry sound from a stored file. */
export const spokenClips = (): Spoken[] => S.P.clips.filter((c): c is Spoken => {
  if (c.kind === 'text') return false;
  const m = media.get(c.mediaId);
  return !!m && !!m.file && (m.kind === 'video' || m.kind === 'audio');
});
const speedOf = (c: Spoken) => (c.kind === 'video' ? c.speed : 1);

/**
 * Replace a clip with pieces that cover only the given source ranges, closing the gaps between them.
 * Returns the ids of the pieces (empty if nothing of the clip is left).
 */
export function keepRanges(c: Spoken, ranges: Range[]): string[] {
  const sp = speedOf(c), idx = S.P.clips.indexOf(c);
  const parts = ranges.map(r => [Math.max(c.in, r[0]), Math.min(c.out, r[1])] as Range).filter(r => r[1] - r[0] > .04);
  if (parts.length === 1 && parts[0][0] <= c.in + 1e-3 && parts[0][1] >= c.out - 1e-3) return [c.id];   // nothing to cut
  let at = c.start;
  const made = parts.map((r, i) => {
    const b: any = JSON.parse(JSON.stringify(c));
    b.id = i === 0 ? c.id : uid(); b.in = r[0]; b.out = r[1]; b.start = at; at += (r[1] - r[0]) / sp;
    b.kf = shiftedKf(c.kf, (r[0] - c.in) / sp); if (!b.kf) delete b.kf;
    if (i > 0) { b.fadeIn = 0; delete b.trans; }
    if (i < parts.length - 1) b.fadeOut = 0;
    return b as Clip;
  });
  S.P.clips.splice(idx, 1, ...made);
  return made.map(b => b.id);
}

const hasCaptions = () => S.P.clips.some(c => c.kind === 'text' && c.cap);
function finish(sel?: string[]) {
  if (sel) S.sel = sel;
  if (hasCaptions()) makeCaptions(false);   // captions follow the cut
  S.own = true; commit();
}

/** Cut the quiet stretches out of the selected clips (or, with nothing selected, the whole main track). */
export async function removeSilences() {
  const picked = selected().filter(c => spokenClips().includes(c as Spoken)) as Spoken[];
  const targets = picked.length ? picked : spokenClips().filter(c => c.track === mainTrack()?.id);
  if (!targets.length) return toast('Add or select a clip with sound first.');
  toast('Looking for silences…');
  let saved = 0; const sel: string[] = [];
  for (const c of targets) {
    try {
      const before = clipDur(c), ids = keepRanges(c, speechRanges(await audio16k(media.get(c.mediaId)!)));
      sel.push(...ids);
      saved += before - S.P.clips.filter(x => ids.includes(x.id)).reduce((s, x) => s + clipDur(x), 0);
    } catch (e) { toast('Could not read the audio of ' + media.get(c.mediaId)?.name + '.'); }
  }
  if (saved < .05) return toast('No silences longer than half a second were found.');
  finish(sel);
  toast(`Removed ${saved.toFixed(1)}s of silence.`);
}

/** Transcribe every file on the timeline that has no transcript yet. */
export async function transcribeAll(opts: { model: string; lang: string }, status: (text: string, p: number) => void) {
  const todo = [...new Set(spokenClips().map(c => media.get(c.mediaId)!))].filter(m => !m.words);
  for (const m of todo) {
    m.words = await transcribe(m, opts, status);
    await saveMedia(m);
    notify();
  }
  return todo.length;
}

export interface TWord { i: number; a: number; b: number; w: string }
/** The words spoken during a clip, with timeline times (a, b) and their index in the file's transcript. */
export function clipWords(c: Spoken): TWord[] {
  const m = media.get(c.mediaId), sp = speedOf(c), out: TWord[] = [];
  (m?.words || []).forEach((w, i) => {
    const mid = (w.s + w.e) / 2;
    if (mid >= c.in && mid < c.out) out.push({ i, a: c.start + (Math.max(w.s, c.in) - c.in) / sp, b: c.start + (Math.min(w.e, c.out) - c.in) / sp, w: w.w });
  });
  return out;
}

const CAP_STYLE = ['x', 'y', 'size', 'rot', 'font', 'bold', 'color', 'bg', 'bgColor', 'anim'] as const;
/** Create caption clips from the transcripts, replacing earlier captions but keeping their styling. */
export function makeCaptions(commitNow = true) {
  const old = S.P.clips.filter((c): c is TextClip => c.kind === 'text' && !!c.cap);
  // Narrow frames fit fewer characters per line.
  const [maxChars, size] = S.P.aspect === '9:16' ? [18, 3.6] : S.P.aspect === '1:1' ? [24, 4.5] : [32, 5];
  const style: any = { x: .5, y: .86, size, rot: 0, font: 'Figtree', bold: true, color: '#ffffff', bg: true, bgColor: '#111111', anim: 'none' };
  if (old[0]) for (const k of CAP_STYLE) style[k] = (old[0] as any)[k];
  let track = S.P.tracks.find(t => t.kind === 'text' && t.name === 'Captions');
  if (!track) { track = addTrack('text'); track.name = 'Captions'; }
  S.P.clips = S.P.clips.filter(c => !(c.kind === 'text' && c.cap));

  const lines = spokenClips().filter(c => !trackOf(c)?.off && !(c.kind === 'video' && c.mute))
    .flatMap(c => captionLines(clipWords(c), maxChars)).sort((p, q) => p[0].a - q[0].a);
  lines.forEach((ln, i) => {
    const start = ln[0].a, next = lines[i + 1]?.[0].a ?? Infinity, end = Math.max(start + .3, Math.min(ln[ln.length - 1].b + .15, next));
    S.P.clips.push({ id: uid(), kind: 'text', track: track!.id, text: ln.map(w => w.w).join(' '), start, dur: end - start, ...style, cap: true } as TextClip);
  });
  if (commitNow) { S.own = true; commit(); toast(lines.length ? `Added ${lines.length} captions.` : 'There is no transcript to caption yet.'); }
}

export function styleAllCaptions(from: TextClip) {
  for (const c of S.P.clips) if (c.kind === 'text' && c.cap && c !== from) for (const k of CAP_STYLE) (c as any)[k] = (from as any)[k];
  S.own = true; commit();
}

/** Where a word's removal should end: at the next word, so the speech closes up cleanly. */
function cutEnd(m: Media, c: Spoken, i: number): number {
  const w = m.words![i], next = m.words![i + 1];
  return next && next.s < c.out && next.s - w.e < 1 ? next.s : w.e;
}

/** Edit by transcript: remove words i0..i1 (indices in the file's transcript) from a clip. */
export function deleteWords(clipId: string, i0: number, i1: number) {
  const c = spokenClips().find(x => x.id === clipId), m = c && media.get(c.mediaId);
  if (!c || !m?.words) return;
  keepRanges(c, [[c.in, m.words[i0].s], [cutEnd(m, c, i1), c.out]]);
  finish([]);
}

const FILLER = /^(u+h*m+|u+h+|e+r+m*|a+h+|h+m+|m+h*m+)[,.!?…]*$/i;
export function removeFillers() {
  let n = 0;
  for (const c of spokenClips()) {
    const m = media.get(c.mediaId)!, hits = clipWords(c).filter(w => FILLER.test(w.w));
    if (!hits.length) continue;
    const keep: Range[] = []; let at = c.in;
    for (const h of hits) { keep.push([at, m.words![h.i].s]); at = cutEnd(m, c, h.i); }
    keep.push([at, c.out]);
    keepRanges(c, keep); n += hits.length;
  }
  if (!n) return toast('No filler words (um, uh, er) were found in the transcript.');
  finish([]);
  toast(`Removed ${n} filler word${n > 1 ? 's' : ''}.`);
}
