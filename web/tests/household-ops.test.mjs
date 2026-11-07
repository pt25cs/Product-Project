// Task 9 — household create/join/invitation logic (Requirement 7).
// Tests the shared ops against an in-memory fake of the Supabase query-builder API (NFR 5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHousehold, createInvitation, acceptInvitation, MAX_MEMBERS } from '../../supabase/functions/_shared/household-ops.mjs';

// ---- Minimal fake Supabase client: supports the chained calls the ops use ----
function fakeDb() {
  const tables = { households: [], memberships: [], invitations: [] };
  let seq = 0;
  const id = () => `id_${++seq}`;

  function query(name) {
    const rows = tables[name];
    const q = {
      _filters: [],
      _op: null,
      _payload: null,
      insert(payload) { this._op = 'insert'; this._payload = payload; return this; },
      update(payload) { this._op = 'update'; this._payload = payload; return this; },
      select() { this._op = this._op || 'select'; return this; },
      eq(col, val) { this._filters.push([col, val]); return this; },
      _match(r) { return this._filters.every(([c, v]) => r[c] === v); },
      async single() { return this._run(true); },
      async maybeSingle() { return this._run(false, true); },
      then(resolve) { resolve(this._run(false)); }, // allow await without select for update/insert
      async _run(requireOne = false, maybe = false) {
        if (this._op === 'insert') {
          const row = { id: id(), ...this._payload };
          rows.push(row);
          return { data: row, error: null };
        }
        if (this._op === 'update') {
          const matched = rows.filter((r) => this._match(r));
          matched.forEach((r) => Object.assign(r, this._payload));
          return { data: matched, error: null };
        }
        // select
        const matched = rows.filter((r) => this._match(r));
        if (requireOne) return { data: matched[0] ?? null, error: matched[0] ? null : { message: 'no row' } };
        if (maybe) return { data: matched[0] ?? null, error: null };
        return { data: matched, error: null };
      },
    };
    return q;
  }
  return { from: (n) => query(n), _tables: tables };
}

test('createHousehold seeds the caller as the first owner member (R7.1)', async () => {
  const db = fakeDb();
  const res = await createHousehold(db, 'user-1', { name: 'Pecan Court', displayName: 'Alice' });
  assert.equal(res.ok, true);
  assert.equal(db._tables.households.length, 1);
  assert.equal(db._tables.memberships.length, 1);
  const m = db._tables.memberships[0];
  assert.equal(m.user_id, 'user-1');
  assert.equal(m.role, 'owner');
  assert.equal(m.claimed, true);
});

test('createHousehold rejects empty/over-long names', async () => {
  const db = fakeDb();
  assert.equal((await createHousehold(db, 'u', { name: '', displayName: 'A' })).ok, false);
  assert.equal((await createHousehold(db, 'u', { name: 'x'.repeat(61), displayName: 'A' })).ok, false);
  assert.equal((await createHousehold(db, 'u', { name: 'Home', displayName: '' })).ok, false);
});

test('createInvitation requires the caller to be a member (R7.2)', async () => {
  const db = fakeDb();
  await createHousehold(db, 'owner', { name: 'Home', displayName: 'Owner' });
  const hid = db._tables.households[0].id;

  const outsider = await createInvitation(db, 'stranger', { householdId: hid });
  assert.equal(outsider.ok, false);

  const ok = await createInvitation(db, 'owner', { householdId: hid });
  assert.equal(ok.ok, true);
  assert.ok(ok.code && ok.code.length === 8);
});

test('acceptInvitation adds a new member (R7.2)', async () => {
  const db = fakeDb();
  await createHousehold(db, 'owner', { name: 'Home', displayName: 'Owner' });
  const hid = db._tables.households[0].id;
  const { code } = await createInvitation(db, 'owner', { householdId: hid });

  const res = await acceptInvitation(db, 'joiner', { code, displayName: 'Bob' });
  assert.equal(res.ok, true);
  assert.equal(res.householdId, hid);
  assert.equal(db._tables.memberships.length, 2);
  assert.ok(db._tables.memberships.some((m) => m.user_id === 'joiner' && m.display_name === 'Bob'));
});

test('acceptInvitation claims a placeholder membership (R7.3)', async () => {
  const db = fakeDb();
  await createHousehold(db, 'owner', { name: 'Home', displayName: 'Owner' });
  const hid = db._tables.households[0].id;
  // add a placeholder (migration leftover): claimed=false, user_id=null
  db._tables.memberships.push({ id: 'ph1', household_id: hid, user_id: null, role: 'member', display_name: 'Roommate 2', claimed: false });

  const { code } = await createInvitation(db, 'owner', { householdId: hid, placeholderMembershipId: 'ph1' });
  const res = await acceptInvitation(db, 'claimer', { code, displayName: 'Carol' });
  assert.equal(res.ok, true);
  const ph = db._tables.memberships.find((m) => m.id === 'ph1');
  assert.equal(ph.user_id, 'claimer');
  assert.equal(ph.claimed, true);
  assert.equal(ph.display_name, 'Carol');
  // no NEW membership row created — the placeholder was claimed in place
  assert.equal(db._tables.memberships.length, 2);
});

test('acceptInvitation rejects an already-used invitation', async () => {
  const db = fakeDb();
  await createHousehold(db, 'owner', { name: 'Home', displayName: 'Owner' });
  const hid = db._tables.households[0].id;
  const { code } = await createInvitation(db, 'owner', { householdId: hid });
  await acceptInvitation(db, 'joiner', { code, displayName: 'Bob' });
  const again = await acceptInvitation(db, 'joiner2', { code, displayName: 'Dan' });
  assert.equal(again.ok, false);
  assert.match(again.error, /already been used/i);
});

test('acceptInvitation rejects an expired invitation', async () => {
  const db = fakeDb();
  await createHousehold(db, 'owner', { name: 'Home', displayName: 'Owner' });
  const hid = db._tables.households[0].id;
  const past = new Date(Date.now() - 1000).toISOString();
  const { code } = await createInvitation(db, 'owner', { householdId: hid, expiresAt: past });
  const res = await acceptInvitation(db, 'joiner', { code, displayName: 'Bob' });
  assert.equal(res.ok, false);
  assert.match(res.error, /expired/i);
});

test('acceptInvitation blocks a user already in the household', async () => {
  const db = fakeDb();
  await createHousehold(db, 'owner', { name: 'Home', displayName: 'Owner' });
  const hid = db._tables.households[0].id;
  const { code } = await createInvitation(db, 'owner', { householdId: hid });
  const res = await acceptInvitation(db, 'owner', { code, displayName: 'Owner' });
  assert.equal(res.ok, false);
  assert.match(res.error, /already a member/i);
});

test('acceptInvitation enforces the 5-roommate cap (R7.4)', async () => {
  const db = fakeDb();
  await createHousehold(db, 'owner', { name: 'Home', displayName: 'Owner' });
  const hid = db._tables.households[0].id;
  // fill to MAX_MEMBERS total (owner + 4)
  for (let i = 0; i < MAX_MEMBERS - 1; i++) {
    db._tables.memberships.push({ id: `m${i}`, household_id: hid, user_id: `u${i}`, role: 'member', display_name: `R${i}`, claimed: true });
  }
  const { code } = await createInvitation(db, 'owner', { householdId: hid });
  const res = await acceptInvitation(db, 'overflow', { code, displayName: 'Too Many' });
  assert.equal(res.ok, false);
  assert.match(res.error, /full/i);
});
