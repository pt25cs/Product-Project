// Browser runtime config (Phase 2). Copy to `config.js` and fill in your Supabase project's
// PUBLISHABLE values. Only these two browser-safe values live here (Requirement 6.4 / NFR 2);
// service-role and Twilio secrets never appear client-side.
//
// If `config.js` is absent or the values are blank, Kasa runs in DEMO-ONLY mode (no backend,
// no sign-in) — the app stays fully usable offline. This file is the example; `config.js` is
// git-ignored.
export const SUPABASE_URL = '';      // e.g. https://buwnxnhyxtzrkahkdkct.supabase.co
export const SUPABASE_ANON_KEY = ''; // the anon / publishable key

// Dummy sign-in (default when this file is absent or the values above are blank): "Continue with
// Google" signs you in as a dummy user, with no Supabase project and no network. Household
// data is kept in this browser's localStorage. Set to false for a demo-only build with no sign-in.
// export const MOCK_AUTH = false;
