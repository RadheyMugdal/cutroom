import { media, refreshMediaCss } from '../media';
import { addMediaToTimeline } from '../actions';
import { $, fmt, h } from '../util';

export function renderBin() {
  refreshMediaCss();
  const box = $('#mediaList'); box.textContent = '';
  for (const m of media.values()) {
    const meta = m.missing ? 'missing, import again' : m.kind === 'gen' ? 'sample' : isFinite(m.duration) ? fmt(m.duration) : m.kind;
    box.append(h('div', { class: 'media' },
      h('div', { class: 'th', style: m.thumb ? `background-image:url(${m.thumb})` : '' }, m.kind === 'audio' ? '♪' : ''),
      h('div', { class: 'nm' }, h('b', { title: m.name }, m.name), h('span', {}, meta)),
      h('div', { class: 'acts' },
        h('button', { title: m.kind === 'audio' ? 'Add to an audio track at the playhead' : 'Add to the end of the main track', disabled: !!m.missing, onclick: () => addMediaToTimeline(m.id) }, 'Add'),
        m.kind === 'audio' ? null : h('button', { title: 'Add as a layer above the main track (picture-in-picture)', disabled: !!m.missing, onclick: () => addMediaToTimeline(m.id, true) }, 'Layer'))));
  }
}
