import './styles.css';
import type { Aspect, Clip, Media, TextClip, VideoClip } from './types';
import { NOFX, NOXF, S, canRedo, canUndo, commit, migrate, noCrop, notify, onChange, one, redo, total, undo } from './state';
import { addGen, media, revive } from './media';
import { initPreview, pause, play, seek, sizeCanvas, syncEls } from './playback';
import { loadMedia, loadProject, saveProject } from './storage';
import { addText, addTrackOf, del, duplicate, enrichLater, importFiles, newProject, split } from './actions';
import { initTimeline, label, renderTimeline, tickTimeline } from './ui/timeline';
import { FONTS, renderInspector, tickInspector } from './ui/inspector';
import { renderBin } from './ui/bin';
import { exportOpen, initExportDialog } from './ui/exportDialog';
import { initStage } from './ui/stage';
import { deleteSelectedWords, initTranscript, renderTranscript, tickTranscript } from './ui/transcript';
import { setEngine } from './speech';
import { $, fmt, uid } from './util';

const FPS = 30;

/* ---------- view ---------- */
function renderAll() {
  renderTimeline(); renderInspector(); renderBin(); renderTranscript();
  ($('#undo') as HTMLButtonElement).disabled = !canUndo();
  ($('#redo') as HTMLButtonElement).disabled = !canRedo();
  ($('#exportBtn') as HTMLButtonElement).disabled = !total();
  ($('#aspect') as HTMLSelectElement).value = S.P.aspect;
  const c = one();
  $('#selHint').textContent = c ? 'Selected: ' + label(c) : S.sel.length > 1 ? S.sel.length + ' clips selected' : '';
  if (!S.own) $('#projTag').textContent = 'Sample project';
}

/* ---------- autosave ---------- */
let saveTimer = 0;
function scheduleSave() {
  if (!S.own) return;                       // never overwrite a saved project with the sample
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    $('#projTag').textContent = (await saveProject(S.P)) ? 'Saved in this browser' : 'Not saved: browser storage is unavailable';
  }, 400);
}

function sampleProject() {
  const v = (mediaId: string, out: number, x: Partial<VideoClip>): VideoClip =>
    ({ id: uid(), kind: 'video', track: 'v1', mediaId, start: 0, in: 0, out, speed: 1, volume: 1, mute: false, fit: 'cover', fadeIn: 0, fadeOut: 0, f: { ...NOFX }, ...NOXF, crop: noCrop(), ...x });
  const txt = (x: Partial<TextClip>): TextClip =>
    ({ id: uid(), kind: 'text', track: 't1', text: '', start: 0, dur: 3, x: .5, y: .5, size: 8, rot: 0, font: 'Figtree', bold: false, color: '#ffffff', bg: false, bgColor: '#000000', anim: 'fade', ...x });
  S.P.clips = [
    v('gen-aurora', 5, { fadeIn: .6 }), v('gen-blocks', 4, { fadeOut: .8, trans: { type: 'fade', dur: .8 } }),
    // A picture-in-picture layer above the main track.
    v('gen-blocks', 3.2, { track: 'v2', start: 1.4, scale: .3, x: .8, y: .76, fadeIn: .3, fadeOut: .3, kf: { x: [{ t: .2, v: .2 }, { t: 2.6, v: .8 }], scale: [{ t: .2, v: .18 }, { t: 2.6, v: .3 }] } }),
    txt({ text: 'Your title here', start: .6, dur: 3.6, y: .4, size: 13, font: 'Bebas Neue', anim: 'slide' }),
    txt({ text: 'Sample project. Import your own video to begin.', start: 4.8, dur: 3.2, y: .5, size: 4.2, color: '#1b1e25' }),
    txt({ text: 'Cut. Layer. Animate.', start: 5.2, dur: 2.8, y: .82, size: 6, bold: true, color: '#1b1e25', bg: true, bgColor: '#ffb224', anim: 'pop' }),
  ];
  S.sel = [S.P.clips[2].id];
  S.t = 2.6;
}

async function boot() {
  addGen('aurora', 'Sample clip: Aurora'); addGen('blocks', 'Sample clip: Blocks');

  // Restore the last session if there is one.
  const [saved, recs] = await Promise.all([loadProject(), loadMedia()]);
  for (const r of recs) media.set(r.id, await revive(r));
  const restored = saved ? migrate(saved) : null;
  if (restored && restored.clips.length) {
    S.P = restored; S.own = true;
    // A clip whose file record is gone entirely still needs a placeholder so it can be relinked.
    for (const c of restored.clips as Clip[]) if (c.kind !== 'text' && !media.has(c.mediaId))
      media.set(c.mediaId, { id: c.mediaId, name: 'unknown file', kind: c.kind, duration: c.out, missing: true } as Media);
    $('#projTag').textContent = 'Saved in this browser';
  } else sampleProject();
  for (const m of media.values()) enrichLater(m);   // filmstrips and waveforms for files imported before they existed

  initPreview($('#cv') as HTMLCanvasElement, $('#view'),
    () => { $('#tcNow').textContent = fmt(S.t); tickTimeline(); tickInspector(); tickTranscript(); },
    () => { $('#play').textContent = S.playing ? 'Pause' : 'Play'; });
  initTimeline(); initExportDialog(); initStage($('#cv') as HTMLCanvasElement); initTranscript();
  onChange(() => { syncEls(); sizeCanvas(); renderAll(); scheduleSave(); });

  /* ---------- buttons ---------- */
  $('#play').onclick = () => (S.playing ? pause() : play());
  $('#toStart').onclick = () => { pause(); seek(0); $('#scroll').scrollLeft = 0; };
  $('#splitBtn').onclick = split; $('#delBtn').onclick = del; $('#addText').onclick = addText;
  $('#addV').onclick = () => addTrackOf('video'); $('#addT').onclick = () => addTrackOf('text'); $('#addA').onclick = () => addTrackOf('audio');
  $('#undo').onclick = undo; $('#redo').onclick = redo; $('#newBtn').onclick = newProject;
  $('#aspect').onchange = e => { S.P.aspect = (e.target as HTMLSelectElement).value as Aspect; S.own = true; commit(); };
  $('#importBtn').onclick = () => $('#file').click();
  $('#file').onchange = e => { const i = e.target as HTMLInputElement; importFiles([...(i.files || [])]); i.value = ''; };

  /* ---------- drag and drop ---------- */
  window.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', () => document.body.classList.remove('dragging'));
  window.addEventListener('drop', e => { e.preventDefault(); document.body.classList.remove('dragging'); if (e.dataTransfer?.files.length) importFiles([...e.dataTransfer.files]); });

  /* ---------- keyboard ---------- */
  window.addEventListener('keydown', e => {
    const el = e.target as HTMLInputElement;
    if (/INPUT|TEXTAREA|SELECT/.test(el.tagName) && el.type !== 'range') return;
    if (S.exporting || exportOpen()) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (k === ' ') { e.preventDefault(); S.playing ? pause() : play(); }
    else if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && k === 'y') { e.preventDefault(); redo(); }
    else if (mod && k === 'a') { e.preventDefault(); S.sel = S.P.clips.map(c => c.id); notify(); }
    else if (mod && k === 'd') { e.preventDefault(); duplicate(); }
    else if (k === 'escape') { S.sel = []; notify(); }
    else if (k === 's' && !mod) split();
    else if (k === 'delete' || k === 'backspace') { e.preventDefault(); if (!deleteSelectedWords()) del(); }
    else if (k === 'arrowleft' || k === 'arrowright') { e.preventDefault(); pause(); seek(S.t + (k === 'arrowleft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / FPS)); }
  });

  // Canvas text needs its fonts loaded before the first frame that uses them.
  FONTS.forEach(f => document.fonts?.load(`700 20px "${f}"`).catch(() => {}));
  commit();
}
boot();

// Handy when debugging from the browser console.
(window as any).cutroom = { S, media, setEngine };
