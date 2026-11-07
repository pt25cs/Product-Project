// Browser runtime config (Phase 2). Copy to `config.js` and fill in your Supabase project's
// PUBLISHABLE values. Only these two browser-safe values live here (Requirement 6.4 / NFR 2);
// service-role and Twilio secrets never appear client-side.
//
// If `config.js` is absent or the values are blank, Kasa runs in DEMO-ONLY mode (no backend,
// no sign-in) — the app stays fully usable offline. This file is the example; `config.js` is
// git-ignored.
export const SUPABASE_URL = '';      // e.g. https://buwnxnhyxtzrkahkdkct.supabase.co
export const SUPABASE_ANON_KEY = ''; // the anon / publishable key
