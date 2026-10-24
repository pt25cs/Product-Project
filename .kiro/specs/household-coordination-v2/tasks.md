# Tasks — Household Coordination v2 (local-first)

_Spec status: draft for review. Do not start coding until requirements.md and design.md are
approved. Resolve the three open questions in design.md §"Open questions" first._

Each task is a discrete, test-backed coding step. Sub-bullets name the files and reference the
requirement(s) each task satisfies. Tasks are ordered so the data layer and pure logic land
before UI. Prefer writing the unit test alongside (or just before) each store/logic change,
matching `tests/store.test.mjs` conventions (`createStore` + in-memory storage + `startDemo`).

---

- [x] 1. Add persistence back-compat normalization and new state defaults
  - Add a `normalize(state)` step after `load()` in `js/store.js` that fills missing new
    fields without bumping `version` from `1`.
  - Extend `blank()` to include `swaps: []`, `expectations: []`, `purchasing: {budgetCents:null,
    preferredProducts:[], storePreferences:[]}`, and per-member `profile` defaults; add
    `channels` defaults inside `prefsOf`.
  - _Requirements: NFR 3; 5.6; foundation for all others._
  - _Test:_ loading a `version:1` save lacking new fields yields normalized state; existing
    `store.test.mjs` persistence/corrupt-data tests stay green.

- [x] 2. Add pure rotation helpers to `js/logic.js`
  - Implement `cyclesSince(anchorDate, targetDate, cycleDays=7)`, `rotationAssignee(chore,
    targetDate)`, `currentCycleDue(chore, today)`. Keep them pure (no DOM/storage). Read
    `cycleDays` from the chore (default 7) so weekly is default and other cadences work.
  - _Requirements: 1.1, 1a, 1.3, 1.7._
  - _Test:_ cycle counting across boundaries for cycleDays=7 and a non-weekly value; round-robin
    assignee; no-backlog due date.

- [x] 3. Implement scheduled auto-rotation in the store
  - Add `chore.autoRotate` + `anchorDate` + `cycleDays` (default 7) on create/edit; add
    `occ.manualOverride`.
  - Add internal `advanceRotations(today)`; call it from `commit()` and the existing reminder
    hooks (60s interval / visibilitychange via `runReminders`). Ensure current-cycle occurrence
    exists and is assigned per `rotationAssignee`, skipping `manualOverride`/completed; dedupe
    notifications with a stable key; don't re-notify the prior assignee.
  - Set `manualOverride=true` in `reassignChore`.
  - _Requirements: 1.1, 1a, 1.2, 1.3, 1.4, 1.5, 1.6._
  - _Test:_ advances across skipped cycles without backlog (weekly and a non-weekly cadence);
    manual override suppresses one cycle then resumes; single-assignee/one-time chores
    unchanged; notification dedupe.

- [x] 4. Implement chore swaps in the store (state + functions)
  - Add the `swaps` entity and `requestOpenSwap`, `cancelSwap`, `acceptOpenSwap`,
    `proposeDirectSwap`, `respondDirectSwap` following the `mutate`/validate/`notify`/
    `logActivity` pattern. Enforce ownership, pending-status re-checks, atomic assignee swap,
    and `manualOverride` on reassigned occurrences.
  - Invalidate pending swaps from `completeChore`, `deleteChore`, `reassignChore`.
  - Add selectors `sel.openSwaps()`, `sel.incomingSwaps()`, `sel.outgoingSwaps()`.
  - _Requirements: 2.1–2.11, 1.4/2.9._
  - _Test:_ open accept reassigns+notifies; double-accept rejected; cancel; direct accept swaps
    atomically; decline unchanged; invalidation on complete/delete/reassign.

- [x] 5. Implement shared household expectations in the store
  - Add `addExpectation`, `editExpectation`, `removeExpectation` (non-empty + length
    validation, activity logging, undoable removal) writing to `state.expectations`.
  - _Requirements: 3.1–3.5._
  - _Test:_ add/edit/remove persistence; length rejection; undo restores.

- [x] 6. Implement shared purchasing rules in the store
  - Add `setPurchasingBudget` (via `parseMoney`, reject invalid), `addPreferredProduct`,
    `addStorePreference`, and remove counterparts; a budget-status helper using
    `sel.monthTotal()` (display-only).
  - _Requirements: 4.1, 4.2, 4.4, 4.5._
  - _Test:_ budget parse rejects invalid; remaining-vs-over-budget math; undoable removals.

- [x] 7. Implement local profile fields in the store
  - Add `updateProfile(patch)` updating `me().profile` (dietary, `budgetCents` via `parseMoney`,
    rules) with validation; ensure `blank()`/`startDemo()`/`createHousehold()` seed defaults.
  - _Requirements: 5.1, 5.3, 5.4, 5.6._
  - _Test:_ validation (amount + lengths); defaults seeded; another member's profile readable.

- [x] 8. Rework onboarding into per-tab coachmarks in `js/tour.js`
  - Add `COACH_KEY` per-tab seen map with `coachSeen`/`markCoachSeen`/`resetCoachmarks`; add a
    `COACHMARKS` content map and a single-step `showCoachmark()` reusing the existing
    chrome/positioning engine. Money coachmark anchors to `.tabs` with center fallback.
  - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.6, 6.7._
  - _Test (pure seen-state):_ per-tab independence; `resetCoachmarks` clears all; storage-blocked
    path doesn't throw.

- [x] 9. Retire the upfront tour and wire coachmark triggering + replay in `js/app.js`
  - Remove the automatic first-run `launchTour` call and delete the monolithic `STEPS`
    walkthrough engine from `tour.js` (keep only the reused chrome/positioning primitives);
    remove now-dead imports (`startTour`/`endTour`/`tourSeen`).
  - In `afterRender(route, sig)`, map `route.parts[0]` to a tab key (incl. `profile`); if a
    household exists and the tab is unseen, call `showCoachmark` once then mark seen.
  - Point Settings "Replay tutorial" (`'replay-tour'`) at `resetCoachmarks` and reword the
    Settings copy to "Show the getting-started tips again"; clear coach state on data reset.
  - _Requirements: 6.1, 6.2, 6.4, 6 (4a: no upfront tour)._

- [x] 10. Build the auto-rotation + swaps UI
  - Chore form: "Advance automatically each cycle" (sets `autoRotate`) plus a cycle-length
    control defaulting to weekly (sets `cycleDays`); detail modal shows auto-rotate cadence +
    next-in-rotation.
  - Chore row/detail menus: "Ask someone to take this" (open) and "Offer a trade…" (direct,
    modal picker); a "Swap requests" section with Accept/Decline/Cancel wired via `actions`.
  - _Requirements: 1 (UI), 2 (UI)._

- [x] 11. Build the expectations + purchasing-rules UI
  - "House expectations" section (Home disclosure and/or Settings) with add/edit/remove.
  - "Purchasing rules" block (Expenses & Shopping and/or Settings): budget, preferred products,
    store preferences; non-blocking hints in the shopping add/claim/purchase flow; a
    remaining-budget line near the monthly spending total.
  - _Requirements: 3 (UI), 4.3, 4.4._

- [x] 12. Build the profile UI and interim labeling
  - Add the dedicated `#/profile` route: register it in `NAV`/`TITLES` and the `render()`
    router `switch`; editable fields for the current roommate, read-only for others, plus the
    interim "local only, no account/sync" banner. A dedicated route (not a Settings section)
    so Profile gets its own coachmark.
  - _Requirements: 5.1, 5.2, 5.5; supports 6.1 (profile coachmark)._

- [x] 13. Add the inert notification-channel toggles (Phase 3 seam)
  - Surface `prefs.channels` (in-app / push / SMS) toggles in Settings; persist via `setPrefs`.
    Only `inApp` affects behavior; `push`/`sms` stored and clearly labeled as future delivery.
  - _Requirements: NFR 2; roadmap Phase 3 seam._

- [x] 14. Seed demo fixtures for the new features
  - Extend `startDemo()` with one auto-rotating chore, a pending swap, a couple of expectations,
    a purchasing budget + preferred product, and populated member profiles.
  - _Requirements: supports 1–5 demoability and e2e fixtures._

- [x] 15. Full verification pass
  - Run `node --test tests/*.test.mjs` (incl. `contrast.test.mjs`) and the existing `e2e.*`
    flows; fix regressions. Confirm no new dependencies, no network calls, and pre-existing
    saves still load. Update `docs/master-plan.md`/`docs/roadmap.md` Phase 1 exit-criteria
    checkboxes if used.
  - _Requirements: NFR 1, 2, 3, 4, 5; all exit criteria._

- [x] 16. Make coachmarks non-blocking and teach the v2 features (post-verification refinement)
  - `css/styles.css` / `js/tour.js`: the coachmark backdrop must not intercept pointer events so
    the tab underneath stays usable while the tip shows (Option B). Keep the card interactive and
    dismissable (Got it / Skip / Escape).
  - `js/tour.js`: expand the existing per-tab coachmark copy (no new anchors/steps) so chores
    mentions auto-rotation + swaps, and money mentions purchasing rules / shared budget.
  - Re-run the full `e2e.*` suite and `node --test tests/*.test.mjs`; both must pass.
  - Also fixes the `serve.mjs` Windows bare-`/` 404 that blocked e2e (see design.md
    "Post-implementation notes").
  - _Requirements: 6.1, 6.2 (presentation); design.md Resolved decisions 4 & 5._

---

## Traceability summary

| Requirement                      | Tasks            |
| -------------------------------- | ---------------- |
| 1 Auto-rotating chores           | 2, 3, 10, 14, 15 |
| 2 Chore swaps                    | 4, 10, 14, 15    |
| 3 Shared expectations            | 5, 11, 14, 15    |
| 4 Shared purchasing rules        | 6, 11, 14, 15    |
| 5 Local profile fields           | 7, 12, 14, 15    |
| 6 Per-tab coachmarks             | 8, 9, 15         |
| NFR (back-compat, seam, verify)  | 1, 13, 15        |
