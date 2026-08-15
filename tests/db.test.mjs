import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import * as db from '../js/db.js';

// db.js caches its IndexedDB connection at module scope (a real singleton --
// a real app only ever opens the database once, and never closes it). A
// static import shares that one connection across every "happy path" test
// below, so each clears both stores first rather than getting a fresh
// database: real IndexedDB (and fake-indexeddb, which polyfills it
// faithfully) blocks deleteDatabase until every open connection on it is
// closed, and db.js never closes its connection.
test.beforeEach(async () => {
  await db.clearWordStates();
  await db.clearHistory();
});

test('getAllWordStates / getHistoryAll start empty', async () => {
  assert.deepEqual(await db.getAllWordStates(), {});
  assert.deepEqual(await db.getHistoryAll(), {});
});

test('putWordState / getAllWordStates round-trip, keyed by id', async () => {
  await db.putWordState('hola', { timesSeen: 3, ef: 2.5 });
  await db.putWordState('adios', { timesSeen: 1, ef: 2.3 });
  const states = await db.getAllWordStates();
  assert.deepEqual(states, {
    hola: { timesSeen: 3, ef: 2.5 },
    adios: { timesSeen: 1, ef: 2.3 },
  });
});

test('putWordState overwrites an existing id', async () => {
  await db.putWordState('hola', { timesSeen: 1 });
  await db.putWordState('hola', { timesSeen: 2 });
  const states = await db.getAllWordStates();
  assert.deepEqual(states, { hola: { timesSeen: 2 } });
});

test('clearWordStates empties the store', async () => {
  await db.putWordState('hola', { timesSeen: 1 });
  await db.clearWordStates();
  assert.deepEqual(await db.getAllWordStates(), {});
});

test('putHistoryDay / getHistoryAll round-trip, keyed by date', async () => {
  await db.putHistoryDay('2026-01-01', { reviews: 5, clean: 4 });
  await db.putHistoryDay('2026-01-02', { reviews: 2, clean: 1 });
  const history = await db.getHistoryAll();
  assert.deepEqual(history, {
    '2026-01-01': { reviews: 5, clean: 4 },
    '2026-01-02': { reviews: 2, clean: 1 },
  });
});

test('clearHistory empties the store', async () => {
  await db.putHistoryDay('2026-01-01', { reviews: 5 });
  await db.clearHistory();
  assert.deepEqual(await db.getHistoryAll(), {});
});

test('rejects if the store operation itself throws synchronously (e.g. a non-cloneable value)', async () => {
  await assert.rejects(
    () => db.putWordState('hola', { fn: () => {} }),
    /could not be cloned/
  );
});

test('rejects if the transaction fails asynchronously after the operation was queued', async (t) => {
  // Distinct from the synchronous-throw case above: here fn(store) succeeds
  // (the request was queued fine), but the transaction itself later aborts
  // -- e.g. a quota error. db.js listens for that via tx.onerror separately
  // from the per-request failure. A fake db/transaction stands in for a
  // real one so this can be triggered directly rather than chasing a real
  // IndexedDB failure mode; the onerror setter fires the handler on the
  // next microtask, after withStore has had a chance to assign it, so
  // there's no timing race with the real assignment.
  const savedIndexedDB = globalThis.indexedDB;
  const fakeTx = {
    objectStore: () => ({ getAll: () => ({}) }),
    oncomplete: null,
    error: new Error('simulated transaction failure'),
    set onerror(handler) {
      queueMicrotask(handler);
    },
  };
  globalThis.indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = { transaction: () => fakeTx };
        request.onsuccess?.();
      });
      return request;
    },
  };
  try {
    const freshDb = await import(`../js/db.js?instance=${counter++}`);
    await assert.rejects(freshDb.getAllWordStates(), /simulated transaction failure/);
  } finally {
    globalThis.indexedDB = savedIndexedDB;
  }
});

test('word states and history are independent stores', async () => {
  await db.putWordState('hola', { timesSeen: 1 });
  await db.putHistoryDay('2026-01-01', { reviews: 1 });
  await db.clearWordStates();
  assert.deepEqual(await db.getAllWordStates(), {});
  assert.deepEqual(await db.getHistoryAll(), { '2026-01-01': { reviews: 1 } });
});

// --- In-memory fallback (IndexedDB unavailable) -----------------------
//
// These need a genuinely fresh module instance each time (a cache-busting
// query string does that for Node ESM) since they're specifically testing
// what db.js does the *first* time it discovers IndexedDB is unavailable or
// broken -- module-scope state that the static import above has already
// moved past. None of them touch the shared fake-indexeddb connection
// above, so there's no deleteDatabase/close concern here.
let counter = 0;

test('falls back to an in-memory store when indexedDB is unavailable, and still round-trips', async (t) => {
  const savedIndexedDB = globalThis.indexedDB;
  const warnings = [];
  t.mock.method(console, 'warn', (msg) => warnings.push(msg));
  delete globalThis.indexedDB;
  try {
    const freshDb = await import(`../js/db.js?instance=${counter++}`);
    assert.deepEqual(await freshDb.getAllWordStates(), {});

    await freshDb.putWordState('hola', { timesSeen: 1 });
    assert.deepEqual(await freshDb.getAllWordStates(), { hola: { timesSeen: 1 } });

    await freshDb.putHistoryDay('2026-01-01', { reviews: 1 });
    assert.deepEqual(await freshDb.getHistoryAll(), { '2026-01-01': { reviews: 1 } });

    await freshDb.clearWordStates();
    assert.deepEqual(await freshDb.getAllWordStates(), {});
    await freshDb.clearHistory();
    assert.deepEqual(await freshDb.getHistoryAll(), {});

    assert.ok(
      warnings.some((w) => String(w).includes('IndexedDB is unavailable')),
      'should warn once about falling back to in-memory storage'
    );
  } finally {
    globalThis.indexedDB = savedIndexedDB;
  }
});

test('falls back to in-memory storage if indexedDB.open throws synchronously', async (t) => {
  const savedIndexedDB = globalThis.indexedDB;
  t.mock.method(console, 'warn', () => {});
  globalThis.indexedDB = {
    open() {
      throw new Error('simulated synchronous open failure');
    },
  };
  try {
    const freshDb = await import(`../js/db.js?instance=${counter++}`);
    // Should still work via the memory fallback rather than rejecting.
    await freshDb.putWordState('hola', { timesSeen: 1 });
    assert.deepEqual(await freshDb.getAllWordStates(), { hola: { timesSeen: 1 } });
  } finally {
    globalThis.indexedDB = savedIndexedDB;
  }
});

test('falls back to in-memory storage if the open request fails asynchronously', async (t) => {
  const savedIndexedDB = globalThis.indexedDB;
  const warnings = [];
  t.mock.method(console, 'warn', (msg) => warnings.push(msg));
  globalThis.indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.error = new Error('simulated open error');
        request.onerror?.();
      });
      return request;
    },
  };
  try {
    const freshDb = await import(`../js/db.js?instance=${counter++}`);
    await freshDb.putWordState('hola', { timesSeen: 1 });
    assert.deepEqual(await freshDb.getAllWordStates(), { hola: { timesSeen: 1 } });
    assert.ok(warnings.some((w) => String(w).includes('Failed to open IndexedDB')));
  } finally {
    globalThis.indexedDB = savedIndexedDB;
  }
});
