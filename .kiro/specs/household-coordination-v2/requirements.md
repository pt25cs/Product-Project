# Requirements — Household Coordination v2 (local-first)

_Spec status: draft for review_

## Introduction

This spec covers the Phase 1 (local-first) feature set from `docs/master-plan.md`: features
that deepen RoomSync's roommate coordination model and are buildable on the current
dependency-free, local-only architecture (`js/store.js`, `js/logic.js`, `js/app.js`,
`js/tour.js`) with no backend.

In scope:

1. Auto-rotating chores (scheduled rotation with a conflict/priority rule)
2. Chore swaps (direct trade and open request)
3. Shared household expectations
4. Shared purchasing rules
5. Local roommate profile fields (dietary, personal budget, personal rules) — interim
6. Per-tab onboarding coachmarks

Out of scope (tracked in `docs/roadmap.md`, Phases 2–5): accounts/auth, profiles synced to
email + phone, push/SMS delivery, B2B multi-tenancy, and cross-device sync. Where this spec
touches the notification-preferences model, it adds inert channel toggles only, as a seam for
Phase 3.

### Conventions

- Acceptance criteria use EARS phrasing ("WHEN … THE SYSTEM SHALL …").
- "The current roommate" means the member selected in the existing "Viewing as" switcher
  (`store.me()`), since there are no accounts yet.
- "Persisted" means written to localStorage through the existing `save()` path and surviving
  a reload (the persistence round-trip already covered by `tests/store.test.mjs`).
- Money is integer cents, parsed/formatted via `js/logic.js` (`parseMoney`/`fmtMoney`),
  consistent with existing expenses.

---

## Requirement 1 — Auto-rotating chores

**User story:** As a roommate, I want recurring chores to rotate through the household
automatically on a schedule, so that whose-turn-it-is is always answered without anyone
manually reassigning, even if a week gets skipped.

#### Acceptance criteria

1. WHEN an auto-rotating chore with a rotation of two or more roommates reaches a new cycle,
   THE SYSTEM SHALL assign that cycle's occurrence to the next roommate in household order,
   advancing the rotation deterministically (no agentic/AI selection).
1a. THE SYSTEM SHALL default the rotation cadence to weekly (7 days) and SHALL allow the
    household to configure a different cycle length per chore; rotation computation SHALL honor
    the configured cadence.
2. WHEN the current date has passed the due date of the active occurrence of an auto-rotating
   chore and no completion has occurred, THE SYSTEM SHALL still advance the rotation on
   schedule so that the rotation does not stall on an uncompleted turn.
3. WHEN the rotation advances across one or more skipped cycles, THE SYSTEM SHALL NOT create a
   backlog of past-dated occurrences (consistent with the existing `nextDue` no-backlog rule).
4. WHEN a roommate is manually reassigned an occurrence, or an occurrence changes owner via a
   chore swap, THE SYSTEM SHALL treat that manual assignment as higher priority than the
   automatic turn for that cycle and SHALL resume the normal rotation order on the following
   cycle.
5. WHEN a chore has no rotation (single assignee) or is one-time, THE SYSTEM SHALL leave its
   assignment behavior unchanged from today.
6. WHEN auto-rotation assigns a new occurrence to a roommate, THE SYSTEM SHALL create an
   in-app notification for that roommate (deduped by key, matching the existing `notify`
   pattern) and SHALL NOT notify the previous assignee as if they were newly assigned.
7. THE SYSTEM SHALL compute rotation using pure functions in `js/logic.js` so the behavior is
   unit-testable without the DOM.

---

## Requirement 2 — Chore swaps

**User story:** As a roommate who can't do an assigned chore, I want to hand it off in-app —
either by trading with a specific roommate or by asking the whole household — so that I can
resolve it without a confrontational conversation.

#### Acceptance criteria

**Open request (post to household):**

1. WHEN the current roommate posts an open swap request for one of their open occurrences, THE
   SYSTEM SHALL record a pending request visible to the household and SHALL notify the other
   roommates.
2. WHEN another roommate accepts an open swap request, THE SYSTEM SHALL reassign that
   occurrence to the accepting roommate, mark the request resolved, and notify the original
   assignee.
3. WHEN an open swap request has already been resolved or cancelled, THE SYSTEM SHALL reject
   any further accept attempt and SHALL explain why (no silent failure, no double assignment).
4. WHEN the original requester cancels their own open request, THE SYSTEM SHALL mark it
   cancelled and leave the occurrence assigned to the original requester.

**Direct trade (propose to a specific roommate):**

5. WHEN the current roommate proposes a direct trade (their occurrence ↔ a specific
   roommate's occurrence), THE SYSTEM SHALL record a pending proposal addressed to that
   roommate and SHALL notify them.
6. WHEN the addressed roommate accepts a direct-trade proposal, THE SYSTEM SHALL swap the two
   occurrences' assignees atomically and notify the proposer.
7. WHEN the addressed roommate declines a direct-trade proposal, THE SYSTEM SHALL mark it
   declined, leave both occurrences unchanged, and notify the proposer.
8. WHEN either occurrence in a pending direct-trade proposal is completed, deleted, or already
   reassigned, THE SYSTEM SHALL invalidate the proposal rather than perform an inconsistent
   swap.

**Both modes:**

9. WHEN a swap (either mode) reassigns an occurrence, THE SYSTEM SHALL treat the new assignee
   as a manual override for that cycle per Requirement 1.4 (rotation resumes next cycle).
10. THE SYSTEM SHALL only allow a roommate to post/propose swaps for occurrences currently
    assigned to them, and SHALL only allow the addressed roommate (direct) or any other
    roommate (open) to accept.
11. THE SYSTEM SHALL log swap activity to the existing activity feed and SHALL support the
    existing one-step undo for the resolving action where feasible.

---

## Requirement 3 — Shared household expectations

**User story:** As a household, we want a shared, editable list of agreed norms (e.g. "quiet
after 11pm", "dishes done same day"), so that expectations are explicit and everyone can see
what we agreed to.

#### Acceptance criteria

1. WHEN any roommate adds an expectation with non-empty text, THE SYSTEM SHALL persist it as
   shared household state visible to all roommates.
2. WHEN a roommate edits or removes an expectation, THE SYSTEM SHALL update the shared state
   and SHALL record who changed it and when (lightweight change tracking via the existing
   activity feed).
3. WHEN expectation text exceeds a reasonable length limit, THE SYSTEM SHALL reject it with a
   clear validation message (consistent with existing field-length validation).
4. WHEN a roommate removes an expectation, THE SYSTEM SHALL support the existing one-step undo.
5. THE SYSTEM SHALL treat expectations as shared (not per-roommate) data distinct from the
   per-roommate "personal rules" in Requirement 5.

---

## Requirement 4 — Shared purchasing rules

**User story:** As a household, we want shared purchasing rules — a shared budget, preferred
products/brands, and store preferences — so that buying shared items follows an agreed
standard instead of guesswork.

#### Acceptance criteria

1. WHEN a roommate sets a shared monthly purchasing budget, THE SYSTEM SHALL persist it as a
   positive integer-cents amount using the existing money parsing/formatting, and SHALL reject
   invalid amounts with a clear message.
2. WHEN a roommate adds a preferred product or store preference, THE SYSTEM SHALL persist it
   as shared household state visible to all roommates.
3. WHEN the household has shared purchasing rules set, THE SYSTEM SHALL surface the relevant
   rule(s) in the shopping flow (e.g. when adding/claiming/purchasing an item) as guidance,
   without blocking the action.
4. WHEN household shared spending for the current month is compared against the shared budget,
   THE SYSTEM SHALL indicate remaining budget or over-budget status using existing monthly
   spending computation, as information only (RoomSync never blocks spending or moves money).
5. WHEN a roommate edits or removes a purchasing rule, THE SYSTEM SHALL update shared state,
   log the change to the activity feed, and support one-step undo for removals.

---

## Requirement 5 — Local roommate profile fields (interim)

**User story:** As a roommate, I want a profile with my dietary restrictions, a personal
budget, and my personal roommate rules, so that my preferences are visible to the household
and testable now, ahead of real synced accounts.

#### Acceptance criteria

1. WHEN the current roommate edits their profile, THE SYSTEM SHALL allow setting dietary
   restrictions/preferences, a personal budget, and personal roommate rules, and SHALL persist
   them on that member's record.
2. WHEN a roommate views another roommate's profile, THE SYSTEM SHALL display that roommate's
   profile fields (shared-visibility model, consistent with the current no-accounts "Viewing
   as" design).
3. WHEN a personal budget amount is entered, THE SYSTEM SHALL validate it as a positive
   integer-cents amount using existing money parsing and reject invalid input with a clear
   message.
4. WHEN profile text fields exceed reasonable length limits, THE SYSTEM SHALL reject them with
   clear validation messages.
5. THE SYSTEM SHALL clearly label the profile area as interim/local (no account, no sync, no
   privacy guarantee) so it is not mistaken for authenticated per-user data. (Supersession is
   tracked in roadmap Phase 2.)
6. WHEN a household is created or the demo is started, THE SYSTEM SHALL initialize members
   with empty/default profile fields so existing flows and tests are unaffected.

---

## Requirement 6 — Per-tab onboarding coachmarks

**User story:** As a first-time user, I want a short, focused explanation the first time I
open each tab, so that I learn each area in context instead of sitting through one long
upfront tour.

#### Acceptance criteria

1. WHEN a user opens a tab (Home, Chores, Expenses & Shopping, Calendar, and the new Profile
   area) for the first time, THE SYSTEM SHALL show that tab's coachmark once.
2. WHEN a user has already seen a given tab's coachmark, THE SYSTEM SHALL NOT show it again on
   subsequent visits.
3. WHEN a user dismisses or completes a tab's coachmark, THE SYSTEM SHALL persist that tab's
   "seen" state independently of the other tabs' states.
4. WHEN a user chooses "replay the tutorial" from Settings, THE SYSTEM SHALL reset all per-tab
   coachmark seen-states so every tab's coachmark will show again on next visit.
4a. THE SYSTEM SHALL NOT show any single upfront multi-step guided tour on first run; per-tab
    coachmarks are the only onboarding mechanism (the previous monolithic tour is retired).
5. WHEN the shopping/expenses tab has two sub-tabs, THE SYSTEM SHALL anchor that tab's
   coachmark to a reliably present element and SHALL degrade gracefully (centered message) if
   the anchor is not found, reusing the existing tour positioning engine.
6. WHEN coachmark seen-state cannot be persisted (storage blocked), THE SYSTEM SHALL fail
   quietly without breaking navigation, consistent with the current tour's storage handling.
7. THE SYSTEM SHALL record coachmark shown/seen events via the existing on-device analytics
   (`trackEvent`) without any network calls.

---

## Non-functional requirements

1. **No new dependencies / no build step.** All features ship as additions to the existing
   vanilla ES modules; `package.json` stays dependency-free.
2. **No backend, no network.** Nothing in this spec makes an outbound request. Notification
   channel toggles for push/SMS may be stored but MUST be inert in this phase.
3. **Persistence compatibility.** New state MUST load cleanly, and older saved data without
   the new fields MUST still load (the loader's version check and defaulting must not reject
   pre-existing households).
4. **Testability.** New logic (rotation, swaps resolution, budget math) MUST be covered by
   `node --test` unit tests in `tests/`, following the patterns in `tests/store.test.mjs`.
5. **Accessibility.** New UI MUST follow existing patterns (labelled controls, keyboard
   operability, the color-contrast expectations checked by `tests/contrast.test.mjs`).
6. **Determinism.** Rotation and swap resolution MUST be deterministic and side-effect-free in
   `js/logic.js` where computed, matching the existing split/rotation approach.
