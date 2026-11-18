export const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
export const esc = (s: unknown) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const fmt = (s: number) => {
  s = Math.max(0, s);
  const m = Math.floor(s / 60), r = s - m * 60;
  return m + ':' + String(Math.floor(r)).padStart(2, '0') + '.' + String(Math.floor((r % 1) * 100)).padStart(2, '0');
};

/** Tiny DOM builder: h('button', {class:'x', onclick}, 'Label') */
export function h(tag: string, props?: Record<string, any> | null, ...kids: any[]): HTMLElement {
  const e = document.createElement(tag) as any;
  kids.flat().forEach(k => k != null && e.append(k));
  for (const k in props || {}) {
    const v = props![k];
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  return e;
}

/** True on the hosted Claude preview page, which limits downloads, recording and requests to other sites. */
export const hosted = 'claude' in window;

/** Hand a generated file to the user. Returns a short status sentence. */
export async function saveFile(blob: Blob, name: string): Promise<string> {
  // The hosted preview saves through its host; everywhere else a normal download works.
  let host: any = null;
  try { const c = (window as any).claude; if (c?.use) host = await c.use('downloads'); } catch { /* not hosted */ }
  if (host) {
    try { await host.save({ filename: name, data: blob }); return 'Saved.'; }
    catch (e: any) { return e?.code === 'declined' ? 'Save was cancelled. You can try again.' : 'The file could not be saved here' + (e?.message ? ': ' + e.message : '.'); }
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: name }) as HTMLAnchorElement;
  document.body.append(a); a.click(); a.remove();
  return 'Saved to your downloads folder.';
}
