// Session controller (Requirement 1, 9). Decides which MODE the app is in and owns the small
// state machine between signed-out, demo (local), and authenticated. Kept DOM-free so it is
// unit-testable (NFR 5); app.js renders based on mode() and calls the actions.
//
// Modes:
//   'signed-out'    no auth session, no local/demo household loaded -> show sign-in screen
//   'demo'          a local/demo household is active (no backend)   -> full app, "Viewing as" kept
//   'authenticated' a real auth session is active (backend)         -> full app, "Viewing as" gone
//
// The demo stays permanently local (Requirement 8.6): entering demo never constructs auth and
// never contacts a backend. Signing in is a separate, explicit path.

export function createSession({ getAuth = () => null, hasLocalHousehold = () => false } = {}) {
  // `getAuth()` returns the createAuth(...) instance once available, or null when no backend is
  // configured (pure demo deployment). It MUST be a function (not a captured value) so the
  // session reflects auth being wired in asynchronously after boot.
  let demoActive = false;

  const auth = () => getAuth();
  function authed() { const a = auth(); return !!(a && a.isAuthenticated()); }

  /** The current mode (Requirement 1.1, 9.1/9.2). */
  function mode() {
    if (authed()) return 'authenticated';
    if (demoActive || hasLocalHousehold()) return 'demo';
    return 'signed-out';
  }

  /** Is the "Viewing as" switcher allowed? Only in demo/local mode (Requirement 9.1/9.2). */
  function showViewingAs() { return mode() === 'demo'; }

  /** Whether a Google sign-in affordance should be offered (only when auth is configured). */
  function canSignIn() { return !!auth(); }

  /** Enter the demo/local path explicitly. Never touches auth/backend (Requirement 8.6). */
  function enterDemo() { demoActive = true; }

  /** Leave demo (e.g., returning to the sign-in screen without data). */
  function exitDemo() { demoActive = false; }

  return { mode, showViewingAs, canSignIn, authed, enterDemo, exitDemo };
}
