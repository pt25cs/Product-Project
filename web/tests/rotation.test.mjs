import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';
import { createStore } from '../js/store.js';

// In-memory storage + a controllable clock so schedule-driven rotation is deterministic.
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m }; };
const clock = (start) => { let cur = new Date(start); return { now: () => cur, set: (d) => { cur = new Date(d); } }; };
const fresh = (opts = {}) => { const storage = opts.storage || mem(); const s = createStore({ storage, now: opts.now }); s.load(); return { s, storage }; };
const id = (s, name) => s.state.members.find((m) => m.name === name).id;
// Local-date Date at local midnight, matching how the store reads `now()` through L.toDateStr.
const at = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d, 9, 0, 0, 0); };

// ---- pure helpers (Task 2 logic, exercised here for the rotation feature) ----

test('cyclesSince counts whole cycles for weekly and non-weekly cadences', () => {
  assert.equal(L.cyclesSince('2026-01-01', '2026-01-01', 7), 0);
  assert.equal(L.cyclesSince('2026-01-01', '2026-01-07', 7), 0); // 6 days -> still cycle 0
  assert.equal(L.cyclesSince('2026-01-01', '2026-01-08', 7), 1); // exactly one week
  assert.equal(L.cyclesSince('2026-01-01', '2026-01-22', 7), 3);
  // non-weekly: 3-day cadence
  assert.equal(L.cyclesSince('2026-01-01', '2026-01-04', 3), 1);
  assert.equal(L.cyclesSince('2026-01-01', '2026-01-10', 3), 3);
  // before the anchor is negative
  assert.equal(L.cyclesSince('2026-01-08', '2026-01-01', 7), -1);
});

test('rotationAssignee is deterministic round-robin honoring cycleDays', () => {
  const chore = { rotation: ['a', 'b', 'c'], anchorDate: '2026-01-01', cycleDays: 7, startIdx: 0 };
  assert.equal(L.rotationAssignee(chore, '2026-01-01'), 'a');
  assert.equal(L.rotationAssignee(chore, '2026-01-08'), 'b');
  assert.equal(L.rotationAssignee(chore, '2026-01-15'), 'c');
  assert.equal(L.rotationAssignee(chore, '2026-01-22'), 'a'); // wraps
  // non-weekly cadence advances faster
  const fast = { rotation: ['a', 'b'], anchorDate: '2026-01-01', cycleDays: 3, startIdx: 0 };
  assert.equal(L.rotationAssignee(fast, '2026-01-04'), 'b');
  assert.equal(L.rotationAssignee(fast, '2026-01-07'), 'a');
});

test('currentCycleDue never returns a past-dated backlog', () => {
  const chore = { anchorDate: '2026-01-01', cycleDays: 7 };
  // today falls mid-cycle -> the due is the current cycle boundary on/after today
  assert.equal(L.currentCycleDue(chore, '2026-01-20') >= '2026-01-20', true);
  assert.equal(L.currentCycleDue(chore, '2026-01-20'), '2026-01-22');
  // when today lands exactly on a boundary, that boundary is the due date
  assert.equal(L.currentCycleDue(chore, '2026-01-15'), '2026-01-15');
});

// ---- store-level scheduled auto-rotation ----

// Build an auto-rotating weekly chore anchored today, assigned to the first roommate.
function makeAutoChore(s, { cycleDays = 7, rotation } = {}) {
  const all = s.memberIds();
  const rot = rotation || all;
  const r = s.addChore({ title: 'Kitchen rota', notes: '', recurrence: 'weekly', rotate: true, rotation: rot, assigneeId: rot[0], due: s.today(), autoRotate: true, cycleDays });
  assert.ok(r.ok, JSON.stringify(r));
  const chore = s.state.chores.find((c) => c.id === s.state.occurrences.find((o) => o.id === r.id).choreId);
  return { choreId: chore.id, firstOccId: r.id };
}

test('advances across skipped cycles without creating a backlog (weekly)', () => {
  const c = clock(at('2026-03-02')); // a Monday
  const { s } = fresh({ now: c.now });
  s.startDemo();
  const [maya, jordan, priya, sam] = ['Maya', 'Jordan', 'Priya', 'Sam'].map((n) => id(s, n));
  const { choreId } = makeAutoChore(s, { rotation: [maya, jordan, priya, sam] });
  const occsFor = () => s.state.occurrences.filter((o) => o.choreId === choreId);
  assert.equal(occsFor().length, 1);
  assert.equal(occsFor()[0].assigneeId, maya);

  // Jump forward 3 weeks WITHOUT completing anything, then run the reminder hook.
  c.set(at('2026-03-23'));
  s.runReminders();
  const occs = occsFor();
  // No backlog: exactly one occurrence per cycle actually materialized (the original + current cycle),
  // never one per skipped week.
  assert.ok(occs.length <= 2, `expected no backlog, got ${occs.length}`);
  const current = occs.find((o) => o.due === L.currentCycleDue(s.state.chores.find((x) => x.id === choreId), s.today()));
  assert.ok(current, 'current-cycle occurrence exists');
  // 3 whole weeks after anchor -> rotation index 3 -> Sam.
  assert.equal(current.assigneeId, sam);
});

test('advances on a non-weekly cadence', () => {
  const c = clock(at('2026-03-02'));
  const { s } = fresh({ now: c.now });
  s.startDemo();
  const [maya, jordan] = ['Maya', 'Jordan'].map((n) => id(s, n));
  const { choreId } = makeAutoChore(s, { cycleDays: 3, rotation: [maya, jordan] });
  // 6 days = 2 cycles later -> back to the first roommate (even number of cycles).
  c.set(at('2026-03-08'));
  s.runReminders();
  const chore = s.state.chores.find((x) => x.id === choreId);
  const due = L.currentCycleDue(chore, s.today());
  const current = s.state.occurrences.find((o) => o.choreId === choreId && o.due === due);
  assert.ok(current);
  assert.equal(current.assigneeId, L.rotationAssignee(chore, due));
  // 9 days (3 cycles) later -> the other roommate.
  c.set(at('2026-03-11'));
  s.runReminders();
  const due2 = L.currentCycleDue(chore, s.today());
  const cur2 = s.state.occurrences.find((o) => o.choreId === choreId && o.due === due2);
  assert.equal(cur2.assigneeId, L.rotationAssignee(chore, due2));
  assert.notEqual(cur2.assigneeId, current.assigneeId);
});

test('manual override suppresses one cycle then rotation resumes', () => {
  const c = clock(at('2026-03-02'));
  const { s } = fresh({ now: c.now });
  s.startDemo();
  const [maya, jordan, priya, sam] = ['Maya', 'Jordan', 'Priya', 'Sam'].map((n) => id(s, n));
  const { choreId, firstOccId } = makeAutoChore(s, { rotation: [maya, jordan, priya, sam] });

  // Move to week 1: rotation would pick Jordan. First let rotation create that occurrence.
  c.set(at('2026-03-09'));
  s.runReminders();
  const chore = () => s.state.chores.find((x) => x.id === choreId);
  const dueW1 = L.currentCycleDue(chore(), s.today());
  let occW1 = s.state.occurrences.find((o) => o.choreId === choreId && o.due === dueW1);
  assert.equal(occW1.assigneeId, jordan);

  // Manually reassign this cycle to Sam -> sets manualOverride, suppressing the auto-turn.
  assert.ok(s.reassignChore(occW1.id, sam).ok);
  occW1 = s.state.occurrences.find((o) => o.id === occW1.id);
  assert.equal(occW1.manualOverride, true);
  assert.equal(occW1.assigneeId, sam);
  // Running the hook again must NOT revert the manual override back to Jordan.
  s.runReminders();
  assert.equal(s.state.occurrences.find((o) => o.id === occW1.id).assigneeId, sam);

  // Next cycle (week 2): rotation resumes normally -> Priya (index 2).
  c.set(at('2026-03-16'));
  s.runReminders();
  const dueW2 = L.currentCycleDue(chore(), s.today());
  const occW2 = s.state.occurrences.find((o) => o.choreId === choreId && o.due === dueW2);
  assert.ok(occW2);
  assert.equal(occW2.manualOverride, false);
  assert.equal(occW2.assigneeId, priya);
  assert.ok(firstOccId);
});

test('single-assignee and one-time chores are left unchanged by auto-rotation', () => {
  const c = clock(at('2026-03-02'));
  const { s } = fresh({ now: c.now });
  s.startDemo();
  const [maya] = ['Maya'].map((n) => id(s, n));
  // One-time chore (autoRotate ignored because recurrence !== weekly).
  const one = s.addChore({ title: 'Assemble shelf', notes: '', recurrence: 'once', rotate: false, rotation: [], assigneeId: maya, due: s.today(), autoRotate: true });
  assert.ok(one.ok);
  const oneChore = s.state.chores.find((x) => x.id === s.state.occurrences.find((o) => o.id === one.id).choreId);
  assert.equal(oneChore.autoRotate, false);
  // Single-assignee weekly chore: autoRotate can't engage (rotation < 2).
  const single = s.addChore({ title: 'Water plants', notes: '', recurrence: 'weekly', rotate: false, rotation: [], assigneeId: maya, due: s.today(), autoRotate: true });
  assert.ok(single.ok);
  const singleChore = s.state.chores.find((x) => x.id === s.state.occurrences.find((o) => o.id === single.id).choreId);
  assert.equal(singleChore.autoRotate, false);

  const before = s.state.occurrences.length;
  c.set(at('2026-04-01'));
  s.runReminders();
  // No extra occurrences conjured for these chores.
  assert.equal(s.state.occurrences.filter((o) => o.choreId === oneChore.id).length, 1);
  assert.equal(s.state.occurrences.filter((o) => o.choreId === singleChore.id).length, 1);
  assert.ok(s.state.occurrences.length >= before);
});

test('rotation notification is deduped by a stable key and not sent to the prior assignee', () => {
  const c = clock(at('2026-03-02'));
  const { s } = fresh({ now: c.now });
  s.startDemo();
  const [maya, jordan, priya, sam] = ['Maya', 'Jordan', 'Priya', 'Sam'].map((n) => id(s, n));
  const { choreId } = makeAutoChore(s, { rotation: [maya, jordan, priya, sam] });

  // Advance to week 1 (Jordan's turn) and fire the hook twice.
  c.set(at('2026-03-09'));
  s.runReminders();
  const chore = s.state.chores.find((x) => x.id === choreId);
  const dueW1 = L.currentCycleDue(chore, s.today());
  const occW1 = s.state.occurrences.find((o) => o.choreId === choreId && o.due === dueW1);
  const rotKey = `rotate:${occW1.id}:${jordan}`;
  const countKey = () => s.state.notifications.filter((n) => n.key === rotKey).length;
  assert.equal(countKey(), 1, 'exactly one rotation notification for the new assignee');
  s.runReminders(); s.runReminders();
  assert.equal(countKey(), 1, 'dedupe: still exactly one after repeated hooks');
  // The new turn's notification goes to Jordan, and not to Maya (the prior assignee) as a new turn.
  assert.ok(s.state.notifications.some((n) => n.userId === jordan && n.key === rotKey));
  assert.ok(!s.state.notifications.some((n) => n.userId === maya && n.key === rotKey));
});

test('auto-rotation state round-trips through persistence', () => {
  const c = clock(at('2026-03-02'));
  const a = fresh({ now: c.now });
  a.s.startDemo();
  const rot = a.s.memberIds();
  const r = a.s.addChore({ title: 'Rota', notes: '', recurrence: 'weekly', rotate: true, rotation: rot, assigneeId: rot[0], due: a.s.today(), autoRotate: true, cycleDays: 5 });
  assert.ok(r.ok);
  const b = fresh({ storage: a.storage, now: c.now });
  const chore = b.s.state.chores.find((x) => x.title === 'Rota');
  assert.equal(chore.autoRotate, true);
  assert.equal(chore.cycleDays, 5);
  assert.equal(chore.anchorDate, a.s.today());
});
