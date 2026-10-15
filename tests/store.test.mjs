import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';
import { createStore } from '../js/store.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m }; };
const fresh = (opts = {}) => { const storage = opts.storage || mem(); const s = createStore({ storage, now: opts.now }); s.load(); return { s, storage }; };
const id = (s, name) => s.state.members.find((m) => m.name === name).id;

test('money parsing and formatting', () => {
  assert.equal(L.parseMoney('$1,234.5'), 123450);
  assert.equal(L.parseMoney('0.07'), 7);
  assert.equal(L.parseMoney('0'), null);
  assert.equal(L.parseMoney('-5'), null);
  assert.equal(L.parseMoney('1.234'), null);
  assert.equal(L.parseMoney('abc'), null);
  assert.equal(L.fmtMoney(-1205), '-$12.05');
});

test('equal split is exact and deterministic', () => {
  for (const [total, n] of [[1, 3], [100, 3], [2743, 4], [13837, 4], [999999, 7], [5, 5]]) {
    const ids = Array.from({ length: n }, (_, i) => `u${i}`);
    const split = L.splitEqual(total, ids);
    assert.equal(Object.values(split).reduce((a, b) => a + b, 0), total);
    assert.deepEqual(split, L.splitEqual(total, ids));
    const vals = Object.values(split);
    assert.ok(Math.max(...vals) - Math.min(...vals) <= 1);
  }
  assert.deepEqual(L.splitEqual(100, ['a', 'b', 'c']), { a: 34, b: 33, c: 33 });
});

test('balances sum to zero and reimbursements shift them', () => {
  const { s } = fresh(); s.startDemo();
  const [m, j, p, sam] = ['Maya', 'Jordan', 'Priya', 'Sam'].map((n) => id(s, n));
  const b = s.sel.balances();
  assert.equal(Object.values(b).reduce((a, c) => a + c, 0), 0);
  // electric 13837 by Jordan /4 -> 3460,3459,3459,3459 ; supplies 2743 by Priya -> 686,686,686,685; Maya paid Jordan 2000
  assert.equal(b[m], -3460 - 686 + 2000);
  assert.equal(b[j], 13837 - 3459 - 686 - 2000);
  assert.equal(b[p], 2743 - 686 - 3459);
  assert.equal(b[sam], -3459 - 685);
});

test('chore recurrence: complete creates next once, rotates, undo removes it', () => {
  const { s } = fresh(); s.startDemo();
  const [m, j] = ['Maya', 'Jordan'].map((n) => id(s, n));
  const trash = s.sel.mine().find((o) => o.title.startsWith('Take out trash'));
  assert.equal(trash.due, s.today());
  const before = s.state.occurrences.length;
  assert.ok(s.completeChore(trash.id).ok);
  assert.equal(s.completeChore(trash.id).ok, false); // double click
  assert.equal(s.state.occurrences.length, before + 1);
  const next = s.state.occurrences.find((o) => o.id === trash.nextOccId) || s.state.occurrences.find((o) => o.id === s.state.occurrences.find((x) => x.id === trash.id).nextOccId);
  assert.equal(next.assigneeId, j);
  assert.equal(next.due, L.addDays(s.today(), 7));
  const done = s.state.occurrences.find((o) => o.id === trash.id);
  assert.equal(done.doneBy, m);
  assert.ok(done.doneAt);
  assert.ok(s.state.activity.some((a) => a.ref === trash.id));
  assert.ok(s.state.notifications.some((n) => n.userId === j && n.key === `assign:${next.id}:${j}`));
  assert.ok(s.undoComplete(trash.id).ok);
  assert.equal(s.state.occurrences.length, before);
  assert.ok(!s.state.activity.some((a) => a.ref === trash.id));
  // full rotation wraps
  let cur = trash;
  const seen = [];
  for (let i = 0; i < 4; i++) { s.completeChore(cur.id); const c = s.state.occurrences.find((o) => o.id === cur.id); cur = s.state.occurrences.find((o) => o.id === c.nextOccId); seen.push(s.nameOf(cur.assigneeId)); }
  assert.deepEqual(seen, ['Jordan', 'Priya', 'Sam', 'Maya']);
});

test('late completion does not create a backlog of past occurrences', () => {
  assert.equal(L.nextDue('2026-10-01', '2026-10-13'), '2026-10-15');
  assert.equal(L.nextDue('2026-10-13', '2026-10-13'), '2026-10-20');
});

test('reminders dedupe and stop after completion', () => {
  const { s } = fresh(); s.startDemo();
  const maya = id(s, 'Maya'), jordan = id(s, 'Jordan');
  const count = () => s.state.notifications.filter((n) => n.key && /^(due|overdue):/.test(n.key)).length;
  const c0 = count();
  assert.ok(s.state.notifications.some((n) => n.userId === jordan && n.type === 'chore_overdue'));
  s.runReminders(); s.runReminders();
  assert.equal(count(), c0);
  const kitchen = s.sel.overdue()[0];
  s.setCurrentUser(jordan);
  s.completeChore(kitchen.id);
  assert.ok(!s.state.notifications.some((n) => n.key === `overdue:${kitchen.id}` && !n.read));
  s.setPrefs({ reminders: false });
  assert.equal(s.prefsOf(jordan).reminders, false);
  assert.ok(maya);
});

test('shopping: claim, purchase with linked expense, no duplicates, balances', () => {
  const { s } = fresh(); s.startDemo();
  const [m, j, p, sam] = ['Maya', 'Jordan', 'Priya', 'Sam'].map((n) => id(s, n));
  const soap = s.sel.needed().find((i) => i.name === 'Dish soap');
  assert.ok(s.claimItem(soap.id).ok);
  assert.equal(s.state.shopping.find((i) => i.id === soap.id).buyerId, m);
  s.setCurrentUser(j);
  assert.equal(s.claimItem(soap.id).ok, false);
  s.setCurrentUser(m);
  const before = s.sel.balances();
  const bad = s.purchaseItem(soap.id, { expense: { description: 'Dish soap', amount: 'x', date: s.today(), payerId: m, participantIds: [m, j, p, sam] } });
  assert.equal(bad.ok, false);
  assert.equal(s.state.shopping.find((i) => i.id === soap.id).status, 'needed');
  const exp = { description: 'Dish soap', amount: '10.01', date: s.today(), payerId: m, participantIds: [m, j, p, sam] };
  assert.ok(s.purchaseItem(soap.id, { expense: exp }).ok);
  assert.ok(s.purchaseItem(soap.id, { expense: exp }).duplicate);
  assert.equal(s.state.expenses.filter((e) => e.shoppingItemId === soap.id).length, 1);
  const after = s.sel.balances();
  assert.equal(after[m] - before[m], 1001 - 251); // payer share is 251 (10.01/4 -> 251,250,250,250)
  assert.equal(after[j] - before[j], -250);
  assert.equal(Object.values(after).reduce((a, c) => a + c, 0), 0);
  assert.ok(s.state.notifications.some((n) => n.userId === j && n.type === 'expense' && /Your share: \$2\.50/.test(n.body)));
  // delete the expense -> balances revert, item stays purchased
  const e = s.state.expenses.find((x) => x.shoppingItemId === soap.id);
  s.deleteExpense(e.id);
  assert.deepEqual(s.sel.balances(), before);
  assert.equal(s.state.shopping.find((i) => i.id === soap.id).status, 'purchased');
  assert.ok(s.undoLast());
  assert.equal(s.state.expenses.some((x) => x.id === e.id), true);
});

test('expense idempotency token, edit and reimbursement', () => {
  const { s } = fresh(); s.startDemo();
  const [m, j] = ['Maya', 'Jordan'].map((n) => id(s, n));
  const d = { description: 'Internet', amount: '60', date: s.today(), payerId: m, participantIds: [m, j], token: 'tok1' };
  s.addExpense(d); s.addExpense(d);
  assert.equal(s.state.expenses.filter((e) => e.description === 'Internet').length, 1);
  const e = s.state.expenses.find((x) => x.description === 'Internet');
  assert.equal(s.editExpense(e.id, { ...d, amount: '61.01' }).ok, true);
  assert.deepEqual(s.state.expenses.find((x) => x.id === e.id).splits, { [m]: 3051, [j]: 3050 });
  const b0 = s.sel.balances();
  assert.equal(s.addReimbursement({ fromId: j, toId: m, amount: '10', date: s.today() }).ok, true);
  assert.equal(s.sel.balances()[j] - b0[j], 1000);
  assert.equal(s.addReimbursement({ fromId: j, toId: j, amount: '10', date: s.today() }).ok, false);
});

test('events: creator-only edit/delete, validation, dated chores appear without duplicates', () => {
  const { s } = fresh(); s.startDemo();
  const [m, p] = ['Maya', 'Priya'].map((n) => id(s, n));
  const t = s.today();
  assert.equal(s.addEvent({ title: 'Quiet', category: 'quiet', startDate: t, startTime: '20:00', endDate: t, endTime: '19:00' }).ok, false);
  const r = s.addEvent({ title: 'Quiet time', category: 'quiet', startDate: t, startTime: '20:00', endDate: t, endTime: '22:00' });
  assert.ok(r.ok);
  assert.ok(s.state.notifications.some((n) => n.userId === p && /Quiet time/.test(n.title)));
  s.setCurrentUser(p);
  assert.equal(s.editEvent(r.id, { title: 'x', category: 'quiet', startDate: t, startTime: '20:00', endDate: t, endTime: '22:00' }).ok, false);
  assert.equal(s.deleteEvent(r.id).ok, false);
  s.setCurrentUser(m);
  assert.ok(s.deleteEvent(r.id).ok);
  assert.ok(s.undoLast());
  const occsToday = s.sel.occsOn(t);
  assert.equal(new Set(occsToday.map((o) => o.id)).size, occsToday.length);
  assert.ok(!s.state.events.some((e) => e.title.startsWith('Take out trash')));
});

test('persistence round-trip and corrupt data handling', () => {
  const a = fresh(); a.s.startDemo();
  const m = id(a.s, 'Maya');
  a.s.completeChore(a.s.sel.mine()[0].id);
  const b = fresh({ storage: a.storage });
  assert.equal(b.s.state.household.name, 'Pecan Court Apt 204');
  assert.equal(b.s.sel.done().length, a.s.sel.done().length);
  a.storage.setItem('roomsync.v1', '{nope');
  const c = createStore({ storage: a.storage });
  assert.equal(c.load().ok, false);
  assert.ok(m);
});

test('save failures are surfaced, not thrown', () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem() {} };
  const s = createStore({ storage }); s.load(); s.startDemo();
  assert.ok(s.saveError);
});

test('createHousehold validation and starter chores', () => {
  const { s } = fresh();
  assert.equal(s.createHousehold({ userName: '', householdName: '', others: [] }).ok, false);
  assert.equal(s.createHousehold({ userName: 'A', householdName: 'H', others: ['a'] }).ok, false);
  const r = s.createHousehold({ userName: 'Ana', householdName: 'Casa', others: ['Ben', 'Cy'], starter: ['trash', 'kitchen'] });
  assert.ok(r.ok);
  assert.equal(s.state.members.length, 3);
  assert.equal(s.sel.pending().length, 2);
  assert.equal(s.state.mode, 'local');
});

test('week stats count by roommate for the selected week', () => {
  const { s } = fresh(); s.startDemo();
  const ws = L.startOfWeek(s.today());
  const st = s.sel.weekStats(ws);
  assert.equal(st.length, 4);
  const total = st.reduce((a, x) => a + x.completed + x.pending, 0);
  assert.ok(total > 0);
});

test('reminders for a completed chore are removed even if already read', () => {
  const { s } = fresh(); s.startDemo();
  const jordan = id(s, 'Jordan');
  const kitchen = s.sel.overdue()[0];
  const n = s.state.notifications.find((x) => x.key === `overdue:${kitchen.id}` && x.userId === jordan);
  assert.ok(n); s.setCurrentUser(jordan); s.setRead(n.id, true);
  s.completeChore(kitchen.id);
  assert.ok(!s.state.notifications.some((x) => x.key === `overdue:${kitchen.id}`));
  s.runReminders();
  assert.ok(!s.state.notifications.some((x) => x.key === `overdue:${kitchen.id}`), 'not regenerated while completed');
});

test('notification and activity wording is concrete (no filler)', () => {
  const { s } = fresh(); s.startDemo();
  const m = id(s, 'Maya'), j = id(s, 'Jordan');
  s.addExpense({ description: 'Wifi', amount: '90.00', date: s.today(), payerId: m, participantIds: [m, j] });
  const n = s.state.notifications.find((x) => x.userId === j && /Wifi/.test(x.title));
  assert.equal(n.title, 'Maya added Wifi.');
  assert.equal(n.body, 'Your share: $45.00 of $90.00');
  assert.ok(!s.state.notifications.some((x) => /Friendly reminder/.test(x.body)));
  assert.equal(s.state.activity[0].verb, 'added the expense');
});

test('deleting a chore keeps completed history and removes open occurrences', () => {
  const { s } = fresh(); s.startDemo();
  const vac = s.state.occurrences.find((o) => o.title.startsWith('Vacuum') && o.doneAt);
  const open = s.state.occurrences.find((o) => o.choreId === vac.choreId && !o.doneAt);
  assert.ok(s.deleteChore(open.id).ok);
  assert.ok(s.state.occurrences.some((o) => o.id === vac.id), 'history kept');
  assert.ok(!s.state.occurrences.some((o) => o.id === open.id));
  assert.ok(s.undoLast());
  assert.ok(s.state.occurrences.some((o) => o.id === open.id));
});

test('taking over a claimed shopping item is one atomic step', () => {
  const { s } = fresh(); s.startDemo();
  const [m, j] = ['Maya', 'Jordan'].map((n) => id(s, n));
  const soap = s.sel.needed().find((i) => i.name === 'Dish soap');
  s.setCurrentUser(j); s.claimItem(soap.id);
  s.setCurrentUser(m);
  assert.equal(s.claimItem(soap.id).ok, false);
  assert.ok(s.takeOverItem(soap.id).ok);
  assert.equal(s.state.shopping.find((i) => i.id === soap.id).buyerId, m);
});
