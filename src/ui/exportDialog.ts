import { S, notify, total } from '../state';
import { canExport, exportVideo } from '../export';
import { pause } from '../playback';
import { $, fmt, h } from '../util';

let out: { blob: Blob; ext: string } | null = null, cancelled = false;
const show = (id: string, on: boolean) => { $(id).hidden = !on; };

function open() {
  pause(); out = null;
  show('#dlg', true); show('#dlgSetup', true); show('#dlgRun', false); show('#exSave', false); show('#exGo', true);
  ($('#exGo') as HTMLButtonElement).disabled = !canExport();
  $('#exClose').textContent = 'Close';
  $('#exInfo').textContent = canExport()
    ? `Your video is ${fmt(total())} long. It is rendered on this device, frame by frame, and nothing is uploaded.`
    : 'This browser cannot encode video. Use a current version of Chrome or Edge.';
}

async function start() {
  const short = +($('#exRes') as HTMLSelectElement).value, fps = +($('#exFps') as HTMLSelectElement).value;
  cancelled = false; S.exporting = true; S.sel = []; notify();
  show('#dlgSetup', false); show('#dlgRun', true); show('#exGo', false);
  $('#exClose').textContent = 'Cancel'; $('#exBar').style.width = '0';
  const t0 = performance.now();
  try {
    out = await exportVideo({
      short, fps, isCancelled: () => cancelled,
      onProgress: (p, stage) => { $('#exBar').style.width = (p * 100).toFixed(1) + '%'; $('#exStatus').textContent = `${stage} ${Math.round(p * 100)}%`; },
    });
    if (!out) { show('#dlg', false); return; }
    const secs = (performance.now() - t0) / 1000;
    $('#exBar').style.width = '100%';
    $('#exStatus').textContent = `Done in ${secs.toFixed(1)}s. ${(out.blob.size / 1048576).toFixed(1)} MB ${out.ext.toUpperCase()} is ready.`;
    show('#exSave', true);
  } catch (e) {
    $('#exStatus').textContent = 'Export failed: ' + ((e as Error)?.message || 'unknown error') + ' Try 720p, or a current version of Chrome.';
  } finally {
    S.exporting = false; $('#exClose').textContent = 'Close';
  }
}

async function save() {
  if (!out) return;
  const name = 'cutroom-export.' + out.ext;
  // When hosted as a Claude artifact the page saves through the host; everywhere else a normal download works.
  let host: any = null;
  try { const c = (window as any).claude; if (c?.use) host = await c.use('downloads'); } catch { /* not hosted */ }
  if (host) {
    try { await host.save({ filename: name, data: out.blob }); $('#exStatus').textContent = 'Saved.'; }
    catch (e: any) { $('#exStatus').textContent = e?.code === 'declined' ? 'Save was cancelled. You can try again.' : 'The file could not be saved here' + (e?.message ? ': ' + e.message : '.'); }
  } else {
    const a = h('a', { href: URL.createObjectURL(out.blob), download: name }) as HTMLAnchorElement;
    document.body.append(a); a.click(); a.remove();
    $('#exStatus').textContent = 'Saved to your downloads folder.';
  }
}

export function initExportDialog() {
  $('#exportBtn').onclick = open; $('#exGo').onclick = start; $('#exSave').onclick = save;
  $('#exClose').onclick = () => { if (S.exporting) cancelled = true; else show('#dlg', false); };
}
export const exportOpen = () => !$('#dlg').hidden;
