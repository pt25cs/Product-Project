# Requirements — Accounts & Identity (Phase 2)

_Spec status: draft for review_

## Introduction

This spec covers **Phase 2** from `docs/roadmap.md` and `docs/master-plan.md`: real
authenticated users, synced to a Google/email identity and a verified phone number, with
server-backed profiles that supersede the Phase 1 local member-record scaffolding.

Phase 2 is explicitly described in the roadmap as **"the first server-side component in
Kasa's history."** It is therefore the point at which the project deliberately leaves behind
its founding constraints — dependency-free, no build step, static-only hosting. Those
constraints were always framed as a way to prove the coordination model cheaply before lifting
it onto a backend (see master-plan §2, "The pivot is deliberately sequenced"). This spec is
where that lift begins.

### Product rename

Alongside Phase 2, the product has been renamed from **RoomSync** to **Kasa**. All
user-facing strings change to "Kasa." Internal runtime identifiers that are not user-visible
(the `window.__roomsync` test hook and the `roomsync.*` localStorage keys) are intentionally
left unchanged to avoid orphaning existing local saves and churning the e2e harness; this is
captured as a non-functional requirement below.

### In scope

1. Authentication with a Google/email identity (OAuth) — real sign-in, sign-out, session.
2. A verified phone number per user (SMS one-time-code verification).
3. Server-backed user profiles (dietary, personal budget, personal rules) that replace the
   Phase 1 local `member.profile` fields and are portable across devices.
4. Profile privacy: a profile is owned by its authenticated user; the household sees only what
   is shared by design. The Phase 1 "editable by whoever is viewing as" model is retired.
5. Migration of an existing local household's state into the first authenticated account, so
   nothing is lost moving from local to synced.
6. The backend itself: a datastore and the API/edge surface the client talks to, with
   per-household data isolation.
7. Renaming all user-facing product strings to "Kasa."

### Out of scope (later roadmap phases)

- **Phase 3:** push/SMS *delivery* of notifications. Phase 2 verifies a phone number and
  stores it; it does not send notification texts. (The Phase 1 `prefs.channels` seam stays
  inert.)
- **Phase 4:** B2B multi-tenancy (property → unit → household) and the property-manager
  surface.
- **Phase 5:** full cross-device real-time sync of *all* household state and conflict
  resolution. Phase 2 syncs **identity and profiles**; broad household-state sync is Phase 5.
  (See "Scope boundary: what syncs in Phase 2" below.)

### Scope boundary: what syncs in Phase 2

This is the most important scoping decision in the phase, because "accounts synced across
devices" can be read narrowly or broadly.

- **Phase 2 makes portable:** a user's identity (Google/email + verified phone) and that
  user's **profile** (dietary, personal budget, personal rules). Signing in on a second device
  shows the same identity and the same profile.
- **Phase 2 does NOT yet make portable:** the full household dataset (chores, occurrences,
  expenses, shopping, events, notifications, activity). Broad household-state sync is Phase 5
  and is called out as a dependency there. Phase 2 establishes the account + the server-side
  home for a household and migrates the local data into it once, but real-time multi-device
  convergence of all collections is Phase 5.

The roadmap's Phase 2 exit criterion — "a roommate can sign in on two devices and see the same
profile" — is satisfied by profile + identity portability; it does not require full household
sync.

### Conventions

- Acceptance criteria use EARS phrasing ("WHEN … THE SYSTEM SHALL …").
- "The authenticated user" replaces Phase 1's "current roommate (`store.me()`)." The "Viewing
  as" switcher is retired for authenticated households (see Requirement 9).
- "Persisted" now means **written to the backend datastore and durable across devices and
  sessions**, not localStorage. Local persistence remains only as an offline/degraded path and
  as the source for one-time migration.
- Money remains integer cents, parsed/formatted via `js/logic.js` (`parseMoney`/`fmtMoney`).
- Secrets (OAuth client secret, Twilio credentials, service-role keys) are never committed and
  never shipped to the browser; see NFR 4.

---

## Requirement 1 — Google / email authentication

**User story:** As a roommate, I want to sign in with my Google account (or email), so that
Kasa knows who I am and my data follows me instead of living in one browser.

#### Acceptance criteria

1. WHEN an unauthenticated visitor opens Kasa, THE SYSTEM SHALL present a sign-in screen
   offering "Continue with Google" and SHALL NOT expose household data until authentication
   succeeds.
2. WHEN a user completes the Google OAuth flow successfully, THE SYSTEM SHALL establish an
   authenticated session, record the user's identity (stable provider id + email), and route
   them into the app.
3. WHEN OAuth fails or is cancelled, THE SYSTEM SHALL return the user to the sign-in screen
   with a clear, non-technical message and SHALL NOT create a partial session.
4. WHEN an authenticated user chooses to sign out, THE SYSTEM SHALL end the session on the
   client and invalidate it with the auth provider, returning to the sign-in screen.
5. WHEN a session exists and is still valid on app load, THE SYSTEM SHALL restore it without
   requiring the user to re-authenticate.
6. WHEN a session token has expired, THE SYSTEM SHALL attempt a silent refresh where the
   provider supports it, and SHALL fall back to the sign-in screen if refresh fails.
7. THE SYSTEM SHALL treat the authenticated user's identity as the single source of "who am I,"
   replacing `store.me()` for authenticated households.

---

## Requirement 2 — Verified phone number

**User story:** As a roommate, I want to verify my phone number, so that Kasa can later reach
me by text (Phase 3) and so my account has a second, trusted contact method.

#### Acceptance criteria

1. WHEN an authenticated user without a verified phone enters a phone number, THE SYSTEM SHALL
   validate its format and SHALL send a one-time verification code to that number via the SMS
   provider.
2. WHEN the user submits the correct verification code within its validity window, THE SYSTEM
   SHALL mark the phone number verified on the user's server-side record.
3. WHEN the user submits an incorrect or expired code, THE SYSTEM SHALL reject it with a clear
   message and SHALL allow re-requesting a new code, subject to rate limiting.
4. WHEN verification SMS are requested repeatedly, THE SYSTEM SHALL rate-limit send attempts to
   prevent abuse and SHALL communicate the limit to the user.
5. WHEN a phone number is already verified on another account, THE SYSTEM SHALL handle the
   collision explicitly (reject or require re-verification) rather than silently sharing a
   number across accounts.
6. THE SYSTEM SHALL store the phone number and its verified state server-side, never derive
   trust from a client-asserted flag.
7. WHEN phone verification is incomplete, THE SYSTEM SHALL still allow the user to use the app
   (verification is not a hard gate in Phase 2), while clearly indicating phone is unverified.
   (The hard dependency on a verified number is Phase 3 SMS delivery.)

---

## Requirement 3 — Server-backed user profiles

**User story:** As a roommate, I want my profile (dietary, personal budget, personal rules) to
live with my account on the server, so that it is the same on every device and is owned by me.

#### Acceptance criteria

1. WHEN an authenticated user edits their profile (dietary restrictions/preferences, personal
   budget, personal rules), THE SYSTEM SHALL persist those fields to the server on that user's
   record.
2. WHEN the same user signs in on a different device, THE SYSTEM SHALL load and display the
   identical profile from the server.
3. WHEN a personal budget amount is entered, THE SYSTEM SHALL validate it as a positive
   integer-cents amount using existing money parsing and reject invalid input with a clear
   message (parity with Phase 1 validation).
4. WHEN profile text fields exceed reasonable length limits, THE SYSTEM SHALL reject them with
   clear validation messages (parity with Phase 1: 300-char cap).
5. THE SYSTEM SHALL preserve the Phase 1 profile field *shape* (`dietary`, `budgetCents`,
   `rules`) so the UI adopts the server source without reshaping, per the master plan's
   interim-scaffolding intent.
6. WHEN a profile write fails (network/server error), THE SYSTEM SHALL surface a clear failure
   state and SHALL NOT silently drop the edit.

---

## Requirement 4 — Profile privacy and ownership

**User story:** As a roommate, I want my profile to be mine, so that the household sees only
what is meant to be shared and no one can edit my profile as me.

#### Acceptance criteria

1. THE SYSTEM SHALL allow only the authenticated owner of a profile to edit that profile.
2. WHEN a roommate views another household member, THE SYSTEM SHALL show only the fields
   designated as household-visible and SHALL NOT expose private contact details (e.g. the raw
   phone number) beyond what the owner shares.
3. THE SYSTEM SHALL enforce ownership and visibility **server-side** (e.g. row-level security),
   not only in the client UI.
4. THE SYSTEM SHALL retire the Phase 1 "editable by whoever is viewing as" model for
   authenticated households; a member's profile is no longer editable by other members.
5. WHEN the server rejects an unauthorized profile access or edit, THE SYSTEM SHALL fail
   closed (deny) and surface a clear message, never partially apply the change.

---

## Requirement 5 — Local-to-account migration

**User story:** As an existing local user, I want my current household (chores, expenses,
shopping, calendar, and my profile) brought into my new account when I first sign in, so that
switching to the real backend loses nothing.

#### Acceptance criteria

1. WHEN a user with existing local household data (`roomsync.v1` in localStorage) signs in for
   the first time, THE SYSTEM SHALL detect that local data and offer to import it into the
   newly authenticated account.
2. WHEN the user confirms import, THE SYSTEM SHALL create the household server-side and migrate
   the local household, members, chores, occurrences, expenses, reimbursements, shopping,
   events, expectations, purchasing rules, and the user's profile into it, preserving ids and
   relationships where feasible.
3. WHEN import maps the local "Viewing as" members to server identities, THE SYSTEM SHALL
   associate the signing-in user with the member they were acting as (or let them choose) and
   SHALL represent the remaining local members as not-yet-claimed placeholders that another
   real user can later claim by joining.
4. WHEN migration completes successfully, THE SYSTEM SHALL mark the local data as migrated so
   it is not re-imported on subsequent sign-ins, and SHALL NOT delete the local copy until the
   server copy is confirmed persisted.
5. WHEN migration fails partway, THE SYSTEM SHALL leave the local data intact, report the
   failure clearly, and SHALL NOT leave a half-migrated server household that corrupts future
   imports (import is atomic or safely resumable).
6. WHEN a user declines import, THE SYSTEM SHALL start them with a fresh empty server household
   and leave the local data untouched.

---

## Requirement 6 — Backend service and data isolation

**User story:** As the product, we need a server datastore and API so that identity and
profiles are durable, shared across a household, and isolated between households.

#### Acceptance criteria

1. THE SYSTEM SHALL provide a server-side datastore holding users, households, memberships,
   and profiles, with referential integrity between them.
2. THE SYSTEM SHALL scope all household data so that a user can read/write only households they
   are a member of, enforced server-side (row-level security or equivalent).
3. WHEN the client reads or writes server data, THE SYSTEM SHALL do so only through
   authenticated requests carrying the user's session, rejecting unauthenticated calls.
4. THE SYSTEM SHALL keep the client (browser) free of any privileged/service-role credential;
   privileged operations (if any) run only in a trusted server/edge context.
5. THE SYSTEM SHALL define the schema as versioned migrations checked into the repo so the
   datastore can be recreated deterministically.
6. WHEN the backend is unreachable, THE SYSTEM SHALL degrade clearly (explain the app needs a
   connection for account features) rather than failing silently or corrupting local state.

---

## Requirement 7 — Household membership via accounts

**User story:** As roommates, we want to be in the same household under our own accounts, so
that each of us signs in as ourselves instead of using a shared "Viewing as" switch.

#### Acceptance criteria

1. WHEN an authenticated user has no household, THE SYSTEM SHALL let them create one (becoming
   its first member) or join an existing one via an invitation.
2. WHEN a household member invites a roommate, THE SYSTEM SHALL produce an invitation (e.g. a
   link/code) that, when accepted by another authenticated user, adds them as a real member.
3. WHEN a user joins a household that has unclaimed placeholder members (from migration, R5.3),
   THE SYSTEM SHALL let them claim an existing placeholder member or join as a new member.
4. THE SYSTEM SHALL enforce household size limits consistent with the product (the Phase 1
   2–5 roommate guidance) at the server.
5. THE SYSTEM SHALL record each membership with the user's identity and role so later phases
   (B2B, Phase 4) can build on it.

---

## Requirement 8 — Client integration with the backend (persistence seam)

**User story:** As a developer, I want the client's data layer to talk to the backend through
the existing store seam, so that the UI and selectors keep working without a rewrite.

#### Acceptance criteria

1. THE SYSTEM SHALL route the store's persistence (today `load()`/`save()` against
   localStorage) through a backend-backed implementation for authenticated households, keeping
   the store's action functions (e.g. `addChore`, `addExpense`, `updateProfile`) as the stable
   seam the UI calls.
2. WHEN an authenticated action mutates state, THE SYSTEM SHALL persist the change to the
   backend and keep the in-memory `state` and subscribers (`emit()`) consistent with the
   persisted result.
3. WHEN a backend write fails, THE SYSTEM SHALL surface the existing save-failure affordance
   (the store already models `saveError`) and SHALL NOT present the write as succeeded.
4. THE SYSTEM SHALL keep pure logic in `js/logic.js` unchanged and backend-agnostic (money
   splits, rotation, dates stay client-side pure functions).
5. THE SYSTEM SHALL preserve the local-only path for an unauthenticated/demo user (the demo
   household still works without a backend), so the app remains demonstrable offline.
6. THE SYSTEM SHALL keep the demo/local path **permanently local**: it SHALL NOT require,
   contact, or depend on the backend at any point, and a demo session SHALL NEVER be silently
   upgraded to the authenticated/backend path. The demo stays local for its entire lifetime.
7. WHEN a demo/local user later chooses to sign in, THE SYSTEM SHALL treat moving their local
   data to an account as the explicit, opt-in migration of Requirement 5 — never an automatic
   switch — and until they do so, the demo continues to run entirely client-side.

---

## Requirement 9 — Retire "Viewing as" for authenticated households

**User story:** As a roommate, I want the app to act as *me* when I'm signed in, so that the
demo-only account switcher no longer stands in for real identity.

#### Acceptance criteria

1. WHEN a household is authenticated (real accounts), THE SYSTEM SHALL remove the "Viewing as"
   switcher and SHALL act as the signed-in user throughout.
2. WHEN running the demo/local household (no accounts), THE SYSTEM SHALL retain "Viewing as" as
   a demo affordance, clearly distinct from authenticated mode, and this local demo SHALL
   remain fully offline (no backend), consistent with Requirement 8.6.
3. THE SYSTEM SHALL update all copy that refers to "Viewing as" as a stand-in for accounts to
   reflect that real accounts now exist (README "What is simulated" section updated).

---

## Requirement 10 — Product rename to "Kasa"

**User story:** As a user, I want the product to be consistently called "Kasa," so the rename
is complete and there is no leftover "RoomSync" in anything I see.

#### Acceptance criteria

1. THE SYSTEM SHALL display "Kasa" in all user-visible strings: the document title, boot/loading
   text, the `noscript` message, in-app copy (including the "Kasa doesn't move money" / "No
   money was moved by Kasa" lines), and the dev-server startup log.
2. THE SYSTEM SHALL update product documentation (`README.md`, `docs/master-plan.md`,
   `docs/roadmap.md`) to use "Kasa."
3. THE SYSTEM SHALL leave non-user-visible runtime identifiers unchanged: the `window.__roomsync`
   test hook and the `roomsync.*` localStorage keys (`roomsync.v1`, `roomsync.coach.v1`,
   `roomsync.tour.v1`), to avoid orphaning existing local saves and breaking the e2e harness.
4. WHEN the rename lands, THE SYSTEM SHALL keep all existing tests green; any test asserting a
   user-visible "RoomSync" string is updated to "Kasa," while tests referencing the internal
   `window.__roomsync` hook are left unchanged.

---

## Non-functional requirements

1. **Architecture pivot is intentional and bounded.** Introducing a backend ends the
   dependency-free / no-build / static-only constraints *for the authenticated path only*. The
   demo/local path MUST still run with no backend (NFR parity with today's offline demo), so
   the app stays demonstrable without credentials.
2. **Security.** OAuth and SMS verification MUST follow provider best practices. No secret
   (OAuth client secret, SMS provider auth token, datastore service-role key) is committed to
   the repo or shipped to the browser. The browser holds only publishable/anon keys and the
   user's own session token.
3. **Data isolation.** Household data MUST be isolated per household server-side (row-level
   security or equivalent), verified by tests against the policy, not just the UI.
4. **Secrets & config.** All credentials come from environment variables / provider config,
   documented in a setup guide. The repo ships `.env.example` placeholders, never real values,
   and `.env` is git-ignored.
5. **Testability at the provider boundary.** Auth, SMS, and datastore access MUST be
   abstracted behind interfaces so logic can be tested with mocked providers under
   `node --test`, without live credentials. Live end-to-end verification (real Google sign-in,
   a real SMS arriving, two real devices) requires provisioned credentials and is documented as
   a manual step, not an automated gate.
6. **Migration safety.** Local-to-account migration MUST be non-destructive to local data until
   the server copy is confirmed, and MUST be idempotent (safe if retried).
7. **Backwards/offline compatibility.** Existing local `roomsync.v1` saves MUST still load for
   the unauthenticated/demo path and MUST be the input to migration; the loader's version guard
   and normalization are unchanged for that path.
8. **No scope creep into Phase 3–5.** Phase 2 verifies and stores a phone number but sends no
   notification texts (Phase 3); it syncs identity + profile but not the full household dataset
   in real time (Phase 5).

---

## Open questions (resolve during design review)

1. **Managed vs. custom backend.** Recommended: **Supabase** (managed Postgres + Google OAuth +
   row-level security + phone-OTP path). Alternative: a custom API + Postgres. Design doc makes
   the case and pins the choice.
2. **SMS provider.** Recommended: **Twilio Verify** for the one-time-code flow (works whether
   Supabase or custom). Supabase phone-OTP still needs an SMS provider underneath, so Twilio is
   the concrete dependency either way.
3. **Repo restructure.** Where the backend lives (e.g. `web/` + Supabase config/edge functions)
   and how hosting splits (static app on Vercel; backend on the managed platform). Design doc
   proposes the layout.
4. **How much household data migrates now vs. Phase 5.** This spec migrates the full local
   household **once** into the server home but does not add real-time multi-device sync of all
   collections (that's Phase 5). Confirm this boundary in review.
