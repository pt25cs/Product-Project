# Tasks — Accounts & Identity (Phase 2)

_Spec status: draft for review. Do not start coding until requirements.md and design.md are
approved. Resolve the design.md "Open questions" first — especially the backend stack
(Supabase + Twilio), the `web/` restructure, and the migrate-now boundary._

Each task is a discrete, reviewable step. Sub-bullets name files and reference the
requirement(s) each task satisfies. Tasks are ordered so config/schema and the provider-boundary
abstractions land before UI, and so the local/demo path is never broken (Requirement 8.5).
Prefer writing tests against **mocked providers** alongside each step (NFR 5); live-credential
verification is a documented manual step, not an automated gate.

The **rename to Kasa (Task 1)** is intentionally first and standalone: it is low-risk,
user-visible, and unblocks everything else without depending on the backend.

---

- [x] 1. Rename user-facing product strings to "Kasa"
  - Update `index.html` (`<title>`, boot text, `noscript`), `js/app.js` (visible copy incl.
    "Kasa doesn't move money" / "Paid outside Kasa" / "No money was moved by Kasa"),
    `serve.mjs` startup log, and docs (`README.md`, `docs/master-plan.md`, `docs/roadmap.md`).
  - Leave internal identifiers unchanged: `window.__roomsync`, `roomsync.v1`,
    `roomsync.coach.v1`, `roomsync.tour.v1`.
  - _Requirements: 10.1, 10.2, 10.3._
  - _Test:_ update e2e assertions expecting visible "RoomSync" strings to "Kasa"
    (`tests/e2e.demo.mjs`); leave `window.__roomsync` references untouched; full suite green
    (10.4).

- [x] 2. Restructure the repo for client + backend
  - Move the static app under `web/` (`index.html`, `css/`, `js/`, `tests/`, `serve.mjs`);
    update `vercel.json` `outputDirectory` to `web`. Add `supabase/` (`config.toml`,
    `migrations/`, `functions/`, `seed.sql`). Add `.env.example` (placeholders) and git-ignore
    `.env`.
  - Convert `package.json` to real dependencies (pinned, exact) + scripts (dev/test/supabase).
  - _Requirements: NFR 1, NFR 4; design §2._
  - _Test:_ existing `node --test` suite and `serve.mjs` still run from the new layout; no
    source import breaks.

- [ ] 3. Define the Postgres schema and RLS as versioned migrations
  - SQL migrations under `supabase/migrations/`: `profiles`, `households`, `memberships`,
    `invitations`, and household-content tables (chores/occurrences/expenses/reimbursements/
    shopping/events/expectations/purchasing/notifications/activity) each with `household_id`
    and mirrored field shapes. Add RLS policies: profile owner-only write + household-visible
    read; household membership-scoped read/write; owner-only phone exposure.
  - _Requirements: 3, 4.1–4.3, 6.1, 6.2, 6.5, 7, NFR 3._
  - _Test:_ RLS tests (Supabase local / pgTAP) — a member reads only their household; cannot
    read another; updates only their own profile; `phone_e164` not exposed to others.

- [ ] 4. Build the auth module wrapper (`web/js/auth.js`)
  - Wrap the Supabase client: `getSession`, `onAuthStateChange`, `signInWithGoogle`,
    `signOut`, session restore + silent refresh, and current-user accessors. Provider-agnostic
    surface so it is mockable.
  - _Requirements: 1.1–1.7, NFR 5._
  - _Test:_ with a mocked provider, sign-in establishes a session, sign-out clears it, expired
    session triggers refresh then falls back to signed-out.

- [ ] 5. Add the backend-backed persistence seam to the store
  - Extend `createStore({ storage, backend, now })`: when `backend` is present, `load()`
    hydrates `state` from the backend and `save()`/`commit()` persist mutations through it;
    when absent, behavior is exactly today (local/demo). `me()` returns the authenticated
    membership id for authenticated households. Reuse `saveError` for backend write failures;
    surface a clear "needs connection" state when unreachable. Keep `js/logic.js` pure.
  - _Requirements: 8.1–8.5, 6.6, 1.7._
  - _Test:_ with an in-memory fake `backend`, actions persist + keep `state`/`emit()`
    consistent; failing backend sets `saveError` and does not report success; local/demo path
    (no backend) unchanged — existing `store.test.mjs` stays green.

- [ ] 6. Server-backed profiles
  - Route `updateProfile(patch)` to the `profiles` row for authenticated households, same field
    shape (`dietary`, `budgetCents`, `rules`) and validation (300-char caps, `parseMoney`).
    Load profile on sign-in; render other members' profiles read-only.
  - _Requirements: 3.1–3.6, 4.1, 4.4._
  - _Test (mocked backend):_ owner edit persists + reloads identically; invalid budget/length
    rejected; non-owner write denied; write failure surfaced (no silent drop).

- [ ] 7. Phone verification (Twilio Verify)
  - Edge function(s) + `auth.js` methods: `startPhoneVerify(e164)` (send code),
    `confirmPhoneVerify(code)` (verify → set `profiles.phone_verified`). Handle wrong/expired
    code, rate limiting, and already-verified-elsewhere collision. Store number + verified flag
    server-side only.
  - _Requirements: 2.1–2.7, 6.4._
  - _Test (fake Twilio):_ correct code verifies; wrong/expired rejected; rate limit surfaced;
    collision handled; client never holds the Twilio token.

- [ ] 8. Sign-in shell, sign-out, and retire "Viewing as"
  - `app.js`: top-level gate renders the sign-in screen ("Continue with Google") when
    unauthenticated (and not explicit demo); render the app as the signed-in user otherwise.
    Remove the "Viewing as" switcher for authenticated households (keep it, clearly marked, for
    the demo). Add sign-out + phone-verify entry in `#/profile` or `#/account`.
  - _Requirements: 1.1, 1.4, 9.1, 9.2, 9.3._
  - _Test (mocked auth):_ unauthenticated shows sign-in and no household data; authenticated
    shows app without "Viewing as"; demo still shows it.

- [ ] 9. Household create / join / invitations
  - Create household (first membership), generate invitations (code/link), accept invitation to
    join as a new member or claim a migration placeholder; enforce 2–5 size server-side.
  - _Requirements: 7.1–7.5._
  - _Test:_ create → first member; accept invite → new membership; claim placeholder → bound to
    user; size limit rejected server-side.

- [ ] 10. Local-to-account migration (`migrate-import` edge function + client flow)
  - Detect `roomsync.v1` on first authenticated load; offer import. Client reads + `normalize()`s
    local state and POSTs it; the edge function transactionally creates the household +
    memberships (signing-in user `claimed`, others placeholders) + all content + the user's
    profile, preserving ids where allowed. On success write a `roomsync.migrated.v1` marker and
    keep local data; on failure roll back and leave local intact; idempotent on retry. Member
    mapping selector ("which local member is me"). Decline → fresh empty household.
  - _Requirements: 5.1–5.6, 7.3, NFR 6._
  - _Test:_ local JSON → expected insert payloads (mapping, placeholders, id preservation);
    marker prevents re-import; simulated mid-import failure leaves no half-migrated household
    and local data intact; retry is safe.

- [ ] 11. Setup guide and config documentation
  - `docs/phase-2-setup.md`: create the Google OAuth client (redirect URIs), the Twilio Verify
    service, and the Supabase project; configure providers; fill `.env` from `.env.example`.
    Document the manual live-verification exit check (real sign-in, real SMS, two devices).
  - Update `README.md` "What is simulated or not supported" and "To make it real later" to
    reflect that accounts/backend now exist; update `docs/roadmap.md` Phase 2 status when done.
  - _Requirements: NFR 2, NFR 4, NFR 5; 9.3; roadmap Phase 2 exit criteria._

- [ ] 12. Full verification pass
  - Run `node --test` (store authenticated path with fakes, migration mapping, phone-verify,
    rename assertions) + RLS policy tests on Supabase local. Confirm: no secret committed or
    shipped to the browser; demo/local path still works with no backend; existing local saves
    still load and feed migration. Then perform the documented manual live check with real
    credentials and record results against the roadmap exit criteria.
  - _Requirements: all; NFR 1, 2, 3, 5, 6, 7, 8._

---

## Traceability summary

| Requirement                         | Tasks              |
| ----------------------------------- | ------------------ |
| 1 Google/email auth                 | 4, 8, 12           |
| 2 Verified phone                    | 7, 11, 12          |
| 3 Server-backed profiles            | 3, 6, 12           |
| 4 Profile privacy/ownership         | 3, 6, 12           |
| 5 Local-to-account migration        | 10, 12             |
| 6 Backend & isolation               | 2, 3, 5, 7, 12     |
| 7 Membership via accounts           | 3, 9, 10, 12       |
| 8 Client persistence seam           | 5, 6, 12           |
| 9 Retire "Viewing as"               | 8, 11              |
| 10 Rename to Kasa                   | 1                  |
| NFR (pivot/security/isolation/      | 2, 3, 5, 10, 11,   |
| secrets/testability/migration)      | 12                 |

---

## Credentials boundary (what blocks the live exit criteria)

Tasks 1–10 are buildable and testable with **mocked providers** and Supabase local. The
roadmap's live exit criteria — real Google sign-in, a real verification SMS, and the same
profile on two devices — require a provisioned **Supabase project, Google OAuth client, and
Twilio Verify service** with real secrets in `.env`. Those credentials come from the product
owner; the design keeps every secret out of the repo and the browser.
