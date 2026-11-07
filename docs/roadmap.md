# Kasa Roadmap

_Last updated: 2026-10-23_

This roadmap sequences Kasa's delivery across phases. It pairs with `docs/master-plan.md`
(the why) and the spec at `.kiro/specs/household-coordination-v2/` (the detailed how for the
local-first phase).

Guiding rule: **every phase leaves the app shippable.** We prove coordination features
locally first, where they are cheap and testable, then lift them onto a backend that adds
identity, delivery, multi-tenancy, and sync. The local data model and logic are the contract
the backend implements.

---

## Phase 0 — Current app _(done)_

The shipped Kasa: chores (one-time + weekly, completion-driven rotation), expenses with
exact-cent equal splits, balances/settlements, reimbursements, shopping list with
purchase-to-expense linking, shared calendar, in-app notifications and reminders, per-user
reminder preferences, guided tour, on-device analytics. Local-only, single device, no
accounts.

---

## Phase 1 — Local-first coordination features _(now — this spec)_

**Goal:** deepen coordination without a backend. Fully specified and built in this repo.

Scope:

- **Auto-rotating chores** — scheduled rotation that advances on time, with a priority rule so
  manual reassignments and swaps take precedence for that cycle. Deterministic, not agentic.
- **Chore swaps** — direct trade (propose to a specific roommate, accept/decline) and open
  request (post to the household, first to claim takes it). In-app notifications on both.
- **Shared household expectations** — household-wide editable norms with change tracking.
- **Shared purchasing rules** — shared budget, preferred products, store preferences,
  referenced by the shopping flow.
- **Local profile fields** — dietary, personal budget, personal rules per roommate. Interim
  scaffolding; shape designed to be adopted by Phase 2 unchanged.
- **Per-tab onboarding coachmarks** — replace the single upfront tour with one coachmark per
  tab, fired once on first visit, tracked individually, replayable from Settings.

**Exit criteria:** all six features implemented, `node --test tests/*.test.mjs` green
including new tests for rotation, swaps, expectations, purchasing rules, and coachmark
seen-state. Notification-preferences model extended with channel toggles (in-app only wired;
push/SMS toggles present but inert) so Phase 3 has a seam.

**Explicitly deferred:** anything requiring a server, accounts, or real message delivery.

---

## Phase 2 — Accounts and identity synced to email + phone _(next)_

**Goal:** real authenticated users; supersede the Phase 1 local profile scaffolding.

Scope:

- Authentication with a Gmail/email identity (OAuth) and a verified phone number.
- Server-backed user profiles that replace the local member-record fields: dietary, personal
  budget, personal rules — now portable across devices and owned by the authenticated user.
- Profile privacy: a user's profile is theirs; the household sees only what's shared by
  design. (Phase 1's "editable by whoever is viewing as" model goes away here.)
- Migration path: import a local household's state into the first authenticated account so
  nothing is lost moving from local to synced.

**Dependencies:** a backend service and datastore (first server-side component in Kasa's
history). Auth provider for Google sign-in; phone verification provider.

**Exit criteria:** a roommate can sign in on two devices and see the same profile; phone
number is verified and stored; local-to-account migration works.

---

## Phase 3 — Push and SMS delivery _(after accounts)_

**Goal:** turn Kasa notifications from in-app-only into real reminders on the phone.

Scope:

- Deliver existing notification types (chore assigned/due/overdue, expense added, event
  changes, **swap requests**, **rotation turn**) over push and SMS.
- SMS for time-sensitive items once a verified number is on file: upcoming deadlines, swap
  requests, conflicts needing a decision.
- Wire the channel toggles that Phase 1 added to the preferences model (in-app / push / SMS,
  per user, per notification type). Quiet-hours and rate limiting so texts don't become spam.

**Dependencies:** Phase 2 (verified phone numbers, user accounts), an SMS provider (e.g.
Twilio), and push infrastructure. Reuses the existing `notify()` + preferences model as the
dispatch layer — delivery becomes a channel behind it rather than a rewrite.

**Exit criteria:** a roommate with SMS enabled receives a text for an overdue chore and an
incoming swap request; preferences correctly suppress channels a user turned off.

---

## Phase 4 — B2B multi-tenancy and property-manager surface

**Goal:** make Kasa sellable to apartment operators.

Scope:

- Tenancy hierarchy: **property → unit → household → roommate.**
- Property-manager role and surface: onboard units, invite roommates, see portfolio-level
  usage signal (adoption, active households) — never individual roommates' private profile
  data.
- Billing model: per-unit / per-door subscription.
- Onboarding flow for a unit so a new roommate joins an existing household rather than
  creating one from scratch.

**Dependencies:** Phases 2–3 (accounts, delivery). This is where the B2C→B2B pivot from the
master plan becomes concrete.

**Exit criteria:** an operator can onboard a property, add units, invite roommates, and view
adoption without accessing private profile contents.

---

## Phase 5 — Cross-device sync and portfolio analytics

**Goal:** replace single-browser localStorage with consistent server state everywhere.

Scope:

- Server-authoritative household state synced across every roommate's devices (real-time or
  near-real-time), replacing the per-browser model.
- Conflict handling for concurrent edits (the current one-step local undo is not enough once
  multiple people edit the same state live).
- Operator-facing portfolio analytics built on real multi-household data (satisfaction and
  renewal-oriented signal), replacing today's on-device analytics export.

**Dependencies:** Phases 2–4.

**Exit criteria:** two roommates editing on different devices converge correctly; operators
see portfolio analytics across live households.

---

## Dependency summary

```
Phase 0 ─ done
Phase 1 ─ now (no backend)
Phase 2 ─ needs backend + auth (Google) + phone verification
Phase 3 ─ needs Phase 2 + SMS/push providers
Phase 4 ─ needs Phase 2–3 (tenancy, manager surface, billing)
Phase 5 ─ needs Phase 2–4 (sync + portfolio analytics)
```

Each later phase gets its own spec when we reach it. Only Phase 1 is specified for
implementation today.
