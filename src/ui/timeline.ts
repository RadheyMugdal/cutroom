import type { Clip, TrackDef } from '../types';
import { S, clipDur, clipEnd, commit, kfTimes, layout, mainTrack, notify, resolveOverlap, selected, shiftedKf, total, trackOf, transDur } from '../state';
import { media, srcLen } from '../media';
import { pause, seek } from '../playback';
import { removeTrack, toggleTrack } from '../actions';
import { $, clamp, esc, fmt } from '../util';

const TILE = 64, SNAP_PX = 8, MIN = .1;

export function label(c: Clip): string {
  if (c.kind === 'text') return c.text.split('\n')[0] || 'Text';
  const m = media.get(c.mediaId);
  return m ? (m.missing ? 'Missing: ' : '') + m.name : 'Missing file';
}

function clipHtml(c: Clip, pps: number): string {
  const d = clipDur(c), w = Math.max(6, d * pps - 1), m = c.kind !== 'text' ? media.get(c.mediaId) : undefined;
  let art = '';
  if (c.kind === 'video' && m && !m.missing) {
    if (m.kind === 'video' && m.strip && m.stripN) {
      // One tile per 64px, each showing the stored frame nearest to that point in the source.
      for (let k = 0, n = Math.min(400, Math.ceil(w / TILE)); k < n; k++) {
        const srcT = c.in + (k * TILE + TILE / 2) / pps * c.speed, idx = clamp(Math.floor(srcT / m.duration * m.stripN), 0, m.stripN - 1);
        art += `<i class="tile strip-${m.id}" style="left:${k * TILE}px;background-position:${-idx * TILE}px 0"></i>`;
      }
    } else if (m.thumb) art = `<i class="tiles strip-${m.id}"></i>`;
  } else if (c.kind === 'audio' && m?.wave) art = `<i class="wave wave-${m.id}" style="left:${-c.in * pps}px;width:${m.duration * pps}px"></i>`;
  const fi = c.kind !== 'text' && c.fadeIn ? `<i class="fade" style="left:0;width:${c.fadeIn * pps}px"></i>` : '';
  const fo = c.kind !== 'text' && c.fadeOut ? `<i class="fade out" style="right:0;width:${c.fadeOut * pps}px"></i>` : '';
  return `<div class="clip ${c.kind}${S.sel.includes(c.id) ? ' sel' : ''}${m?.missing ? ' missing' : ''}" data-id="${c.id}" style="left:${c.start * pps}px;width:${w}px" title="${esc(label(c))} · ${fmt(d)}">`
    + art + fi + fo + kfTimes(c).filter(t => t >= 0 && t <= d).map(t => `<i class="kfd" data-t="${c.start + t}" style="left:${t * pps}px" title="Keyframe: click to go here"></i>`).join('')
    + `<i class="hd l"></i><span class="nm">${esc(label(c))}</span><i class="hd r"></i></div>`;
}

export function renderTimeline() {
  const pps = S.pps, dur = total(), width = (Math.max(dur, 8) + 4) * pps;
  const step = [.25, .5, 1, 2, 5, 10, 30, 60, 120].find(s => s * pps >= 64) || 300;
  let html = '<div class="ruler">';
  for (let s = 0; s * pps < width; s += step)
    html += `<div class="tick" style="left:${s * pps}px">${s % 1 ? s.toFixed(2).replace(/0$/, '') + 's' : fmt(s).slice(0, -3)}</div>`;
  html += '</div>';
  let labels = '';
  for (const tr of S.P.tracks) {
    html += `<div class="track ${tr.kind}${tr.off ? ' off' : ''}${tr.main ? ' main' : ''}" data-track="${tr.id}">`;
    let count = 0, prev: Clip | undefined;
    for (const c of S.P.clips) if (c.track === tr.id) {
      html += clipHtml(c, pps); count++;
      if (tr.main && prev) {
        // Between two main-track clips: a badge over the overlap if there is a transition, otherwise a dot to add one.
        const d = transDur(prev, c);
        html += d > 0 ? `<div class="trans" data-id="${c.id}" style="left:${c.start * pps}px;width:${Math.max(10, d * pps)}px" title="Transition, ${d.toFixed(1)}s. Click to edit."></div>`
          : `<button class="junc" data-id="${c.id}" style="left:${c.start * pps}px" title="Add a transition here" aria-label="Add a transition here">+</button>`;
      }
      prev = c;
    }
    html += '</div>';
    const offWord = tr.kind === 'audio' ? 'Muted' : 'Hidden', onWord = tr.kind === 'audio' ? 'Mute' : 'Hide';
    labels += `<div class="trow ${tr.kind}${tr.off ? ' off' : ''}"><span class="tn" title="${esc(tr.name)}">${esc(tr.name)}</span>`
      + `<button data-act="toggle" data-track="${tr.id}" aria-pressed="${!!tr.off}" title="${tr.off ? 'Turn this track back on' : onWord + ' this track'}">${tr.off ? offWord : onWord}</button>`
      + (!tr.main && !count ? `<button data-act="del" data-track="${tr.id}" title="Remove this empty track" aria-label="Remove track">×</button>` : '') + '</div>';
  }
  const inner = $('#inner');
  inner.style.width = width + 'px';
  inner.innerHTML = html + '<div id="ph"></div>' + (S.snapX != null ? `<div id="snap" style="left:${S.snapX * pps}px"></div>` : '');
  $('#ph').style.left = S.t * pps + 'px';
  $('#labels').innerHTML = labels;
  $('#tcDur').textContent = fmt(dur);
}

/** Called every frame: move the playhead and keep it in view while playing. */
export function tickTimeline() {
  const ph = document.getElementById('ph'); if (!ph) return;
  const x = S.t * S.pps, sc = $('#scroll');
  ph.style.left = x + 'px';
  if (S.playing && (x > sc.scrollLeft + sc.clientWidth - 30 || x < sc.scrollLeft)) sc.scrollLeft = x - 30;
}

/* ---------- snapping ---------- */
/** Times a dragged edge may snap to: the start, the playhead, and the edges of every clip not being dragged. */
function snapPoints(): number[] {
  const pts = [0, S.t];
  for (const c of S.P.clips) if (!S.sel.includes(c.id)) pts.push(c.start, clipEnd(c));
  return pts;
}
function snapEdge(time: number, pts: number[]): number {
  let best = time, bd = SNAP_PX / S.pps;
  for (const p of pts) { const d = Math.abs(p - time); if (d < bd) { bd = d; best = p; } }
  if (best !== time) S.snapX = best;
  return best;
}
/** Snap a moving clip by whichever of its two edges is closer to a snap point. */
function snapMove(start: number, dur: number, pts: number[]): number {
  let best = start, bd = SNAP_PX / S.pps, line: number | null = null;
  for (const p of pts) for (const off of [0, dur]) {
    const d = Math.abs(p - (start + off));
    if (d < bd) { bd = d; best = p - off; line = p; }
  }
  if (line != null && best >= 0) { S.snapX = line; return best; }
  return Math.max(0, start);
}

/* ---------- dragging ---------- */
type Drag = { mode: 'scrub' } | { mode: 'l' | 'r' | 'move'; c: Clip; x0: number; grab: number; o: Map<string, any>; pts: number[]; moved: boolean };
let drag: Drag | null = null;
const xToT = (e: PointerEvent) => (e.clientX - $('#inner').getBoundingClientRect().left) / S.pps;
function trackAt(y: number): TrackDef | undefined {
  for (const el of document.querySelectorAll<HTMLElement>('#inner .track')) {
    const r = el.getBoundingClientRect();
    if (y >= r.top && y < r.bottom) return S.P.tracks.find(t => t.id === el.dataset.track);
  }
}

function onMove(e: PointerEvent) {
  if (!drag) return;
  if (drag.mode === 'scrub') { seek(xToT(e)); return; }
  if (Math.abs(e.clientX - drag.x0) < 3 && !drag.moved) return;
  drag.moved = true; S.snapX = null;
  const { mode, pts } = drag, c: any = drag.c, o = drag.o.get(c.id), dx = (e.clientX - drag.x0) / S.pps;
  const main = mainTrack(), isMain = c.track === main?.id;

  if (mode !== 'move') {
    if (c.kind === 'text') {
      if (mode === 'l') { const ns = clamp(snapEdge(o.start + dx, pts), 0, o.start + o.dur - MIN); c.dur = o.dur - (ns - o.start); c.start = ns; if (o.kf) c.kf = shiftedKf(o.kf, ns - o.start); }
      else c.dur = Math.max(MIN, snapEdge(o.start + o.dur + dx, pts) - o.start);
    } else {
      const sp = c.kind === 'video' ? o.speed : 1, len = (o.out - o.in) / sp;
      if (mode === 'l') {
        if (isMain) { c.in = clamp(o.in + dx * sp, 0, o.out - MIN * sp); if (o.kf) c.kf = shiftedKf(o.kf, (c.in - o.in) / sp); }   // the main track ripples, so only the in-point moves
        else { const d = clamp(snapEdge(o.start + dx, pts) - o.start, Math.max(-o.in / sp, -o.start), len - MIN); c.in = o.in + d * sp; c.start = o.start + d; if (o.kf) c.kf = shiftedKf(o.kf, d); }
      } else {
        const ne = isMain ? o.start + len + dx : snapEdge(o.start + len + dx, pts);
        c.out = clamp(o.in + (ne - o.start) * sp, o.in + MIN * sp, srcLen(c));
      }
    }
  } else if (S.sel.length > 1) {
    // Group move: every selected clip outside the main track shifts by the same amount.
    const d = isMain ? dx : snapMove(o.start + dx, clipDur(c), pts) - o.start;
    for (const x of selected()) if (x.track !== main?.id) x.start = Math.max(0, drag.o.get(x.id).start + d);
  } else {
    const row = trackAt(e.clientY), target = row && row.kind === c.kind ? row : trackOf(c)!;
    c.track = target.id;
    if (target.main) {
      // Reorder: drop the clip where the pointer is, measured against the other clips' midpoints.
      const tp = xToT(e), rest = S.P.clips.filter(v => v !== c), mains = rest.filter(v => v.track === target.id);
      let s = 0, idx = 0;
      for (const v of mains) { const d = clipDur(v); if (tp > s + d / 2) idx++; s += d; }
      rest.splice(mains[idx] ? rest.indexOf(mains[idx]) : rest.length, 0, c); S.P.clips = rest;
    } else c.start = snapMove(Math.max(0, xToT(e) - drag.grab), clipDur(c), pts);
  }
  layout(); renderTimeline();
}

export function initTimeline() {
  $('#inner').addEventListener('pointerdown', e => {
    if (S.exporting) return;
    const target = e.target as HTMLElement, ce = target.closest('.clip') as HTMLElement | null;
    const tj = target.closest('.trans, .junc') as HTMLElement | null;
    if (tj) {   // select the arriving clip; the inspector shows its transition
      const c: any = S.P.clips.find(x => x.id === tj.dataset.id);
      if (tj.classList.contains('junc')) { c.trans = { type: 'fade', dur: .5 }; S.own = true; S.sel = [c.id]; commit(); }
      else { S.sel = [c.id]; notify(); }
      e.preventDefault(); return;
    }
    if (target.classList.contains('kfd')) { pause(); seek(+target.dataset.t!); S.sel = [ce!.dataset.id!]; notify(); e.preventDefault(); return; }
    if (!ce) {
      if (!target.closest('.ruler') && S.sel.length) { S.sel = []; notify(); }
      pause(); seek(xToT(e)); drag = { mode: 'scrub' }; e.preventDefault(); return;
    }
    const id = ce.dataset.id!, c = S.P.clips.find(x => x.id === id)!;
    e.preventDefault();
    if (e.shiftKey || e.ctrlKey || e.metaKey) {   // add to or remove from the selection
      S.sel = S.sel.includes(id) ? S.sel.filter(x => x !== id) : [...S.sel, id]; notify(); return;
    }
    if (!S.sel.includes(id)) S.sel = [id];
    const mode = target.classList.contains('l') ? 'l' : target.classList.contains('r') ? 'r' : 'move';
    if (mode !== 'move') S.sel = [id];
    drag = { mode, c, x0: e.clientX, grab: xToT(e) - c.start, o: new Map(selected().map(x => [x.id, JSON.parse(JSON.stringify(x))])), pts: snapPoints(), moved: false };
    notify();
  });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag; drag = null; S.snapX = null;
    if (d.mode === 'scrub' || !d.moved) return;
    if (d.mode === 'move') selected().forEach(resolveOverlap);
    S.own = true; commit();
  });

  $('#labels').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    if (b.dataset.act === 'toggle') toggleTrack(b.dataset.track!); else removeTrack(b.dataset.track!);
  });
  ($('#zoom') as HTMLInputElement).oninput = e => { S.pps = +(e.target as HTMLInputElement).value; renderTimeline(); };
}
