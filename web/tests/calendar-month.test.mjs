// Month calendar date helpers (front-end refinement v1, K2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, monthGrid } from '../js/logic.js';

test('addMonths moves by whole months and rolls the year', () => {
  assert.equal(addMonths('2026-03-15', 1), '2026-04-15');
  assert.equal(addMonths('2026-12-10', 1), '2027-01-10');
  assert.equal(addMonths('2026-01-10', -1), '2025-12-10');
  assert.equal(addMonths('2026-03-15', 0), '2026-03-15');
});

test('addMonths clamps to the end of shorter months (incl. leap February)', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(addMonths('2026-05-31', 1), '2026-06-30');
});

test('monthGrid: whole Monday-first weeks, 7 cells each', () => {
  for (const day of ['2026-02-10', '2026-03-10', '2026-11-18', '2028-02-01', '2026-08-31']) {
    const g = monthGrid(day);
    assert.ok(g.length >= 4 && g.length <= 6, `${day}: ${g.length} weeks`);
    for (const w of g) assert.equal(w.length, 7);
    // consecutive days, no gaps
    const flat = g.flat().map((c) => c.date);
    for (let i = 1; i < flat.length; i++) assert.equal((new Date(flat[i]) - new Date(flat[i - 1])) / 86400000, 1);
    // each row starts on a Monday
    for (const w of g) assert.equal(new Date(`${w[0].date}T12:00:00`).getDay(), 1);
  }
});

test('monthGrid: flags in-month days and covers every day of the month exactly once', () => {
  const g = monthGrid('2026-11-18').flat();
  const inMonth = g.filter((c) => c.inMonth).map((c) => c.date);
  assert.equal(inMonth.length, 30);
  assert.equal(inMonth[0], '2026-11-01');
  assert.equal(inMonth.at(-1), '2026-11-30');
  assert.equal(g[0].date, '2026-10-26'); // Nov 1 2026 is a Sunday, so the grid starts the Monday before
  assert.equal(g[0].inMonth, false);
  assert.equal(g.at(-1).date, '2026-12-06'); // Nov 30 2026 is a Monday, so the last row runs to Sunday Dec 6
  assert.equal(g.at(-1).inMonth, false);
});

test('monthGrid: week count is 4 for a Feb that starts on Monday, 6 when the month spans six rows', () => {
  assert.equal(monthGrid('2027-02-14').length, 4); // Feb 2027: Mon Feb 1 .. Sun Feb 28
  assert.equal(monthGrid('2026-08-01').length, 6); // Aug 2026: starts Saturday, 31 days
  assert.equal(monthGrid('2028-02-10').flat().filter((c) => c.inMonth).length, 29); // leap year
});
