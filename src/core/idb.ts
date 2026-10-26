/**
 * Minimal IndexedDB wrapper with a localStorage fallback.
 * Stores: settings (key/value) and chat messages.
 */
import { DB_NAME, DB_VERSION } from './config';

const HAS_IDB = typeof indexedDB !== 'undefined';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('messages')) db.createObjectStore('messages', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    });
  }
  return dbPromise;
}

/* ---------- key/value (settings) ---------- */

export async function kvSet(key: string, value: unknown): Promise<void> {
  if (!HAS_IDB) return lsSet(key, value);
  const db = await openDB();
  await tx(db, 'kv', 'readwrite', (store) => store.put(value, key));
}

export async function kvGet<T>(key: string): Promise<T | null> {
  if (!HAS_IDB) return lsGet<T>(key);
  const db = await openDB();
  return tx<T | null>(db, 'kv', 'readonly', (store) => store.get(key));
}

/* ---------- messages ---------- */

export async function msgAll(): Promise<unknown[]> {
  if (!HAS_IDB) return lsGet<unknown[]>('messages') ?? [];
  const db = await openDB();
  return tx<unknown[]>(db, 'messages', 'readonly', (store) => store.getAll());
}

export async function msgAdd(msg: unknown): Promise<void> {
  if (!HAS_IDB) {
    const all = (await lsGet<unknown[]>('messages')) ?? [];
    all.push(msg);
    await lsSet('messages', all);
    return;
  }
  const db = await openDB();
  await tx(db, 'messages', 'readwrite', (store) => store.put(msg));
}

export async function msgClear(): Promise<void> {
  if (!HAS_IDB) return lsSet('messages', []);
  const db = await openDB();
  await tx(db, 'messages', 'readwrite', (store) => store.clear());
}

/* ---------- helpers ---------- */

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/* ---------- localStorage fallback ---------- */

function lsSet(key: string, value: unknown): void {
  try {
    localStorage.setItem('ultron:' + key, JSON.stringify(value));
  } catch {
    /* storage full or blocked - fail silently, app still works */
  }
}

function lsGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem('ultron:' + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Wipe everything this app stored locally. */
export async function wipeLocalData(): Promise<void> {
  try {
    if (HAS_IDB) {
      const db = await openDB();
      const t = db.transaction(['kv', 'messages'], 'readwrite');
      t.objectStore('kv').clear();
      t.objectStore('messages').clear();
    }
    Object.keys(localStorage)
      .filter((k) => k.startsWith('ultron:'))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* best effort */
  }
}
