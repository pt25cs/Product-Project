// Kasa Phase 2 — authentication wrapper (Requirement 1, 2).
//
// The ONLY place the client knows about the auth provider. Everything else (store,
// app) talks to this small, provider-agnostic surface, so the real Supabase client
// can be swapped for a fake in `node --test` (NFR 5).
//
// Dependency injection: `createAuth({ client })` takes a Supabase-js-shaped client.
// In the browser, app.js constructs the real client (`createClient(url, anonKey)`)
// and passes it in (wired in Task 8). In tests, a fake client is passed.
//
// This module performs NO real network calls itself — it delegates to `client`.
// The demo/local path never constructs an auth instance at all (Requirement 8.6):
// auth exists only on the authenticated path.

/**
 * Shape of the injected client (subset of @supabase/supabase-js we use):
 *   client.auth.getSession() -> { data: { session }, error }
 *   client.auth.onAuthStateChange(cb) -> { data: { subscription: { unsubscribe } } }
 *   client.auth.signInWithOAuth({ provider, options }) -> { data, error }
 *   client.auth.signOut() -> { error }
 *   client.auth.refreshSession() -> { data: { session }, error }
 *   client.functions.invoke(name, { body }) -> { data, error }   // phone verify via edge fn
 */
export function createAuth({ client }) {
  if (!client || !client.auth) throw new Error('createAuth requires a Supabase-shaped client');

  const listeners = new Set();
  let session = null;
  let unsub = null;

  const userFromSession = (s) =>
    s && s.user
      ? { id: s.user.id, email: s.user.email ?? null, phoneVerified: !!(s.user.user_metadata?.phone_verified) }
      : null;

  const emit = () => { const u = userFromSession(session); listeners.forEach((fn) => fn(u)); };

  /** Restore an existing session on load (Requirement 1.5) and begin tracking changes. */
  async function init() {
    const { data, error } = await client.auth.getSession();
    if (error) { session = null; } else { session = data?.session ?? null; }
    // Subscribe so sign-in/out elsewhere (or token refresh) updates our view (1.2/1.6).
    const res = client.auth.onAuthStateChange((_event, s) => { session = s ?? null; emit(); });
    unsub = res?.data?.subscription?.unsubscribe ?? null;
    emit();
    return currentUser();
  }

  /** Current authenticated user, or null. Replaces store.me() for authenticated households (1.7). */
  function currentUser() { return userFromSession(session); }
  function isAuthenticated() { return !!userFromSession(session); }
  function accessToken() { return session?.access_token ?? null; }

  /** Subscribe to auth-state changes; returns an unsubscribe function. */
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  /** Start Google OAuth (Requirement 1.1, 1.2). Redirect/popup handled by the provider. */
  async function signInWithGoogle(redirectTo) {
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: redirectTo ? { redirectTo } : undefined,
    });
    if (error) return { ok: false, error: friendly(error) };
    return { ok: true, data };
  }

  /** End the session locally and with the provider (Requirement 1.4). */
  async function signOut() {
    const { error } = await client.auth.signOut();
    session = null;
    emit();
    if (error) return { ok: false, error: friendly(error) };
    return { ok: true };
  }

  /** Attempt a silent refresh; fall back to signed-out on failure (Requirement 1.6). */
  async function refresh() {
    const { data, error } = await client.auth.refreshSession();
    if (error || !data?.session) { session = null; emit(); return { ok: false }; }
    session = data.session; emit();
    return { ok: true };
  }

  // ---------- phone verification (Requirement 2) ----------
  // Delegated to an edge function so the Twilio token never reaches the browser
  // (Requirement 6.4). The function owns code lifecycle + rate limiting (Task 7).
  const E164 = /^\+[1-9]\d{1,14}$/;

  /** Request a verification code for a phone number (Requirement 2.1). */
  async function startPhoneVerify(e164) {
    if (!E164.test(String(e164 || ''))) {
      return { ok: false, error: 'Enter a phone number in international format, e.g. +15555550123.' };
    }
    const { data, error } = await client.functions.invoke('phone-verify-start', { body: { phone: e164 } });
    if (error) return { ok: false, error: friendly(error) };
    if (data && data.error) return { ok: false, error: data.error }; // rate-limit / collision (2.3–2.5)
    return { ok: true };
  }

  /** Submit a verification code (Requirement 2.2). On success the server marks it verified. */
  async function confirmPhoneVerify(code) {
    const c = String(code || '').trim();
    if (!/^\d{4,8}$/.test(c)) return { ok: false, error: 'Enter the numeric code we texted you.' };
    const { data, error } = await client.functions.invoke('phone-verify-check', { body: { code: c } });
    if (error) return { ok: false, error: friendly(error) };
    if (data && data.error) return { ok: false, error: data.error }; // wrong/expired (2.3)
    // refresh the session so the updated phone_verified flag is reflected (2.2)
    await refresh();
    return { ok: true, verified: true };
  }

  function dispose() { if (unsub) unsub(); unsub = null; listeners.clear(); }

  return {
    init,
    currentUser,
    isAuthenticated,
    accessToken,
    onChange,
    signInWithGoogle,
    signOut,
    refresh,
    startPhoneVerify,
    confirmPhoneVerify,
    dispose,
  };
}

/** Turn a provider error into a short, non-technical message (Requirement 1.3). */
function friendly(error) {
  const msg = (error && (error.message || error.error_description)) || '';
  if (/popup|cancell|closed/i.test(msg)) return 'Sign-in was cancelled. Please try again.';
  if (/network|fetch|connection/i.test(msg)) return 'Couldn’t reach the server. Check your connection and try again.';
  if (/rate|too many/i.test(msg)) return 'Too many attempts. Please wait a bit and try again.';
  return msg || 'Something went wrong. Please try again.';
}
