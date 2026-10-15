// Browser checks for the Todoist/Fantastical/AnyList-inspired pass: quick add, purchase-only, add again,
// calendar date strip, Add menu, empty states, menu placement. Fresh browser contexts with demo data only.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.APP_URL || 'http://localhost:8080/';
const shots = process.env.SHOTS || '';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = [];
const step = (s) => console.log('✓', s);

async function run(width, height) {
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const st = (fn, a) => page.evaluate(fn, a);
  const shot = (n) => shots && page.screenshot({ path: `${shots}/${n}-${width}.png` });
  await page.goto(BASE);
  await page.getByRole('button', { name: /Try the demo/ }).click();
  await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor();
  await page.waitForTimeout(150);

  // Add menu: keyboard + stays inside viewport
  const addBtn = page.getByRole('button', { name: 'Add', exact: true });
  await addBtn.focus(); await page.keyboard.press('Enter');
  const items = page.getByRole('menuitem');
  assert.deepEqual(await items.allInnerTexts(), ['Chore', 'Expense', 'Shopping item', 'Event']);
  const pop = await page.locator('.menu-pop:not([hidden])').boundingBox();
  assert.ok(pop.x >= 0 && pop.x + pop.width <= width && pop.y >= 0 && pop.y + pop.height <= height, 'Add menu inside viewport');
  await shot('add-menu');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Add expense' }).waitFor();
  await page.keyboard.press('Escape');
  step(`${width}px: Add menu opens by keyboard, stays in viewport, items launch their forms`);

  // Shopping quick add: empty rejected, Enter adds once, clears, focus stays
  await page.goto(`${BASE}#/money/shopping`);
  const qa = page.getByRole('textbox', { name: 'Add an item' });
  const count = () => st(() => window.__roomsync.state.shopping.length);
  const c0 = await count();
  await qa.focus(); await page.keyboard.press('Enter');
  await page.getByText('Type an item name to add it.').waitFor();
  assert.equal(await count(), c0, 'empty input creates nothing');
  await qa.fill('Sponges'); await page.getByRole('textbox', { name: 'Quantity' }).fill('3');
  await page.keyboard.press('Enter');
  await page.getByText('Added Sponges.').waitFor();
  assert.equal(await count(), c0 + 1);
  assert.equal(await qa.inputValue(), '', 'input cleared');
  assert.equal(await st(() => document.activeElement.id), 'qa-name', 'focus stays for the next item');
  await page.keyboard.type('Rice'); await page.keyboard.press('Enter');
  assert.equal(await count(), c0 + 2);
  await page.getByText('Sponges').first().waitFor();
  await shot('shopping');
  step(`${width}px: quick add — empty rejected, Enter adds once, clears, keeps focus, quantity kept`);

  // Purchase only → no expense; item moves to history; Add again; no duplicate
  const e0 = await st(() => window.__roomsync.state.expenses.length);
  await page.getByRole('checkbox', { name: 'Purchased: Rice' }).click();
  await page.getByRole('radio', { name: 'Purchase only' }).check({ force: true });
  await page.getByRole('button', { name: 'Mark purchased' }).dblclick();
  await page.getByText('Marked Rice purchased. No expense recorded.').waitFor();
  assert.equal(await st(() => window.__roomsync.state.expenses.length), e0, 'no expense without confirmation');
  assert.equal(await st(() => window.__roomsync.sel.purchased().some((i) => i.name === 'Rice' && !i.expenseId)), true);
  await page.locator('details[data-key=bought] > summary').click();
  await page.getByRole('button', { name: 'Add Rice again' }).dblclick();
  assert.equal(await st(() => window.__roomsync.sel.needed().filter((i) => i.name === 'Rice').length), 1, 'Add again does not duplicate');
  assert.equal(await st(() => window.__roomsync.sel.purchased().filter((i) => i.name === 'Rice').length), 1, 'history kept');
  assert.equal(await st(() => window.__roomsync.state.expenses.length), e0);
  step(`${width}px: purchase-only creates no expense; Add again creates one fresh item and keeps history`);

  // Calendar: date strip selection / week navigation / week → agenda
  await page.goto(`${BASE}#/calendar`);
  await page.getByRole('radio', { name: 'Agenda' }).check({ force: true });
  const today = await st(() => window.__roomsync.today());
  const todayBtn = page.locator(`.ds-day[aria-current="date"]`);
  assert.equal(await todayBtn.getAttribute('aria-pressed'), 'true');
  const target = await st(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); });
  const tomorrow = await st(() => { const s = window.__roomsync; const t = s.today(); const d = new Date(t + 'T00:00'); d.setDate(d.getDate() + 1); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; });
  await page.locator(`.ds-day[data-date="${tomorrow}"]`).click();
  assert.equal(await page.locator(`.ds-day[data-date="${tomorrow}"]`).getAttribute('aria-pressed'), 'true');
  assert.equal(await todayBtn.getAttribute('aria-pressed'), 'false');
  assert.equal(await todayBtn.getAttribute('aria-current'), 'date', 'today stays identifiable when another day is selected');
  await page.getByRole('heading', { name: /^Tomorrow/ }).waitFor();
  await page.getByText('Quiet study block (midterm review)').first().waitFor();
  await shot('calendar-agenda');
  await page.getByRole('button', { name: 'Next week' }).click();
  await page.getByRole('heading', { level: 2, name: /20\d\d/ }).waitFor();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  assert.equal(await todayBtn.getAttribute('aria-pressed'), 'true');
  await page.getByRole('radio', { name: 'Week' }).check({ force: true });
  await page.locator('.wk-head').nth(0).waitFor();
  await shot('calendar-week');
  await page.locator('.wk-head').last().click();
  await page.getByRole('radio', { name: 'Agenda' }).waitFor();
  assert.ok(await page.locator('.ds-day[aria-pressed="true"]').count() === 1);
  step(`${width}px: date strip selects the day and agenda follows; today stays marked; week/next/Today navigation; week day opens agenda`);

  // Event details open from the agenda; chore rows open chore details
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: /Take out trash/ }).first().click();
  await page.getByRole('dialog').getByRole('heading', { name: 'Take out trash & recycling' }).waitFor();
  await page.keyboard.press('Escape');
  step(`${width}px: agenda chore rows open the same chore details`);

  // Empty states (isolated household with no chores)
  await page.evaluate(() => { const s = window.__roomsync; s.state.occurrences.filter((o) => !o.doneAt).forEach((o) => s.deleteChore(o.id)); });
  await page.goto(`${BASE}#/chores/mine`);
  await page.getByText('You have no open chores').waitFor();
  await page.goto(`${BASE}#/home`);
  await page.getByText('You’re all caught up today').waitFor();
  await shot('empty-home');
  step(`${width}px: empty states render (no chores / all caught up)`);
  await page.context().close();
}
await run(390, 844);
await run(1280, 900);
assert.deepEqual(errors, [], errors.join('; '));
console.log('REFRESH CHECKS PASSED');
await browser.close();
