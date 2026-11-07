// Task 10 — migration mapping (Requirement 5.2/5.3). Tests the PURE buildImportPlan +
// applyImportPlan against a fake DB (NFR 5). Proves member mapping (signer claimed, others
// placeholders), id preservation via client_id, and content mapping.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, STORAGE_KEY } from '../js/store.js';
import { buildImportPlan, applyImportPlan } from '../../supabase/functions/_shared/migrate.mjs';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m }; };

function seedLocal() {
  const storage = mem();
  const s = createStore({ storage });
  s.load();
  s.startDemo();
  // give the first member a profile so migration carries it
  s.updateProfile({ dietary: 'Vegan', budgetCents: '120', rules: 'Quiet mornings' });
  return JSON.parse(storage.getItem(STORAGE_KEY));
}

test('buildImportPlan maps the signer to a claimed owner and others to placeholders (R5.3)', () => {
  const local = seedLocal();
  const signer = 'auth-user-uuid';
  const meLocal = local.members[0].id;
  const plan = buildImportPlan(local, signer, meLocal);

  assert.equal(plan.household.created_by, signer);
  assert.equal(plan.memberships.length, local.members.length);

  const mine = plan.memberships.find((m) => m.client_id === meLocal);
  assert.equal(mine.user_id, signer);
  assert.equal(mine.claimed, true);
  assert.equal(mine.role, 'owner');

  const others = plan.memberships.filter((m) => m.client_id !== meLocal);
  assert.ok(others.length >= 1);
  for (const o of others) {
    assert.equal(o.user_id, null, 'other members are unclaimed placeholders');
    assert.equal(o.claimed, false);
  }
});

test('buildImportPlan preserves local ids as client_id and migrates the signer profile (R5.2)', () => {
  const local = seedLocal();
  const meLocal = local.members[0].id;
  const plan = buildImportPlan(local, 'u', meLocal);

  // chores/occurrences keep local ids + links
  assert.ok(plan.content.chores.every((c) => typeof c.client_id === 'string'));
  assert.ok(plan.content.occurrences.every((o) => typeof o.client_id === 'string' && 'chore_client_id' in o));

  // profile carried from the signer's local member.profile
  assert.equal(plan.profile.user_id, 'u');
  assert.equal(plan.profile.dietary, 'Vegan');
  assert.equal(plan.profile.budget_cents, 12000);
  assert.equal(plan.profile.rules, 'Quiet mornings');
});

test('buildImportPlan rejects unrecognized local data', () => {
  assert.throws(() => buildImportPlan({}, 'u', 'x'), /not a recognized household/);
});

// ---- applyImportPlan against a fake DB (the JS applier path) ----
function fakeDb() {
  const tables = {};
  let seq = 0;
  const get = (n) => (tables[n] = tables[n] || []);
  function q(name) {
    const rows = get(name);
    let op, payload;
    return {
      insert(p) { op = 'insert'; payload = p; return this; },
      upsert(p) { op = 'upsert'; payload = p; return this; },
      select() { return this; },
      async single() {
        const row = { id: `id_${++seq}`, ...(Array.isArray(payload) ? payload[0] : payload) };
        rows.push(row); return { data: row, error: null };
      },
      then(resolve) {
        const arr = Array.isArray(payload) ? payload : [payload];
        arr.forEach((p) => rows.push({ id: `id_${++seq}`, ...p }));
        resolve({ data: null, error: null });
      },
    };
  }
  return { from: q, _tables: tables };
}

test('applyImportPlan writes household + all collections with household_id (R5.2)', async () => {
  const local = seedLocal();
  const plan = buildImportPlan(local, 'u', local.members[0].id);
  const db = fakeDb();
  const res = await applyImportPlan(db, plan);
  assert.equal(res.ok, true);
  assert.ok(res.householdId);

  assert.equal(db._tables.households.length, 1);
  assert.equal(db._tables.memberships.length, local.members.length);
  // every content row carries the new household_id
  for (const t of ['chores', 'occurrences', 'expenses', 'shopping', 'events']) {
    for (const r of db._tables[t] || []) assert.equal(r.household_id, res.householdId);
  }
  assert.equal(db._tables.profiles.length, 1);
  assert.equal(db._tables.purchasing.length, 1);
});
