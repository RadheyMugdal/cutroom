import {
  ALL_FORMATS, AudioBufferSource, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output,
  QUALITY_HIGH, WebMOutputFormat, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec, type WrappedCanvas,
} from 'mediabunny';
import type { Media, Project, VideoClip } from './types';
import { S, layout, total } from './state';
import { media } from './media';
import { activeVideoClips, dims, gainAt, renderFrame, type FrameSource } from './render';

/**
 * Offline export. Instead of recording the preview in real time, every output frame is decoded,
 * composited and encoded as fast as the machine allows (WebCodecs), so no frame is ever dropped
 * and the tab does not need to stay visible.
 */
export interface ExportOpts {
  short: number;                 // short side in pixels: 720, 1080...
  fps: number;
  onProgress: (p: number, stage: string) => void;
  isCancelled: () => boolean;
}
export const canExport = () => typeof VideoEncoder !== 'undefined';

/** Walks forward through one clip's source frames. */
interface Cursor { advance(t: number): Promise<void>; frame(): FrameSource; close(): Promise<void> }

async function openCursor(clip: VideoClip, m: Media): Promise<Cursor> {
  // Fast path: demux and decode the file directly.
  try {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(m.file!) });
    const track = await input.getPrimaryVideoTrack();
    if (track && await track.canDecode()) {
      const it = new CanvasSink(track, { poolSize: 3 }).canvases(clip.in, clip.out + 1);
      let cur: WrappedCanvas | null = null, next: WrappedCanvas | null = null;
      const pull = async () => { const r = await it.next(); next = r.done ? null : r.value; };
      await pull();
      return {
        async advance(t) {
          while (next && next.timestamp <= t + 1e-4) { cur = next; await pull(); }
          if (!cur) cur = next;
        },
        frame: () => cur ? { src: cur.canvas, w: cur.canvas.width, h: cur.canvas.height } : null,
        async close() { await it.return(); input.dispose(); },
      };
    }
    input.dispose();
  } catch { /* fall through to the slow path */ }

  // Slow path for files WebCodecs cannot decode: seek a <video> element frame by frame.
  const el = document.createElement('video');
  el.muted = true; el.preload = 'auto'; el.src = m.url!;
  await new Promise<void>(ok => { el.onloadeddata = () => ok(); el.onerror = () => ok(); setTimeout(ok, 4000); });
  return {
    async advance(t) {
      if (Math.abs(el.currentTime - t) < 1e-3) return;
      await new Promise<void>(ok => { el.onseeked = () => ok(); setTimeout(ok, 2000); el.currentTime = t; });
    },
    frame: () => el.readyState >= 2 ? { src: el, w: el.videoWidth, h: el.videoHeight } : null,
    async close() { el.removeAttribute('src'); el.load(); },
  };
}

/** Render the whole soundtrack in one pass: clip audio, the audio track, volumes, fades and speed. */
async function mixAudio(P: Project, end: number, rate = 48000): Promise<AudioBuffer | null> {
  const jobs: { c: any; speed: number }[] = [];
  for (const c of P.clips) {
    if (c.kind === 'video') { if (media.get(c.mediaId)?.kind === 'video') jobs.push({ c, speed: c.speed }); }
    else if (c.kind === 'audio') jobs.push({ c, speed: 1 });
  }
  if (!jobs.length || end <= 0) return null;
  const off = new OfflineAudioContext(2, Math.ceil(end * rate), rate);
  const decoded = new Map<string, AudioBuffer | null>();
  let any = false;
  for (const { c, speed } of jobs) {
    const m = media.get(c.mediaId);
    if (!m?.file) continue;
    if (!decoded.has(m.id)) {
      try { decoded.set(m.id, await off.decodeAudioData(await m.file.arrayBuffer())); }
      catch { decoded.set(m.id, null); }       // e.g. a video with no audio track
    }
    const buf = decoded.get(m.id);
    if (!buf) continue;
    const node = off.createBufferSource(); node.buffer = buf; node.playbackRate.value = speed;
    // The loudness envelope (volume keyframes, fades, transition crossfades) sampled 100 times a second.
    const g = off.createGain(), s = c.start, d = (c.out - c.in) / speed, n = Math.max(2, Math.ceil(d * 100));
    const curve = new Float32Array(n); let loud = false;
    for (let i = 0; i < n; i++) { curve[i] = gainAt(P, c, i / (n - 1) * d * .9999); if (curve[i] > 0) loud = true; }
    if (!loud || d <= 0) continue;
    g.gain.value = curve[0]; g.gain.setValueCurveAtTime(curve, s, d);
    any = true;
    node.connect(g); g.connect(off.destination);
    node.start(s, c.in, c.out - c.in);
  }
  return any ? off.startRendering() : null;
}

// A yield that is not throttled when the tab is in the background (unlike setTimeout).
const breathe = () => new Promise<void>(ok => { const ch = new MessageChannel(); ch.port1.onmessage = () => ok(); ch.port2.postMessage(0); });

export async function exportVideo(o: ExportOpts): Promise<{ blob: Blob; ext: string } | null> {
  const P: Project = JSON.parse(JSON.stringify(S.P));
  layout(P);
  const end = total(P);
  const [W, H] = dims(P.aspect, o.short);
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  o.onProgress(0, 'Mixing audio');
  const audio = await mixAudio(P, end);

  let format: Mp4OutputFormat | WebMOutputFormat = new Mp4OutputFormat();
  let vcodec = await getFirstEncodableVideoCodec(format.getSupportedVideoCodecs(), { width: W, height: H });
  if (!vcodec) { format = new WebMOutputFormat(); vcodec = await getFirstEncodableVideoCodec(format.getSupportedVideoCodecs(), { width: W, height: H }); }
  if (!vcodec) throw new Error('This browser has no video encoder for this size.');
  const acodec = audio ? await getFirstEncodableAudioCodec(format.getSupportedAudioCodecs(), { numberOfChannels: 2, sampleRate: 48000 }) : null;

  const output = new Output({ format, target: new BufferTarget() });
  const vs = new CanvasSource(canvas, { codec: vcodec, bitrate: QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(vs, { frameRate: o.fps });
  let as: AudioBufferSource | null = null;
  if (audio && acodec) { as = new AudioBufferSource({ codec: acodec, bitrate: QUALITY_HIGH }); output.addAudioTrack(as); }
  await output.start();

  // Feed audio alongside video so the muxer can interleave the two.
  let audioError: unknown = null;
  const audioDone = as ? as.add(audio!).catch(e => { audioError = e; }) : Promise.resolve();

  const N = Math.max(1, Math.round(end * o.fps)), cursors = new Map<string, Cursor>();
  const closeAll = async () => { for (const c of cursors.values()) await c.close().catch(() => {}); cursors.clear(); };
  try {
    for (let i = 0; i < N; i++) {
      if (o.isCancelled()) { await closeAll(); await output.cancel(); return null; }
      const t = i / o.fps, active = activeVideoClips(P, t, end).filter(c => { const m = media.get(c.mediaId); return m?.kind === 'video' && m.file; });
      for (const [id, cur] of cursors) if (!active.some(c => c.id === id)) { await cur.close().catch(() => {}); cursors.delete(id); }
      for (const c of active) {
        let cur = cursors.get(c.id);
        if (!cur) { cur = await openCursor(c, media.get(c.mediaId)!); cursors.set(c.id, cur); }
        await cur.advance(c.in + (Math.min(t, end - 1e-4) - c.start) * c.speed);
      }
      renderFrame(ctx, W, H, P, t, end, clip => cursors.get(clip.id)?.frame() ?? null);
      await vs.add(t, 1 / o.fps);
      if (i % 6 === 0) { o.onProgress(i / N, 'Rendering'); await breathe(); }
    }
    await closeAll();
    await audioDone;
    if (audioError) throw audioError;
    o.onProgress(1, 'Finishing');
    await output.finalize();
  } catch (e) {
    await closeAll();
    if (output.state !== 'canceled' && output.state !== 'finalized') await output.cancel().catch(() => {});
    throw e;
  }
  return { blob: new Blob([output.target.buffer!], { type: format.mimeType }), ext: format.fileExtension.replace('.', '') };
}
