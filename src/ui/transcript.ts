import { S, notify } from '../state';
import { media } from '../media';
import { pause, seek } from '../playback';
import { LANGS, MODELS } from '../speech';
import { clipWords, deleteWords, makeCaptions, removeFillers, removeSilences, spokenClips, transcribeAll } from '../speechActions';
import { toast } from '../actions';
import { $, h } from '../util';

/** The Transcript tab: transcribe speech, add captions, and cut the video by deleting words. */
let tab: 'media' | 'script' = 'media';
let wsel: { clip: string; i0: number; i1: number } | null = null;   // selected words (indices in the file's transcript)
let busy = false, statusText = '', statusP = 0;
let spans: { el: HTMLElement; a: number; b: number; clip: string; i: number }[] = [], lastT = -1;

const pref = (k: string, d: string) => { try { return localStorage.getItem('cutroom.' + k) || d; } catch { return d; } };
const setPref = (k: string, v: string) => { try { localStorage.setItem('cutroom.' + k, v); } catch { /* not available */ } };
const hosted = 'claude' in window;   // the hosted preview page blocks downloads from other sites, including the speech model

function showTab(t: 'media' | 'script') {
  tab = t;
  $('#paneMedia').hidden = t !== 'media'; $('#paneScript').hidden = t !== 'script';
  $('#tabM').classList.toggle('on', t === 'media'); $('#tabS').classList.toggle('on', t === 'script');
  renderTranscript();
}

async function runTranscribe() {
  busy = true; statusText = 'Starting'; statusP = 0; renderTranscript();
  const bar = () => { const s = document.getElementById('asrStatus'), b = document.getElementById('asrBar'); if (s) s.textContent = statusText; if (b) b.style.width = (statusP * 100).toFixed(0) + '%'; };
  try {
    const n = await transcribeAll({ model: pref('model', MODELS[0][0]), lang: pref('lang', 'auto') }, (t, p) => { statusText = t; statusP = p; bar(); });
    toast(n ? 'Transcript ready.' : 'Everything on the timeline is already transcribed.');
  } catch (e) {
    toast('Transcription failed: ' + ((e as Error).message || 'unknown error').slice(0, 140).replace(/\.?$/, '.')
      + (hosted ? ' This hosted page blocks the model download; use the local version.' : ' The speech model is downloaded on first use, so check your connection.'));
  }
  busy = false; renderTranscript();
}

function paintSel() {
  for (const s of spans) s.el.classList.toggle('sel', !!wsel && s.clip === wsel.clip && s.i >= wsel.i0 && s.i <= wsel.i1);
  const b = document.getElementById('delWords') as HTMLButtonElement | null; if (b) b.disabled = !wsel;
}

/** Delete the selected words. Returns false if no words are selected, so the Delete key can fall through to clips. */
export function deleteSelectedWords(): boolean {
  if (tab !== 'script' || !wsel) return false;
  const s = wsel; wsel = null; deleteWords(s.clip, s.i0, s.i1); return true;
}

export function renderTranscript() {
  if (tab !== 'script') return;
  const box = $('#paneScript'); box.textContent = ''; spans = []; lastT = -1;
  const clips = spokenClips().sort((p, q) => p.start - q.start);
  const files = [...new Set(clips.map(c => media.get(c.mediaId)!))], todo = files.filter(m => !m.words).length, any = files.some(m => m.words);
  if (wsel && !clips.some(c => c.id === wsel!.clip)) wsel = null;

  const sel = (id: string, lbl: string, key: string, opts: [string, string][], d: string) =>
    h('div', { class: 'field' }, h('label', { htmlFor: id }, lbl), h('select', { id, value: pref(key, d), onchange: (e: Event) => setPref(key, (e.target as HTMLSelectElement).value) }, opts.map(([v, l]) => h('option', { value: v }, l))));
  box.append(h('h2', {}, 'Speech to text'));
  if (hosted) box.append(h('p', { class: 'warn' }, 'Transcription needs to download a speech model, which this hosted preview page blocks. It works in the local version (npm run dev). Silence removal works here.'));
  box.append(sel('asrModel', 'Quality', 'model', MODELS, MODELS[0][0]), sel('asrLang', 'Spoken language', 'lang', LANGS, 'auto'),
    h('button', { class: 'primary', disabled: busy || !todo, onclick: runTranscribe }, busy ? 'Working…' : !files.length ? 'Add a clip with speech first' : todo ? (any ? `Transcribe ${todo} more file${todo > 1 ? 's' : ''}` : 'Transcribe speech') : 'Transcribed'));
  if (busy) box.append(h('div', { class: 'bar' }, h('i', { id: 'asrBar', style: `width:${statusP * 100}%` })), h('p', { class: 'hint', id: 'asrStatus' }, statusText));
  else if (!any) box.append(h('p', { class: 'hint' }, 'Runs on this device. The model is downloaded once and then kept by the browser. Nothing you import is uploaded.'));

  box.append(h('hr'), h('h2', {}, 'Tools'),
    h('div', { class: 'btnrow' },
      h('button', { disabled: !any, onclick: () => makeCaptions() }, S.P.clips.some(c => c.kind === 'text' && c.cap) ? 'Update captions' : 'Add captions'),
      h('button', { onclick: removeSilences, title: 'Cut pauses longer than about half a second from the selected clips, or from the main track' }, 'Remove silences')),
    h('div', { class: 'btnrow' },
      h('button', { id: 'delWords', disabled: !wsel, onclick: deleteSelectedWords }, 'Delete selected words'),
      h('button', { disabled: !any, onclick: removeFillers }, 'Remove filler words')));

  if (any) {
    box.append(h('hr'), h('h2', {}, 'Transcript'), h('p', { class: 'hint' }, 'Click a word to jump there. Shift-click another to select a range, then delete it to cut the video.'));
    for (const c of clips) {
      const words = clipWords(c); if (!words.length) continue;
      const p = h('p', { class: 'script' });
      for (const w of words) {
        const el = h('span', { class: 'w', onclick: (e: MouseEvent) => {
          pause(); seek(w.a + .001);
          if (e.shiftKey && wsel && wsel.clip === c.id) wsel = { clip: c.id, i0: Math.min(wsel.i0, w.i), i1: Math.max(wsel.i1, w.i) };
          else wsel = wsel && wsel.clip === c.id && wsel.i0 === w.i && wsel.i1 === w.i ? null : { clip: c.id, i0: w.i, i1: w.i };
          if (S.sel.length) { S.sel = []; notify(); } else paintSel();
        } }, w.w);
        p.append(el, ' '); spans.push({ el, a: w.a, b: w.b, clip: c.id, i: w.i });
      }
      box.append(h('div', { class: 'scriptHead' }, media.get(c.mediaId)!.name), p);
    }
    paintSel();
  }
}

/** Called every frame: highlight the word being spoken. */
export function tickTranscript() {
  if (tab !== 'script' || !spans.length || S.t === lastT) return;
  lastT = S.t;
  for (const s of spans) s.el.classList.toggle('now', S.t >= s.a && S.t < s.b);
}

export function initTranscript() {
  $('#tabM').onclick = () => showTab('media'); $('#tabS').onclick = () => showTab('script');
}
