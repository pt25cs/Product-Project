// End-to-end checks in a real browser (demo scenarios, responsive overflow, keyboard basics).
// Needs Playwright + Chromium (not a project dependency) and the app running (npm start):
//   PLAYWRIGHT_MODULE=/path/to/playwright [CHROMIUM=/path/to/chrome] [SHOTS=dir] node tests/e2e.demo.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.APP_URL || 'http://localhost:8080/';
const shots = process.env.SHOTS || '';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const shot = (n) => shots && page.screenshot({ path: `${shots}/${n}.png`, fullPage: true });
const step = (s) => console.log('✓', s);
const st = (fn, arg) => page.evaluate(fn, arg);
const nav = (label) => page.getByRole('navigation', { name: 'Primary' }).last().getByRole('link', { name: label });
const addMenu = async (item) => { await page.getByRole('button', { name: 'Add', exact: true }).click(); await page.getByRole('menuitem', { name: item }).click(); };
const toastGone = () => page.evaluate(() => document.querySelectorAll('#toasts .toast').forEach((t) => t.remove()));

// 1. demo entry
await page.goto(BASE);
await page.getByRole('button', { name: /Try the demo/ }).click();
await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor();
await page.getByText(/Good (morning|afternoon|evening), Maya/).waitFor();
assert.equal(await page.locator('#switch-user').inputValue().then((v) => st((id) => window.__roomsync.nameOf(id), v)), 'Maya');
await page.getByText('Demo · Saved on this device').waitFor();
// first useful task visible without scrolling on a phone
const trashBox = await page.getByRole('checkbox', { name: 'Complete: Take out trash & recycling' }).boundingBox();
assert.ok(trashBox && trashBox.y + trashBox.height < 844, 'first chore should be on the first screen');
await shot('01-home-mobile');
step('1. demo entry; first chore is above the fold on a phone');

// 2/3. complete, derived views, undo, recurrence
const trash = () => page.getByRole('checkbox', { name: 'Complete: Take out trash & recycling' });
const occCount = () => st(() => window.__roomsync.state.occurrences.length);
const before = await occCount();
await trash().dblclick(); // repeated click must not duplicate
await page.getByText('Completed Take out trash & recycling.').waitFor();
assert.equal(await trash().count(), 0);
assert.equal(await occCount(), before + 1, 'exactly one next occurrence');
const next = await st(() => { const s = window.__roomsync; const o = s.state.occurrences.filter((x) => x.title.startsWith('Take out') && !x.doneAt)[0]; return { who: s.nameOf(o.assigneeId), due: o.due, today: s.today() }; });
assert.equal(next.who, 'Jordan');
await page.getByText("You’re all caught up today").waitFor();
await nav('Chores').click();
await page.getByRole('navigation', { name: 'Chore views' }).getByRole('link', { name: 'Completed' }).click();
await page.getByText(/^You · /).first().waitFor();
await page.getByText('On time').first().waitFor();
await shot('02-completed-mobile');
await toastGone();
await page.getByRole('button', { name: 'Undo completing Take out trash & recycling' }).click();
await page.getByText('Chore is open again.').waitFor();
assert.equal(await occCount(), before, 'undo removes the generated occurrence');
await page.getByRole('navigation', { name: 'Chore views' }).getByRole('link', { name: 'Mine' }).click();
await trash().waitFor();
step('2-3. complete → dashboard/history update → undo restores; one next occurrence for Jordan; no duplicates');

// 4/5. shopping purchase → one linked expense; balances; split preview
await nav('Expenses & Shopping').click();
await page.getByRole('link', { name: 'Shopping', exact: true }).click();
await page.getByRole('button', { name: 'Claim Dish soap' }).click();
await page.getByText('You’re getting this').first().waitFor();
await page.getByRole('checkbox', { name: 'Purchased: Dish soap' }).click();
await page.getByLabel('Amount (USD)').fill('10.01');
await page.getByText('Split 4 ways: Maya $2.51 · Jordan $2.50 · Priya $2.50 · Sam $2.50').waitFor();
const balBefore = await st(() => window.__roomsync.sel.balances());
await page.getByRole('button', { name: 'Save purchase and expense' }).dblclick();
await page.getByText('Purchased Dish soap and recorded the expense.').waitFor();
const exps = await st(() => window.__roomsync.state.expenses.filter((e) => e.description === 'Dish soap').map((e) => ({ c: e.amountCents, link: !!e.shoppingItemId })));
assert.deepEqual(exps, [{ c: 1001, link: true }]);
const balAfter = await st(() => window.__roomsync.sel.balances());
const ids = await st(() => Object.fromEntries(window.__roomsync.state.members.map((m) => [m.name, m.id])));
assert.equal(balAfter[ids.Maya] - balBefore[ids.Maya], 1001 - 251);
assert.equal(balAfter[ids.Jordan] - balBefore[ids.Jordan], -250);
assert.equal(Object.values(balAfter).reduce((a, b) => a + b, 0), 0);
await page.locator('details[data-key=bought] > summary').click(); await page.waitForTimeout(200); console.log('open?', await st(() => document.querySelector('details[data-key=bought]').open), await st(() => location.hash));
await page.getByText('See expense').first().waitFor();
await shot('03-shopping-mobile');
step('4-5. claim → purchase → exactly one linked expense, shares sum to total, balances reconcile');

// edit + delete expense recalculates; undo
await page.getByRole('link', { name: 'Expenses', exact: true }).click();
await page.getByRole('button', { name: 'More actions for Dish soap' }).click();
await page.getByRole('menuitem', { name: 'Edit expense' }).click();
await page.getByLabel('Amount (USD)').fill('10.03');
await page.getByRole('button', { name: 'Save changes' }).click();
assert.deepEqual(await st(() => Object.values(window.__roomsync.state.expenses.find((e) => e.description === 'Dish soap').splits).sort()), [250, 251, 251, 251]);
await page.getByRole('button', { name: 'More actions for Dish soap' }).click();
await page.getByRole('menuitem', { name: 'Delete expense' }).click();
await page.getByRole('button', { name: 'Delete expense' }).click();
assert.deepEqual(await st(() => window.__roomsync.sel.balances()), balBefore);
await toastGone();
step('5b. edit recalculates splits; delete restores balances exactly');

// 6. repayment
await page.getByRole('button', { name: 'Record repayment' }).first().click();
await page.getByText('RoomSync doesn’t move money.').first().waitFor();
await page.getByLabel('Amount (USD)').fill('5');
const bal0 = await st(() => window.__roomsync.sel.balances());
await page.getByRole('button', { name: 'Record repayment' }).last().click();
await page.getByText('Repayment recorded. No money was moved by RoomSync.').waitFor();
const bal1 = await st(() => window.__roomsync.sel.balances());
assert.equal(bal1[ids.Maya] - bal0[ids.Maya], 500);
await shot('04-expenses-mobile');
step('6. external repayment recorded, balances updated, copy states no money moves');

// 7. calendar: invalid, add, edit
await nav('Calendar').click();
await addMenu('Event');
await page.getByRole('textbox', { name: 'Title' }).fill('Quiet time: orgo prep');
await page.getByLabel('End time').fill('18:00');
await page.getByRole('button', { name: 'Add event' }).last().click();
await page.getByText('End time must be after the start time.').waitFor();
assert.equal(await page.getByLabel('Title').inputValue(), 'Quiet time: orgo prep', 'values preserved after validation error');
await page.getByLabel('End time').fill('21:00');
await page.getByRole('button', { name: 'Add event' }).last().click();
await page.getByText('Event added.').waitFor();
await page.getByRole('button', { name: /Quiet time: orgo prep/ }).first().click();
await page.getByRole('button', { name: 'Edit' }).click();
await page.getByRole('textbox', { name: 'Title' }).fill('Quiet time: orgo exam');
await page.getByRole('button', { name: 'Save changes' }).click();
await page.getByRole('button', { name: /Quiet time: orgo exam/ }).first().waitFor();
await shot('05-calendar-mobile');
await page.getByRole('radio', { name: /Week/ }).check({ force: true });
await page.getByText('Mon').first().waitFor();
step('7. event added (validation error near field, values kept), edited, visible in agenda and week views');

// 8/9. switch roommate; notifications
await page.getByLabel('Viewing as').selectOption({ label: 'Jordan' });
await nav('Home').click();
await page.getByText(/Good (morning|afternoon|evening), Jordan/).waitFor();
await page.getByText('Deep-clean kitchen').first().waitFor();
await page.getByRole('link', { name: /^Notifications/ }).click();
await page.getByText('Maya updated Quiet time: orgo exam.').first().waitFor();
await page.getByText(/Your share: \$2\.50/).first().waitFor();
const unread0 = await st(() => window.__roomsync.sel.unread());
assert.ok(unread0 > 0);
await page.getByText('Maya updated Quiet time: orgo exam.').first().click();
await page.getByRole('heading', { name: 'Calendar' }).waitFor();
assert.equal(await st(() => window.__roomsync.sel.unread()), unread0 - 1, 'following a notification marks it read');
await shot('06-notifications-mobile');
await page.getByRole('dialog').waitFor(); // notification link opens the event
await page.keyboard.press('Escape');
await page.getByLabel('Viewing as').selectOption({ label: 'Maya' });
step('8-9. Jordan sees his own chores/notifications; opening a notification marks it read and navigates; switched back');

// 10. persistence
await nav('Chores').click();
await page.reload();
await page.getByRole('heading', { name: 'Chores' }).waitFor();
assert.equal(await st(() => window.__roomsync.state.events.filter((e) => e.title === 'Quiet time: orgo exam').length), 1);
step('10. state and route persist across refresh');

// keyboard: menu opens, arrows move, Escape restores focus
await page.getByRole('button', { name: 'More actions for Take out trash & recycling' }).first().focus();
await page.keyboard.press('Enter');
await page.getByRole('menuitem', { name: 'Edit chore' }).waitFor();
await page.keyboard.press('ArrowDown');
assert.equal(await st(() => document.activeElement.textContent.trim()), 'Delete chore');
await page.keyboard.press('Escape');
assert.equal(await st(() => document.activeElement.getAttribute('aria-label')), 'More actions for Take out trash & recycling');
// dialog: Escape closes and focus returns to opener
await page.getByRole('button', { name: 'Add chore', exact: true }).first().focus();
await page.keyboard.press('Enter');
await page.getByRole('dialog').waitFor();
await page.keyboard.press('Escape');
assert.equal(await st(() => document.activeElement.textContent.trim()), 'Add chore');
step('keyboard: menu arrows/Escape and dialog Escape restore focus');

// responsive: no horizontal overflow, dialogs fit, nav doesn't cover content
const routes = ['home', 'chores/mine', 'chores/all', 'chores/done', 'money/expenses', 'money/shopping', 'calendar', 'notifications', 'settings'];
for (const w of [360, 390, 768, 1280, 1600]) {
  await page.setViewportSize({ width: w, height: 800 });
  for (const r of routes) {
    await page.goto(`${BASE}#/${r}`);
    await page.waitForTimeout(80);
    const o = await st(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    assert.ok(o.sw <= o.iw, `horizontal overflow at ${w}px on #/${r}: ${o.sw} > ${o.iw}`);
  }
  await page.goto(`${BASE}#/money/expenses`);
  await page.getByRole('button', { name: 'Add expense', exact: true }).first().click();
  await page.waitForTimeout(260); // let the entry animation finish
  const box = await page.locator('#modal').boundingBox();
  assert.ok(box.x >= -1 && box.x + box.width <= w + 1 && box.y >= -1 && box.y + box.height <= 801, `dialog fits viewport at ${w}px`);
  await page.keyboard.press('Escape');
  // last content isn't hidden behind the bottom nav (mobile)
  if (w < 860) {
    await page.goto(`${BASE}#/home`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const gap = await st(() => { const last = document.querySelector('main').lastElementChild.getBoundingClientRect().bottom; const nav = document.querySelector('.bottomnav').getBoundingClientRect().top; return nav - last; });
    assert.ok(gap >= 0, `content hidden behind bottom nav at ${w}px`);
  }
}
step('responsive: no horizontal overflow at 360/390/768/1280/1600 on all routes; dialogs fit; content clears bottom nav');

await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${BASE}#/home`);
await shot('07-home-desktop');
await page.goto(`${BASE}#/calendar`);
await shot('08-calendar-desktop');
assert.deepEqual(errors, [], 'console/page errors: ' + errors.join('; '));
console.log('ALL E2E CHECKS PASSED');
await browser.close();
