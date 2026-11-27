// Painted stop pictures (and the narration clip), kept on this device (IndexedDB) so an evening that comes back after a reload or an
// app relaunch shows the same pictures without painting them again. The page snapshot keeps only the key.
// Best effort: any failure just means the card offers "Show picture" again.

const DB_NAME = 'eve-pictures';
const STORE = 'pictures';
const MAX_PICTURES = 12;

interface Picture {
  key: string;
  data: string;
  mime: string;
  at: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        try {
          req.result.createObjectStore(STORE, { keyPath: 'key' });
        } catch {
          /* already there */
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

/** The picture's identity: the same stop in the same city and vibe paints the same scene. */
export function pictureKey(stop: { name: string; kind: string; oneLineVibe: string }, city: string, vibe: string): string {
  return [city, vibe, stop.kind, stop.name, stop.oneLineVibe].join('|').slice(0, 400);
}

export async function putPicture(key: string, data: string, mime: string): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.put({ key, data, mime, at: Date.now() } satisfies Picture);
      // Keep only the newest few.
      const all = store.getAll();
      all.onsuccess = () => {
        const list = (all.result as Picture[]).sort((a, b) => b.at - a.at);
        for (const old of list.slice(MAX_PICTURES)) store.delete(old.key);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    /* ignore */
  }
}

export async function getPicture(key: string): Promise<{ data: string; mime: string } | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => {
        const p = req.result as Picture | undefined;
        resolve(p && typeof p.data === 'string' && p.data ? { data: p.data, mime: p.mime || 'image/png' } : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Deletes every picture and narration clip kept on this device ("Delete my account and data"). */
export async function clearPictures(): Promise<void> {
  try {
    const db = await (dbPromise ?? Promise.resolve(null));
    db?.close();
    dbPromise = null;
    if (typeof indexedDB === 'undefined') return;
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      // Another Eve tab still has it open: it goes once that tab closes.
      req.onblocked = () => resolve();
    });
  } catch {
    /* ignore */
  }
}
