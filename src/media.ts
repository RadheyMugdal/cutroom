import type { Media } from './types';
import { uid } from './util';

/** Media library: every imported file or generated sample, by id. */
export const media = new Map<string, Media>();

/* ---------- generated sample clips ---------- */
type GenFn = (g: CanvasRenderingContext2D, w: number, h: number, s: number) => void;
const genCv = document.createElement('canvas'); genCv.width = 640; genCv.height = 360;
const gx = genCv.getContext('2d')!;

export const GEN: Record<string, GenFn> = {
  aurora(g, w, hh, s) {
    g.fillStyle = '#0b1026'; g.fillRect(0, 0, w, hh); g.globalCompositeOperation = 'lighter';
    ([['#1f6feb', .9, .31], ['#d4609a', 1.3, .47], ['#3faa78', .7, .63], ['#ffb224', 1.1, .2]] as [string, number, number][]).forEach(([c, f, p], i) => {
      const x = w * (.5 + .38 * Math.sin(s * f * .5 + i * 1.7)), y = hh * (p + .18 * Math.cos(s * f * .4 + i)), r = w * .42;
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, c); gr.addColorStop(1, 'transparent');
      g.fillStyle = gr; g.fillRect(0, 0, w, hh);
    });
    g.globalCompositeOperation = 'source-over';
  },
  blocks(g, w, hh, s) {
    g.fillStyle = '#f3e9d8'; g.fillRect(0, 0, w, hh);
    const n = 7, cw = w / n;
    for (let i = 0; i < n; i++) {
      const k = .5 + .5 * Math.sin(s * 1.4 + i * .8);
      g.fillStyle = ['#e5645a', '#ffb224', '#4a8fd6', '#1b1e25'][i % 4];
      g.fillRect(i * cw + 6, hh * (1 - k) * .8 + 10, cw - 12, hh * .2 + hh * k * .5);
    }
    g.fillStyle = '#1b1e25'; g.beginPath(); g.arc(w * ((s * .18) % 1.2 - .1), hh * .22, hh * .08, 0, 7); g.fill();
  },
};
export function drawGen(key: string, s: number): HTMLCanvasElement { GEN[key](gx, 640, 360, s); return genCv; }
export function addGen(key: string, name: string): string {
  const id = 'gen-' + key, c = document.createElement('canvas'); c.width = 160; c.height = 90;
  GEN[key](c.getContext('2d')!, 160, 90, 1.2);
  media.set(id, { id, name, kind: 'gen', gen: key, duration: Infinity, thumb: c.toDataURL() });
  return id;
}

export const srcLen = (c: { mediaId: string }): number => {
  const m = media.get(c.mediaId);
  return m && isFinite(m.duration) ? m.duration : Infinity;
};

const kindOf = (type: string): Media['kind'] | null =>
  type.startsWith('video') ? 'video' : type.startsWith('audio') ? 'audio' : type.startsWith('image') ? 'image' : null;

/** Read a file's duration and thumbnail. Throws if the browser cannot play it. */
export async function probe(file: File): Promise<Media> {
  const kind = kindOf(file.type);
  if (!kind) throw new Error('type');
  const url = URL.createObjectURL(file);
  const m: Media = { id: uid(), name: file.name, kind, url, duration: Infinity, size: file.size, file };
  try {
    if (kind === 'image') {
      m.img = new Image(); m.img.src = url; await m.img.decode(); m.thumb = await smallThumb(m.img, m.img.naturalWidth, m.img.naturalHeight);
    } else {
      const el = document.createElement(kind) as HTMLVideoElement;
      el.preload = 'auto'; el.muted = true; el.src = url;
      await new Promise<void>((ok, no) => { el.onloadedmetadata = () => ok(); el.onerror = () => no(new Error('unsupported')); });
      if (!isFinite(el.duration)) { el.currentTime = 1e7; await new Promise<void>(ok => { el.ondurationchange = () => ok(); setTimeout(ok, 1500); }); }
      m.duration = isFinite(el.duration) ? el.duration : 10;
      if (kind === 'video') {
        el.currentTime = Math.min(.2, m.duration / 2);
        await new Promise<void>(ok => { el.onseeked = () => ok(); setTimeout(ok, 1500); });
        m.thumb = await smallThumb(el, el.videoWidth, el.videoHeight);
      }
      el.removeAttribute('src'); el.load();
    }
  } catch (e) { URL.revokeObjectURL(url); throw e; }
  return m;
}
async function smallThumb(src: CanvasImageSource, w: number, hh: number): Promise<string> {
  const c = document.createElement('canvas'); c.width = 160; c.height = 90;
  if (w && hh) { const s = Math.max(160 / w, 90 / hh); c.getContext('2d')!.drawImage(src, (160 - w * s) / 2, (90 - hh * s) / 2, w * s, hh * s); }
  return c.toDataURL('image/jpeg', .7);
}

/** Rebuild the runtime parts (object URL, decoded image) of a media record loaded from storage. */
export async function revive(m: Media): Promise<Media> {
  if (!m.file) { m.missing = true; return m; }
  m.url = URL.createObjectURL(m.file); m.missing = false;
  if (m.kind === 'image') { m.img = new Image(); m.img.src = m.url; try { await m.img.decode(); } catch { m.missing = true; } }
  return m;
}

/* ---------- timeline artwork: filmstrips and waveforms ---------- */
const TILE_W = 64, TILE_H = 36;

async function buildStrip(m: Media) {
  const el = document.createElement('video'); el.muted = true; el.preload = 'auto'; el.src = m.url!;
  await new Promise<void>((ok, no) => { el.onloadeddata = () => ok(); el.onerror = () => no(new Error('load')); setTimeout(ok, 4000); });
  const n = Math.min(30, Math.max(6, Math.ceil(m.duration / 2)));
  const c = document.createElement('canvas'); c.width = n * TILE_W; c.height = TILE_H;
  const g = c.getContext('2d')!;
  for (let i = 0; i < n; i++) {
    await new Promise<void>(ok => { el.onseeked = () => ok(); setTimeout(ok, 1500); el.currentTime = (i + .5) / n * m.duration; });
    const s = Math.max(TILE_W / el.videoWidth, TILE_H / el.videoHeight), w = el.videoWidth * s, hh = el.videoHeight * s;
    g.save(); g.beginPath(); g.rect(i * TILE_W, 0, TILE_W, TILE_H); g.clip();
    g.drawImage(el, i * TILE_W + (TILE_W - w) / 2, (TILE_H - hh) / 2, w, hh); g.restore();
  }
  el.removeAttribute('src'); el.load();
  m.strip = c.toDataURL('image/jpeg', .6); m.stripN = n;
}

async function buildWave(m: Media) {
  if (!m.file || m.file.size > 300 * 1048576) return;   // decoding is done in memory; skip very large files
  const buf = await new OfflineAudioContext(1, 1, 22050).decodeAudioData(await m.file.arrayBuffer());
  const data = buf.getChannelData(0), cols = Math.min(4000, Math.max(200, Math.ceil(buf.duration * 40))), per = data.length / cols;
  const peaks = new Float32Array(cols); let top = 0;
  for (let x = 0; x < cols; x++) {
    let pk = 0; const a = Math.floor(x * per), b = Math.min(data.length, Math.floor((x + 1) * per));
    for (let i = a; i < b; i += 8) { const v = Math.abs(data[i]); if (v > pk) pk = v; }
    peaks[x] = pk; if (pk > top) top = pk;
  }
  const c = document.createElement('canvas'); c.width = cols; c.height = TILE_H;
  const g = c.getContext('2d')!; g.fillStyle = 'rgba(255,255,255,.6)';
  // Scaled to the loudest moment, so quiet recordings still show their shape.
  for (let x = 0; x < cols; x++) { const hh = Math.max(1, peaks[x] / (top || 1) * (TILE_H - 4)); g.fillRect(x, (TILE_H - hh) / 2, 1, hh); }
  m.wave = c.toDataURL();
}

/** Build whatever timeline artwork a media item is still missing. Returns true if something was added. */
export async function enrich(m: Media): Promise<boolean> {
  if (m.missing || !m.url) return false;
  try {
    if (m.kind === 'video' && !m.strip) { await buildStrip(m); return true; }
    if (m.kind === 'audio' && !m.wave) { await buildWave(m); return !!m.wave; }
  } catch { /* artwork is optional */ }
  return false;
}

/** Artwork is attached with CSS classes so the (large) image data is written to the page once, not per clip. */
let cssSig = '';
export function refreshMediaCss() {
  const sig = [...media.values()].map(m => m.id + (m.strip ? 's' : '') + (m.wave ? 'w' : '') + (m.thumb ? 't' : '')).join('|');
  if (sig === cssSig) return;
  cssSig = sig;
  let css = '';
  for (const m of media.values()) {
    if (m.strip) css += `.strip-${m.id}{background-image:url(${m.strip});background-size:${m.stripN! * TILE_W}px ${TILE_H}px}`;
    else if (m.thumb && m.kind !== 'audio') css += `.strip-${m.id}{background-image:url(${m.thumb});background-size:${TILE_W}px ${TILE_H}px}`;
    if (m.wave) css += `.wave-${m.id}{background-image:url(${m.wave})}`;
  }
  let el = document.getElementById('mediaCss');
  if (!el) { el = document.createElement('style'); el.id = 'mediaCss'; document.head.append(el); }
  el.textContent = css;
}
