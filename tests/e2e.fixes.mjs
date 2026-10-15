// Regression checks: bottom-bar Add button never covers page controls; calendar focus stays on the activated control.
// PLAYWRIGHT_MODULE=... [CHROMIUM=...] [SHOTS=dir] node tests/e2e.fixes.mjs   (app on :8080; fresh demo contexts only)
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.APP_URL || 'http://localhost:8080/';
const shots = process.env.SHOTS || '';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = [];
const step = (s) => console.log('✓', s);
const open = async (w, h) => {
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE); await page.getByRole('button', { name: /Try the demo/ }).click(); await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor(); await page.waitForTimeout(250);
  return page;
};

// ---- 1. Add button vs page controls (phone) ----
for (const w of [360, 390]) {
  const page = await open(w, 844);
  for (const r of ['home', 'calendar', 'money/expenses', 'money/shopping']) {
    await page.goto(`${BASE}#/${r}`); await page.waitForTimeout(200);
    const result = await page.evaluate(() => {
      document.querySelectorAll('#toasts .toast').forEach((t) => t.remove()); // transient confirmations overlay content by design
      const nav = document.querySelector('.bottomnav').getBoundingClientRect(), topBottom = document.querySelector('.topbar').getBoundingClientRect().bottom, fab = document.querySelector('.fab').getBoundingClientRect();
      const problems = [];
      const max = document.documentElement.scrollHeight - window.innerHeight;
      for (let y = 0; y <= max + 40; y += 40) {
        window.scrollTo(0, Math.min(y, max));
        for (const el of document.querySelectorAll('main a, main button, main summary, main select, main input')) {
          const r = el.getBoundingClientRect();
          if (el.closest('details:not([open])') && !el.matches('summary')) continue; // collapsed content isn't on screen
          if (!r.width || !r.height || r.top < topBottom || r.bottom > nav.top) continue; // controls fully inside the visible content area (between the sticky header and the bottom bar)
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (!hit || !(el === hit || el.contains(hit) || hit.contains(el))) problems.push(`${(el.getAttribute('aria-label') || el.textContent).trim().slice(0, 30)} covered by ${hit && hit.className}`);
        }
        // nothing in the content area intersects the Add button
        if (fab.top < nav.top) problems.push('Add button sits above the bar');
      }
      window.scrollTo(0, max);
      const last = document.querySelector('main').lastElementChild.getBoundingClientRect();
      return { problems: [...new Set(problems)], fab: { w: fab.width, h: fab.height, inside: fab.top >= nav.top && fab.bottom <= nav.bottom }, clearance: nav.top - last.bottom, navH: nav.height };
    });
    assert.deepEqual(result.problems, [], `${w}px #/${r}: ${result.problems.join('; ')}`);
    assert.ok(result.fab.inside && result.fab.w >= 44 && result.fab.h >= 44, `Add button docked in the bar and ≥44px (${JSON.stringify(result.fab)})`);
    assert.ok(result.clearance >= 0, `last content clears the bar at ${w}px #/${r}`);
  }
  // Home: Record repayment and Add are both visible and independently tappable
  await page.goto(`${BASE}#/home`);
  const rr = page.getByRole('button', { name: 'Record repayment' }).first();
  await rr.scrollIntoViewIfNeeded();
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Record repayment')); const r = b.getBoundingClientRect(); window.scrollBy(0, r.top - (window.innerHeight - 220)); });
  await page.waitForTimeout(100);
  const rb = await rr.boundingBox(), ab = await page.getByRole('button', { name: 'Add', exact: true }).boundingBox();
  const overlap = !(rb.x + rb.width <= ab.x || ab.x + ab.width <= rb.x || rb.y + rb.height <= ab.y || ab.y + ab.height <= rb.y);
  assert.equal(overlap, false, 'Record repayment and Add do not overlap');
  if (shots) await page.screenshot({ path: `${shots}/add-docked-${w}.png` });
  await rr.click();
  await page.getByRole('heading', { name: 'Record repayment' }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const pop = await page.locator('.menu-pop:not([hidden])').boundingBox();
  assert.ok(pop.x >= 0 && pop.x + pop.width <= w && pop.y >= 0, 'Add menu inside viewport');
  await page.getByRole('menuitem', { name: 'Event' }).click();
  await page.getByRole('heading', { name: 'Add event' }).waitFor();
  await page.keyboard.press('Escape');
  step(`${w}px: Add is docked in the bottom bar; no control is covered at any scroll position on Home, Calendar, Expenses, Shopping; repayment + Add both tappable, Add menu inside the viewport; last content clears the bar`);
  await page.context().close();
}

// ---- 2. Desktop unchanged ----
{
  const page = await open(1280, 900);
  assert.equal(await page.locator('.bottomnav').count(), 0); assert.equal(await page.locator('.fab').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Add', exact: true }).count(), 1, 'sidebar Add only');
  assert.ok((await page.locator('.sidebar').boundingBox()).width > 240);
  step('1280px: desktop still uses the sidebar Add; no bottom bar or docked button');
  await page.context().close();
}

// ---- 3. Calendar focus ----
{
  const page = await open(390, 844);
  await page.goto(`${BASE}#/calendar`);
  await page.getByRole('radio', { name: 'Agenda' }).check({ force: true });
  const days = page.locator('.ds-day');
  const focusedLabel = () => page.evaluate(() => document.activeElement.getAttribute('aria-label'));
  const todayLabel = await page.locator('.ds-day[aria-current="date"]').getAttribute('aria-label');
  // Tab through the strip to Friday, activate with Enter
  await days.first().focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  const fridayLabel = await days.nth(4).getAttribute('aria-label');
  assert.equal(await focusedLabel(), fridayLabel, 'Tab reaches Friday');
  await page.keyboard.press('Enter');
  assert.equal(await focusedLabel(), fridayLabel, 'focus stays on Friday after Enter');
  assert.equal(await days.nth(4).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.ds-day[aria-current="date"]').getAttribute('aria-label'), todayLabel, 'today indicator unchanged');
  const friIso = await days.nth(4).getAttribute('data-date');
  await page.getByText(/Next 14 days · From/).waitFor();
  assert.match(await page.locator('.ag-anchor').innerText(), /From [A-Z][a-z]{2} \d+/);
  assert.equal(await page.getByRole('button', { name: 'Back to today' }).isVisible(), true);
  assert.equal(await page.locator('.agenda-day h3').first().getAttribute('id'), `ag-${friIso}`, 'agenda starts on Friday');
  // Space on Saturday
  await page.keyboard.press('Tab');
  const satLabel = await days.nth(5).getAttribute('aria-label');
  assert.equal(await focusedLabel(), satLabel, 'Tab moves Friday → Saturday');
  await page.keyboard.press('Space');
  assert.equal(await focusedLabel(), satLabel, 'focus stays on Saturday after Space');
  assert.equal(await days.nth(5).getAttribute('aria-pressed'), 'true');
  assert.equal(await days.nth(4).getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('.agenda-day h3').first().getAttribute('id'), `ag-${await days.nth(5).getAttribute('data-date')}`);
  // Next week keeps focus on Next week; view switch keeps focus on its radio
  await page.getByRole('button', { name: 'Next week' }).focus(); await page.keyboard.press('Enter');
  assert.equal(await focusedLabel(), 'Next week', 'focus stays on Next week (was jumping to Previous week)');
  await page.getByRole('radio', { name: 'Week' }).focus(); await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => document.activeElement.value), 'week', 'focus stays on the Week radio');
  await page.getByRole('radio', { name: 'Agenda' }).focus(); await page.keyboard.press('Space');
  // no unexpected scrolling when activating a date
  await page.evaluate(() => window.scrollTo(0, 0));
  await days.nth(2).focus(); const y0 = await page.evaluate(() => window.scrollY); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.scrollY), y0, 'no scroll jump on activation');
  // Back to today still works; today is selected again
  await page.getByRole('button', { name: 'Back to today' }).focus(); await page.keyboard.press('Enter');
  assert.equal(await page.locator('.ds-day[aria-current="date"]').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('.ag-anchor').innerText(), /\(today\)/);
  step('390px calendar: Tab/Enter/Space keep focus on the activated date; selected state, today marker, agenda start and Back to today stay correct; Next week and view switch keep focus too');
  await page.context().close();
}
assert.deepEqual(errors, [], errors.join('; '));
console.log('FIX CHECKS PASSED');
await browser.close();
