# RoomSync Master Plan

_Last updated: 2026-10-23_

This document is the single source of truth for where RoomSync is going. It covers the
product vision, the strategic pivot from B2C to B2B SaaS, the full feature set, and how
the work is phased between what we can build on the current local-only architecture and
what requires a backend.

Companion documents:

- `docs/roadmap.md` — phased delivery plan, especially the backend/SaaS work.
- `.kiro/specs/household-coordination-v2/` — the formal spec (requirements, design, tasks)
  for the local-first feature set described below.

---

## 1. Vision

RoomSync helps roommates run a shared home without chasing each other: chores, shared
expenses, shopping, and plans in one place. Today it is a dependency-free, single-device
web app with no accounts and no server.

The next chapter expands RoomSync in two directions at once:

1. **Deepen the coordination model** — move beyond "track chores and split money" into the
   softer problems that actually cause roommate friction: who does what and when (fairness),
   trading responsibilities without awkward conversations, shared norms everyone agreed to,
   and shared purchasing decisions.
2. **Change who we sell to** — reposition from a consumer tool roommates discover on their
   own (B2C) to a product sold to **apartment operators and property managers** (B2B SaaS),
   where RoomSync is part of the unit and a lever for tenant satisfaction and renewals.

### The thesis behind the B2B pivot

When tenants move in without pre-chosen roommates, a bad roommate dynamic often gets blamed
on the apartment itself. That resentment shows up at renewal time. RoomSync reduces that
friction by giving roommates a low-conflict, structured way to keep each other accountable —
rotating chores fairly, trading tasks without confrontation, and agreeing on shared rules up
front. For an operator, happier roommate dynamics mean higher satisfaction and more
renewals, which is a budget line a property manager actually cares about.

The product principle that follows from this: **a roommate should never need another app or
service to coordinate the home.** Chores, money, shopping, plans, profiles, and household
norms all live in RoomSync.

---

## 2. Strategic shift: B2C → B2B SaaS

| Dimension        | Today (B2C, local)                          | Target (B2B SaaS)                                             |
| ---------------- | ------------------------------------------- | ------------------------------------------------------------- |
| Buyer            | A roommate who finds the app                | Apartment operator / property manager                         |
| Unit of sale     | Free single household                       | Per-unit or per-door subscription across a property portfolio |
| Identity         | "Viewing as" switch, no accounts            | Authenticated users tied to email + phone                     |
| Tenancy          | One household per browser                   | Property → unit → household → roommates                        |
| Value narrative  | "Stop chasing roommates"                    | "Higher tenant satisfaction and renewals"                     |
| Data             | localStorage on one device                  | Server-side, synced across devices and roommates              |

The pivot is deliberately **sequenced, not simultaneous.** We harden and prove the
coordination features locally first, where they are cheap to build and test, then lift them
onto a backend that adds identity, sync, multi-tenancy, and real notification delivery. The
local build is not throwaway: its data model and logic are the contract the backend will
implement.

---

## 3. Who RoomSync is for

We are intentionally **not** shipping invented marketing personas. Instead we describe the
real roles the product serves, because the B2B pivot introduces a buyer who never touches the
day-to-day app.

- **Roommate (primary end user).** Lives in the unit, uses RoomSync daily to see what they
  owe, what chores are theirs, what the household needs, and what's planned. Wants low effort
  and low confrontation. Values being able to trade a chore or flag a conflict without a
  face-to-face negotiation.
- **Household (the group).** A set of roommates sharing one unit. Has shared state that no
  single person owns: the chore rotation, shared expectations, purchasing rules, the shopping
  list, and the expense ledger.
- **Property manager / operator (the buyer, B2B phase).** Does not manage chores. Buys
  RoomSync to raise tenant satisfaction and renewals, onboards units, and wants
  portfolio-level signal that the product is being used. Never sees an individual roommate's
  private profile data.

---

## 4. Feature set

### 4.1 Already shipped (current app)

Chores (one-time and weekly, manual assignment, completion-driven rotation, reassign),
expense tracking with exact-cent equal splits, balances and settlement suggestions,
reimbursements, shopping list with claim/purchase-to-expense linking, a shared calendar
(away/quiet/guests/plans), in-app notifications and reminders, per-user reminder preferences,
a guided onboarding tour, and on-device analytics export.

### 4.2 New — local-first (build now)

These fit the current `store` / `logic` / `app` architecture and ship without a backend.
They are specified in detail in the spec.

1. **Auto-rotating chores.** Chores rotate through the roommates on a schedule (e.g. weekly),
   not only when someone marks the current one done. The rotation keeps advancing so the
   "whose turn is it" question is always answered, even if a week is skipped. Includes a
   priority/conflict rule so a manual reassignment or a swap takes precedence over the
   automatic turn for that cycle. Rotation is computed **algorithmically**, not by an agent.
2. **Chore swaps.** A roommate who can't do their chore can resolve it in-app two ways:
   - **Direct trade:** propose swapping a specific chore with a specific roommate's specific
     chore; the other roommate accepts or declines.
   - **Open request:** post "can someone take this?" to the whole household; the first
     roommate to claim it takes it over.
   Both paths generate notifications (and, in the backend phase, push/SMS).
3. **Shared household expectations.** A household-wide, editable set of agreed norms (e.g.
   "quiet after 11pm", "dishes same day"). Shared state, visible to everyone, with lightweight
   change tracking so it's clear what the house agreed to.
4. **Shared purchasing rules.** Household-level rules for shared buying: a shared budget,
   preferred products/brands, and store preferences, so claiming and purchasing shopping items
   can reference an agreed standard instead of guesswork.
5. **Local profile fields (interim).** Each roommate gets editable profile fields —
   **dietary restrictions/preferences, a personal budget, and personal roommate rules.** In
   the local build these attach to the existing member record and are editable by whoever is
   "viewing as" that member. **This is interim scaffolding**: the backend phase replaces the
   storage and identity layer with real authenticated profiles. The _shape_ of the data is
   designed now so the backend can adopt it without reshaping the UI.
6. **Per-tab onboarding coachmarks.** Replace the single upfront guided tour with focused
   coachmarks that appear **the first time a user opens each tab** (Home, Chores, Expenses &
   Shopping, Calendar, and the new Profile area). Each tab's coachmark is tracked
   individually so it shows once and never nags again, and all of them remain replayable from
   Settings.

### 4.3 New — backend-dependent (roadmap, later phases)

Specified at a high level here and sequenced in `docs/roadmap.md`. Not part of the current
spec's implementation tasks.

1. **Authenticated user profiles** synced to a Gmail/email address and a phone number. This
   supersedes the local profile scaffolding and makes profiles portable across devices and
   roommates.
2. **Push notifications and SMS/text delivery.** Once a phone number is on file, RoomSync can
   send texts about upcoming deadlines, swap requests, and conflicts — not just in-app
   notices. The notification _preferences_ model is designed now so delivery channels slot in
   later.
3. **B2B multi-tenancy.** Property → unit → household → roommate hierarchy, with a
   property-manager surface for onboarding units and seeing portfolio-level usage signal.
4. **Cross-device sync.** Server-side state so a household's data is consistent across every
   roommate's phone and laptop, replacing the single-browser localStorage model.

---

## 5. Phasing principle

```
Phase 0  (done)      Current local app: chores, money, shopping, calendar, tour
Phase 1  (now)       Local-first features (section 4.2) — specced and built here
Phase 2  (next)      Accounts + identity synced to email + phone (supersedes 4.2 #5)
Phase 3               Push + SMS delivery on top of the existing notification model
Phase 4               B2B multi-tenancy + property-manager surface
Phase 5               Cross-device sync + portfolio analytics
```

Each phase leaves the app shippable. Phase 1 is the current spec's scope; everything from
Phase 2 on is tracked in the roadmap and will get its own specs when we reach it.

---

## 6. Guardrails and non-goals (this chapter)

- **No agentic chore scheduling.** Rotation and conflict resolution are deterministic
  algorithms, so behavior is predictable and testable.
- **RoomSync never moves money.** Expenses, budgets, and purchasing rules are records and
  guidance; repayments are logged, not transacted. Unchanged by this plan.
- **Local profile fields are not private accounts yet.** Until Phase 2, profile data lives in
  shared local state and carries no real authentication or privacy guarantee. This is stated
  wherever the fields appear so it isn't mistaken for secure, per-user data.
- **No invented personas in the product.** We describe real roles (section 3), not fictional
  archetypes.
