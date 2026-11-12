import type { Box } from '../types';
import { S, commit, localT, notify, one, setProp, val } from '../state';
import { boxes, canvasScale, canvasSize, pause } from '../playback';
import { HANDLE, ROT_OFFSET, toLocal } from '../render';
import { clamp } from '../util';

/**
 * Direct manipulation on the preview: click a picture or text to select it, drag to move,
 * drag a corner to resize, drag the round handle to rotate.
 */
type Mode = 'move' | 'scale' | 'rot';
interface Drag { mode: Mode; c: any; o: any; x0: number; y0: number; box: Box; moved: boolean }

const inside = (b: Box, x: number, y: number) => { const [lx, ly] = toLocal(b, x, y); return Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2; };
function handleAt(b: Box, x: number, y: number, k: number): Mode | null {
  const [lx, ly] = toLocal(b, x, y), r = (HANDLE + 4) * k;
  if (Math.hypot(lx, ly + b.h / 2 + ROT_OFFSET * k) < r) return 'rot';
  if (Math.abs(Math.abs(lx) - b.w / 2) < r && Math.abs(Math.abs(ly) - b.h / 2) < r) return 'scale';
  return null;
}

export function initStage(cv: HTMLCanvasElement) {
  let d: Drag | null = null;
  const pt = (e: PointerEvent) => { const r = cv.getBoundingClientRect(), [W, H] = canvasSize(); return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H] as const; };

  cv.addEventListener('pointerdown', e => {
    if (S.exporting) return;
    const [x, y] = pt(e), k = canvasScale(), cur = one(), curBox = cur && boxes.find(b => b.id === cur.id);
    let mode: Mode | null = curBox ? handleAt(curBox, x, y, k) : null, box = curBox;
    if (!mode) {
      box = [...boxes].reverse().find(b => inside(b, x, y));    // topmost thing under the pointer
      if (!box) { if (S.sel.length) { S.sel = []; notify(); } return; }
      mode = 'move';
      if (!S.sel.includes(box.id) || S.sel.length > 1) { S.sel = [box.id]; notify(); }
    }
    pause();
    const c: any = S.P.clips.find(q => q.id === box!.id);
    const lt = localT(c), prop = c.kind === 'text' ? 'size' : 'scale';
    d = { mode, c, o: { x: val(c, 'x', lt), y: val(c, 'y', lt), size: val(c, prop, lt) }, x0: x, y0: y, box: { ...box! }, moved: false };
    cv.setPointerCapture(e.pointerId);
  });

  cv.addEventListener('pointermove', e => {
    if (!d) return;
    const [x, y] = pt(e), [W, H] = canvasSize(), { c, o, box } = d, lt = localT(c);
    d.moved = true;
    if (d.mode === 'move') {
      let nx = o.x + (x - d.x0) / W, ny = o.y + (y - d.y0) / H;
      const sv = Math.abs(nx - .5) < .012, sh = Math.abs(ny - .5) < .012;   // snap to the frame centre
      if (sv) nx = .5; if (sh) ny = .5;
      S.guides = { v: sv, h: sh };
      setProp(c, 'x', clamp(nx, -.5, 1.5), lt); setProp(c, 'y', clamp(ny, -.5, 1.5), lt);
    } else if (d.mode === 'scale') {
      const ratio = Math.hypot(x - box.cx, y - box.cy) / Math.max(1, Math.hypot(d.x0 - box.cx, d.y0 - box.cy));
      if (c.kind === 'text') setProp(c, 'size', clamp(o.size * ratio, 1, 60), lt); else setProp(c, 'scale', clamp(o.size * ratio, .05, 8), lt);
    } else {
      let a = Math.atan2(y - box.cy, x - box.cx) * 180 / Math.PI + 90;
      const near = Math.round(a / 45) * 45; if (Math.abs(a - near) < 3) a = near;   // snap to 45° steps
      setProp(c, 'rot', ((a + 180) % 360 + 360) % 360 - 180, lt);
    }
  });

  const end = () => { if (d?.moved) { S.own = true; commit(); } d = null; S.guides = { v: false, h: false }; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
}
