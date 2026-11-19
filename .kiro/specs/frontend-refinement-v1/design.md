# Front-end refinement v1 — Design

_Status: IMPLEMENTED. Requirement IDs (H1, C2, …) refer to `requirements.md`._

**Differences from the first draft:** the small bordered action buttons use the existing `.btn.sm` (no new `.btn.outline-sm`); the segmented tabs are the existing `.tabs` markup restyled (no `.seg-tabs` class); `sec()` now wraps its body in `.sec-body` so card padding works everywhere; `addRow()` renders an outlined dashed button app-wide; the Home disclosure `right` slot takes `navBtn()` buttons; the legacy Week CSS was removed; `web/serve.mjs` serves an empty `config.js` when none exists (no more 404 console error).

## Shared primitives (new, in `styles.css` + small helpers in `app.js`)

Today only the Profile page uses card chrome (`.profile-cards .sec`). Generalize it:

| Primitive | What it is | Used by |
|---|---|---|
| `.cards` wrapper | Makes each child `.sec` a card: 1px `--color-border`, `--radius-surface`, 16px padding, 16px gap between cards. Replaces the Profile-only rule. | Chores, Expenses, Shopping, Profile |
| `.sec-head` band | Header row on `--color-surface-subtle` inside a card (heading, count, optional action button). Danger variant uses `--color-danger-subtle`. | all cards |
| `.row-card` | Clickable row: bordered, hover = `--color-primary-subtle` + primary border, trailing chevron, 56px min height. The row body is the `<button>`/`<a>`; checkbox and ⋯ menu stay separate targets. | chores, expenses, shopping |
| `.btn.nav` | Existing `.btn.sm` + trailing chevron icon, for “Open expenses”, “Open list”, “See expense”. | Home, Money |
| `.btn.outline-sm` | Small bordered button with icon/label for text-style actions (Details, Change, Claim, Add again, Undo). | Money, Shopping |
| `.chip-btn` / `.chip` | Pill with optional × (remove) and a dashed “+ Add” pill. | Home purchasing rules |
| `.seg-tabs` | Segmented button group (reuses the existing `.seg` look from the calendar view toggle). | Chores tabs, Calendar toggle |
| `.progress` | Thin bar + text label (value never color-only). | Shared budget |

No new colors: `--color-surface-subtle`, `--color-primary-subtle`, `--color-danger-subtle`, `--color-border` cover it. Any new foreground/background pair is added to `contrast.test.mjs`.

## Home (H1–H6)

Current: two columns (`.dash`), each item a `disclosure()`. Add two disclosures to the side column and remove two sections from `viewSettings`:

```
Today                                       (page head)
┌ main column ─────────────┐ ┌ side column ─────────────────────────┐
│ Overdue                  │ │ ▸ Expenses                           │
│ ▾ Chores                 │ │ ▸ Household plans                    │
│ Past due in household    │ │ ▸ Shopping list                      │
│ ▸ Recent activity        │ │ ┌──────────────────────────────────┐ │
│                          │ │ │ House expectations   View & edit ⌄│ │  NEW
│                          │ │ │ Quiet after 11pm, +2 more        │ │
│                          │ │ └──────────────────────────────────┘ │
│                          │ │ ┌──────────────────────────────────┐ │
│                          │ │ │ Shared purchasing    View & edit ⌄│ │  NEW
│                          │ │ │ $400 budget · 2 products · 1 store│ │
│                          │ │ └──────────────────────────────────┘ │
└──────────────────────────┘ └──────────────────────────────────────┘
```
- Reuse `disclosure()`, extended with a bordered header, a visible text label (“View & edit” / “Hide”) next to the chevron, and a summary line under the title (H2/H2a). The summary is built from real content (first expectation text + “+N more”; budget + product/store counts), so it is informative, not just a count.
- Move `expectationsSection()` and `purchasingRulesSection()` bodies as-is into the expanded area (their `data-action`s, modals and confirm dialogs are untouched, so store logic and `expectations.test.mjs` / `purchasing.test.mjs` are unaffected). `purchasingRulesSection()` switches its two lists to `.chip` rows; the budget line becomes a value plus a **Change** button.
- `ui.open` tracks open state in memory; collapsed on first load. Deep link `#/home?open=purchrules` sets `ui.open.purchrules = true` and scrolls to it (used by the Shopping hint, H6).
- Narrow-screen order: after Shopping list, before Recent activity (`data-o` renumbered; activity last).
- Remove both sections from `viewSettings()`. Settings keeps Household, Notifications, Tour, Research, Account, Danger zone.

_Considered and rejected:_ an always-open “Household agreements” band (more visible, but makes Home long by default) and a single two-tab card (hides half the content). Revisit if testers miss the cards.

## Chores (C1–C4)

- `viewChores`: wrap output in `.cards`. `choreSections()` already emits one `sec()` per group — they inherit card chrome and header band; Overdue passes the danger variant (already has `danger: true`).
- `choreRow`: replace `.title-btn` with a row-wide `.row-card` button (`data-action="view-chore"`) containing title + meta + chevron; keep `.chk` and the ⋯ menu outside the button so nested interactive controls stay valid HTML. Owner chip stays.
- Tabs: `.tabs` markup → `.seg-tabs` (links with `aria-current="page"`, filled primary-subtle selected state).
- “Add chore”: `addRow()` gets an `outlined` variant (dashed border, full width, centered plus) used here and for Add expense / Add item.
- Weekly counts disclosure becomes a card at the bottom.

## Expenses & Shopping (M1–M4)

Tab order is unchanged: **Your balance → Expenses and repayments → Budget & spending → Everyone’s balance**, each a card (`.cards`).

- **Noticeable controls (M1):** add `.btn.outline-sm` (bordered, 36px, icon + label) and use it for: expense **Details** (a toggle button replacing the inline `<details><summary>`; chevron rotates; `aria-expanded` kept), budget **Change / Set a budget** (replacing `.btn.quiet`), Shopping **Claim / Add again / Undo**, and “See expense”. Home’s “Open expenses / Open list / Open chores / Calendar” header links become `.btn.nav`.
- **Real buttons (M2):** `addRow()` for Add expense / Record repayment / Add item is replaced by a button group under the list: **Add expense** (`.btn.primary`, plus icon) and **Record repayment** (`.btn`); stacked full-width below 560px.
- **Budget & spending card (M3):** new `budgetCard()` replaces the “Household spending in <month>” section and `budgetLine()`:
  - Large spend figure (`.balance-line` scaled up) and “of $Y budget”.
  - `.progress` bar: `width = min(100, spent / budget)`; fill uses `--color-success` under budget and `--color-warning` over; always paired with a text status chip (icon + “$Z left” / “Over by $Z”) and `role="progressbar"` with `aria-valuenow/max` and a text label.
  - **Change budget** button; unset state shows spend total, one sentence, and a primary **Set a shared budget** button.
  - Reads the existing `store.sel.budgetStatus()` and `store.sel.monthTotal()`; **no store changes**.
- **Shopping tab (M4):** quick-add stays on top; Needed and Purchased become cards; item name is an Edit `.row-card`. `shoppingHint()` becomes a compact card with an “Open purchasing rules” `.btn.nav` that goes to Home (H6).

## Calendar (K1–K5)

**Pure helpers in `logic.js`** (unit-tested):
- `addMonths(dateStr, n)` — clamps the day (Jan 31 + 1 → Feb 28/29).
- `monthGrid(dateStr)` → array of weeks, each 7 `{ date, inMonth }`, Monday-start, 5–6 weeks. Built on the existing `startOfWeek`/`addDays`.

**`viewCalendar` changes**
- `ui.calView` values become `'agenda' | 'month'`; default `'month'`. Existing `'week'` value maps to `'month'` (in-memory only, no migration needed).
- Title bar: `cal-shift` now moves by month in Month view (delta ±1 month via `addMonths`) and by week in Agenda view (its date strip is still weekly). Button labels: “Previous/Next month” in Month view.
- Month grid markup: `role="grid"`-free, plain `<div class="month">` of 7-column rows with a weekday header row; each day cell is a `<section>` containing a date button (`data-action="cal-pick"`) and item buttons (`data-action="view-event" | "view-chore"`).
- Density: cell `min-height` 96px desktop / 52px narrow (no fixed row heights, so weeks with few items shrink); items beyond 3 collapse to a “+N more” button (`cal-pick`) that selects the day.
- Narrow screens: items render as up to 3 dots (existing `.dots i.cat` styles); the selected day’s list is the main content below the grid.
- Selected-day panel: reuses the existing agenda-day row markup for `ui.calSel`; placed beside the grid at ≥ 1100px, below otherwise.
- Today marker, past-day dimming, category legend and Add event are reused.

## Profile (P1/P2)

The cause is `.qa-notes { border: 0 !important; … }` applied to the two profile textareas (it is meant for the borderless notes in dialogs). Fix: drop `qa-notes` from `#f-dietary` and `#f-rules`, set `min-height: 96px`, keep the global `textarea` border/focus styles, add a `maxlength` counter (“n / 300”, `aria-live="off"`, updated on input). P2, if approved, drops the class from the three dialog textareas the same way (and gives them a visible border).

## Testing & verification

- **Unit (`npm test`):** `addMonths` (month-end clamping, year rollover), `monthGrid` (Monday start, 5 vs 6 week months, leading/trailing days flagged `inMonth: false`, leap February).
- **Contrast:** add any new token pairs (header band text on `--color-surface-subtle`, chip text on `--color-primary-subtle`, danger header) to `contrast.test.mjs`.
- **Browser scripts** (`e2e.*.mjs`, need Playwright — not installed in this environment): update the Week-view steps (`e2e.demo`, `e2e.fixes`, `e2e.refresh`, `e2e.refinement`) to Month, and any Settings steps for expectations/purchasing to Home. Add checks: collapsed cards on Home with correct summaries; edit flows work from Home; budget card states (unset / under / over); month nav and “+N more”; profile textarea has a visible border.
- **Visual:** retake `docs/screenshots/` for Home, Chores, Expenses, Calendar (desktop + 390px) and compare against this spec.

## Risks / notes

- `choreRow` currently nests a button inside a row that also contains a checkbox button and a menu; the row-wide button must not wrap those (hence siblings, not nesting).
- Removing Week changes labels that existing e2e scripts select by name (“Next week”, radio “Week”); they must be updated together with the UI change.
- Multi-day events show in every cell they cover (as chips/dots); no spanning bars in v1.
