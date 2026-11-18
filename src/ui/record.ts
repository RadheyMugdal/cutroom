import { S } from '../state';
import { pause, play } from '../playback';
import { importFiles, toast } from '../actions';
import { $, fmt, hosted } from '../util';

/** Record the screen, the camera or a voiceover, and drop the result onto the timeline. */
type Kind = 'screen' | 'camera' | 'voice';
let rec: MediaRecorder | null = null, stream: MediaStream | null = null, timer = 0, count = 0;
const show = (id: string, on: boolean) => { $(id).hidden = !on; };
const kind = () => ($('#recKind') as HTMLSelectElement).value as Kind;
const pick = (list: string[]) => list.find(m => MediaRecorder.isTypeSupported(m)) || '';

function idle(msg = '') {
  clearInterval(timer); rec = null;
  stream?.getTracks().forEach(t => t.stop()); stream = null;
  const v = $('#recView') as HTMLVideoElement; v.srcObject = null; show('#recView', false);
  $('#recGo').textContent = 'Start recording'; $('#recClose').textContent = 'Close';
  ($('#recKind') as HTMLSelectElement).disabled = false;
  show('#recPlayRow', kind() === 'voice');
  $('#recStatus').textContent = msg || (kind() === 'voice' ? 'Wear headphones if the timeline plays while you record, so its sound is not picked up.'
    : kind() === 'screen' ? 'Your browser will ask which screen, window or tab to share.' : 'Your browser will ask to use the camera and microphone.');
}

async function start() {
  const k = kind(), t0 = S.t;
  try {
    stream = k === 'screen' ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      : await navigator.mediaDevices.getUserMedia({ video: k === 'camera', audio: true });
  } catch (e) { return idle((e as Error).name === 'NotAllowedError' ? 'Permission was not given, so nothing was recorded.' : 'Could not start recording: ' + (e as Error).message); }
  const video = k !== 'voice';
  const mime = video ? pick(['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']) : pick(['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']);
  const chunks: Blob[] = [];
  try { rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
  catch (e) { return idle('This browser cannot record that source.'); }
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = async () => {
    const type = (rec?.mimeType || mime || (video ? 'video/webm' : 'audio/webm')).split(';')[0];
    pause(); idle();
    if (!chunks.length) return toast('Nothing was recorded.');
    const name = `${k === 'screen' ? 'Screen recording' : k === 'camera' ? 'Camera recording' : 'Voiceover'} ${++count}.${type.includes('mp4') ? (video ? 'mp4' : 'm4a') : 'webm'}`;
    show('#recDlg', false);
    if (k === 'voice') S.t = t0;   // a voiceover lands where the playhead was when recording began
    await importFiles([new File(chunks, name, { type })]);
  };
  stream.getVideoTracks()[0]?.addEventListener('ended', stop);   // the user pressed the browser's own "Stop sharing"
  if (video) { const v = $('#recView') as HTMLVideoElement; v.srcObject = stream; v.play().catch(() => {}); show('#recView', true); }
  rec.start(1000);
  if (k === 'voice' && ($('#recPlay') as HTMLInputElement).checked) play();
  const began = performance.now();
  ($('#recKind') as HTMLSelectElement).disabled = true;
  $('#recGo').textContent = 'Stop and add to timeline'; $('#recClose').textContent = 'Discard';
  timer = window.setInterval(() => { $('#recStatus').textContent = 'Recording ' + fmt((performance.now() - began) / 1000).slice(0, -3); }, 250);
}
function stop() { if (rec && rec.state !== 'inactive') rec.stop(); }

export function initRecord() {
  const can = !hosted && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  const btn = $('#recBtn') as HTMLButtonElement;
  if (!can) { btn.disabled = true; btn.title = hosted ? 'Recording is blocked on this hosted preview page. It works in the local version.' : 'This browser cannot record.'; return; }
  btn.onclick = () => { pause(); show('#recDlg', true); idle(); };
  $('#recKind').onchange = () => idle();
  $('#recGo').onclick = () => (rec ? stop() : start());
  $('#recClose').onclick = () => {
    if (rec) { rec.onstop = null; rec.stop(); pause(); idle(); }   // discard
    show('#recDlg', false);
  };
}
