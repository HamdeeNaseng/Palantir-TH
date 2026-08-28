import { SNAPSHOT_SCHEMA, type Snapshot } from "./snapshot";

/**
 * Where the browser keeps the dataset between visits.
 *
 * IndexedDB, not `localStorage`, and not by preference: the projected snapshot
 * is ~5.1 MB of JSON, and `localStorage` caps out around 5 MB per origin —
 * stored as UTF-16, so the real ceiling is lower still, and the failure mode is
 * a thrown `QuotaExceededError` on a synchronous main-thread write. IndexedDB
 * takes structured clones (no stringify, no parse on the way back), has a
 * quota measured in hundreds of megabytes, and does its work off the main
 * thread. `sessionStorage` would also mean re-downloading on every new tab.
 *
 * Every failure here is non-fatal by design. Private-mode windows, a browser
 * with site data blocked, a full disk, and Safari's periodic eviction all
 * surface as a rejected request; the caller treats that as "no cache" and
 * fetches from the network, which is exactly what it would do on a cold start.
 */

const DB_NAME = "palantir-th";
const DB_VERSION = 1;
const STORE = "snapshot";
/** One row, overwritten in place — this is a cache of the whole dataset. */
const KEY = "current";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    // Another tab is holding an older version open. Rather than hang, give up
    // and let the caller go to the network.
    request.onblocked = () => reject(new Error("IndexedDB blocked by another tab"));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
        transaction.oncomplete = () => db.close();
        transaction.onabort = () => {
          db.close();
          reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
        };
      }),
  );
}

/**
 * The cached snapshot, or null when there is none to use.
 *
 * A row written by an older build is discarded rather than returned: the
 * client-side view models would read fields it may not have, and re-fetching
 * 372 KB is cheaper than any migration this cache could ever justify.
 */
export async function readCachedSnapshot(): Promise<Snapshot | null> {
  try {
    const row = await tx<Snapshot | undefined>("readonly", (store) => store.get(KEY));
    if (!row || row.schema !== SNAPSHOT_SCHEMA) return null;
    return row;
  } catch {
    return null;
  }
}

/** Best-effort write. A rejected quota or a private window is not an error here. */
export async function writeCachedSnapshot(snapshot: Snapshot): Promise<void> {
  try {
    await tx("readwrite", (store) => store.put(snapshot, KEY));
  } catch {
    // Intentionally swallowed: the app works without a cache, just colder.
  }
}

/** Drops the cached row — used when a snapshot fails to parse or is rejected. */
export async function clearCachedSnapshot(): Promise<void> {
  try {
    await tx("readwrite", (store) => store.delete(KEY));
  } catch {
    // Nothing to do; the next read discards whatever is there on schema check.
  }
}
