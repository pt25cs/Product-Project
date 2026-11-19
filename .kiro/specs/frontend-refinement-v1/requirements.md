# Front-end refinement v1 — Requirements

_Status: IMPLEMENTED. Source: the team's UI notes on Home, Chores, Expenses & Shopping, Calendar and Profile. Approved decisions: Home rules cards stay collapsed with content-based summaries (H2/H2a); Month is the default calendar view at every width; dialog notes boxes are fixed too (P2)._

## Goal

Make Kasa easier to scan and more obviously tappable, without adding clutter. Scope is **front end only** (`web/js/app.js`, `web/js/ui.js`, `web/js/logic.js`, `web/css/styles.css`). No data-model, store, or backend changes; every existing action keeps working.

## Principles (apply to every requirement)

- **P1 Calm over dense.** New content defaults to collapsed or summarized; one primary action per section.
- **P2 Sections look like sections.** Related content sits in a visibly bounded group with a clear heading.
- **P3 Clickable looks clickable.** Anything that acts or navigates has button chrome (border/fill, hover + focus state, chevron or icon where it navigates). Plain underlined text is reserved for inline prose links.
- **P4 Keep the design system.** Existing semantic color tokens only; no new colors unless they pass `contrast.test.mjs`. Targets stay ≥ 44px, focus rings stay visible, state is never conveyed by color alone.

---

## Home

**H1.** House expectations, the shared budget, preferred products and store preferences move from **Settings** to **Home**. They are removed from Settings (no duplicate copies).

**H2.** On Home they appear as two **collapsed-by-default** cards in the existing dashboard layout, each with a one-line summary visible while collapsed:
- _House expectations_ — e.g. “3 expectations”.
- _Shared purchasing rules_ — e.g. “$400 budget · 2 products · 1 store”.

**H2a. Expanding must be obvious** (the summary must not read as a dead end). Each card header is a full-width button with a visible chevron and an explicit text label (“View & edit” collapsed / “Hide” expanded), a border and hover state, and the same affordance as every other Home card. The summary names the contents (“Quiet after 11pm, +2 more”), so users see real content before expanding.

**H3.** Expanding a card shows the full, editable content with every capability that exists today: add / edit / remove expectations (with “added/updated by”), set / change budget, add / remove preferred products and store preferences, same dialogs and confirmations.

**H4.** Preferred products and store preferences render as compact **removable chips** with an “+ Add” chip-button, not full-width rows, so the expanded card stays short.

**H5.** Home must not feel longer by default: with both new cards collapsed, Home adds exactly two header rows. On narrow screens they sit after Shopping list and before Recent activity.

**H6.** Links that pointed to Settings for these items (the “Purchasing rules” hint on the Shopping tab) now point to Home and open the relevant card.

## Chores

**C1.** Each chore section (Overdue, Today, This week, Later, etc.) is a **bounded card** with a header band, count, and its own list. Overdue is visually distinct (danger-tinted header with the existing alert icon).

**C2.** Chore rows look interactive: the row has a border/hover state and a trailing chevron; tapping the row body opens chore details (today only the title text does this). The complete-checkbox and the “more actions” menu keep their own targets.

**C3.** The Mine / All / Completed tabs look like a **segmented button group**, not underlined text links.

**C4.** “Add chore” is a real outlined button (full-width at the bottom of the list), not a text row. Swap-request actions (Accept, Decline, Take it, Cancel) keep button styling and sit inside their own card.

## Expenses & Shopping

Direction confirmed with the team: make the existing clickable things obviously clickable and make the budget bold. No re-ordering of the tab.

**M1.** **“Details” and “Change” (and the other text-style actions) are noticeable.** Every small text-style action becomes a bordered button with an icon or chevron, a hover state and a clear label: expense **Details**, budget **Change / Set a budget**, shopping **Claim / Add again / Undo**, “See expense”. “Details” becomes a toggle button with a chevron that rotates when open.

**M2.** **“Add expense” and “Record repayment” are proper buttons**, not open text lines: full-width-on-phone outlined buttons with a plus icon (Add expense is the primary style; Record repayment is secondary), sitting together under the expenses list. “Add item” on Shopping gets the same treatment where it appears as a text row.

**M3.** **The bottom budget area is bold and obvious.** The “Household spending in <month>” total and the shared budget line (today small text at the bottom of the tab) become one prominent **Budget & spending** card, still at the bottom of the page. It shows:
- the month’s household spending in large type, and the shared budget amount;
- a **progress bar** of spent vs. budget, with the status as text and an icon — “$120 left” (success) or “Over by $30” (warning) — never color alone; the bar caps at 100% when over;
- a **Change budget** button (bordered, per M1);
- with no budget set: the spending total plus a primary **Set a shared budget** button and a one-line explanation.
Display only; Kasa still never blocks spending.

**M4.** Section separation on the tab: Your balance, Expenses and repayments, Budget & spending, and Everyone’s balance are each a bordered card with its own header, so sections are distinct. Shopping tab (Needed, Purchased) gets the same treatment, and its purchasing-rules hint becomes a compact card with a button to the rules on Home.

> **Note:** the personal monthly budget lives only on Profile and Kasa tracks no personal spending, so there is no bar for it. If “other budget” meant that, say so and we’ll scope it.

## Calendar

**K1.** The **Week** view is replaced by a **Month** view (the Agenda view stays). View toggle: **Agenda | Month**. Month is the default at every screen width (decided: phone default is not a priority; on phones the month grid is compact and the selected day’s agenda sits right below it).

**K2.** Month grid: Monday-start (matches the rest of the app), always whole weeks, today highlighted, days outside the month muted. Navigation is by month: “Previous month”, “Next month”, “Today”; the heading shows month and year.

**K3.** Cells are compact to remove whitespace: on desktop a cell shows up to 3 items as small category-colored chips (icon + title; chores shown as quieter outlined chips) plus “+N more”; on narrow screens a cell shows the date and up to 3 dots.

**K4.** Selecting a day (click/tap on the date, or “+N more”) shows that day’s full list directly below the grid (≥ 1100px: beside it), using the existing agenda rows. Clicking a chip opens that event/chore directly, as today.

**K5.** Everything else is unchanged: Add event, category legend, creator-only edit/delete, chores read from chore records.

## Profile

**P1.** “Personal roommate rules” (and “Dietary restrictions”, which has the identical defect) show a **visible bordered text box** at rest: standard input border, ≥ 96px tall, visible focus ring, with an “n / 300” character counter. Same behavior and validation as today.

**P2 (approved).** The same borderless style exists on Notes in the chore and event dialogs and on the Expectation dialog. Fix those to match so the app is consistent.

## Cross-cutting

**X1.** Fully keyboard operable; new buttons have accessible names (“Open house expectations”, “Previous month”, etc.).
**X2.** Works from 360px to wide desktop with no horizontal scroll.
**X3.** `npm test` stays green; new date helpers have unit tests; the contrast test covers any new token pairs.
**X4.** Existing browser (Playwright) scripts that assume the Week view or Settings contents are updated.

## Out of scope

Data model, store actions, backend/Supabase, notification logic, dark mode, new features (e.g. drag-to-reschedule), recurring-event changes.

---

## Brand refresh (added after approval)

**B1.** The color scheme becomes **indigo, salmon and white**. Indigo (the blue in the logo, `#444E94`) is the primary/interactive color; salmon (`#DB7679`) is the accent; white and a warm-white canvas (`#FFF8F7`) are the surfaces.
**B2.** Salmon is used for the logo, the active-nav marker and event category “Household plans”. It is **not** used for text or as a button fill: white or navy on `#DB7679` is below 4.5:1. Salmon text uses `--color-accent-strong` (`#A63F44`).
**B3.** The logo is the bottom-right option (“Round table”: salmon circle, white K-roof mark, salmon “Kasa” wordmark), used in the header/sidebar, welcome and sign-in screens and as the favicon.
**B4.** Hex values were estimated by eye from the design board and the mark was recreated as inline SVG. Replace with the official hex values and SVG when available (tokens are centralized in `:root`).
