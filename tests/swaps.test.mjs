import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m }; };
const fresh = (opts = {}) => { const storage = opts.storage || mem(); const s = createStore({ storage, now: opts.now }); s.load(); return { s, storage }; };
const id = (s, name) => s.state.members.find((m) => m.name === name).id;
const occFor = (s, title) => s.state.occurrences.find((o) => o.title === title && !o.doneAt);

// Build a predictable household: Maya owns "Mop"; Jordan owns "Dishes"; Priya owns "Trash".
function setup() {
  const { s } = fresh(); s.startDemo();
  const [maya, jordan, priya] = ['Maya', 'Jordan', 'Priya'].map((n) => id(s, n));
  const t = s.today();
  assert.ok(s.addChore({ title: 'Mop', assigneeId: maya, due: t, recurrence: 'once', notes: '' }).ok);
  assert.ok(s.addChore({ title: 'Dishes', assigneeId: jordan, due: t, recurrence: 'once', notes: '' }).ok);
  assert.ok(s.addChore({ title: 'Trash', assigneeId: priya, due: t, recurrence: 'once', notes: '' }).ok);
  return { s, maya, jordan, priya };
}

test('open swap: request notifies household, accept reassigns and notifies requester', () => {
  const { s, maya, jordan } = setup();
  const mop = occFor(s, 'Mop');
  // Maya posts an open request for her Mop occurrence.
  const r = s.requestOpenSwap(mop.id);
  assert.ok(r.ok);
  assert.equal(s.sel.outgoingSwaps().length, 1);
  // Household (not the actor) is notified.
  assert.ok(s.state.notifications.some((n) => n.userId === jordan && n.key === `swap:open:${r.id}`));
  assert.ok(!s.state.notifications.some((n) => n.userId === maya && n.key === `swap:open:${r.id}`));
  // Jordan accepts -> occurrence reassigned to Jordan, request resolved, Maya notified.
  s.setCurrentUser(jordan);
  assert.equal(s.sel.openSwaps().length, 1);
  assert.ok(s.acceptOpenSwap(r.id).ok);
  const after = s.state.occurrences.find((o) => o.id === mop.id);
  assert.equal(after.assigneeId, jordan);
  assert.equal(after.manualOverride, true); // 2.9 / 1.4
  assert.equal(s.state.swaps.find((x) => x.id === r.id).status, 'accepted');
  assert.ok(s.state.notifications.some((n) => n.userId === maya && n.key === `swap:accepted:${r.id}`));
  assert.ok(s.state.activity.some((a) => a.verb === 'took'));
});

test('open swap: a second accept is rejected with an explanation (no double assignment)', () => {
  const { s, maya, jordan, priya } = setup();
  const mop = occFor(s, 'Mop');
  const r = s.requestOpenSwap(mop.id);
  s.setCurrentUser(jordan);
  assert.ok(s.acceptOpenSwap(r.id).ok);
  // Priya tries to accept the already-resolved request.
  s.setCurrentUser(priya);
  const second = s.acceptOpenSwap(r.id);
  assert.equal(second.ok, false);
  assert.match(second.error, /resolved|cancelled/i);
  // Still assigned to Jordan only.
  assert.equal(s.state.occurrences.find((o) => o.id === mop.id).assigneeId, jordan);
  assert.ok(maya);
});

test('open swap: the requester cannot accept their own request', () => {
  const { s } = setup();
  const r = s.requestOpenSwap(occFor(s, 'Mop').id);
  const res = s.acceptOpenSwap(r.id); // still Maya (the requester)
  assert.equal(res.ok, false);
});

test('open swap: cancel marks cancelled and leaves the occurrence with the requester', () => {
  const { s, maya } = setup();
  const mop = occFor(s, 'Mop');
  const r = s.requestOpenSwap(mop.id);
  assert.ok(s.cancelSwap(r.id).ok);
  assert.equal(s.state.swaps.find((x) => x.id === r.id).status, 'cancelled');
  assert.equal(s.state.occurrences.find((o) => o.id === mop.id).assigneeId, maya); // 2.4
  // Cancelling again is rejected.
  assert.equal(s.cancelSwap(r.id).ok, false);
});

test('ownership: cannot request a swap for a chore assigned to someone else', () => {
  const { s } = setup();
  const dishes = occFor(s, 'Dishes'); // Jordan's
  const res = s.requestOpenSwap(dishes.id); // current user is Maya
  assert.equal(res.ok, false); // 2.10
});

test('direct swap: accept swaps both assignees atomically and notifies the proposer', () => {
  const { s, maya, jordan } = setup();
  const mop = occFor(s, 'Mop');       // Maya
  const dishes = occFor(s, 'Dishes'); // Jordan
  const r = s.proposeDirectSwap(mop.id, dishes.id);
  assert.ok(r.ok);
  // Addressee (Jordan) is notified; proposer (Maya) is not.
  assert.ok(s.state.notifications.some((n) => n.userId === jordan && n.key === `swap:direct:${r.id}`));
  s.setCurrentUser(jordan);
  assert.equal(s.sel.incomingSwaps().length, 1);
  assert.ok(s.respondDirectSwap(r.id, true).ok);
  // Atomic swap: Jordan now owns Mop, Maya now owns Dishes.
  assert.equal(s.state.occurrences.find((o) => o.id === mop.id).assigneeId, jordan);
  assert.equal(s.state.occurrences.find((o) => o.id === dishes.id).assigneeId, maya);
  assert.equal(s.state.occurrences.find((o) => o.id === mop.id).manualOverride, true);
  assert.equal(s.state.occurrences.find((o) => o.id === dishes.id).manualOverride, true);
  assert.equal(s.state.swaps.find((x) => x.id === r.id).status, 'accepted');
  assert.ok(s.state.notifications.some((n) => n.userId === maya && n.key === `swap:accepted:${r.id}`));
});

test('direct swap: decline leaves both occurrences unchanged and notifies the proposer', () => {
  const { s, maya, jordan } = setup();
  const mop = occFor(s, 'Mop');
  const dishes = occFor(s, 'Dishes');
  const r = s.proposeDirectSwap(mop.id, dishes.id);
  s.setCurrentUser(jordan);
  const res = s.respondDirectSwap(r.id, false);
  assert.ok(res.ok && res.declined);
  assert.equal(s.state.occurrences.find((o) => o.id === mop.id).assigneeId, maya); // unchanged (2.7)
  assert.equal(s.state.occurrences.find((o) => o.id === dishes.id).assigneeId, jordan);
  assert.equal(s.state.swaps.find((x) => x.id === r.id).status, 'declined');
  assert.ok(s.state.notifications.some((n) => n.userId === maya && n.key === `swap:declined:${r.id}`));
});

test('direct swap: only the addressee can respond', () => {
  const { s, priya } = setup();
  const r = s.proposeDirectSwap(occFor(s, 'Mop').id, occFor(s, 'Dishes').id);
  s.setCurrentUser(priya); // not the addressee (Jordan)
  assert.equal(s.respondDirectSwap(r.id, true).ok, false); // 2.10
});

test('invalidation: completing an occurrence invalidates its pending open swap', () => {
  const { s } = setup();
  const mop = occFor(s, 'Mop');
  const r = s.requestOpenSwap(mop.id);
  assert.ok(s.completeChore(mop.id).ok);
  assert.equal(s.state.swaps.find((x) => x.id === r.id).status, 'invalidated'); // 2.8
});

test('invalidation: deleting a chore invalidates its pending swap', () => {
  const { s } = setup();
  const mop = occFor(s, 'Mop');
  const r = s.requestOpenSwap(mop.id);
  assert.ok(s.deleteChore(mop.id).ok);
  assert.equal(s.state.swaps.find((x) => x.id === r.id).status, 'invalidated'); // 2.8
});

test('invalidation: reassigning an occurrence invalidates a pending direct proposal that references it', () => {
  const { s, priya } = setup();
  const mop = occFor(s, 'Mop');
  const dishes = occFor(s, 'Dishes');
  const r = s.proposeDirectSwap(mop.id, dishes.id);
  // Maya reassigns Mop to Priya -> the proposal referencing Mop is invalidated.
  assert.ok(s.reassignChore(mop.id, priya).ok);
  assert.equal(s.state.swaps.find((x) => x.id === r.id).status, 'invalidated'); // 2.8
});

test('invalidation: accepting an open swap whose occurrence already moved fails cleanly', () => {
  const { s, jordan, priya } = setup();
  const mop = occFor(s, 'Mop');
  const r = s.requestOpenSwap(mop.id);
  // Maya reassigns the occurrence to Priya (invalidates the request).
  assert.ok(s.reassignChore(mop.id, priya).ok);
  s.setCurrentUser(jordan);
  const res = s.acceptOpenSwap(r.id);
  assert.equal(res.ok, false);
  // Occurrence stays with Priya; no double assignment.
  assert.equal(s.state.occurrences.find((o) => o.id === mop.id).assigneeId, priya);
});

test('swap state and resolutions survive a reload (persistence)', () => {
  const a = fresh(); a.s.startDemo();
  const maya = id(a.s, 'Maya'), jordan = id(a.s, 'Jordan');
  const t = a.s.today();
  a.s.addChore({ title: 'Mop', assigneeId: maya, due: t, recurrence: 'once', notes: '' });
  const mop = occFor(a.s, 'Mop');
  const r = a.s.requestOpenSwap(mop.id);
  a.s.setCurrentUser(jordan);
  a.s.acceptOpenSwap(r.id);
  const b = fresh({ storage: a.storage });
  const sw = b.s.state.swaps.find((x) => x.id === r.id);
  assert.equal(sw.status, 'accepted');
  assert.equal(b.s.state.occurrences.find((o) => o.id === mop.id).assigneeId, jordan);
});
