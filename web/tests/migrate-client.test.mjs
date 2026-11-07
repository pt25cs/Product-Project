// Task 10 — client migration flow (Requirement 5.1/5.4/5.5, NFR 6). Tests the injected-invoker
// helper: detection, marker prevents re-import, failure leaves local intact, idempotency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, STORAGE_KEY } from '../js/store.js';
import { readLocal, alreadyMigrated, hasImportableLocal, sourceSignature, runMigration, MIGRATED_MARKER_KEY } from '../js/migrate.mjs';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m }; };

function withLocal() {
  const storage = mem();
  const s = createStore({ storage });
  s.load();
  s.startDemo();
  return storage;
}

test('hasImportableLocal detects a local household (R5.1)', () => {
  const storage = withLocal();
  assert.equal(hasImportableLocal(storage), true);
  assert.ok(readLocal(storage).household);
});

test('hasImportableLocal is false with no local data', () => {
  assert.equal(hasImportableLocal(mem()), false);
});

test('sourceSignature is stable across reads (NFR 6)', () => {
  const storage = withLocal();
  const a = sourceSignature(readLocal(storage));
  const b = sourceSignature(readLocal(storage));
  assert.equal(a, b);
  assert.match(a, /:/);
});

test('runMigration success marks migrated and KEEPS the local copy (R5.4)', async () => {
  const storage = withLocal();
  let received = null;
  const invoke = async (payload) => { received = payload; return { ok: true, householdId: 'hh-123' }; };

  const res = await runMigration(storage, invoke);
  assert.equal(res.ok, true);
  assert.equal(res.householdId, 'hh-123');
  // marker set, local data still present (non-destructive)
  assert.equal(alreadyMigrated(storage), true);
  assert.ok(storage.getItem(STORAGE_KEY), 'local copy retained after success');
  // payload carried the signer mapping + signature
  assert.ok(received.meLocalId);
  assert.ok(received.sourceSignature);
});

test('runMigration is a no-op once the marker is set (R5.4)', async () => {
  const storage = withLocal();
  storage.setItem(MIGRATED_MARKER_KEY, 'hh-prev');
  let called = false;
  const invoke = async () => { called = true; return { ok: true, householdId: 'hh-new' }; };
  const res = await runMigration(storage, invoke);
  assert.equal(res.ok, true);
  assert.equal(res.alreadyImported, true);
  assert.equal(called, false, 'no second import attempt');
});

test('runMigration failure leaves local intact and does not mark migrated (R5.5)', async () => {
  const storage = withLocal();
  const invoke = async () => { throw new Error('server down'); };
  const res = await runMigration(storage, invoke);
  assert.equal(res.ok, false);
  assert.match(res.error, /unchanged/i);
  assert.equal(alreadyMigrated(storage), false, 'not marked migrated on failure');
  assert.ok(storage.getItem(STORAGE_KEY), 'local data preserved');
});

test('runMigration surfaces a server-reported error without marking migrated (R5.5)', async () => {
  const storage = withLocal();
  const invoke = async () => ({ ok: false, error: 'household name too long' });
  const res = await runMigration(storage, invoke);
  assert.equal(res.ok, false);
  assert.equal(alreadyMigrated(storage), false);
});
