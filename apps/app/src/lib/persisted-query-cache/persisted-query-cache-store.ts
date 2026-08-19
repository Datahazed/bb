/**
 * Storage backends for the persisted query cache. The cache is one opaque
 * JSON string under a fixed key, so the backend contract is deliberately tiny:
 * read the blob, replace the blob, or drop it. IndexedDB is the production
 * backend (localStorage is synchronous on the main thread and capped at a few
 * MB on iOS); the memory backend backs tests and any environment without
 * IndexedDB.
 */

export interface PersistedQueryCacheStore {
  /** The stored blob, or null when nothing has been written (or it is unreadable). */
  read(): Promise<string | null>;
  /** Replace the stored blob. Rejects on quota or backend failure. */
  write(value: string): Promise<void>;
  /** Drop the stored blob. Never rejects. */
  clear(): Promise<void>;
}

const IDB_DATABASE_NAME = "bb-query-cache";
const IDB_DATABASE_VERSION = 1;
const IDB_STORE_NAME = "snapshots";
const IDB_SNAPSHOT_KEY = "client";

export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(IDB_DATABASE_NAME, IDB_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

async function withDatabase<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(IDB_STORE_NAME, mode);
    const result = await run(
      transaction.objectStore(IDB_STORE_NAME),
      transaction,
    );
    return result;
  } finally {
    // Every call opens and closes its own connection so a lingering handle
    // never blocks a future version upgrade or a `clear()` from another tab.
    db.close();
  }
}

export function createIndexedDbPersistedQueryCacheStore(): PersistedQueryCacheStore {
  return {
    async read() {
      try {
        return await withDatabase("readonly", async (store) => {
          const value: unknown = await requestToPromise(
            store.get(IDB_SNAPSHOT_KEY),
          );
          return typeof value === "string" ? value : null;
        });
      } catch {
        return null;
      }
    },
    async write(value) {
      await withDatabase("readwrite", async (store, transaction) => {
        // Await the request itself, not just the transaction: a failed put
        // aborts the transaction, but the abort event's `error` can still be
        // null while the request's is the real `QuotaExceededError`, which the
        // persister needs to see to clear the store.
        await requestToPromise(store.put(value, IDB_SNAPSHOT_KEY));
        await transactionDone(transaction);
      });
    },
    async clear() {
      try {
        await withDatabase("readwrite", async (store, transaction) => {
          store.delete(IDB_SNAPSHOT_KEY);
          await transactionDone(transaction);
        });
      } catch {
        // Nothing to recover: an unreadable database has nothing to hydrate
        // from either, and the next successful write replaces the key.
      }
    },
  };
}

export function createMemoryPersistedQueryCacheStore(
  initialValue: string | null = null,
): PersistedQueryCacheStore & { readonly value: string | null } {
  let value = initialValue;
  return {
    get value() {
      return value;
    },
    read: () => Promise.resolve(value),
    write: (next) => {
      value = next;
      return Promise.resolve();
    },
    clear: () => {
      value = null;
      return Promise.resolve();
    },
  };
}
