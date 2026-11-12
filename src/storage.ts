import type { Media } from './types';

/**
 * Autosave. Everything stays in this browser's IndexedDB:
 *  - "kv"    : the project JSON
 *  - "media" : imported files (as Blobs) with their metadata
 * Storage can be unavailable or full; every call fails soft so the editor keeps working.
 */
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return dbp ??= new Promise((ok, no) => {
    const r = indexedDB.open('cutroom', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('media', { keyPath: 'id' }); };
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
}
function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then(d => new Promise<T | undefined>((ok, no) => {
    const t = d.transaction(store, mode); const r = fn(t.objectStore(store));
    t.oncomplete = () => ok(r ? r.result : undefined); t.onerror = t.onabort = () => no(t.error);
  }));
}

export async function saveProject(p: unknown): Promise<boolean> {
  try { await tx('kv', 'readwrite', s => { s.put(JSON.stringify(p), 'project'); }); return true; } catch { return false; }
}
export async function loadProject(): Promise<any> {
  try { const s = await tx<string>('kv', 'readonly', s => s.get('project')); return s ? JSON.parse(s) : null; } catch { return null; }
}
/** Returns false if the file could not be stored (usually: not enough browser storage). */
export async function saveMedia(m: Media): Promise<boolean> {
  const rec = { id: m.id, name: m.name, kind: m.kind, duration: m.duration, size: m.size, thumb: m.thumb, strip: m.strip, stripN: m.stripN, wave: m.wave, words: m.words, file: m.file };
  try { await tx('media', 'readwrite', s => { s.put(rec); }); return true; }
  catch {
    // Keep the metadata without the file so the project can ask for it again later.
    try { await tx('media', 'readwrite', s => { s.put({ ...rec, file: undefined }); }); } catch { /* ignore */ }
    return false;
  }
}
export async function loadMedia(): Promise<Media[]> {
  try { return (await tx<Media[]>('media', 'readonly', s => s.getAll())) || []; } catch { return []; }
}
export async function clearAll(): Promise<void> {
  try { await tx('kv', 'readwrite', s => { s.clear(); }); await tx('media', 'readwrite', s => { s.clear(); }); } catch { /* ignore */ }
}
