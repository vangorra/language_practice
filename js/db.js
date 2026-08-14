// IndexedDB-backed persistence.
//
// The word list is meant to grow into the thousands, and every match
// touches exactly one word's state — re-serializing and rewriting a
// single giant localStorage blob on every match doesn't scale well on a
// phone. IndexedDB stores one record per word, so a write only ever
// touches the row that actually changed.
//
// Two object stores:
//   wordStates  - keyed by word id, holds each word's SRS state
//   history     - keyed by a 'YYYY-MM-DD' date string, holds that day's
//                 review counts (for the streak/chart in the Stats view)
//
// Every function here returns a Promise. If IndexedDB isn't available at
// all (very old browsers, some locked-down embedded webviews), we fall
// back to an in-memory store so the app still runs for the session —
// just without persistence — rather than crashing outright.

const DB_NAME = 'spanish-vocab-matcher';
const DB_VERSION = 1;
const WORD_STATES_STORE = 'wordStates';
const HISTORY_STORE = 'history';

let dbPromise = null;
let memoryFallback = null; // { wordStates: Map, history: Map } if IndexedDB is unavailable

function useMemoryFallback() {
  if (!memoryFallback) {
    memoryFallback = { wordStates: new Map(), history: new Map() };
    console.warn('IndexedDB is unavailable; progress will not persist across reloads.');
  }
  return memoryFallback;
}

function openDB() {
  if (memoryFallback) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  if (typeof indexedDB === 'undefined') {
    useMemoryFallback();
    return Promise.resolve(null);
  }

  dbPromise = new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      useMemoryFallback();
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WORD_STATES_STORE)) {
        db.createObjectStore(WORD_STATES_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(HISTORY_STORE)) {
        db.createObjectStore(HISTORY_STORE, { keyPath: 'date' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.warn('Failed to open IndexedDB, falling back to in-memory storage.', request.error);
      useMemoryFallback();
      resolve(null);
    };
  });

  return dbPromise;
}

function withStore(storeName, mode, fn) {
  return openDB().then((db) => {
    if (!db) {
      // Memory fallback path: `fn` is called with a tiny shim that mimics
      // just enough of the IDBObjectStore surface we use below. Unwrap the
      // same way the real-IndexedDB branch does, so callers see identical
      // shapes regardless of which path ran.
      const store = useMemoryFallback()[storeName === WORD_STATES_STORE ? 'wordStates' : 'history'];
      const shimResult = fn({
        get: (key) => ({ result: store.get(key) }),
        getAll: () => ({ result: [...store.values()] }),
        put: (value) => {
          store.set(value.id ?? value.date, value);
          return {};
        },
        delete: (key) => {
          store.delete(key);
          return {};
        },
        clear: () => {
          store.clear();
          return {};
        },
      });
      return shimResult?.result ?? shimResult;
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try {
        result = fn(store);
      } catch (err) {
        reject(err);
        return;
      }
      tx.oncomplete = () => resolve(result?.result ?? result);
      tx.onerror = () => reject(tx.error);
    });
  });
}

/** @returns {Promise<Object.<string, object>>} map of wordId -> saved SRS state */
export async function getAllWordStates() {
  const rows = await withStore(WORD_STATES_STORE, 'readonly', (store) => store.getAll());
  const map = {};
  for (const row of rows ?? []) {
    const { id, ...state } = row;
    map[id] = state;
  }
  return map;
}

/** Persist a single word's state. Fire-and-forget from the caller's perspective is fine. */
export function putWordState(id, state) {
  return withStore(WORD_STATES_STORE, 'readwrite', (store) => store.put({ id, ...state }));
}

export function clearWordStates() {
  return withStore(WORD_STATES_STORE, 'readwrite', (store) => store.clear());
}

/** @returns {Promise<Object.<string, object>>} map of date -> that day's history record */
export async function getHistoryAll() {
  const rows = await withStore(HISTORY_STORE, 'readonly', (store) => store.getAll());
  const map = {};
  for (const row of rows ?? []) {
    const { date, ...rest } = row;
    map[date] = rest;
  }
  return map;
}

export function putHistoryDay(date, record) {
  return withStore(HISTORY_STORE, 'readwrite', (store) => store.put({ date, ...record }));
}

export function clearHistory() {
  return withStore(HISTORY_STORE, 'readwrite', (store) => store.clear());
}
