# Design — Household Coordination v2 (local-first)

_Spec status: draft for review_

This design maps the requirements onto RoomSync's existing architecture. It references real
functions and state shapes from `js/store.js`, `js/logic.js`, `js/app.js`, and `js/tour.js`
so implementation stays consistent with the current code.

## Architectural context (unchanged)

- **Layers:** `logic.js` (pure functions, no DOM/storage) → `store.js` (single `state`
  object, mutations, selectors, persistence, pub/sub) → `app.js` (hash-router views +
  `actions`/`change` delegation) with `ui.js` helpers and `tour.js` for guided UI.
- **Mutation flow:** every change goes through `mutate(fn, undoable)` → `commit()` →
  `generateReminders()` + `save()` + `emit()` (full re-render). One-step undo snapshots
  `JSON.stringify(state)` into `undoSlot`.
- **Notifications:** `notify(userIds, {type,title,body,link,key}, opts)` writes per-user
  records, never to the actor, deduped by `(userId, key)`, respecting `prefsOf`.
- **Persistence:** `STORAGE_KEY='roomsync.v1'`, `version:1`. The loader rejects data whose
  `version!==1` or missing `household`/`members`. New fields must default in rather than bump
  the version, so pre-existing saves still load (see "Persistence & back-compat").

All new logic goes into these same files. No new dependencies, no build step, no network.

---

## 1. Data model additions

Added to the `blank()` state object in `store.js` (and mirrored in `startDemo()` and
`createHousehold()` so demo/new households get sane defaults):

```js
// members gain profile fields (Requirement 5)
members: [{
  id, name,
  profile: {
    dietary: '',        // free text, length-limited
    budgetCents: null,  // personal budget, integer cents or null
    rules: '',          // personal roommate rules, free text
  },
}]

// chores gain scheduled auto-rotation metadata (Requirement 1)
chores: [{ ...existing,
  autoRotate: false,       // when true, rotation advances on schedule, not only on completion
  anchorDate: 'YYYY-MM-DD',// the cycle origin used to compute "whose turn this cycle"
  cycleDays: 7             // rotation cadence; defaults to 7 (weekly), household-configurable
}]

// occurrences gain an override marker (Requirement 1.4 / 2.9)
occurrences: [{ ...existing,
  manualOverride: false    // set when reassigned/swapped; rotation resumes next cycle
}]

// new top-level collections
swaps: [{                  // Requirement 2
  id, kind: 'open' | 'direct',
  occId,                   // the requester's occurrence being handed off
  targetOccId,             // direct only: the specific occurrence offered in trade
  requesterId,             // must equal the occurrence's assignee when created
  addresseeId,             // direct only
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'invalidated',
  resolvedBy, createdAt, resolvedAt,
}]

expectations: [{           // Requirement 3 (shared household norms)
  id, text, createdBy, createdAt, updatedBy, updatedAt,
}]

purchasing: {              // Requirement 4 (shared, single object)
  budgetCents: null,
  preferredProducts: [{ id, text, createdBy, createdAt }],
  storePreferences: [{ id, text, createdBy, createdAt }],
}

// prefs gain inert channel toggles (seam for roadmap Phase 3; NOT wired to delivery)
prefs: { [userId]: { ...existing, channels: { inApp: true, push: false, sms: false } } }
```

**Why a `manualOverride` flag rather than reordering the rotation array:** the rotation array
is the agreed order; a one-off reassignment/swap should not permanently change whose turn it
is. The flag lets rotation resume cleanly next cycle (Requirement 1.4, 2.9).

---

## 2. Auto-rotating chores (Requirement 1)

### Logic (`logic.js`, pure)

Today rotation is completion-driven via `nextAssigneeId(chore, occ)` / `nextRotIdx` /
`nextDue`. We add **schedule-driven** helpers so the turn is computable from dates alone:

```js
// Number of whole cycles (weeks) between the chore's anchor and a target date.
export function cyclesSince(anchorDate, targetDate, cycleDays = 7) { ... }

// Whose turn for the cycle that contains `targetDate`, given rotation order + anchor.
// Pure round-robin: rotation[(startIdx + cyclesSince(...)) % rotation.length].
export function rotationAssignee(chore, targetDate) { ... }

// The due date of the current cycle on/after today, reusing the no-backlog rule.
export function currentCycleDue(chore, today) { ... }
```

These are deterministic and unit-testable with no DOM, satisfying 1.1, 1.3, 1.7.

### Store behavior

- A new internal `advanceRotations(today)` runs inside `commit()` (alongside
  `generateReminders()`), and on the existing 60s interval / visibilitychange hooks. For each
  `autoRotate` chore it ensures the occurrence for the current cycle exists and is assigned to
  `rotationAssignee(chore, due)` — **unless** that occurrence carries `manualOverride`
  (Requirement 1.4) or is already completed. This advances the rotation even when the prior
  turn was never completed (1.2) and creates no past-dated backlog (1.3).
- When `advanceRotations` creates a new occurrence, it calls `notify([assignee], …)` with a
  stable key (e.g. `rotate:<occId>:<assignee>`) so it appears once and never notifies the
  prior assignee as a "new assignment" (1.6).
- `completeChore` keeps working; for an `autoRotate` chore, completion no longer needs to be
  what produces the next occurrence (schedule does), but completing early still just marks
  done. Guard against producing a duplicate occurrence for the same cycle.
- `reassignChore` and swap resolution set `occ.manualOverride = true` (1.4 / 2.9).

### UI (`app.js`)

Extend the existing chore form (`openChoreForm` / `syncChoreForm`): when "Weekly" + "Rotate"
is on, add an "Advance automatically each cycle" checkbox that sets `autoRotate`, plus a cycle
length control that defaults to weekly (7 days) and lets the household choose another cadence
(`cycleDays`). The chore detail modal (`viewChore`) shows "Auto-rotates every N days — next:
<name>" using `rotationAssignee`. `cyclesSince`/`rotationAssignee`/`currentCycleDue` all take
`cycleDays` from the chore (defaulting to 7), so weekly is the default and other cadences are
supported without special-casing.

---

## 3. Chore swaps (Requirement 2)

### Store functions (new, following the `mutate`/validate/`notify` pattern)

```js
requestOpenSwap(occId)                 // 2.1   requester must own occId
cancelSwap(swapId)                     // 2.4   requester only
acceptOpenSwap(swapId)                 // 2.2/2.3 any other roommate; reassign occ
proposeDirectSwap(occId, targetOccId)  // 2.5   requester owns occId; target owned by addressee
respondDirectSwap(swapId, accept)      // 2.6/2.7 addressee only; atomic assignee swap
```

- **Validation / guards:** `requestOpenSwap`/`proposeDirectSwap` reject if the requester does
  not currently own `occId`, or the occurrence is completed/deleted (2.10). `acceptOpenSwap`
  and `respondDirectSwap` re-check `status==='pending'` and that both occurrences are still
  open and unchanged; otherwise return `{ok:false,error:…}` (2.3, 2.8) — no silent failure,
  no double assignment.
- **Atomicity:** direct accept swaps both `assigneeId`s and sets `manualOverride` on both
  inside one `mutate` so state can't half-apply (2.6, 2.9).
- **Invaliders:** `completeChore`, `deleteChore`, and `reassignChore` mark any pending swap
  referencing the affected occurrence as `invalidated` (2.8).
- **Notifications & activity:** each transition calls `notify(...)` to the right party
  (household for open-post, addressee for direct-propose, requester on resolution) and
  `logActivity(...)` (2.1–2.7, 2.11). Resolving actions are `undoable` where feasible (2.11).

### Selectors

```js
sel.openSwaps()         // pending open requests (household-wide)
sel.incomingSwaps()     // direct proposals addressed to me()
sel.outgoingSwaps()     // my pending requests/proposals
```

### UI

- Chore row/detail "More actions" menu (`choreRow` items, `viewChore` footer) gains **"Ask
  someone to take this"** (open) and **"Offer a trade…"** (direct) for occurrences I own.
- "Offer a trade" opens a modal (`openModal`) listing other roommates' open occurrences to
  pick the counter-chore.
- A compact **"Swap requests"** section on the Chores page lists incoming/open/outgoing with
  Accept / Decline / Cancel buttons wired through the `actions` map.

---

## 4. Shared household expectations (Requirement 3)

- **Store:** `addExpectation(text)`, `editExpectation(id, text)`, `removeExpectation(id)` —
  each validates non-empty + length (reuse `trimmed` + a length cap like existing 300-char
  notes), persists to `state.expectations`, logs activity (3.2), and `removeExpectation` is
  `undoable` (3.4). Shared data, not per-roommate (3.5).
- **UI:** a "House expectations" section — a disclosure on Home and/or a block in Settings —
  listing items with add/edit/remove. No notifications required (quiet, low-friction), though
  edits still land in the activity feed.

---

## 5. Shared purchasing rules (Requirement 4)

- **Store:** `setPurchasingBudget(amount)` (parse via `L.parseMoney`, reject invalid — 4.1),
  `addPreferredProduct(text)` / `addStorePreference(text)` and their remove counterparts
  (4.2, 4.5, undoable removals), all writing to `state.purchasing`.
- **Budget status (logic):** reuse `sel.monthTotal()` for current-month shared spend; a small
  helper computes remaining vs over-budget for display only — never blocks (4.4).
- **UI:** a "Purchasing rules" block in the Expenses & Shopping area and/or Settings. In the
  shopping flow (`viewMoney` shopping tab, add/claim/purchase), surface preferred-product and
  budget hints as non-blocking guidance (4.3). Show remaining-budget line near the existing
  monthly spending total (4.4).

---

## 6. Local roommate profile fields (Requirement 5)

- **Store:** `updateProfile(patch)` updates `me().profile` (dietary, budgetCents via
  `parseMoney`, rules), with length/amount validation (5.3, 5.4). `blank()`/`startDemo()`/
  `createHousehold()` seed `profile` defaults so existing tests and flows are unaffected (5.6).
- **UI:** a dedicated **Profile** route at `#/profile`, added to `NAV`/`TITLES` and the
  router `switch` in `render()`. It shows editable fields for the current roommate and
  read-only display for others (5.1, 5.2), and carries an explicit interim banner — "Local
  only, no account or sync yet" — reusing the existing prototype-disclosure styling (5.5). A
  dedicated route (rather than a Settings section) is required so Profile earns its own
  per-tab coachmark per Requirement 6.1.
- **Interim note:** these fields live on the shared member record by design; roadmap Phase 2
  replaces storage + identity. The field _shape_ here is what Phase 2 adopts.

---

## 7. Per-tab onboarding coachmarks (Requirement 6)

### Replace the single `tourSeen` flag with a per-tab seen map

`tour.js` currently gates the whole tour on one key (`roomsync.tour.v1`). We add a parallel
per-tab mechanism without discarding the reusable engine (`buildChrome`, `position`,
`resolveAnchor`).

```js
// tour.js
const COACH_KEY = 'roomsync.coach.v1';   // { home:true, chores:true, money:true, calendar:true, profile:true }
export function coachSeen(storage, tab) { ... }
export function markCoachSeen(storage, tab) { ... }
export function resetCoachmarks(storage) { ... }   // clears all tabs (used by Settings replay)

// Per-tab coachmark content: one short lesson anchored to a real element per route.
const COACHMARKS = {
  home:     { find: firstVisible('.dash','main'), title, body },
  chores:   { find: firstVisible('.add-row[data-action="add-chore"]'), ... },
  money:    { find: firstVisible('.tabs'), ... },           // anchors to a reliably-present element (6.5)
  calendar: { find: firstVisible('[data-action="add-event"]'), ... },
  profile:  { find: firstVisible('.profile-head','main'), ... },
};
export function showCoachmark({ tab, storage, track, onEnd }) { ... }  // single-step reuse of the ring/card chrome
```

### Trigger point (`app.js`)

In `afterRender(route, sig)` (runs after every render), derive the current tab key from
`route.parts[0]` (mapping `money`→`money`, default→`home`, plus `profile`). If
`store.state` exists and `!coachSeen(storage, tab)`, call `showCoachmark({tab,...})` once,
then `markCoachSeen`. This fires the first time each tab is opened (6.1), once only (6.2),
with independent per-tab state (6.3). Storage failures are swallowed as today (6.6);
`track(...)` logs shown/seen via existing analytics (6.7).

### Coachmark presentation (non-blocking)

Coachmarks are **non-blocking tips**, not a modal gate. The reused chrome renders a card
anchored to a tab element, but the backdrop must **not** intercept pointer events: the
underlying tab stays fully usable while the tip is visible. A user can read the tip and keep
working, or dismiss it via "Got it" / Skip / Escape. Concretely, the coach variant sets
`pointer-events: none` on `.tour-backdrop` (and the backdrop stays visually dimmed only when
no spotlight ring is shown), while the card itself remains interactive. This differs from the
retired modal walkthrough, which intentionally blocked the page. Rationale: per-tab onboarding
should never stand between a first-time user (or an automated/e2e flow) and the first action on
a tab.

### Coachmark content must cover the v2 features

Each per-tab tip is a single short lesson (no new anchors/sub-steps), but its copy must name the
features introduced on that tab so onboarding actually teaches v2:

- **chores:** completing, whose-turn rotation, **auto-rotation** (advance automatically each
  cycle), and **swaps** (ask someone to take a chore / offer a trade).
- **money:** shared expenses + shopping list, and the new **purchasing rules / shared budget**.
- **profile:** dietary, personal budget, personal rules; local-only/interim.
- **home / calendar:** unchanged orientation copy (house expectations live in Settings).

### First-run and replay

- **The upfront guided tour is retired entirely.** The automatic first-run `launchTour` call
  in `app.js` is removed, and the monolithic `STEPS` sequence plus `startTour`/`endTour`/`go`/
  `resolveAnchor` driving it are deleted. Per-tab coachmarks are the only onboarding. The
  low-level chrome/positioning primitives (`buildChrome`, `position`, the ring/card DOM) are
  retained and reused by `showCoachmark`; everything specific to the multi-step walkthrough
  goes away.
- Onboarding now happens purely by coachmarks firing as the user first visits each tab — there
  is no "60-second tour" prompt on launch.
- Settings **"Replay tutorial"** (`'replay-tour'` action) calls `resetCoachmarks(storage)` so
  every tab shows its coachmark again on next visit (6.4). `reset` (delete data) also clears
  coach state. The Settings copy is reworded from "Replay the guided tour" to "Show the
  getting-started tips again".
- The `money` coachmark anchors to `.tabs` (always present on that route) and the engine's
  existing center-fallback handles a missing anchor (6.5).

---

## 8. Persistence & back-compat

- Do **not** bump `version` from `1`. Instead, after a successful `load()`, run a small
  `normalize(state)` that fills any missing new fields (`profile` on members, `autoRotate`/
  `anchorDate` on chores, `manualOverride` on occurrences, and `swaps`/`expectations`/
  `purchasing`/`prefs.channels` defaults). This keeps pre-existing `roomsync.v1` saves loading
  cleanly (NFR 3) and avoids touching the loader's version guard that tests rely on.
- `startDemo()` seeds one example of each new entity (an auto-rotating chore, a sample
  expectation, a purchasing budget + preferred product, and populated profiles) so the demo
  showcases the features and e2e tests have fixtures.

---

## 9. Notification preferences seam (NFR 2, roadmap Phase 3)

`prefs[userId].channels = { inApp:true, push:false, sms:false }` is added and shown as toggles
in Settings, but **only `inApp` affects behavior in this phase.** `notify()` continues to
write in-app records exactly as today; `push`/`sms` are stored, inert, and documented as
future delivery channels. This gives Phase 3 a defined insertion point without any network
code now.

---

## 10. Testing strategy

New `tests/*.test.mjs` suites mirroring `store.test.mjs` conventions (in-memory storage,
`createStore`, `startDemo`):

- **Rotation:** `cyclesSince`/`rotationAssignee`/`currentCycleDue` correctness; `advanceRotations`
  advances across skipped weeks without backlog; `manualOverride` suppresses auto-turn for one
  cycle then resumes; notification dedupe.
- **Swaps:** open request → accept reassigns + notifies; double-accept rejected; cancel;
  direct propose → accept swaps atomically; decline leaves unchanged; invalidation on
  complete/delete/reassign.
- **Expectations & purchasing:** add/edit/remove persistence + validation; budget parse
  rejects invalid; remaining-vs-over-budget computation; undo on removals.
- **Profiles:** `updateProfile` validation; defaults seeded; others' profiles visible.
- **Coachmarks:** `coachSeen`/`markCoachSeen` independence per tab; `resetCoachmarks` clears
  all; storage-blocked path doesn't throw.
- **Back-compat:** loading a `version:1` save lacking the new fields yields normalized state;
  existing `store.test.mjs` assertions remain green.

---

## Resolved decisions

1. **Upfront tour: retired entirely.** The monolithic first-run walkthrough and its `STEPS`
   engine are removed; per-tab coachmarks are the only onboarding, replayable from Settings.
   (See §7 "First-run and replay".)
2. **Profile: dedicated `#/profile` route**, not a Settings section, so it earns its own
   per-tab coachmark. (See §6.)
3. **Cycle length: weekly by default, household-configurable.** Rotation helpers take
   `cycleDays` (default 7) from the chore; the chore form exposes a cadence control. (See §1
   and §2.)
4. **Coachmarks are non-blocking tips.** The coach overlay backdrop does not intercept pointer
   events; the tab underneath stays usable and the tip is dismissable (Got it / Skip / Escape).
   (See §7 "Coachmark presentation".) Resolves an e2e regression where the backdrop blocked the
   first click on a freshly-opened tab.
5. **Per-tab coachmark copy covers the v2 features** it introduces — auto-rotation + swaps on
   chores, purchasing rules on money, profile fields on profile — mentioned inline in each
   existing single tip rather than via added anchors or steps. (See §7 "Coachmark content".)

## Post-implementation notes

- **Coachmark non-blocking refinements (Task 16):** beyond the backdrop `pointer-events: none`,
  running the e2e suite surfaced three more modal-era behaviors that broke non-blocking use and
  were fixed: (a) the card no longer auto-focuses (was stealing focus from the page); (b) the
  global key handler no longer hijacks Enter/ArrowRight — it only handles Escape, in bubble phase,
  and defers to an open modal dialog; (c) navigation (`hashchange`) now dismisses any open
  coachmark so a tip never lingers over another tab. Chores/money tip copy was expanded to teach
  auto-rotation + swaps and purchasing rules.
- **E2E harness:** the browser flows pre-seed `roomsync.coach.v1` (all tabs seen) via
  `addInitScript` so the non-blocking tip overlay never sits over a control during feature flows;
  onboarding itself remains covered by `tests/coachmarks.test.mjs`. Two stale assertions were
  updated for the v2 chore menu (which now includes swap items before 'Delete chore').
- **Pre-existing mobile layout fix:** at narrow widths the fixed bottom nav wraps to ~129px tall,
  but `.main-col` only reserved `--nav-h (64) + space-5` = 88px, so Home content overlapped the
  nav by ~9px (an e2e responsive assertion that was already failing before this spec). Bumped the
  mobile `.main-col` bottom padding to clear the nav’s real footprint. Unrelated to the v2
  features; fixed because it blocked a green e2e run.

All unit/contrast tests (99) and all five `e2e.*` browser flows pass after these changes.

- **Dev server (`serve.mjs`) Windows path fix:** the static server mapped a bare `/` to
  `index.html` via `normalize(pathname).endsWith("/")`. On Windows `normalize("/")` returns a
  backslash, so the site root returned 404 and blocked the e2e suite (which navigates to `/`).
  Fixed by resolving the directory default from the raw pathname before `normalize()`. This is a
  pre-existing dev-server bug unrelated to the v2 features; retained because it unblocks e2e.
