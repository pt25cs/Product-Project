// Task 5 — store backend persistence seam (Requirement 8).
// Uses an in-memory FAKE backend (NFR 5). Proves:
//  - the local/demo path (no backend) is unchanged
//  - the authenticated path loads from and persists through the backend
//  - me() returns the backend identity
//  - a failing backend write sets saveError and does NOT report success
//  - an unreachable backend on load surfaces a clear error (no silent fallback)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, STORAGE_KEY } from '../js/store.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m }; };
const flush = () => new Promise((r) => setTimeout(r, 0)); // let fire-and-forget backend writes settle

// A fake backend adapter. Records every saved snapshot; can be made to fail.
function fakeBackend(opts = {}) {
  const b = {
    saved: [],
    loadCalls: 0,
    failSave: opts.failSave ?? false,
    failLoad: opts.failLoad ?? false,
    userId: opts.userId ?? null,
    seed: opts.seed ?? null,
    async loadHousehold() {
      b.loadCalls++;
      if (b.failLoad) throw new Error('network down');
      return b.seed;
    },
    async saveHousehold(state) {
      if (b.failSave) throw new Error('write rejected');
      b.saved.push(state);
    },
    currentUserId() { return b.userId; },
  };
  return b;
}

// Build a minimal valid household state the backend can return.
function seedState() {
  const storage = mem();
  const s = createStore({ storage });
  s.load();
  s.startDemo();              // produces a full, normalized demo household in storage
  const raw = JSON.parse(storage.getItem(STORAGE_KEY));
  return raw;
}

test('local/demo path is unchanged when no backend is given', async () => {
  const storage = mem();
  const s = createStore({ storage });            // no backend
  assert.equal(s.isBackend, false);
  s.load();
  s.startDemo();
  // persisted to localStorage synchronously, as before
  assert.ok(storage.getItem(STORAGE_KEY), 'demo persisted to localStorage');
  assert.equal(s.saveError, null);
  // me() uses currentUserId (the "Viewing as" selection), not a backend
  assert.equal(s.me(), s.state.currentUserId);
});

test('authenticated path hydrates state from the backend', async () => {
  const backend = fakeBackend({ seed: seedState(), userId: null });
  const s = createStore({ storage: mem(), backend });
  assert.equal(s.isBackend, true);
  const res = await s.loadRemote();
  assert.equal(res.ok, true);
  assert.equal(backend.loadCalls, 1);
  assert.ok(s.state && s.state.household, 'state hydrated from backend');
  assert.ok(Array.isArray(s.state.members) && s.state.members.length >= 2);
});

test('a mutation on the authenticated path persists through the backend', async () => {
  const seed = seedState();
  const backend = fakeBackend({ seed, userId: null });
  const s = createStore({ storage: mem(), backend });
  await s.loadRemote();

  const before = backend.saved.length;
  const firstMemberId = s.state.members[0].id;
  // add an expectation (a simple action function); it should flow through save() -> backend
  const r = s.addExpectation('Quiet after 11pm');
  assert.equal(r.ok, true);
  await flush();
  assert.ok(backend.saved.length > before, 'backend received a saveHousehold call');
  const last = backend.saved[backend.saved.length - 1];
  assert.ok(last.expectations.some((e) => e.text === 'Quiet after 11pm'), 'persisted snapshot includes the new expectation');
  assert.equal(s.saveError, null, 'no save error on success');
});

test('me() returns the backend identity on the authenticated path (R1.7)', async () => {
  const seed = seedState();
  const backendUser = seed.members[1].id;       // pretend the signed-in user is member #2
  const backend = fakeBackend({ seed, userId: backendUser });
  const s = createStore({ storage: mem(), backend });
  await s.loadRemote();
  assert.equal(s.me(), backendUser, 'me() reflects the authenticated user, not currentUserId');
  assert.notEqual(s.me(), s.state.currentUserId);
});

test('a failing backend write sets saveError and does not report success (R8.3)', async () => {
  const seed = seedState();
  const backend = fakeBackend({ seed });
  const s = createStore({ storage: mem(), backend });
  await s.loadRemote();

  backend.failSave = true;
  s.addExpectation('This should fail to persist');
  await flush();
  assert.ok(s.saveError, 'saveError is set after a failed backend write');

  // recovery: a subsequent successful write clears the error
  backend.failSave = false;
  s.addExpectation('This one succeeds');
  await flush();
  assert.equal(s.saveError, null, 'saveError cleared after a successful write');
});

test('an unreachable backend on load surfaces a clear error, no silent fallback (R6.6)', async () => {
  const backend = fakeBackend({ failLoad: true });
  const s = createStore({ storage: mem(), backend });
  const res = await s.loadRemote();
  assert.equal(res.ok, false);
  assert.match(res.error, /connection/i);
  assert.equal(s.state, null, 'state is not populated from a stale/local source');
  assert.ok(s.saveError, 'the load failure is recorded');
});
