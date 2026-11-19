# Front-end refinement v1 — Tasks

_Status: DONE (all tasks implemented and verified in a real browser). Order was smallest/lowest-risk first so each task left the app shippable._

- [x] **T1. Profile text boxes** (P1 and P2, both approved) — remove `qa-notes` from the two profile textareas, add border/min-height/counter. _Verify:_ visible box at rest, focus ring, counter updates, save still works.
- [x] **T2. Shared primitives** (design: Shared primitives) — `.cards`, header band, `.row-card`, `.btn.nav`, `.chip`, `.seg-tabs`, `.progress`, outlined add button. Add token pairs to `contrast.test.mjs`. _Verify:_ `npm test` green; no visual change yet beyond Profile.
- [x] **T3. Chores** (C1–C4) — cards per section, row-wide clickable rows, segmented tabs, outlined Add chore, swap-requests card. _Verify:_ complete/undo, menu actions, view-chore dialog all still work; keyboard order sensible.
- [x] **T4. Expenses & Shopping** (M1–M4) — noticeable Details/Change buttons, Add expense / Record repayment as real buttons, bold Budget & spending card with progress bar, card-per-section on both tabs. _Verify:_ budget unset / under / over states (bar caps at 100%); add/edit/delete expense, record repayment, claim/purchase flows unchanged.
- [x] **T5. Home + Settings move** (H1–H6) — two collapsed cards with content-based summaries and a visible “View & edit” affordance, chip lists, remove from Settings, re-point the Shopping hint link, `#/home?open=` deep link. _Verify:_ every expectation/budget/product/store action works from Home; Settings no longer shows them; `expectations.test.mjs` and `purchasing.test.mjs` still pass untouched.
- [x] **T6. Calendar helpers** (K2) — `addMonths`, `monthGrid` in `logic.js` with unit tests. _Verify:_ new tests pass.
- [x] **T7. Calendar month view** (K1–K5) — Month replaces Week, month navigation, compact cells, “+N more”, selected-day panel, narrow-screen dots. _Verify:_ today/selected/outside-month states, chip → event dialog, add event lands in the right cell, 360px–1280px with no horizontal scroll.
- [x] **T8. Browser scripts + screenshots** (X4) — update the `e2e.*.mjs` scripts; retake `docs/screenshots/`. Added `web/tests/e2e.frontend-v1.mjs`; the four older scripts were updated for Month view, row-button names and the new primary color. `docs/screenshots/` retaken (`calendar-week-desktop.png` replaced by `calendar-month-desktop.png`).
- [x] **T9. Docs** — README “What works” / layout notes and `docs/roadmap.md` mention of the new Home location for house rules and purchasing rules.

- [x] **T10. Brand refresh** (B1–B4) — indigo/salmon/white tokens, Round-table logo mark, favicon, new contrast pairs. _Verify:_ `contrast.test.mjs` green with the new tokens.

## Approval gates

All open questions were answered before implementation.
