// Task 1 (household-coordination-v2): persistence back-compat normalization and new defaults.
// A pre-existing version:1 save lacking the v2 fields must load cleanly and be normalized,
// and new/demo households must carry the same new defaults.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, STORAGE_KEY } from '../js/store.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m }; };

// A minimal, valid v1 save as written by an older build: no swaps/expectations/purchasing,
// no member.profile, no autoRotate/anchorDate/cycleDays on chores, no manualOverride on occs.
const legacySave = () => ({
  version: 1, mode: 'local',
  household: { id: 'hh1', name: 'Old Place', createdAt: '2026-01-01T00:00:00.000Z' },
  members: [{ id: 'u1', name: 'Ana' }, { id: 'u2', name: 'Ben' }],
  currentUserId: 'u1',
  chores: [{ id: 'c1', title: 'Trash', notes: '', recurrence: 'weekly', rotation: ['u1', 'u2'], createdBy: 'u1', createdAt: '2026-01-01T00:00:00.000Z' }],
  occurrences: [{ id: 'o1', choreId: 'c1', title: 'Trash', notes: '', due: '2026-01-08', assigneeId: 'u1', rotIdx: 0, doneBy: null, doneAt: null, nextOccId: null }],
  expenses: [], reimbursements: [], shopping: [], events: [],
  notifications: [], activity: [], prefs: {}, analytics: [],
});

test('legacy v1 save loads and is normalized with v2 defaults', () => {
  const storage = mem();
  storage.setItem(STORAGE_KEY, JSON.stringify(legacySave()));
  const s = createStore({ storage });
  assert.equal(s.load().ok, true);

  // New top-level collections exist.
  assert.deepEqual(s.state.swaps, []);
  assert.deepEqual(s.state.expectations, []);
  assert.deepEqual(s.state.purchasing, { budgetCents: null, preferredProducts: [], storePreferences: [] });

  // Members gain a profile with defaults.
  for (const m of s.state.members) {
    assert.deepEqual(m.profile, { dietary: '', budgetCents: null, rules: '' });
  }
  // Chores gain rotation cadence defaults (weekly) and auto-rotate off.
  const c = s.state.chores[0];
  assert.equal(c.autoRotate, false);
  assert.equal(c.anchorDate, null);
  assert.equal(c.cycleDays, 7);
  // Occurrences gain the manual-override marker.
  assert.equal(s.state.occurrences[0].manualOverride, false);

  // prefsOf exposes the inert channel seam.
  assert.deepEqual(s.prefsOf('u1').channels, { inApp: true, push: false, sms: false });

  // Still version 1 — the format was not bumped.
  assert.equal(s.state.version, 1);
});

test('normalization preserves existing data and does not reject the save', () => {
  const storage = mem();
  storage.setItem(STORAGE_KEY, JSON.stringify(legacySave()));
  const s = createStore({ storage });
  assert.equal(s.load().ok, true);
  assert.equal(s.state.household.name, 'Old Place');
  assert.equal(s.state.members.length, 2);
  assert.equal(s.state.chores[0].title, 'Trash');
  assert.equal(s.state.occurrences[0].id, 'o1');
});

test('partial purchasing object is filled in without clobbering set fields', () => {
  const storage = mem();
  const save = legacySave();
  save.purchasing = { budgetCents: 50000 }; // only budget set by a mid-migration build
  storage.setItem(STORAGE_KEY, JSON.stringify(save));
  const s = createStore({ storage });
  assert.equal(s.load().ok, true);
  assert.equal(s.state.purchasing.budgetCents, 50000);
  assert.deepEqual(s.state.purchasing.preferredProducts, []);
  assert.deepEqual(s.state.purchasing.storePreferences, []);
});

test('new household and demo carry the v2 defaults', () => {
  const a = createStore({ storage: mem() });
  a.load();
  assert.ok(a.createHousehold({ userName: 'Ana', householdName: 'Casa', others: ['Ben'] }).ok);
  assert.deepEqual(a.state.purchasing, { budgetCents: null, preferredProducts: [], storePreferences: [] });
  assert.deepEqual(a.state.swaps, []);
  assert.deepEqual(a.state.expectations, []);
  for (const m of a.state.members) assert.deepEqual(m.profile, { dietary: '', budgetCents: null, rules: '' });

  const b = createStore({ storage: mem() });
  b.load(); b.startDemo();
  for (const m of b.state.members) assert.ok(m.profile && 'dietary' in m.profile && 'budgetCents' in m.profile && 'rules' in m.profile);
  assert.ok(Array.isArray(b.state.swaps) && Array.isArray(b.state.expectations));
  assert.ok(b.state.purchasing && Array.isArray(b.state.purchasing.preferredProducts));
});

test('corrupt and unrecognized saves are still rejected after adding normalization', () => {
  const bad = mem();
  bad.setItem(STORAGE_KEY, '{not json');
  assert.equal(createStore({ storage: bad }).load().ok, false);

  const wrongVersion = mem();
  wrongVersion.setItem(STORAGE_KEY, JSON.stringify({ ...legacySave(), version: 2 }));
  assert.equal(createStore({ storage: wrongVersion }).load().ok, false);
});
