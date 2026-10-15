// Browser checks for the Home / shopping label / calendar / mobile header / copy refinement pass.
// Fresh browser contexts with demo data only. PLAYWRIGHT_MODULE=... node tests/e2e.refinement.mjs (app on :8080)
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.APP_URL || 'http://localhost:8080/';
const shots = process.env.SHOTS || '';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = [];
const step = (s) => console.log('✓', s);

async function open(width, height) {
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE);
  await page.getByRole('button', { name: /Try the demo/ }).click();
  await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor();
  await page.waitForTimeout(200);
  return page;
}
const noOverflow = async (page, label) => { const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })); assert.ok(o.sw <= o.iw, `${label}: horizontal overflow ${o.sw} > ${o.iw}`); };

// ---------- phone ----------
{
  const page = await open(390, 844);
  const st = (fn, a) => page.evaluate(fn, a);
  const shot = (n) => shots && page.screenshot({ path: `${shots}/${n}.png` });
  // seed enough data to exercise previews
  await st(() => {
    const s = window.__roomsync, me = s.me();
    for (let i = 1; i <= 5; i++) s.addChore({ title: `Extra chore ${i}`, notes: '', assigneeId: me, due: (() => { const d = new Date(s.today() + 'T00:00'); d.setDate(d.getDate() + 1 + i); return d.toISOString().slice(0, 10); })(), recurrence: 'once', rotate: false, rotation: [] });
    for (const n of ['Sponges', 'Rice', 'Coffee']) s.addItem({ name: n, qty: '1' });
  });
  await page.reload(); await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor();

  // A. Home labels, previews, collapsed activity, reading order
  await page.getByRole('heading', { level: 2, name: /^Your upcoming chores/ }).waitFor();
  await page.getByRole('heading', { level: 2, name: /^Household plans/ }).waitFor();
  await page.getByRole('heading', { level: 2, name: /^Past due in the household/ }).waitFor();
  assert.equal(await page.getByRole('heading', { level: 2, name: /^(Upcoming|Coming up)/ }).count(), 0, 'ambiguous headings removed');
  assert.ok((await page.locator('#h-up').locator('xpath=ancestor::section//li.row').count()) <= 3, 'upcoming preview limited');
  await page.getByRole('link', { name: /See all your chores \(\d+\)/ }).waitFor();
  await page.getByRole('link', { name: /See the full list \(\d+\)/ }).waitFor();
  assert.equal(await page.locator('details[data-key=activity]').evaluate((d) => d.open), false, 'activity collapsed by default');
  const y = async (sel) => (await page.locator(sel).first().boundingBox()).y;
  const order = [await y('#h-today'), await y('#h-others'), await y('text=Your balance'), await y('#h-ev'), await y('#h-shop'), await y('details[data-key=activity] > summary')];
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'mobile reading order: chores → household past due → balance → plans → shopping → activity');
  await page.locator('details[data-key=activity] > summary').click();
  await page.locator('details[data-key=activity] .feed li').first().waitFor();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const gap = await st(() => document.querySelector('.bottomnav').getBoundingClientRect().top - document.querySelector('main').lastElementChild.getBoundingClientRect().bottom);
  assert.ok(gap >= 0, 'last content clears bottom nav');
  await noOverflow(page, 'home 390');
  await shot('home-mobile-top'); 
  step('390px Home: clear labels, 3-item previews with links, activity collapsed but reachable, actionable content first, bottom clearance');

  // B. Bottom nav states the destination; shopping reachable and counted
  await page.evaluate(() => window.scrollTo(0, 0));
  const navText = await page.locator('.bottomnav a').allInnerTexts();
  assert.ok(navText.some((t) => /Expenses\s*&\s*Shopping/.test(t)), `bottom nav label: ${navText}`);
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Expenses & Shopping' }).click();
  await page.getByRole('link', { name: /^Shopping\s*\d+/ }).waitFor();
  await page.getByRole('link', { name: /^Shopping/ }).click();
  await page.getByRole('textbox', { name: 'Add an item' }).waitFor();
  await shot('shopping-mobile');
  step('390px nav: "Expenses & Shopping" label, shopping tab shows needed count, direct shopping route works');

  // D. quiet header: name + bell + settings only; roommate switcher inside the demo chip
  await page.goto(`${BASE}#/home`);
  const header = page.locator('header.topbar');
  assert.equal(await header.locator('select').count(), 0, 'no selector in the header');
  const full = await header.locator('a.household').getAttribute('title');
  assert.equal(full, 'Pecan Court Apt 204');
  const boxes = await header.locator('a.household, a.icon-link').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
  assert.ok(boxes[0].width > 150, `household name has room (${boxes[0].width}px)`);
  for (const b of boxes.slice(1)) assert.ok(b.width >= 44 && b.height >= 44, 'icon targets ≥44px');
  const chip = await page.locator('.status > summary').boundingBox();
  assert.ok(chip.height >= 44, `demo chip target ${chip.height}px`);
  await page.getByText('Demo · Viewing as Maya').click();
  const sel = page.getByLabel('Viewing as');
  await sel.waitFor();
  await shot('demo-controls-mobile');
  await sel.selectOption({ label: 'Jordan' });
  await page.getByText('Demo · Viewing as Jordan').waitFor();
  await page.getByText(/Good (morning|afternoon|evening), Jordan/).waitFor();
  await page.keyboard.press('Escape');
  await page.getByText('Demo · Viewing as Jordan').click(); await page.getByLabel('Viewing as').selectOption({ label: 'Maya' });
  await page.getByText('Demo · Viewing as Maya').waitFor();
  step('390px header: name has room + full-name title, 44px bell/settings, roommate switcher inside demo controls, current identity visible');

  // Calendar agenda anchor + Add event entry points
  await page.goto(`${BASE}#/calendar`);
  await page.getByRole('radio', { name: 'Agenda' }).check({ force: true });
  const evCount = () => st(() => window.__roomsync.state.events.length);
  const e0 = await evCount();
  const tomorrow = await st(() => { const d = new Date(window.__roomsync.today() + 'T00:00'); d.setDate(d.getDate() + 1); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; });
  await page.getByText(/Showing the next 14 days from/).waitFor();
  await page.locator(`.ds-day[data-date="${tomorrow}"]`).click();
  await page.getByText(/Pick another day above to start the agenda there/).waitFor();
  await page.getByRole('button', { name: 'Back to today' }).waitFor();
  await page.getByRole('button', { name: 'Add event', exact: true }).click();
  assert.equal(await page.getByLabel('Starts').inputValue(), tomorrow, 'toolbar Add event defaults to the selected day');
  await page.getByRole('textbox', { name: 'Title' }).fill('Toolbar event');
  await page.getByRole('button', { name: 'Add event', exact: true }).last().dblclick();
  await page.getByText('Event added.').waitFor();
  assert.equal(await evCount(), e0 + 1, 'toolbar entry creates exactly one event');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Event' }).click();
  assert.equal(await page.getByLabel('Starts').inputValue(), tomorrow, 'global Add menu opens the same dialog');
  await page.getByRole('textbox', { name: 'Title' }).fill('Menu event');
  await page.getByRole('button', { name: 'Add event', exact: true }).last().click();
  await page.getByText('Event added.').first().waitFor();
  assert.equal(await evCount(), e0 + 2, 'global entry creates exactly one event');
  await noOverflow(page, 'calendar 390');
  await shot('agenda-mobile');
  step('390px calendar: agenda anchor wording + Back to today; toolbar and global Add open the same dialog; one event each');
  await page.context().close();
}

// ---------- expenses: single contextual repayment entry ----------
{
  const page = await open(1280, 900);
  await page.goto(`${BASE}#/money/expenses`);
  assert.equal(await page.getByRole('button', { name: 'Record repayment' }).count(), 1, 'Maya owes Jordan: only the contextual button');
  await page.getByLabel('Viewing as').selectOption({ label: 'Jordan' });
  await page.getByText(/You’re owed/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Record repayment' }).count(), 1, 'when nothing is owed, one general entry remains');
  step('1280px expenses: repayment entry appears once in either state');

  // legacy wording is normalised for display but not rewritten in storage
  await page.evaluate(() => {
    const s = window.__roomsync;
    s.state.activity.unshift({ id: 'legacy1', actorId: s.me(), verb: 'recorded a payback of', subject: '$5.00 from Maya to Jordan', link: '#/money/expenses', ref: null, ts: new Date().toISOString() });
    s.state.notifications.unshift({ id: 'legacy2', userId: s.me(), type: 'expense', title: 'Payback recorded: Maya → Jordan', body: '$5.00 paid outside RoomSync', link: '#/money/expenses', key: null, read: false, createdAt: new Date().toISOString() });
    s.save();
  });
  await page.reload();
  await page.goto(`${BASE}#/home`);
  await page.locator('details[data-key=activity] > summary').click();
  await page.getByText(/recorded a repayment of \$5\.00/).waitFor();
  await page.goto(`${BASE}#/notifications`);
  await page.getByText('Repayment recorded: Maya → Jordan').waitFor();
  assert.equal(await page.evaluate(() => /payback/i.test(document.querySelector('main').innerText)), false, 'no "payback" wording on screen');
  assert.equal(await page.evaluate(() => window.__roomsync.state.activity.some((a) => /payback/.test(a.verb))), true, 'stored legacy record left untouched');
  for (const r of ['home', 'chores/all', 'money/expenses', 'money/shopping', 'calendar', 'settings']) { await page.goto(`${BASE}#/${r}`); assert.equal(await page.evaluate(() => /payback/i.test(document.querySelector('main').innerText)), false, `payback on ${r}`); }
  step('legacy "payback" text shows as "repayment" without rewriting stored records');
  await page.context().close();
}

// ---------- desktop week view / sidebar ----------
{
  const page = await open(1280, 900);
  const shot = (n) => shots && page.screenshot({ path: `${shots}/${n}.png` });
  const long = 'Quiet study session for organic chemistry midterm and review of problem sets';
  await page.evaluate((title) => { const s = window.__roomsync; const t = s.today(); s.addEvent({ title, category: 'quiet', startDate: t, startTime: '14:00', endDate: t, endTime: '16:00', notes: 'Please keep the living room quiet.' }); }, long);
  await page.goto(`${BASE}#/calendar`);
  await page.getByRole('radio', { name: 'Week' }).check({ force: true });
  const item = page.locator('.wk-item', { hasText: 'Quiet study session' }).first();
  await item.waitFor();
  const b = await item.boundingBox(), col = await page.locator('.wk-day.today').boundingBox();
  assert.ok(b.x >= col.x - 1 && b.x + b.width <= col.x + col.width + 1, 'event stays inside its day column');
  assert.match(await item.locator('.t').innerText(), /2:00 PM/, 'time stays visible');
  assert.equal(await item.locator('.n').evaluate((n) => n.scrollHeight > n.clientHeight), true, 'long title is clamped to a few lines in the narrow column');
  assert.equal(await item.getAttribute('title'), long);
  await shot('week-desktop');
  await item.click();
  await page.getByRole('dialog').getByRole('heading', { name: long }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Add event', exact: true }).click();
  await page.getByRole('heading', { name: 'Add event' }).waitFor();
  await page.keyboard.press('Escape');
  for (const w of [900, 1024, 1099, 1100, 1280]) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(80); await noOverflow(page, `week ${w}`); }
  step('1280px week view: roomy items, time visible, long title clamped with full title on open; no overflow from 900–1280px');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}#/home`);
  await shot('home-desktop');
  await page.context().close();
}
assert.deepEqual(errors, [], errors.join('; '));
console.log('REFINEMENT CHECKS PASSED');
await browser.close();
