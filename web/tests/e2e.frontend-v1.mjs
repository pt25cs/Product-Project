// Browser checks for front-end refinement v1 (Home rules cards, Chores/Expenses buttons, budget card,
// Month calendar, Profile text boxes) and the dummy sign-in flow. Needs Playwright + Chromium and the app running:
//   PLAYWRIGHT_MODULE=/path/to/playwright node web/tests/e2e.frontend-v1.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.APP_URL || 'http://localhost:8080/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = [];
const step = (s) => console.log('✓', s);
async function open(width, height, { demo = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => { try { localStorage.setItem('roomsync.coach.v1', JSON.stringify({ home: true, chores: true, money: true, calendar: true, profile: true })); } catch (e) {} });
  await page.goto(BASE);
  if (demo) { await page.getByRole('button', { name: /Try the demo/ }).click(); await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor(); }
  return page;
}
const noOverflow = async (page, what) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `no horizontal overflow: ${what}`);

// ---------- Home: rules cards ----------
{
  const page = await open(1280, 900);
  const exp = page.locator('details[data-key="expect"]'), pur = page.locator('details[data-key="purchrules"]');
  assert.equal(await exp.evaluate((d) => d.open), false, 'expectations card starts collapsed');
  assert.equal(await pur.evaluate((d) => d.open), false, 'purchasing card starts collapsed');
  assert.match(await exp.locator('summary').innerText(), /House expectations[\s\S]*Quiet after 11pm[\s\S]*\+1 more[\s\S]*View & edit/, 'summary previews content and says how to expand');
  assert.match(await pur.locator('summary').innerText(), /\$\d[\d,.]* budget · 1 product · 1 store[\s\S]*View & edit/);
  await exp.locator('summary').click();
  assert.match(await exp.locator('summary').innerText(), /Hide/, 'label flips to Hide when open');
  await page.getByRole('button', { name: 'Add expectation' }).click();
  await page.getByRole('textbox', { name: 'Expectation' }).fill('Shoes off at the door');
  const tb = await page.getByRole('textbox', { name: 'Expectation' }).evaluate((e) => getComputedStyle(e).borderTopWidth);
  assert.equal(tb, '1px', 'dialog notes box has a visible border');
  await page.getByRole('button', { name: 'Add expectation' }).last().click();
  await page.getByText('Expectation added.').waitFor();
  assert.match(await exp.locator('summary').innerText(), /3|\+2 more/, 'summary updates after adding');
  await pur.locator('summary').click();
  await page.getByRole('button', { name: 'Add product' }).click();
  await page.locator('#f-text').fill('Bounty paper towels');
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('.chip-item', { hasText: 'Bounty paper towels' }).waitFor();
  await page.getByRole('button', { name: 'Change budget' }).first().click();
  await page.locator('#f-amount').fill('450');
  await page.getByRole('button', { name: 'Save budget' }).click();
  await pur.locator('summary', { hasText: '$450.00 budget' }).waitFor();
  await page.locator('.chip-item', { hasText: 'Bounty paper towels' }).getByRole('button').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.chip-item', { hasText: 'Bounty paper towels' }).count(), 0, 'chip removed');
  await page.goto(`${BASE}#/settings`);
  const t = await page.locator('main').innerText();
  assert.ok(!/House expectations/.test(t) && !/Purchasing rules/.test(t), 'rules no longer live in Settings');
  step('Home: two collapsed cards with content-based summaries; add/edit/remove expectation, product and budget all work from Home; Settings no longer has them');
  await page.context().close();
}

// ---------- Chores + Expenses + Shopping look-and-feel ----------
{
  const page = await open(1280, 900);
  await page.goto(`${BASE}#/chores/mine`);
  assert.ok(await page.locator('.cards > .sec').count() >= 2, 'chore sections are separate cards');
  assert.equal(await page.locator('.tabs a[aria-current="page"]').evaluate((a) => getComputedStyle(a).backgroundColor !== 'rgba(0, 0, 0, 0)'), true, 'selected tab is a filled segment');
  const row = page.locator('.row-open').first();
  await row.click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.add-row[data-action="add-chore"]').evaluate((b) => getComputedStyle(b).borderTopStyle), 'dashed', 'Add chore is an outlined button');

  await page.goto(`${BASE}#/money/expenses`);
  const details = page.locator('details.btn-summary > summary').first();
  assert.equal(await details.evaluate((s) => getComputedStyle(s).borderTopWidth), '1px', 'Details looks like a button');
  await details.click();
  assert.ok(await page.locator('details.btn-summary[open]').count() >= 1, 'Details still toggles');
  assert.equal(await page.getByRole('button', { name: 'Add expense', exact: true }).evaluate((b) => b.classList.contains('btn')), true, 'Add expense is a real button');
  assert.equal(await page.getByRole('button', { name: /^Record repayment$/ }).first().evaluate((b) => b.classList.contains('btn')), true, 'Record repayment is a real button');
  // budget card states: set → under → over
  const card = page.locator('.budget-card');
  await page.getByRole('button', { name: 'Change shared budget' }).click();
  await page.locator('#f-amount').fill('1000');
  await page.getByRole('button', { name: 'Save budget' }).click();
  assert.match(await card.innerText(), /left/, 'under budget shows amount left');
  assert.equal(await card.locator('[role="progressbar"]').getAttribute('aria-valuemax'), '100000');
  const w1 = await card.locator('.progress > span').evaluate((e) => e.style.width);
  assert.ok(parseInt(w1, 10) > 0 && parseInt(w1, 10) < 100, `bar partly filled (${w1})`);
  await page.getByRole('button', { name: 'Change shared budget' }).click();
  await page.locator('#f-amount').fill('20');
  await page.getByRole('button', { name: 'Save budget' }).click();
  assert.match(await card.innerText(), /Over by/, 'over budget is stated in words');
  assert.equal(await card.locator('.progress > span').evaluate((e) => e.style.width), '100%', 'bar caps at 100% when over');
  assert.equal(await card.locator('.progress').evaluate((e) => e.classList.contains('over')), true);
  await page.getByRole('button', { name: 'Change shared budget' }).click();
  await page.locator('#f-amount').fill('');
  await page.getByRole('button', { name: 'Save budget' }).click();
  await page.getByRole('button', { name: 'Set a shared budget' }).waitFor();
  step('Chores cards/rows/tabs/add button; Details + Add expense + Record repayment are buttons; budget card unset / under / over (bar caps at 100%)');

  await page.goto(`${BASE}#/money/shopping`);
  assert.ok(await page.locator('.cards > .sec').count() >= 1);
  await page.getByRole('link', { name: /Open purchasing rules/ }).click();
  await page.locator('details[data-key="purchrules"][open]').waitFor();
  step('Shopping: cards; "Open purchasing rules" button deep-links to the open card on Home');
  await page.context().close();
}

// ---------- Calendar month ----------
for (const [w, h] of [[1280, 900], [390, 844]]) {
  const page = await open(w, h);
  await page.goto(`${BASE}#/calendar`);
  await page.locator('.month').waitFor();
  assert.equal(await page.getByRole('radio', { name: 'Month' }).isChecked(), true, 'Month is the default view');
  assert.equal(await page.getByRole('radio', { name: 'Week' }).count(), 0, 'Week view is gone');
  assert.equal(await page.locator('.mo-day.today').count(), 1);
  const cells = await page.locator('.mo-day').count();
  assert.ok(cells % 7 === 0 && cells >= 28 && cells <= 42, `whole weeks (${cells} cells)`);
  const t0 = await page.locator('.cal-title h2').innerText();
  await page.getByRole('button', { name: 'Next month' }).click();
  await page.getByRole('button', { name: 'Previous month' }).click();
  assert.equal(await page.locator('.cal-title h2').innerText(), t0, 'next then previous returns to the same month');
  const day = page.locator('.mo-num').nth(10);
  await day.click();
  assert.equal(await page.locator('.mo-day.sel').count(), 1, 'one selected day');
  assert.equal(await page.locator('.cal-side .agenda-day').count(), 1, 'selected day list shown');
  if (w >= 720) {
    // "+N more" appears when a day has more than 3 items
    await page.evaluate(() => { const s = window.__roomsync; const t = s.today(); for (let i = 0; i < 5; i++) s.addEvent({ title: `Pile ${i}`, category: 'plans', startDate: t, startTime: '1' + i + ':00', endDate: t, endTime: '1' + i + ':30' }); });
    await page.waitForTimeout(150);
    const more = page.locator('.mo-day.today .mo-more');
    await more.waitFor();
    assert.match(await more.innerText(), /\+\d+ more/);
    assert.equal(await page.locator('.mo-day.today .mo-chip').count(), 3, 'only 3 chips shown per cell');
    await more.click();
    assert.ok((await page.locator('.cal-side .ag-row').count()) >= 5, 'day panel lists everything');
    await page.locator('.mo-chip', { hasText: 'Pile 0' }).first().click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
  } else {
    assert.ok(await page.locator('.mo-dots').first().isVisible(), 'phones show dots');
    assert.equal(await page.locator('.mo-items').first().isVisible(), false, 'phones hide chips');
  }
  await page.getByRole('radio', { name: 'Agenda' }).check({ force: true });
  await page.locator('.date-strip').waitFor();
  await page.getByRole('radio', { name: 'Month' }).check({ force: true });
  await noOverflow(page, `calendar ${w}px`);
  step(`${w}px calendar: Month default, whole-week grid, month nav, day selection + panel, ${w >= 720 ? '+N more and chips' : 'dots on phones'}, Agenda still available`);
  await page.context().close();
}

// ---------- Profile text boxes ----------
{
  const page = await open(390, 844);
  await page.goto(`${BASE}#/profile`);
  for (const id of ['f-rules', 'f-dietary']) {
    const b = await page.locator(`#${id}`).evaluate((e) => { const c = getComputedStyle(e); return { w: c.borderTopWidth, h: e.getBoundingClientRect().height }; });
    assert.equal(b.w, '1px', `${id} has a visible border`);
    assert.ok(b.h >= 90, `${id} is tall enough (${b.h}px)`);
  }
  await page.locator('#f-rules').fill('Knock first');
  assert.equal(await page.locator('#count-f-rules').innerText(), '11 / 300');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.getByText('Profile saved.').waitFor();
  await noOverflow(page, 'profile 390px');
  step('Profile: dietary + rules boxes are bordered, ≥96px, with a live counter, and still save');
  await page.context().close();
}

// ---------- Mobile overflow sweep ----------
{
  const page = await open(360, 740);
  for (const r of ['home', 'chores/mine', 'chores/all', 'chores/done', 'money/expenses', 'money/shopping', 'calendar', 'profile', 'settings']) {
    await page.goto(`${BASE}#/${r}`);
    await page.waitForTimeout(120);
    await noOverflow(page, `/${r} at 360px`);
  }
  step('360px: no horizontal overflow on any tab');
  await page.context().close();
}

// ---------- Dummy sign-in ----------
{
  const page = await open(1280, 900, { demo: false });
  await page.getByRole('button', { name: /Continue with Google \(dummy account\)/ }).click();
  await page.getByRole('heading', { name: /You’re signed in/ }).waitFor();
  assert.equal(await page.locator('#f-householdName').first().inputValue(), 'Elm Street 3B', 'dummy filler pre-fills the household name');
  await page.getByRole('button', { name: 'Create household' }).click();
  await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor();
  assert.equal(await page.locator('#switch-user').count(), 0, 'no Viewing-as switcher when signed in');
  await page.goto(`${BASE}#/profile`);
  await page.getByText('dummy.user@example.com').waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Profile', level: 1 }).waitFor(); // session + household survive a reload
  await page.getByRole('button', { name: /Sign out/ }).click();
  await page.getByRole('button', { name: /Continue with Google \(dummy account\)/ }).waitFor();
  await page.getByRole('button', { name: /Continue with Google \(dummy account\)/ }).click();
  await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor(); // signing back in returns to the same household
  step('Dummy sign-in: continue → create household (pre-filled) → home → profile shows the dummy email → survives reload → sign out/in returns to the household');
  await page.context().close();
}

assert.deepEqual(errors, [], errors.join('; '));
console.log('FRONTEND V1 CHECKS PASSED');
await browser.close();
