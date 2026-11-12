import type { Fx } from '../types';
import { NOFX, NOXF, S, clipDur, commit, isAnimated, kfIndex, kfTimes, layout, localT, neighbours, noCrop, one, setProp, toggleKf, transDur, val } from '../state';
import { pause, seek } from '../playback';
import { media } from '../media';
import { del, duplicate } from '../actions';
import { styleAllCaptions } from '../speechActions';
import { renderTimeline } from './timeline';
import { $, fmt, h } from '../util';

export const FONTS = ['Figtree', 'Bebas Neue', 'Playfair Display', 'JetBrains Mono'];
const PRESETS: Record<string, Partial<Fx>> = {
  'None': {}, 'Black & white': { grayscale: 100, contrast: 115 }, 'Warm': { sepia: 35, saturate: 125, brightness: 104 },
  'Cool': { hue: -18, saturate: 90, contrast: 106 }, 'Vivid': { saturate: 165, contrast: 114 }, 'Faded': { contrast: 80, brightness: 110, saturate: 72 },
};
const pct = (v: number) => Math.round(v) + '%', frac = (v: number) => pct(v * 100), sec = (v: number) => (+v).toFixed(1) + 's', deg = (v: number) => Math.round(v) + '°';
const done = () => { S.own = true; commit(); };

// Live-updates the value while dragging; records one undo step when released.
function slider(lbl: string, o: any, k: string, min: number, max: number, step: number, show: (v: number) => string, idp = '') {
  const out = h('output', {}, show(o[k])), id = 'f-' + idp + k;
  return h('div', { class: 'field' }, h('label', { htmlFor: id }, lbl, out),
    h('input', { type: 'range', id, min, max, step, value: o[k],
      oninput: (e: Event) => { o[k] = +(e.target as HTMLInputElement).value; out.textContent = show(o[k]); layout(); renderTimeline(); },
      onchange: done }));
}

/**
 * A slider for a property that can be animated. The diamond adds or removes a keyframe at the playhead.
 * Once a property has keyframes, moving the slider writes a keyframe at the playhead instead of a fixed value.
 */
interface Live { c: any; prop: string; input: HTMLInputElement; out: HTMLElement; btn: HTMLElement; show: (v: number) => string; busy: boolean }
let live: Live[] = [], lastT = -1;
function aslider(lbl: string, c: any, prop: string, min: number, max: number, step: number, show: (v: number) => string) {
  const out = h('output', {}, ''), id = 'f-' + prop;
  const btn = h('button', { class: 'kfb', title: 'Add or remove a keyframe at the playhead', 'aria-label': `Keyframe for ${lbl}`,
    onclick: () => { toggleKf(c, prop, localT(c)); done(); } }, '◆');
  const input = h('input', { type: 'range', id, min, max, step,
    oninput: () => { setProp(c, prop, +input.value, localT(c)); out.textContent = show(+input.value); },
    onpointerdown: () => { l.busy = true; }, onpointerup: () => { l.busy = false; }, onchange: () => { l.busy = false; done(); } }) as HTMLInputElement;
  const l: Live = { c, prop, input, out, btn, show, busy: false };
  live.push(l);
  return h('div', { class: 'field' }, h('div', { class: 'lb' }, h('label', { htmlFor: id }, lbl), h('span', { class: 'kfr' }, out, btn)), input);
}
/** Called every frame: animated sliders follow the playhead. */
export function tickInspector(force = false) {
  if (!live.length || (!force && S.t === lastT)) return;
  lastT = S.t;
  for (const l of live) {
    const lt = localT(l.c), v = val(l.c, l.prop, lt);
    if (!l.busy) { l.input.value = String(v); l.out.textContent = l.show(v); }
    l.btn.classList.toggle('has', isAnimated(l.c, l.prop));
    l.btn.classList.toggle('on', kfIndex(l.c, l.prop, lt) >= 0);
  }
}
function kfNav(c: any) {
  const times = kfTimes(c); if (!times.length) return null;
  const go = (dir: number) => { const lt = S.t - c.start, t = dir > 0 ? times.find(x => x > lt + .02) : [...times].reverse().find(x => x < lt - .02); if (t != null) { pause(); seek(c.start + t); } };
  return h('div', { class: 'btnrow' }, h('button', { onclick: () => go(-1) }, 'Previous keyframe'), h('button', { onclick: () => go(1) }, 'Next keyframe'),
    h('button', { onclick: () => { for (const p in c.kf) c[p] = val(c, p, localT(c)); delete c.kf; done(); } }, 'Remove all'));
}
const TRANS: [string, string][] = [['none', 'None (hard cut)'], ['fade', 'Crossfade'], ['dip', 'Dip to black'], ['wipe', 'Wipe'], ['slide', 'Slide over'], ['push', 'Push'], ['zoom', 'Zoom in']];
function transSection(c: any) {
  const [prev] = neighbours(S.P, c); if (!prev) return [];
  const tr = c.trans || { type: 'none', dur: .5 }, used = transDur(prev, c);
  const out: HTMLElement[] = [h("hr"), h("h2", {}, "Transition from previous clip"),
    h('div', { class: 'field' }, h('label', { htmlFor: 'f-trans' }, 'Style'),
      h('select', { id: 'f-trans', value: tr.type, onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v === 'none') delete c.trans; else c.trans = { type: v, dur: tr.dur }; done(); } }, TRANS.map(([v, l]) => h('option', { value: v }, l))))];
  if (c.trans) {
    out.push(slider('Length', c.trans, 'dur', .1, 3, .1, sec, 'trans-'));
    if (used < c.trans.dur - .01) out.push(h('p', { class: 'hint' }, `Limited to ${used.toFixed(1)}s: a transition can use at most half of each clip.`));
  }
  return out;
}

const check = (id: string, lbl: string, o: any, k: string) =>
  h('label', { class: 'chk' }, h('input', { type: 'checkbox', id, checked: o[k], onchange: (e: Event) => { o[k] = (e.target as HTMLInputElement).checked; done(); } }), lbl);
const select = (id: string, lbl: string, o: any, k: string, opts: [string, string][]) =>
  h('div', { class: 'field' }, h('label', { htmlFor: id }, lbl),
    h('select', { id, value: o[k], onchange: (e: Event) => { o[k] = (e.target as HTMLSelectElement).value; done(); } }, opts.map(([v, l]) => h('option', { value: v }, l))));
const color = (id: string, aria: string, o: any, k: string) =>
  h('input', { type: 'color', id, value: o[k], 'aria-label': aria, style: 'flex:none', oninput: (e: Event) => { o[k] = (e.target as HTMLInputElement).value; }, onchange: done });

export function renderInspector() {
  const box = $('#insp'); box.textContent = ''; live = [];
  if (S.sel.length > 1) {
    box.append(h('h2', {}, `${S.sel.length} clips selected`),
      h('p', { class: 'hint' }, 'Drag any of them on the timeline to move them together. Shift-click a clip to add or remove it.'),
      h('div', { class: 'btnrow' }, h('button', { onclick: duplicate }, 'Duplicate'), h('button', { onclick: del }, 'Delete')));
    return;
  }
  const c: any = one();
  if (!c) {
    box.append(h('h2', {}, 'Getting started'),
      h('p', { class: 'hint' }, 'Import your clips, then select a clip to trim it, add effects or change its sound. Your work is saved in this browser as you go.'),
      h('hr'), h('h2', {}, 'Shortcuts'),
      h('div', { class: 'keys' }, ...[['Space', 'Play or pause'], ['S', 'Split at playhead'], ['Del', 'Delete selection'], ['Ctrl D', 'Duplicate selection'], ['Ctrl A', 'Select all'], ['← →', 'Step one frame'], ['Ctrl Z', 'Undo']]
        .flatMap(([k, d]) => [h('span', {}, h('kbd', {}, k)), h('span', {}, d)])),
      h('hr'), h('h2', {}, 'Layers'),
      h('p', { class: 'hint' }, 'Higher tracks draw in front. Use "Layer" in the media list for picture-in-picture, then drag, resize and rotate it on the preview.'),
      h('hr'), h('h2', {}, 'On the timeline'),
      h('p', { class: 'hint' }, 'Drag a clip edge to trim. Drag clips between tracks of the same kind. Edges snap to the playhead and to other clips. Shift-click selects several.'));
    return;
  }
  const m = c.kind === 'text' ? undefined : media.get(c.mediaId);
  box.append(h('div', { class: 'kind ' + c.kind }, c.kind === 'video' ? (m?.kind === 'image' ? 'Image clip' : 'Video clip') : c.kind === 'text' ? 'Text' : 'Audio clip'));
  if (m?.missing) box.append(h('p', { class: 'warn' }, `The file "${m.name}" is not stored on this device. Import it again to relink this clip.`));

  if (c.kind === 'text') {
    box.append(
      h('div', { class: 'field' }, h('label', { htmlFor: 'f-text' }, 'Text'),
        h('textarea', { id: 'f-text', value: c.text, oninput: (e: Event) => { c.text = (e.target as HTMLTextAreaElement).value; renderTimeline(); }, onchange: done })),
      h('div', { class: 'inline' }, select('f-font', 'Font', c, 'font', FONTS.map(f => [f, f])),
        h('div', { class: 'field', style: 'flex:none' }, h('label', { htmlFor: 'f-color' }, 'Colour'), color('f-color', 'Text colour', c, 'color'))),
      aslider('Size', c, 'size', 1, 40, .5, v => v.toFixed(1) + '%'),
      check('f-bold', 'Bold', c, 'bold'),
      h('div', { class: 'inline' }, check('f-bg', 'Background box', c, 'bg'), color('f-bgc', 'Background colour', c, 'bgColor')),
      select('f-anim', 'Entrance and exit', c, 'anim', [['none', 'None'], ['fade', 'Fade'], ['slide', 'Slide up'], ['pop', 'Pop']]),
      h('hr'), h('h2', {}, 'Placement'),
      aslider('Horizontal position', c, 'x', 0, 1, .005, frac), aslider('Vertical position', c, 'y', 0, 1, .005, frac), aslider('Rotation', c, 'rot', -180, 180, 1, deg),
      slider('Duration', c, 'dur', .3, 30, .1, sec));
    if (c.cap) box.append(h('button', { onclick: () => styleAllCaptions(c) }, 'Use this style for all captions'));
  } else if (c.kind === 'video') {
    if (m?.kind === 'video') box.append(slider('Speed', c, 'speed', .25, 4, .05, v => (+v).toFixed(2) + '×'), aslider('Volume', c, 'volume', 0, 2, .01, frac), check('f-mute', 'Mute this clip', c, 'mute'));
    box.append(
      h('hr'), h('h2', {}, 'Placement'),
      select('f-fit', 'Framing', c, 'fit', [['contain', 'Fit whole picture'], ['cover', 'Fill the frame (crop)']]),
      aslider('Size', c, 'scale', .05, 4, .01, frac), aslider('Rotation', c, 'rot', -180, 180, 1, deg), aslider('Opacity', c, 'opacity', 0, 1, .01, frac),
      aslider('Horizontal position', c, 'x', 0, 1, .005, frac), aslider('Vertical position', c, 'y', 0, 1, .005, frac),
      h('button', { onclick: () => { Object.assign(c, NOXF); c.crop = noCrop(); for (const p of ['x', 'y', 'scale', 'rot', 'opacity']) delete c.kf?.[p]; if (c.kf && !Object.keys(c.kf).length) delete c.kf; done(); } }, 'Reset placement and crop'),
      h('hr'), h('h2', {}, 'Crop'),
      slider('Left', c.crop, 'l', 0, .45, .005, frac, 'crop-'), slider('Right', c.crop, 'r', 0, .45, .005, frac, 'crop-'),
      slider('Top', c.crop, 't', 0, .45, .005, frac, 'crop-'), slider('Bottom', c.crop, 'b', 0, .45, .005, frac, 'crop-'),
      ...transSection(c),
      h('hr'), h('h2', {}, 'Fades'), slider('Fade in', c, 'fadeIn', 0, 2, .1, sec), slider('Fade out', c, 'fadeOut', 0, 2, .1, sec),
      h('hr'), h('h2', {}, 'Look'),
      h('div', { class: 'chips' }, Object.keys(PRESETS).map(n => h('button', { onclick: () => { c.f = { ...NOFX, ...PRESETS[n] }; done(); } }, n))),
      slider('Brightness', c.f, 'brightness', 0, 200, 1, pct), slider('Contrast', c.f, 'contrast', 0, 200, 1, pct), slider('Saturation', c.f, 'saturate', 0, 200, 1, pct),
      slider('Warm tint', c.f, 'sepia', 0, 100, 1, pct), slider('Hue shift', c.f, 'hue', -180, 180, 1, deg), slider('Blur', c.f, 'blur', 0, 20, .5, v => v + 'px'));
  } else {
    box.append(aslider('Volume', c, 'volume', 0, 2, .01, frac), slider('Fade in', c, 'fadeIn', 0, 5, .1, sec), slider('Fade out', c, 'fadeOut', 0, 5, .1, sec));
  }
  const nav = kfNav(c);
  box.append(h('hr'), h('h2', {}, 'Keyframes'), nav || h('p', { class: 'hint' }, 'Press ◆ beside a setting to animate it: move the playhead, press ◆, change the value, and repeat.'));
  box.append(h('hr'), h('p', { class: 'hint' }, `Starts ${fmt(c.start)} · lasts ${fmt(clipDur(c))}`));
  tickInspector(true);
}
