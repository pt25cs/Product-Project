import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m }; };
const fresh = (opts = {}) => { const storage = opts.storage || mem(); const s = createStore({ storage, now: opts.now }); s.load(); return { s, storage }; };
const id = (s, name) => s.state.members.find((m) => m.name === name).id;
// startDemo seeds sample v2 fixtures (Task 14). These suites test the add/edit/remove logic
// from a known-empty expectations baseline, so clear just that collection after starting the demo.
const demo = (s) => { s.startDemo(); s.state.expectations.length = 0; return s; };

test('expectations: add persists shared state with authorship', () => {
  const { s } = fresh(); demo(s);
  const maya = id(s, 'Maya');
  assert.deepEqual(s.state.expectations, []);
  const r = s.addExpectation('Quiet after 11pm');
  assert.ok(r.ok);
  assert.equal(s.state.expectations.length, 1);
  const e = s.state.expectations[0];
  assert.equal(e.id, r.id);
  assert.equal(e.text, 'Quiet after 11pm');
  assert.equal(e.createdBy, maya);
  assert.equal(e.updatedBy, maya);
  assert.ok(e.createdAt);
  assert.ok(e.updatedAt);
  // shared data, visible regardless of "Viewing as"
  s.setCurrentUser(id(s, 'Jordan'));
  assert.equal(s.state.expectations.length, 1);
  // activity records the change
  assert.ok(s.state.activity.some((a) => a.verb === 'added the expectation' && a.subject === 'Quiet after 11pm'));
});

test('expectations: text is trimmed and empty/whitespace is rejected', () => {
  const { s } = fresh(); demo(s);
  assert.equal(s.addExpectation('').ok, false);
  assert.equal(s.addExpectation('   ').ok, false);
  assert.equal(s.state.expectations.length, 0);
  const r = s.addExpectation('  Dishes done same day  ');
  assert.ok(r.ok);
  assert.equal(s.state.expectations[0].text, 'Dishes done same day');
});

test('expectations: length over 300 chars is rejected with a clear message', () => {
  const { s } = fresh(); demo(s);
  const long = 'x'.repeat(301);
  const r = s.addExpectation(long);
  assert.equal(r.ok, false);
  assert.match(r.error, /300/);
  assert.equal(s.state.expectations.length, 0);
  // exactly 300 is allowed (boundary)
  assert.ok(s.addExpectation('y'.repeat(300)).ok);
});

test('expectations: edit updates text and tracks who/when, rejects bad input', () => {
  const { s } = fresh(); demo(s);
  const maya = id(s, 'Maya'), jordan = id(s, 'Jordan');
  const r = s.addExpectation('Take shoes off inside');
  const created = s.state.expectations[0].createdAt;
  s.setCurrentUser(jordan);
  assert.equal(s.editExpectation('nope', 'x').ok, false);
  assert.equal(s.editExpectation(r.id, '').ok, false);
  assert.equal(s.editExpectation(r.id, 'z'.repeat(301)).ok, false);
  assert.ok(s.editExpectation(r.id, 'Shoes off by the door').ok);
  const e = s.state.expectations[0];
  assert.equal(e.text, 'Shoes off by the door');
  assert.equal(e.createdBy, maya);
  assert.equal(e.createdAt, created);
  assert.equal(e.updatedBy, jordan);
  assert.ok(s.state.activity.some((a) => a.verb === 'updated the expectation'));
});

test('expectations: remove deletes and supports one-step undo', () => {
  const { s } = fresh(); demo(s);
  const a = s.addExpectation('No dishes in the sink overnight');
  const b = s.addExpectation('Label shared food');
  assert.equal(s.state.expectations.length, 2);
  assert.equal(s.removeExpectation('missing').ok, false);
  assert.ok(s.removeExpectation(a.id).ok);
  assert.equal(s.state.expectations.length, 1);
  assert.equal(s.state.expectations[0].id, b.id);
  assert.equal(s.undoLabel, 'Removed expectation “No dishes in the sink overnight”');
  assert.ok(s.undoLast());
  assert.equal(s.state.expectations.length, 2);
  assert.ok(s.state.expectations.some((x) => x.id === a.id && x.text === 'No dishes in the sink overnight'));
});

test('expectations: survive a persistence round-trip', () => {
  const a = fresh(); demo(a.s);
  a.s.addExpectation('Rent reminders in the group chat');
  const b = fresh({ storage: a.storage });
  assert.equal(b.s.state.expectations.length, 1);
  assert.equal(b.s.state.expectations[0].text, 'Rent reminders in the group chat');
});
