// Dummy (mock) auth backend: the authenticated flows complete with no real accounts.
// Exercises the SAME seams the app uses: createAuth(client), createBackend({client, auth}),
// createStore({ backend }), the household / migrate-import "functions", and the RLS emulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockClient, DUMMY_USER, MOCK_DB_KEY } from '../js/mock-client.mjs';
import { createAuth } from '../js/auth.js';
import { createBackend } from '../js/backend.mjs';
import { createStore, STORAGE_KEY } from '../js/store.js';
import { runMigration, hasImportableLocal } from '../js/migrate.mjs';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };

async function signedIn(storage = mem()) {
  const client = createMockClient({ storage });
  const auth = createAuth({ client });
  await auth.init();
  const res = await auth.signInWithGoogle('http://localhost:8080');
  assert.equal(res.ok, true);
  const invoke = async (name, body) => (await client.functions.invoke(name, { body })).data;
  return { storage, client, auth, invoke };
}

test('dummy Google sign-in succeeds with no redirect and exposes a dummy user', async () => {
  const { auth } = await signedIn();
  assert.equal(auth.isAuthenticated(), true);
  assert.equal(auth.currentUser().email, DUMMY_USER.email);
});

test('session survives a reload and sign-out clears it', async () => {
  const { storage, auth } = await signedIn();
  const again = createAuth({ client: createMockClient({ storage }) });
  await again.init();
  assert.equal(again.isAuthenticated(), true, 'restored from storage');
  await auth.signOut();
  const after = createAuth({ client: createMockClient({ storage }) });
  await after.init();
  assert.equal(after.isAuthenticated(), false);
});

test('signed-out clients cannot read or call anything', async () => {
  const client = createMockClient({ storage: mem() });
  const { data, error } = await client.from('memberships').select('household_id').limit(1);
  assert.equal(data, null);
  assert.ok(error);
  const r = await client.functions.invoke('household', { body: { action: 'create', name: 'x', displayName: 'y' } });
  assert.equal(r.data.error, 'Not authenticated');
});

test('create household -> backend loads it and the store acts as the dummy user', async () => {
  const { client, auth, invoke } = await signedIn();
  const backend = createBackend({ client, auth });
  assert.equal(await backend.loadHousehold(), null, 'no household yet');

  const bad = await invoke('household', { action: 'create', name: '', displayName: 'Alex' });
  assert.equal(bad.ok, false);

  const made = await invoke('household', { action: 'create', name: 'Elm Street 3B', displayName: 'Alex' });
  assert.equal(made.ok, true);

  const store = createStore({ storage: mem(), backend });
  const r = await store.loadRemote();
  assert.equal(r.ok, true);
  assert.equal(store.state.household.name, 'Elm Street 3B');
  assert.equal(store.state.members.length, 1);
  assert.equal(store.state.members[0].name, 'Alex');
  assert.equal(store.me(), store.state.members[0].id);
});

test('profile edits persist to the dummy account and reload', async () => {
  const { client, auth, invoke } = await signedIn();
  await invoke('household', { action: 'create', name: 'Home', displayName: 'Alex' });
  const backend = createBackend({ client, auth });
  const store = createStore({ storage: mem(), backend });
  await store.loadRemote();
  const res = store.updateProfile({ dietary: 'vegan', budgetCents: '50', rules: 'quiet after 10' });
  assert.equal(res.ok, true, 'updateProfile accepted');
  await new Promise((r) => setTimeout(r, 5));
  const fresh = createStore({ storage: mem(), backend: createBackend({ client, auth }) });
  await fresh.loadRemote();
  const p = fresh.state.members[0].profile;
  assert.equal(p.dietary, 'vegan');
  assert.equal(p.budgetCents, 5000);
});

test('join accepts ANY code and lands in a seeded sample household as the dummy user', async () => {
  const { client, auth, invoke } = await signedIn();
  assert.equal((await invoke('household', { action: 'accept', code: '' })).ok, false);
  const joined = await invoke('household', { action: 'accept', code: 'DUMMY123', displayName: 'Alex' });
  assert.equal(joined.ok, true);
  const store = createStore({ storage: mem(), backend: createBackend({ client, auth }) });
  await store.loadRemote();
  assert.ok(store.state.members.length >= 2, 'sample housemates present');
  assert.ok(store.state.occurrences.length > 0, 'sample chores present');
  assert.equal(store.state.members.find((m) => m.id === store.me()).name, 'Alex');
});

test('a real mock invitation code is single-use', async () => {
  const { auth, invoke, client } = await signedIn();
  const { householdId } = await invoke('household', { action: 'create', name: 'Home', displayName: 'Alex' });
  const inv = await invoke('household', { action: 'invite', householdId });
  assert.equal(inv.ok, true);
  assert.match(inv.code, /^[A-Z2-9]{8}$/);
  // already a member, so accepting your own household's code is refused
  const own = await invoke('household', { action: 'accept', code: inv.code, displayName: 'Alex' });
  assert.equal(own.ok, false);
  assert.ok(auth && client);
});

test('import local demo data: idempotent, keeps the local copy', async () => {
  const { storage, client, auth, invoke } = await signedIn();
  const local = createStore({ storage });
  local.load(); local.startDemo();
  assert.ok(storage.getItem(STORAGE_KEY));
  assert.equal(hasImportableLocal(storage), true);

  const invokeImport = (payload) => invoke('migrate-import', payload);
  const res = await runMigration(storage, invokeImport);
  assert.equal(res.ok, true);
  assert.ok(storage.getItem(STORAGE_KEY), 'local copy kept');
  assert.equal(hasImportableLocal(storage), false, 'migrated marker set');

  // Forcing a second import server-side (marker cleared) is still a no-op by signature.
  const payload = { local: JSON.parse(storage.getItem(STORAGE_KEY)), sourceSignature: `${local.state.household.id}:${local.state.household.createdAt || ''}`, meLocalId: local.state.currentUserId };
  const again = await invoke('migrate-import', payload);
  assert.equal(again.ok, true);
  assert.equal(again.alreadyImported, true);

  const store = createStore({ storage: mem(), backend: createBackend({ client, auth }) });
  await store.loadRemote();
  assert.equal(store.state.members.length, local.state.members.length);
  assert.equal(store.state.chores.length, local.state.chores.length);
  assert.equal(store.state.expenses.length, local.state.expenses.length);
});

test('RLS emulation: another user sees none of the first user\'s data', async () => {
  const { storage, invoke } = await signedIn();
  await invoke('household', { action: 'create', name: 'Private', displayName: 'Alex' });
  // Same database, different identity.
  const other = createMockClient({ storage, user: { id: 'someone-else', email: 'else@example.com' } });
  await other.auth.signInWithOAuth({ provider: 'google' });
  const hh = await other.from('households').select('*');
  assert.deepEqual(hh.data, []);
  const mem = await other.from('memberships').select('household_id').limit(1);
  assert.deepEqual(mem.data, []);
  assert.equal(await createBackend({ client: other, auth: createAuth({ client: other }) }).loadHousehold(), null);
});

test('dummy phone verification accepts any well-formed number and code', async () => {
  const { auth } = await signedIn();
  assert.equal((await auth.startPhoneVerify('not-a-phone')).ok, false);
  assert.equal((await auth.startPhoneVerify('+15555550123')).ok, true);
  assert.equal((await auth.confirmPhoneVerify('12ab')).ok, false);
  const r = await auth.confirmPhoneVerify('123456');
  assert.equal(r.ok, true);
  assert.equal(auth.currentUser().phoneVerified, true);
});

test('reset wipes the dummy account and data', async () => {
  const { storage, client, auth, invoke } = await signedIn();
  await invoke('household', { action: 'create', name: 'Home', displayName: 'Alex' });
  client.reset();
  assert.equal(storage.getItem(MOCK_DB_KEY), null);
  assert.equal(auth.isAuthenticated(), false);
});
