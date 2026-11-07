# Design — Accounts & Identity (Phase 2)

_Spec status: draft for review_

This design maps the Phase 2 requirements onto Kasa's architecture and introduces the first
server-side component in the product's history. It references real functions and state shapes
from `js/store.js`, `js/logic.js`, `js/app.js`, and `js/tour.js` so the client changes stay
consistent with the current code, and it defines the new backend concretely.

---

## 0. The architectural pivot (why this is different from Phase 1)

> **Two runtime paths, one app. The demo stays local — forever.** Kasa runs the demo/local
> household entirely client-side (localStorage, "Viewing as," no network), exactly as it does
> today, and that never changes. The real backend (Supabase + Twilio) powers the
> **authenticated** path only. A demo session is never silently upgraded to the backend;
> moving local data to an account happens only through the explicit opt-in migration
> (§5 / Requirement 5). See Requirements 8.5–8.7 and 9.2.

Every prior phase shipped as dependency-free vanilla ES modules, no build step, static hosting
on Vercel, all data in `localStorage`. Phase 2 deliberately ends that for the **authenticated
path**: it adds a managed backend, a dependency set, and build/config. This is the roadmap's
stated intent ("the first server-side component in Kasa's history"). Two invariants constrain
the pivot:

- **The demo/local path keeps working with no backend.** An unauthenticated visitor can still
  open the demo household entirely client-side (Requirement 8.5, NFR 1). This keeps the app
  demonstrable without credentials and preserves the offline story.
- **The store's action functions stay the seam.** The UI (`app.js`) keeps calling
  `addChore`, `addExpense`, `updateProfile`, etc. What changes is `load()`/`save()` behind
  them (Requirement 8.1). `js/logic.js` stays pure and backend-agnostic (8.4).

---

## 1. Recommended stack (resolves Open Questions 1 & 2)

**Backend: Supabase.** It bundles exactly what Phase 2 needs with the least custom infra:

- **Postgres** datastore with versioned SQL migrations checked into the repo (R6.1, R6.5).
- **Supabase Auth** with a **Google OAuth** provider (R1) and session/JWT handling, including
  refresh (R1.6).
- **Row-Level Security (RLS)** for per-household isolation and per-user profile ownership,
  enforced in the database, not just the client (R4.3, R6.2, NFR 3).
- **Phone auth / OTP** path; under the hood it needs an SMS provider, which we configure as
  **Twilio Verify** (R2). We use Twilio Verify for the one-time-code flow because it owns code
  generation, expiry, and rate limiting (R2.3, R2.4) so we don't reimplement them.
- **Edge Functions** (Deno) for the few operations that must run server-side with elevated
  privilege (migration import, phone-collision checks) so no service-role key ever reaches the
  browser (R6.4, NFR 2).

**Why not a custom API + Postgres:** it's more control but materially more to build and
operate (auth, session refresh, RLS-equivalent authZ, migrations tooling, deploy) for no Phase
2 benefit. Supabase covers auth + DB + RLS + OTP as managed concerns. If a future phase needs
bespoke server logic, Edge Functions already provide that seam.

**SMS: Twilio Verify** (R2). Chosen because it handles code lifecycle and rate limiting as a
service; Supabase phone-OTP is wired to use Twilio as its messaging provider. Either way Twilio
is the concrete external dependency.

**Hosting:** the static client stays on **Vercel**; the backend is Supabase's managed platform.
No change to the Vercel static deploy except environment variables for the publishable Supabase
URL + anon key. Edge Functions deploy to Supabase.

---

## 2. Repo restructure (resolves Open Question 3)

Introduce a clear client/server split without disturbing the client's internal layout:

```
/
  web/                     # the existing static app, moved as-is
    index.html
    css/ js/ tests/ serve.mjs
  supabase/
    config.toml            # project config (providers, auth settings)
    migrations/            # versioned SQL: tables, RLS policies, indexes
    functions/             # Edge Functions (Deno): migrate-import, phone-check
    seed.sql               # optional local dev seed
  package.json             # now has real deps + scripts (dev/build/test/supabase)
  .env.example             # placeholders only; real .env is git-ignored
  vercel.json              # points static hosting at web/
  docs/
```

- Moving the app under `web/` keeps `js/`, `css/`, `tests/`, `serve.mjs` intact so existing
  relative imports and the e2e harness still resolve; `vercel.json` `outputDirectory` updates
  to `web`.
- `package.json` gains the Supabase client dependency and dev tooling. The **no-build**
  property relaxes to "the client can still run unbuilt for the demo, but the project now has a
  dependency and tooling for the authenticated path" (NFR 1).
- **Pinned, exact dependency versions** (per security guidance); `.env` git-ignored; only
  `VITE_`/publishable values reach the browser.

> Decision to confirm in review: moving the app into `web/` vs. leaving it at root and nesting
> `supabase/` beside it. The design assumes the `web/` move for a clean split; if you prefer
> minimal churn we can keep the client at root. This is called out because it touches every
> relative path in tooling (not source).

---

## 3. Data model (Postgres)

New server schema (SQL migrations under `supabase/migrations/`). Shapes mirror the client state
so the store maps cleanly.

```sql
-- Identity is Supabase auth.users (managed): id (uuid), email, provider.
-- Our tables reference auth.uid().

create table profiles (                 -- R3, R4; one row per auth user
  user_id      uuid primary key references auth.users on delete cascade,
  display_name text not null,
  dietary      text default '',         -- length-capped in app + check constraint
  budget_cents integer,                 -- personal budget, null allowed; >= 0
  rules        text default '',
  phone_e164   text,                    -- stored server-side only (R2.6)
  phone_verified boolean not null default false,
  updated_at   timestamptz not null default now()
);

create table households (               -- R6, R7
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid not null references auth.users,
  created_at  timestamptz not null default now()
);

create table memberships (              -- R7; links users to households
  household_id uuid references households on delete cascade,
  user_id      uuid references auth.users on delete cascade,
  role         text not null default 'member',    -- seam for Phase 4 roles
  display_name text not null,                      -- the member's name in this household
  claimed      boolean not null default true,      -- false = migration placeholder (R5.3, R7.3)
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table invitations (              -- R7.2
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  code         text not null unique,
  created_by   uuid not null references auth.users,
  placeholder_membership uuid,          -- optional: invite to claim a specific placeholder
  expires_at   timestamptz,
  accepted_by  uuid references auth.users,
  created_at   timestamptz not null default now()
);

-- Household content tables (chores, occurrences, expenses, reimbursements, shopping,
-- events, expectations, purchasing, notifications, activity) are created to receive the
-- one-time migration (R5) and to host the authenticated household. Each carries a
-- household_id FK and is RLS-scoped to members. Field shapes mirror js/store.js state so
-- the client maps 1:1. (Full column list enumerated in the migration; elided here.)
```

**RLS policies (R4.3, R6.2, NFR 3):**

- `profiles`: a user may `select` profiles of users who share a household with them, but may
  `update` only their own row (`user_id = auth.uid()`). `phone_e164` is exposed only to the
  owner (R4.2) via a column-level view/policy.
- `households` / `memberships` / content tables: a row is visible/writable only if
  `auth.uid()` has a membership in that `household_id`. Enforced by policy predicates that
  join through `memberships`.
- Placeholder memberships (`claimed = false`) are readable by household members but map to no
  `auth.users` row until claimed.

**Versioned migrations (R6.5):** every schema object and policy ships as a numbered SQL file so
the database is deterministically reproducible (`supabase db reset` locally, CI apply remotely).

---

## 4. Client architecture

### 4.1 Auth module (`web/js/auth.js`, new)

Wraps the Supabase client and is the only place the client knows about the provider:

```js
export function createAuth({ supabaseUrl, anonKey }) {
  // getSession(), onAuthStateChange(cb)
  // signInWithGoogle()           -> OAuth redirect/popup (R1.1, R1.2)
  // signOut()                    -> (R1.4)
  // startPhoneVerify(e164)       -> Twilio Verify send (R2.1)
  // confirmPhoneVerify(code)     -> verify + mark profiles.phone_verified (R2.2)
  // current user id / email / phone-verified state
}
```

- Session restore on load (R1.5) and silent refresh (R1.6) come from the Supabase client;
  `onAuthStateChange` drives the app between "signed out" and "signed in" shells.
- The module exposes a small, provider-agnostic surface so it can be swapped/mocked (NFR 5).

### 4.2 Backend-backed persistence seam (`web/js/store.js`)

Today `createStore({ storage })` loads/saves a single JSON blob to `localStorage`. We add a
**remote backend** alongside the existing local one, selected by auth state:

```js
createStore({ storage, backend, now })   // backend optional; omitted = local/demo path
```

- **Local/demo path (unchanged, R8.5):** no `backend` → exactly today's behavior (localStorage,
  "Viewing as," demo household). This preserves the offline demo and all existing tests.
- **Authenticated path (R8.1, R8.2):** `backend` provided → `load()` hydrates `state` from the
  backend for the user's household; `save()`/`mutate()` persist mutations to the backend. The
  **action functions do not change** — `addChore`, `addExpense`, `updateProfile`, etc. still
  run the same validation and in-memory mutation; only the persistence call under `commit()`
  differs.
- `me()` returns the authenticated user's membership id instead of the "Viewing as" selection
  (R1.7, R9.1).
- **Write failures (R8.3):** reuse the store's existing `saveError` model so the UI's
  save-failure banner lights up on a failed backend write; the write is not reported as
  success.
- **Backend unreachable (R6.6):** `load()` surfaces a clear "needs connection" state rather
  than silently falling back or corrupting local state.

> **Scope note (NFR 8):** Phase 2 wires the backend for **identity + profiles** end-to-end and
> performs a **one-time migration** of the full household into the server tables. Real-time
> multi-device convergence of all collections (live chores/expenses sync) is **Phase 5**. In
> Phase 2 the authenticated store reads the household at load and writes mutations through, but
> we do not add realtime subscriptions / conflict resolution yet.

### 4.3 Profiles (`updateProfile` → server, R3)

Phase 1's `updateProfile(patch)` mutates `me().profile` locally. For authenticated households
it writes to the `profiles` row via the backend, keeping the **same field shape** (`dietary`,
`budgetCents`, `rules`) and the **same validation** (300-char caps, `parseMoney` for
`budgetCents`) so the UI is unchanged (R3.3, R3.4, R3.5). Only the owner can write (R4.1,
enforced by RLS, R4.3); other members' profiles are read-only in the UI and at the DB.

### 4.4 Phone verification UI (R2)

A step in the Profile area: enter number → "Send code" (`startPhoneVerify`) → enter code →
"Verify" (`confirmPhoneVerify`). Shows unverified state without blocking app use (R2.7).
Rate-limit and collision messages come back from the provider/edge function (R2.3–R2.5).

### 4.5 Sign-in shell and router (`app.js`, R1, R9)

- A new top-level gate: if not authenticated (and not in explicit demo mode), render the
  **sign-in screen** ("Continue with Google") instead of the app shell (R1.1).
- On auth, render the app as the signed-in user; **remove the "Viewing as" switcher** for
  authenticated households (R9.1). The demo/local household may keep it, clearly marked (R9.2).
- Add a `#/account` (or extend `#/profile`) area for sign-out and phone verification.

### 4.6 Household create/join + invitations (R7)

- Authenticated user with no household: **Create household** (writes `households` +
  `memberships` as first member) or **Join** via an invitation code (R7.1).
- **Invite:** a member generates an invitation (`invitations` row + shareable code/link);
  acceptance by another authenticated user inserts a `memberships` row (R7.2), or **claims a
  placeholder** member left by migration (R7.3).
- Household size limit (2–5 guidance) enforced server-side via a check/trigger or edge
  function (R7.4).

---

## 5. Local-to-account migration (R5)

The riskiest flow; designed to be **non-destructive and idempotent** (NFR 6).

**Trigger (R5.1):** on first authenticated load, if `localStorage['roomsync.v1']` exists and is
not yet marked migrated, offer "Import your existing household."

**Import (R5.2), via an Edge Function `migrate-import`** (runs server-side so it can insert
across tables transactionally):

1. Client reads and `normalize()`s the local state (reusing the existing loader/normalizer).
2. Client POSTs the local household JSON to the edge function with the user's session.
3. The function, in a single transaction: creates the `households` row; creates
   `memberships` — the signing-in user's chosen member is `claimed=true` tied to `auth.uid()`,
   the rest are `claimed=false` placeholders (R5.3, R7.3); inserts chores/occurrences/expenses/
   reimbursements/shopping/events/expectations/purchasing/activity and the user's profile,
   preserving ids where the schema allows (R5.2).
4. On success it returns the new `household_id`; the client records a **migrated marker** in
   localStorage (e.g. `roomsync.migrated.v1 = <household_id>`) so it won't re-import (R5.4),
   and does **not** delete the local copy (R5.4 — keep until server confirmed; we keep it as a
   safety net).

**Member mapping (R5.3):** default maps the signing-in user to the member they were last
"Viewing as"; a selector lets them pick which local member is "me." Unclaimed members become
placeholders a future real user claims by joining (R7.3).

**Atomicity & failure (R5.5):** the import is one DB transaction in the edge function — it
either fully commits or rolls back, so there is never a half-migrated household. On failure the
client reports it and leaves local data intact (R5.5). Idempotency: the migrated marker plus a
server-side guard (reject a second import for the same source signature) make retries safe
(NFR 6).

**Decline (R5.6):** start a fresh empty server household; local data untouched.

---

## 6. Provider-boundary abstraction & testing (NFR 5, R-tests)

To stay testable without live credentials, the three external concerns sit behind interfaces:

- `auth` (sign-in/out, session, phone verify) — `web/js/auth.js`, mockable.
- `backend` (read household, persist mutations, profile r/w) — a `backend` object passed to
  `createStore`, mockable with an in-memory fake.
- `edge functions` — pure TS handlers that take inputs and a db client, unit-testable with a
  fake db.

**Automated tests (`node --test`, mocked providers):**

- Store authenticated path: with a fake `backend`, actions persist via the backend and keep
  `state`/`emit()` consistent; a failing backend sets `saveError` and does not report success
  (R8.2, R8.3).
- Migration mapping: local JSON → expected server insert payloads (member mapping, placeholders,
  id preservation, idempotent marker) (R5.2–R5.4).
- Phone verify flow against a fake Twilio: correct code verifies, wrong/expired rejects, rate
  limit surfaces (R2.2–R2.4).
- RLS policy tests: using Supabase local (pgTAP or SQL tests) assert a member can read their
  household and cannot read another household, and can update only their own profile (R4,
  R6.2, NFR 3).
- Rename: tests asserting user-visible strings expect "Kasa"; `window.__roomsync` hook tests
  unchanged (R10.4).

**Manual/live verification (documented, not an automated gate — NFR 5):** real Google sign-in,
a real SMS code arriving, and signing in on two devices to see the same profile. These need the
provisioned Supabase project + Twilio account and are listed in the setup guide as the Phase 2
exit-criteria check.

---

## 7. Product rename to "Kasa" (R10)

**User-visible (change to "Kasa"):**

- `web/index.html`: `<title>`, the boot `<p class="boot">Loading …</p>`, the `noscript`
  message.
- `web/js/app.js`: the "Record a payment … Kasa doesn't move money." hint, the "Paid outside
  Kasa" rows, the "No money was moved by Kasa." toast, and any other visible "RoomSync."
- `web/serve.mjs`: the startup log string.
- Docs: `README.md`, `docs/master-plan.md`, `docs/roadmap.md`.

**Left unchanged (internal, not user-visible — R10.3):**

- `window.__roomsync` test hook (used throughout `tests/e2e.*`).
- localStorage keys `roomsync.v1`, `roomsync.coach.v1`, `roomsync.tour.v1` (renaming would
  orphan existing saves and break the e2e harness; also the migration marker reuses the
  `roomsync.*` namespace for consistency).
- `package.json` `"name": "roomsync"` can stay or become `"kasa"` — not user-visible; design
  proposes renaming it for clarity since it's low-risk, but it is not required by R10.

**Tests (R10.4):** update assertions that check a visible "RoomSync" string (e.g.
`tests/e2e.demo.mjs` waits on "RoomSync doesn't move money." / "No money was moved by
RoomSync.") to "Kasa"; leave `window.__roomsync` references alone.

---

## 8. Configuration & secrets (NFR 2, NFR 4)

- `.env.example` documents: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (publishable, browser-safe),
  and server-only (edge function / tooling) `SUPABASE_SERVICE_ROLE_KEY`, `TWILIO_ACCOUNT_SID`,
  `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`, and the Google OAuth client id/secret
  (configured in Supabase Auth, not shipped to the browser).
- Only `SUPABASE_URL` + `SUPABASE_ANON_KEY` reach the client. Service-role and Twilio
  credentials live only in Supabase (edge function env / auth provider config).
- `.env` is git-ignored; a `docs/phase-2-setup.md` explains creating the Google OAuth client,
  the Twilio Verify service, and the Supabase project, then filling `.env`.

---

## 9. What I can build vs. what needs you (credentials boundary)

Stated plainly so the plan's limits are explicit:

- **I build:** the schema + RLS migrations, the `auth.js` wrapper, the backend-backed store
  seam, the phone-verify UI, the sign-in shell, household create/join/invite, the
  `migrate-import` edge function, the rename, `.env.example`, the setup guide, and all
  mocked-provider `node --test` suites.
- **You provide (can't be automated):** a Supabase project, a Google Cloud OAuth client
  (id/secret + redirect URIs), and a Twilio account + Verify service — with their real secrets
  dropped into `.env` / Supabase config. Live sign-in, a real SMS, and the two-device check run
  once those exist.

---

## 10. Requirement → design traceability

| Requirement                         | Design sections            |
| ----------------------------------- | -------------------------- |
| 1 Google/email auth                 | 1, 4.1, 4.5                |
| 2 Verified phone                    | 1, 4.4, 6, 8               |
| 3 Server-backed profiles            | 3, 4.2, 4.3                |
| 4 Profile privacy/ownership         | 3 (RLS), 4.3               |
| 5 Local-to-account migration        | 5                          |
| 6 Backend & isolation               | 1, 3, 8                    |
| 7 Membership via accounts           | 3, 4.6                     |
| 8 Client persistence seam           | 4.2, 6                     |
| 9 Retire "Viewing as"               | 4.5, 7                     |
| 10 Rename to Kasa                   | 7                          |
| NFR (pivot, security, isolation,    | 0, 1, 2, 3, 6, 8           |
| secrets, testability, migration)    |                            |

---

## Decisions (confirmed in review)

1. **`web/` restructure — confirmed.** The static app moves under `web/`; `supabase/` sits
   beside it. (Was open question 1.)
2. **`package.json` name — renamed to `kasa`** during the Task 1 rename. (Was open question 2.)
3. **Demo stays permanently local — confirmed.** Two runtime paths; the demo never contacts or
   upgrades to the backend (Requirements 8.5–8.7, 9.2; see §0 banner).
4. **Migration-now boundary — confirmed.** Migrate the full household once; real-time
   multi-device sync stays in Phase 5. (Was open question 4.)

## Open questions (remaining, for sign-off before backend coding)

1. **Supabase phone-OTP vs. calling Twilio Verify directly from an edge function** — both work;
   design leans on Twilio Verify owning the code lifecycle. Confirm preference (or let the
   design decide).
