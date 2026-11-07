// Task 6 — server-backed profiles (Requirement 3, 4). Uses the fake backend.
// Proves: owner edit persists through the backend (save receives a profileWriteFor hint),
// validation parity with Phase 1, another member's profile is readable (read-only in UI),
// and a profile write failure surfaces via saveError (R3.6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, STORAGE_KEY } from '../js/store.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m }; };
const flush = () => new Promise((r) => setTimeout(r, 0));

function seedState() {
  const storage = mem();
  const s = createStore({ storage });
  s.load();
  s.startDemo();
  return JSON.parse(storage.getItem(STORAGE_KEY));
}

function fakeBackend(opts = {}) {
  const b = {
    seed: opts.seed ?? null,
    userId: opts.userId ?? null,
    saves: [],                 // { snapshot, profileWriteFor }
    failProfileWrite: opts.failProfileWrite ?? false,
    async loadHousehold() { return b.seed; },
    async saveHousehold(snapshot, meta = {}) {
      // Simulate the adapter targeting the profiles row when this save is a profile edit;
      // fail only that path when configured (R3.6).
      if (meta.profileWriteFor && b.failProfileWrite) throw new Error('profile write rejected');
      b.saves.push({ snapshot, profileWriteFor: meta.profileWriteFor ?? null });
    },
    currentUserId() { return b.userId; },
  };
  return b;
}

test('owner edit persists and marks the save as a profile write (R3.1)', async () => {
  const seed = seedState();
  const meId = seed.members[0].id;
  const backend = fakeBackend({ seed, userId: meId });
  const s = createStore({ storage: mem(), backend });
  await s.loadRemote();

  const res = s.updateProfile({ dietary: 'Vegetarian, no nuts', budgetCents: '150.50', rules: 'Knock first' });
  assert.equal(res.ok, true);
  await flush();

  const p = s.profileOf(meId);
  assert.equal(p.dietary, 'Vegetarian, no nuts');
  assert.equal(p.budgetCents, 15050);
  assert.equal(p.rules, 'Knock first');

  const last = backend.saves[backend.saves.length - 1];
  assert.equal(last.profileWriteFor, meId, 'save carried the profile-write hint for the signed-in user');
  const savedProfile = last.snapshot.members.find((m) => m.id === meId).profile;
  assert.equal(savedProfile.budgetCents, 15050, 'persisted snapshot carries the new profile');
});

test('validation parity: invalid budget and over-long text are rejected (R3.3/3.4)', async () => {
  const seed = seedState();
  const meId = seed.members[0].id;
  const backend = fakeBackend({ seed, userId: meId });
  const s = createStore({ storage: mem(), backend });
  await s.loadRemote();

  const bad = s.updateProfile({ budgetCents: '-5' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.budgetCents);

  const long = s.updateProfile({ dietary: 'x'.repeat(301) });
  assert.equal(long.ok, false);
  assert.ok(long.errors.dietary);

  await flush();
  assert.equal(backend.saves.length, 0, 'no backend write on invalid input');
});

test('another member\'s profile is readable for display (R3.2)', async () => {
  const seed = seedState();
  seed.members[1].profile = { dietary: 'Gluten-free', budgetCents: 20000, rules: '' };
  const meId = seed.members[0].id;
  const otherId = seed.members[1].id;
  const backend = fakeBackend({ seed, userId: meId });
  const s = createStore({ storage: mem(), backend });
  await s.loadRemote();

  const other = s.profileOf(otherId);
  assert.equal(other.dietary, 'Gluten-free');
  assert.equal(other.budgetCents, 20000);
});

test('a profile write failure surfaces via saveError (R3.6)', async () => {
  const seed = seedState();
  const meId = seed.members[0].id;
  const backend = fakeBackend({ seed, userId: meId, failProfileWrite: true });
  const s = createStore({ storage: mem(), backend });
  await s.loadRemote();

  const res = s.updateProfile({ dietary: 'Pescatarian' });
  assert.equal(res.ok, true);            // the in-memory mutation applies optimistically
  await flush();
  assert.ok(s.saveError, 'saveError set after a failed profile write');
});

test('local/demo path: updateProfile still works with no backend', async () => {
  const storage = mem();
  const s = createStore({ storage });
  s.load();
  s.startDemo();
  const res = s.updateProfile({ dietary: 'None' });
  assert.equal(res.ok, true);
  assert.equal(s.profileOf(s.me()).dietary, 'None');
  assert.equal(s.saveError, null);
});
