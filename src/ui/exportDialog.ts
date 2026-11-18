import type { Aspect } from '../types';
import { S, commit, notify, total } from '../state';
import { GIF_MAX_SECONDS, canExport, exportFrame, exportGif, exportVideo, type Exported, type QualityName } from '../export';
import { pause } from '../playback';
import { $, fmt, saveFile } from '../util';

let out: Exported | null = null, cancelled = false;
const show = (id: string, on: boolean) => { $(id).hidden = !on; };
const value = (id: string) => ($(id) as HTMLSelectElement).value;

/** Show only the settings that apply to the chosen kind of export, and describe what will happen. */
function refresh() {
  const kind = value('#exKind'), ok = kind === 'png' || canExport();
  show('#exPresetRow', kind === 'video'); show('#exResRow', kind !== 'gif'); show('#exFpsBox', kind === 'video'); show('#exQRow', kind === 'video');
  ($('#exGo') as HTMLButtonElement).disabled = !ok;
  $('#exGo').textContent = kind === 'png' ? 'Save frame' : 'Start export';
  $('#exInfo').textContent = !ok ? 'This browser cannot encode video. Use a current version of Chrome or Edge.'
    : kind === 'video' ? `Your video is ${fmt(total())} long. It is rendered on this device, frame by frame, and nothing is uploaded.`
    : kind === 'gif' ? `A silent, looping GIF at 12 frames a second, up to 480 pixels wide${total() > GIF_MAX_SECONDS ? `. Only the first ${GIF_MAX_SECONDS} seconds are included` : ''}. GIFs are large: keep them short.`
    : `Saves the picture under the playhead (${fmt(S.t)}) as an image.`;
}

function open() {
  pause(); out = null;
  show('#dlg', true); show('#dlgSetup', true); show('#dlgRun', false); show('#exSave', false); show('#exGo', true);
  $('#exClose').textContent = 'Close';
  ($('#exPreset') as HTMLSelectElement).value = '';
  refresh();
}

/** A platform preset sets size and frame rate, and changes the project's frame shape if it needs to. */
function applyPreset() {
  const v = value('#exPreset'); if (!v) return;
  const [aspect, res, fps] = v.split('|');
  ($('#exRes') as HTMLSelectElement).value = res; ($('#exFps') as HTMLSelectElement).value = fps;
  if (S.P.aspect !== aspect) { S.P.aspect = aspect as Aspect; S.own = true; commit(); $('#exInfo').textContent = `The project's frame shape was changed to ${aspect} for this preset. Check your layout before exporting.`; }
}

async function start() {
  const kind = value('#exKind'), short = +value('#exRes'), fps = +value('#exFps');
  cancelled = false; S.exporting = true; S.sel = []; notify();
  show('#dlgSetup', false); show('#dlgRun', true); show('#exGo', false);
  $('#exClose').textContent = 'Cancel'; $('#exBar').style.width = '0'; $('#exStatus').textContent = 'Starting';
  const t0 = performance.now(), o = { isCancelled: () => cancelled, onProgress: (p: number, stage: string) => { $('#exBar').style.width = (p * 100).toFixed(1) + '%'; $('#exStatus').textContent = `${stage} ${Math.round(p * 100)}%`; } };
  try {
    out = kind === 'png' ? await exportFrame(short) : kind === 'gif' ? await exportGif(o) : await exportVideo({ ...o, short, fps, quality: value('#exQ') as QualityName });
    if (!out) { show('#dlg', false); return; }
    $('#exBar').style.width = '100%';
    const size = out.blob.size > 1048576 ? (out.blob.size / 1048576).toFixed(1) + ' MB' : Math.ceil(out.blob.size / 1024) + ' KB';
    $('#exStatus').textContent = `Done in ${((performance.now() - t0) / 1000).toFixed(1)}s. ${size} ${out.ext.toUpperCase()} is ready.`;
    show('#exSave', true);
  } catch (e) {
    $('#exStatus').textContent = 'Export failed: ' + ((e as Error)?.message || 'unknown error') + ' Try a lower resolution, or a current version of Chrome.';
  } finally {
    S.exporting = false; $('#exClose').textContent = 'Close';
  }
}

export function initExportDialog() {
  $('#exportBtn').onclick = open; $('#exGo').onclick = start;
  $('#exSave').onclick = async () => { if (out) $('#exStatus').textContent = await saveFile(out.blob, 'cutroom-export.' + out.ext); };
  $('#exKind').onchange = refresh; $('#exPreset').onchange = applyPreset;
  $('#exClose').onclick = () => { if (S.exporting) cancelled = true; else show('#dlg', false); };
}
export const exportOpen = () => !$('#dlg').hidden || !$('#recDlg').hidden;
