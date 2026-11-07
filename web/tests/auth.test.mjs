// Task 4 — auth module tests against a FAKE Supabase-shaped client (NFR 5).
// No network, no real Google/Twilio. Covers Requirement 1 (auth) and 2 (phone verify).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from '../js/auth.js';

// A minimal fake of the @supabase/supabase-js surface auth.js uses.
function fakeClient(opts = {}) {
  let session = opts.session ?? null;
  const changeCbs = new Set();
  const calls = { signInWithOAuth: 0, signOut: 0, refresh: 0, fns: [] };
  const client = {
    __setSession(s) { session = s; changeCbs.forEach((cb) => cb('X', s)); },
    auth: {
      async getSession() { return { data: { session }, error: opts.getSessionError ?? null }; },
      onAuthStateChange(cb) {
        changeCbs.add(cb);
        return { data: { subscription: { unsubscribe() { changeCbs.delete(cb); } } } };
      },
      async signInWithOAuth(args) {
        calls.signInWithOAuth++;
        if (opts.signInError) return { data: null, error: opts.signInError };
        return { data: { provider: args.provider, url: 'https://oauth.example/go' }, error: null };
      },
      async signOut() { calls.signOut++; session = null; return { error: opts.signOutError ?? null }; },
      async refreshSession() {
        calls.refresh++;
        if (opts.refreshOk) { session = opts.refreshedSession ?? { access_token: 't2', user: { id: 'u1' } }; return { data: { session }, error: null }; }
        return { data: { session: null }, error: { message: 'refresh failed' } };
      },
    },
    functions: {
      async invoke(name, args) {
        calls.fns.push({ name, body: args?.body });
        const r = (opts.fnResponses || {})[name];
        if (typeof r === 'function') return r(args);
        return r ?? { data: { ok: true }, error: null };
      },
    },
    __calls: calls,
  };
  return client;
}

const session1 = { access_token: 'tok1', user: { id: 'u1', email: 'a@example.com', user_metadata: { phone_verified: false } } };

test('init with an existing session restores the user (1.5)', async () => {
  const client = fakeClient({ session: session1 });
  const auth = createAuth({ client });
  const user = await auth.init();
  assert.ok(auth.isAuthenticated());
  assert.equal(user.id, 'u1');
  assert.equal(user.email, 'a@example.com');
  assert.equal(auth.accessToken(), 'tok1');
});

test('init with no session yields signed-out', async () => {
  const auth = createAuth({ client: fakeClient({ session: null }) });
  const user = await auth.init();
  assert.equal(user, null);
  assert.equal(auth.isAuthenticated(), false);
});

test('onChange fires when the provider reports a new session (1.2)', async () => {
  const client = fakeClient({ session: null });
  const auth = createAuth({ client });
  await auth.init();
  let latest = 'unset';
  auth.onChange((u) => { latest = u; });
  client.__setSession(session1);
  assert.ok(latest && latest.id === 'u1', 'listener received the signed-in user');
});

test('signInWithGoogle delegates to the provider (1.1/1.2)', async () => {
  const client = fakeClient({ session: null });
  const auth = createAuth({ client });
  await auth.init();
  const res = await auth.signInWithGoogle('http://localhost:8080');
  assert.equal(res.ok, true);
  assert.equal(client.__calls.signInWithOAuth, 1);
});

test('signInWithGoogle surfaces a friendly cancel message (1.3)', async () => {
  const client = fakeClient({ session: null, signInError: { message: 'User closed the popup' } });
  const auth = createAuth({ client });
  await auth.init();
  const res = await auth.signInWithGoogle();
  assert.equal(res.ok, false);
  assert.match(res.error, /cancelled/i);
});

test('signOut clears the session (1.4)', async () => {
  const client = fakeClient({ session: session1 });
  const auth = createAuth({ client });
  await auth.init();
  assert.ok(auth.isAuthenticated());
  const res = await auth.signOut();
  assert.equal(res.ok, true);
  assert.equal(auth.isAuthenticated(), false);
  assert.equal(client.__calls.signOut, 1);
});

test('refresh succeeds and updates the session (1.6)', async () => {
  const client = fakeClient({ session: session1, refreshOk: true, refreshedSession: { access_token: 'tok2', user: { id: 'u1' } } });
  const auth = createAuth({ client });
  await auth.init();
  const res = await auth.refresh();
  assert.equal(res.ok, true);
  assert.equal(auth.accessToken(), 'tok2');
});

test('refresh failure falls back to signed-out (1.6)', async () => {
  const client = fakeClient({ session: session1, refreshOk: false });
  const auth = createAuth({ client });
  await auth.init();
  const res = await auth.refresh();
  assert.equal(res.ok, false);
  assert.equal(auth.isAuthenticated(), false);
});

// ---------- phone verification (Requirement 2) ----------
test('startPhoneVerify rejects a malformed number before calling the server (2.1)', async () => {
  const client = fakeClient({ session: session1 });
  const auth = createAuth({ client });
  await auth.init();
  const res = await auth.startPhoneVerify('555-1234');
  assert.equal(res.ok, false);
  assert.equal(client.__calls.fns.length, 0, 'no edge-function call for invalid input');
});

test('startPhoneVerify sends a code for a valid E.164 number (2.1)', async () => {
  const client = fakeClient({ session: session1, fnResponses: { 'phone-verify-start': { data: { ok: true }, error: null } } });
  const auth = createAuth({ client });
  await auth.init();
  const res = await auth.startPhoneVerify('+15555550123');
  assert.equal(res.ok, true);
  assert.equal(client.__calls.fns[0].name, 'phone-verify-start');
  assert.equal(client.__calls.fns[0].body.phone, '+15555550123');
});

test('startPhoneVerify surfaces a rate-limit/collision error from the server (2.3–2.5)', async () => {
  const client = fakeClient({ session: session1, fnResponses: { 'phone-verify-start': { data: { error: 'Too many requests. Try again in a minute.' }, error: null } } });
  const auth = createAuth({ client });
  await auth.init();
  const res = await auth.startPhoneVerify('+15555550123');
  assert.equal(res.ok, false);
  assert.match(res.error, /too many/i);
});

test('confirmPhoneVerify rejects a non-numeric code locally (2.2)', async () => {
  const client = fakeClient({ session: session1 });
  const auth = createAuth({ client });
  await auth.init();
  const res = await auth.confirmPhoneVerify('abcd');
  assert.equal(res.ok, false);
  assert.equal(client.__calls.fns.length, 0);
});

test('confirmPhoneVerify succeeds on a correct code and refreshes (2.2)', async () => {
  const client = fakeClient({
    session: session1,
    refreshOk: true,
    fnResponses: { 'phone-verify-check': { data: { ok: true }, error: null } },
  });
  const auth = createAuth({ client });
  await auth.init();
  const res = await auth.confirmPhoneVerify('123456');
  assert.equal(res.ok, true);
  assert.equal(res.verified, true);
  assert.ok(client.__calls.refresh >= 1, 'session refreshed to reflect verified phone');
});

test('confirmPhoneVerify surfaces a wrong/expired code error (2.3)', async () => {
  const client = fakeClient({
    session: session1,
    fnResponses: { 'phone-verify-check': { data: { error: 'That code is incorrect or expired.' }, error: null } },
  });
  const auth = createAuth({ client });
  await auth.init();
  const res = await auth.confirmPhoneVerify('000000');
  assert.equal(res.ok, false);
  assert.match(res.error, /incorrect or expired/i);
});

test('createAuth requires a client', () => {
  assert.throws(() => createAuth({}), /requires a Supabase/);
});
