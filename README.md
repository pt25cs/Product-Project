# RoomSync (MVP prototype)

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
# Optional browser walkthrough of the demo scenario (needs Playwright + Chromium, app running):
PLAYWRIGHT_MODULE=/path/to/playwright node tests/e2e.demo.mjs
```

## Design system
Neutral canvas (`#F8FAFC`), white surfaces, slate text, one indigo accent (`#4F46E5`), semantic green/amber/red. All colors are semantic CSS tokens at the top of `css/styles.css` (`--color-*`); `tests/contrast.test.mjs` checks the real token pairs against WCAG contrast ratios. Controls, buttons, dialogs, menus, chips and rows share one set of primitives (`js/ui.js` + CSS). Status never relies on color alone (icons, text labels, state on checkboxes).

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

## What is simulated or not supported
- **No backend, accounts, or sync.** All data is stored in this browser’s `localStorage` (key `roomsync.v1`). Other devices/browsers see nothing. The “Viewing as” switcher is a demo-mode stand-in for separate user accounts; it is not authentication.
- **Invite links / join codes: not implemented** (they need a server). The welcome screen says so.
- **Reminders are in-app only**, evaluated while the app is open (on load, every minute, and when the tab regains focus). There is **no background/browser/device push** and no delivery confirmations are shown.
- Events: no external calendar sync, no location or presence tracking. Guest events are informational.
- Not built (out of scope): approvals, payments/Venmo, rules doc, chat, gamification, AI scheduling.
- Household membership can’t be edited after creation in this version.

## Data model (in `localStorage`, one household per browser)
`household`, `members` (user + membership combined), `chores` (templates: recurrence, rotation), `occurrences` (dated instances with `assigneeId`, `doneBy`, `doneAt`, `nextOccId`), `expenses` (with stored `splits`), `reimbursements`, `shopping`, `events`, `notifications`, `activity`, `prefs`, `analytics`. Dashboard cards and feature screens read the same records through shared selectors in `js/store.js`.
Dates are local `YYYY-MM-DD` (times `YYYY-MM-DDTHH:mm`); timestamps like `doneAt` are ISO-8601 UTC. Weeks start Monday.

## User-testing support
Basic events (household created, chore assigned/completed, expense created, shopping purchased, calendar event created) plus completion timestamps are logged **locally**. **Settings → Download events (JSON)** exports them. No metrics are displayed. The research targets (≥80% easier coordination, ≥75% month-one retention, ≥70% on-time chores) are targets, not results; on-time can be computed from `due` vs `completedAt` in the export.

## To make it real later
- **Real household sharing:** add a backend (e.g. Supabase/Firebase or a small API + Postgres) with auth, `households`/`memberships` tables keyed by household id (row-level security for isolation), invite codes, and replace `localStorage` persistence in `createStore` with API calls; the store’s action functions are the natural seam.
- **Push notifications:** requires a service worker, Web Push (VAPID keys) with user permission, and a server-side scheduler to fire due/overdue reminders when the app is closed.

## Layout
`index.html` · `css/styles.css` · `js/logic.js` (pure helpers) · `js/store.js` (data + actions) · `js/app.js` (UI) · `tests/` · `serve.mjs`
