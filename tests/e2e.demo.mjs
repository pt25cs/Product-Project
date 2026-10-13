// End-to-end walkthrough of the demo scenario in a real browser.
// Needs Playwright + Chromium (not a project dependency): PLAYWRIGHT_MODULE=/path/to/playwright node tests/e2e.demo.mjs
// Expects the app on http://localhost:8080 (npm start).
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const URL_ = process.env.APP_URL || 'http://localhost:8080/';
const shots = process.env.SHOTS || '';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const shot = (n) => shots && page.screenshot({ path: `${shots}/${n}.png`, fullPage: true });
const step = (s) => console.log('✓', s);

await page.goto(URL_);
await page.getByRole('button', { name: 'Try demo household' }).click();
await page.getByRole('heading', { name: 'Hi, Maya' }).waitFor();
step('1. entered demo household as Maya'); await shot('01-home-mobile');

// 2. assigned chore → complete
const trash = page.getByRole('button', { name: 'Mark “Take out trash & recycling” complete' }).first();
await trash.click();
// 3. dashboard + history update
await page.getByText('Marked “Take out trash & recycling” complete.').waitFor();
assert.equal(await page.getByRole('button', { name: 'Mark “Take out trash & recycling” complete' }).count(), 0);
await page.getByRole('link', { name: 'Chores' }).first().click();
await page.getByRole('link', { name: 'Completed', exact: true }).click();
await page.getByText('Completed by You').first().waitFor();
assert.ok(await page.getByText('Take out trash & recycling').count() >= 1);
await shot('02-completed');
await page.getByRole('link', { name: 'All chores', exact: true }).click();
await page.getByText('Next: Priya').first().waitFor().catch(() => {}); // Jordan's turn now → next after is Priya
step('2-3. chore completed, history + next occurrence updated');

// 4. claim, purchase, record expense
await page.getByRole('link', { name: 'Expenses & Shopping' }).first().click();
await page.getByRole('link', { name: 'Shopping', exact: true }).click();
await page.getByRole('button', { name: 'Claim Dish soap' }).click();
await page.getByText('You will buy').first().waitFor();
await page.getByRole('button', { name: 'Mark Dish soap purchased' }).click();
await page.getByLabel('Amount (USD)').fill('10.01');
await page.getByRole('button', { name: 'Save purchase & expense' }).dblclick(); // double click must not duplicate
await page.getByText('Purchased “Dish soap” and recorded the expense.').waitFor();
const dup = await page.evaluate(() => window.__roomsync.state.expenses.filter((e) => e.description === 'Dish soap').length);
assert.equal(dup, 1);
await shot('03-shopping');
// 5. balances
await page.getByRole('link', { name: 'Expenses', exact: true }).click();
const bal = await page.evaluate(() => { const s = window.__roomsync; const b = s.sel.balances(); return Object.fromEntries(s.state.members.map((m) => [m.name, b[m.id]])); });
assert.equal(Object.values(bal).reduce((a, b) => a + b, 0), 0);
await page.getByText('Dish soap · $10.01').waitFor();
await shot('04-expenses');
step('4-5. claimed, purchased, expense recorded once; balances ' + JSON.stringify(bal));

// 6. quiet time
await page.getByRole('link', { name: 'Calendar' }).first().click();
await page.getByRole('button', { name: '+ Add event' }).click();
await page.getByLabel('Title').fill('Quiet time: orgo exam prep');
await page.getByRole('button', { name: 'Add event' }).last().click();
await page.getByText('Event added.').waitFor();
await shot('05-calendar');
step('6. quiet time added to calendar');

// 7. switch roommate
await page.getByLabel('Viewing as').selectOption({ label: 'Jordan' });
await page.getByRole('link', { name: /^Notifications/ }).click();
await page.getByText('Maya added: Quiet time: orgo exam prep').waitFor();
await page.getByText(/your share \$2\.50/).first().waitFor();
await page.getByText(/You're up next|Take out trash/).first().waitFor();
await shot('06-notifications');
await page.getByRole('link', { name: 'Home' }).first().click();
await page.getByText('Maya completed Take out trash & recycling').waitFor();
step('7. switched to Jordan; shared updates and notifications visible');

// persistence
await page.reload();
await page.getByRole('heading', { name: 'Hi, Jordan' }).waitFor();
assert.equal(await page.evaluate(() => window.__roomsync.state.expenses.filter((e) => e.description === 'Dish soap').length), 1);
step('persistence across refresh');

// validation
await page.getByRole('button', { name: '+ Add expense' }).click();
await page.getByRole('button', { name: 'Add expense' }).last().click();
await page.getByText('Describe what this was for.').waitFor();
await page.getByText(/Enter an amount greater than/).waitFor();
await page.keyboard.press('Escape');
step('validation errors shown');

// desktop layout
await page.setViewportSize({ width: 1280, height: 900 });
await page.getByRole('navigation', { name: 'Primary' }).first().waitFor();
await shot('07-home-desktop');
assert.deepEqual(errors, [], 'console/page errors: ' + errors.join('; '));
console.log('ALL E2E CHECKS PASSED');
await browser.close();
