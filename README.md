# Kasa (MVP prototype)

> Know what needs to happen, who’s responsible, and what’s already done—without chasing your roommates.

A small, dependency-free web app for 2–5 college roommates: shared **dashboard**, **chores with rotation**, **expenses & shopping**, a **shared calendar**, and an **in-app notification center**. Built for user testing.

## Run the demo

```bash
npm start            # serves http://localhost:8080  (any static server works; no install/build step)
```
Open the page and click **Try demo household** (you start as Maya). Use **Viewing as** in the header to switch roommates.

Run the checks:
```bash
npm test             # logic tests (money split, rotation, balances, reminders, persistence…) + design-token contrast checks
# Optional browser checks (need Playwright + Chromium, app running on :8080):
PLAYWRIGHT_MODULE=/path/to/playwright node tests/e2e.demo.mjs            # demo scenario, keyboard, responsive sweep
PLAYWRIGHT_MODULE=/path/to/playwright node tests/e2e.chore-details.mjs   # chore details dialog
PLAYWRIGHT_MODULE=/path/to/playwright node tests/e2e.refresh.mjs         # quick add, calendar date strip, Add menu, empty states
PLAYWRIGHT_MODULE=/path/to/playwright node tests/e2e.refinement.mjs      # Home previews, nav label, mobile header, calendar entry points, copy
```

## Design system
List-first and quiet, in the spirit of Todoist: a tinted sidebar with a clear selected row and an **Add** entry, a focused white content column with strong page headings, round-check task rows with thin separators and one line of muted metadata, inline "+ Add" rows, and small contextual menus. The calendar borrows Fantastical's date strip over a time-first agenda; shopping borrows AnyList's quick-add field, check-off rows and "add again". One shared palette throughout: white and `#F8FAFC` surfaces, slate text, indigo `#4F46E5` for interaction, semantic green/amber/red always paired with an icon or text.

All colors are semantic CSS tokens at the top of `css/styles.css` (`--color-*`); `tests/contrast.test.mjs` checks the real token pairs against WCAG contrast ratios. Shared primitives live in `js/ui.js` (icons, dialogs, menus, form fields, toasts). No card chrome around lists; cards are used only for focused groups (the balance panel and forms).

## Demo walkthrough (verified by `tests/e2e.demo.mjs`)
1. Click **Try the demo** → dashboard as Maya.
2. Tick the checkbox next to **Take out trash & recycling** (due today) → complete. Undo is offered.
3. Dashboard updates; **Chores → Completed** shows who/when and “On time”. The next weekly occurrence is created once, assigned to the next person in rotation (Jordan).
4. **Expenses & Shopping → Shopping**: **Claim** Dish soap → **Purchased** → enter the price (e.g. 10.01) → saves the purchase + one linked expense (double-clicks can’t duplicate it).
5. **Expenses** tab: balances recalculate (shares are exact to the cent; leftover cents go to the earliest roommate in household order).
6. **Calendar → Add event** (Quiet / study). Mobile opens on an agenda of today and upcoming; Week view is one tap away.
7. Switch **Viewing as → Jordan**: notification bell shows the new expense share and the calendar change; Home shows shared activity.

## What works
- Create a household (name, roommates, optional starter chores) or open the seeded demo household.
- Chores: create/edit/delete, one-time or weekly, manual (re)assignment, optional round-robin rotation (current & next assignee shown), one-tap complete + undo, completion history with who/when and on-time marker, My / All / Completed views, per-roommate counts for a selected week (not a fairness score).
- Expenses: equal split among chosen participants in integer cents, edit/delete with recalculated balances, “settle up” suggestions, recorded repayments (**does not move money**), current-month total.
- Shopping: items with quantity/notes/buyer, claim, purchased history, optional linked expense with price + split participants.
- Calendar: week view + upcoming list; Away / Quiet-study / Guests / Household plans; creator-only edit/delete; dated chores displayed alongside events (read from chore records, not duplicated).
- Notifications: new assignments, due-soon/overdue chore reminders (deduped; cleared when completed), new shared expenses, event changes; read/unread; links to the record; reminder preferences.
- Validation errors, empty states, save-failure banner, delete confirmation + one-step undo, keyboard-friendly native controls, visible focus, mobile bottom nav / desktop sidebar.

## Two modes: local demo and authenticated accounts (Phase 2)

Kasa now runs in **two modes**, chosen by whether you sign in:

- **Demo / local (default, no setup).** With no `web/js/config.js`, Kasa runs entirely in the
  browser: `localStorage` (key `roomsync.v1`), the **"Viewing as"** switcher standing in for
  accounts, and the seeded demo household. No backend, no network, no accounts. This path is
  permanent — the demo never contacts a server and is never auto-upgraded.
- **Authenticated (real backend).** With a Supabase backend configured (see
  `docs/phase-2-setup.md`), the welcome screen offers **Continue with Google**. Signing in gives
  you a server-backed account: your **profile** (dietary, personal budget, personal rules) and a
  **verified phone number** are stored server-side and portable across devices; "Viewing as" is
  retired (you act as yourself). You can **create** a household, **join** one with an invite code,
  or **import** your existing local demo data into your account (non-destructive, one-time).

Setup for the authenticated path lives in **`docs/phase-2-setup.md`** (Supabase project, Google
OAuth, schema push, edge functions, config).

## What is simulated or not supported
- **Phone verification: code built and tested, live SMS deferred.** Phone verification works
  against Twilio Verify but requires a billing-enabled Twilio account to send real texts, so the
  live SMS step is deferred (phone verification is non-blocking in Phase 2). See the setup guide.
- **Cross-device sync is identity + profile only (Phase 2).** Real-time sync of the whole
  household dataset across devices is Phase 5; Phase 2 syncs who-you-are and your profile, and
  migrates a local household into your account once.
- **Reminders are in-app only**, evaluated while the app is open. Push/SMS **delivery** of
  notifications is Phase 3 (the preferences model has the inert channel toggles already).
- Events: no external calendar sync, no location or presence tracking. Guest events are informational.
- Not built (out of scope): approvals, payments/Venmo, rules doc, chat, gamification, AI scheduling.
- Household membership can’t be edited after creation in this version.

## Data model (in `localStorage`, one household per browser)
`household`, `members` (user + membership combined), `chores` (templates: recurrence, rotation), `occurrences` (dated instances with `assigneeId`, `doneBy`, `doneAt`, `nextOccId`), `expenses` (with stored `splits`), `reimbursements`, `shopping`, `events`, `notifications`, `activity`, `prefs`, `analytics`. Dashboard cards and feature screens read the same records through shared selectors in `js/store.js`.
Dates are local `YYYY-MM-DD` (times `YYYY-MM-DDTHH:mm`); timestamps like `doneAt` are ISO-8601 UTC. Weeks start Monday.

## User-testing support
Basic events (household created, chore assigned/completed, expense created, shopping purchased, calendar event created) plus completion timestamps are logged **locally**. **Settings → Download events (JSON)** exports them. No metrics are displayed. The research targets (≥80% easier coordination, ≥75% month-one retention, ≥70% on-time chores) are targets, not results; on-time can be computed from `due` vs `completedAt` in the export.

## Backend status (what's built)
- **Done (Phase 2):** Supabase backend with Google auth, `households`/`memberships`/`profiles`/`invitations` + content tables, row-level security for per-household isolation, invite codes, local→account migration, and a backend-backed persistence seam in `createStore` (the store's action functions are the seam — unchanged on both paths). See `docs/phase-2-setup.md`.
- **Deferred:** live SMS phone verification (Twilio paid gate; code built).
- **Later phases:** push + SMS **delivery** (Phase 3), B2B multi-tenancy (Phase 4), full real-time cross-device sync + conflict handling (Phase 5). See `docs/roadmap.md`.

## Layout
`web/index.html` · `web/css/styles.css` · `web/js/logic.js` (pure helpers) · `web/js/store.js` (data + actions, local or backend) · `web/js/app.js` (UI) · `web/js/auth.js` · `web/js/session.mjs` · `web/js/backend.mjs` · `web/js/migrate.mjs` · `web/tests/` · `web/serve.mjs` · `supabase/` (migrations, edge functions, tests)
