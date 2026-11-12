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
