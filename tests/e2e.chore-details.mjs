// Browser checks for the chore-details dialog (isolated demo data in a fresh browser context).
// PLAYWRIGHT_MODULE=/path/to/playwright [CHROMIUM=...] [SHOTS=dir] node tests/e2e.chore-details.mjs   (app on :8080)
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
  const snapshot = () => st(() => JSON.stringify([window.__roomsync.state.occurrences, window.__roomsync.state.chores, window.__roomsync.state.activity.length, window.__roomsync.state.notifications.length]));
  const dialog = page.getByRole('dialog');

  await page.goto(BASE);
  await page.getByRole('button', { name: /Try the demo/ }).click();
  await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor();

  // extra isolated chores: one without notes, one with very long title + notes
  await st(() => {
    const s = window.__roomsync, me = s.me(), t = s.today();
    s.addChore({ title: 'Wipe stovetop', notes: '', assigneeId: me, due: t, recurrence: 'once', rotate: false, rotation: [] });
    s.addChore({ title: 'Reorganize the hall closet and sort every seasonal item into labelled bins', notes: 'Line one of the instructions.\nLine two: ' + 'verylongwordwithoutspaces'.repeat(6) + ' and a normal sentence that keeps going to check wrapping.', assigneeId: me, due: s.today(), recurrence: 'once', rotate: false, rotation: [] });
  });

  // 1. Home title opens details for a chore with notes + recurrence + rotation, without changing anything
  const before = await snapshot();
  const titleBtn = page.getByRole('button', { name: 'Take out trash & recycling', exact: true }).first();
  await titleBtn.focus();
  await page.keyboard.press('Enter');
  await dialog.waitFor();
  assert.equal(await dialog.getByRole('heading', { level: 2 }).innerText(), 'Take out trash & recycling');
  await dialog.getByText('Bins go to the curb the night before pickup.').waitFor();
  assert.match(await dialog.innerText(), /Assigned to\s+You/);
  assert.match(await dialog.innerText(), /Today/);
  assert.match(await dialog.innerText(), /Repeats\s+Every week/);
  assert.match(await dialog.innerText(), /Next in rotation\s+Jordan/);
  assert.equal(await st(() => document.activeElement.closest('dialog') !== null), true, 'focus moves into the dialog');
  await shot('details-notes');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await st(() => document.activeElement.textContent.trim()), 'Take out trash & recycling', 'focus returns to the title');
  assert.equal(await snapshot(), before, 'opening and closing changes nothing');
  step(`${width}px: Home title opens correct details (keyboard), Escape closes, focus returns, data untouched`);

  // 2. no notes / non-recurring: optional sections omitted
  await page.getByRole('button', { name: 'Wipe stovetop', exact: true }).click();
  const txt = await dialog.innerText();
  assert.ok(!/Notes/.test(txt) && !/Repeats/.test(txt) && !/rotation/i.test(txt), 'optional sections omitted');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  step(`${width}px: chore without notes/recurrence omits those sections`);

  // 3. long title/notes wrap and fit
  await page.goto(`${BASE}#/chores/mine`);
  await page.getByRole('button', { name: /^Reorganize the hall closet/ }).click();
  await page.waitForTimeout(260); // entry animation
  const box = await page.locator('#modal').boundingBox();
  assert.ok(box.x >= -1 && box.x + box.width <= width + 1 && box.y >= -1 && box.y + box.height <= height + 1, 'dialog fits viewport');
  const over = await st(() => { const m = document.querySelector('#modal'); return m.scrollWidth > m.clientWidth + 1 || [...m.querySelectorAll('*')].some((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'visible' && e.getBoundingClientRect().right > m.getBoundingClientRect().right + 1); });
  assert.equal(over, false, 'long text wraps inside the dialog');
  await shot('details-long');
  await page.keyboard.press('Escape');
  step(`${width}px: long title/notes wrap and the dialog fits`);

  // 4. All chores: someone else's chore shows the correct assignee; opening it does not modify anything
  await page.goto(`${BASE}#/chores/all`);
  const b2 = await snapshot();
  await page.getByRole('button', { name: 'Deep-clean kitchen', exact: true }).click();
  assert.match(await dialog.innerText(), /Assigned to\s+Jordan/);
  assert.match(await dialog.innerText(), /overdue/);
  assert.match(await dialog.innerText(), /Next in rotation\s+Priya/);
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  assert.equal(await snapshot(), b2);
  step(`${width}px: All chores title opens matching record (assignee, overdue status, rotation)`);

  // 5. Complete through dialog; one next occurrence; Undo; repeated clicks harmless
  await page.goto(`${BASE}#/home`);
  const n0 = await st(() => window.__roomsync.state.occurrences.length);
  await page.getByRole('button', { name: 'Take out trash & recycling', exact: true }).first().click();
  await dialog.getByRole('button', { name: 'Mark complete' }).dblclick();
  await page.getByText('Completed Take out trash & recycling.').waitFor();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await st(() => window.__roomsync.state.occurrences.length), n0 + 1);
  assert.equal(await page.getByRole('checkbox', { name: 'Complete: Take out trash & recycling' }).count(), 0, 'list updated');
  await shot('after-complete');
  await page.locator('#toasts').getByRole('button', { name: 'Undo' }).click();
  await page.getByText('Take out trash & recycling is open again.').waitFor();
  assert.equal(await st(() => window.__roomsync.state.occurrences.length), n0, 'Undo removes the generated occurrence');
  await page.getByRole('checkbox', { name: 'Complete: Take out trash & recycling' }).waitFor();
  step(`${width}px: Mark complete uses existing completion + Undo; no duplicates; lists update`);

  // 6. Edit from details opens the existing editor with the record
  await page.getByRole('button', { name: 'Take out trash & recycling', exact: true }).first().click();
  await dialog.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('heading', { name: 'Edit chore' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Chore' }).inputValue(), 'Take out trash & recycling');
  await page.getByRole('button', { name: 'Cancel' }).click();
  step(`${width}px: Edit from details opens the existing editor`);

  // 7. persistence
  await page.reload();
  await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor();
  assert.ok(await st(() => window.__roomsync.state.chores.some((c) => c.title === 'Wipe stovetop')));
  step(`${width}px: data still loads after refresh`);
  await page.context().close();
}
await run(390, 844);
await run(1280, 900);
assert.deepEqual(errors, [], errors.join('; '));
console.log('CHORE DETAILS CHECKS PASSED');
await browser.close();
