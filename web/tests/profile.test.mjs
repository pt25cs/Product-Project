import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m }; };
const fresh = (opts = {}) => { const storage = opts.storage || mem(); const s = createStore({ storage, now: opts.now }); s.load(); return { s, storage }; };
const id = (s, name) => s.state.members.find((m) => m.name === name).id;
const profileOf = (s, uid) => s.state.members.find((m) => m.id === uid).profile;
// startDemo seeds sample profiles (Task 14). These suites test updateProfile from a known-empty
// baseline, so reset every member's profile to defaults right after starting the demo.
const demo = (s) => { s.startDemo(); for (const m of s.state.members) m.profile = { dietary: '', budgetCents: null, rules: '' }; return s; };

test('profile shape is seeded on startDemo, and defaults on createHousehold/blank', () => {
  // The demo seeds sample profiles (Task 14) but every member still carries the full shape
  // (dietary/budgetCents/rules) and at least one member is left at defaults for the empty state.
  const { s } = fresh(); s.startDemo();
  for (const m of s.state.members) {
    assert.deepEqual(Object.keys(m.profile).sort(), ['budgetCents', 'dietary', 'rules']);
  }
  assert.ok(
    s.state.members.some((m) => m.profile.dietary === '' && m.profile.budgetCents === null && m.profile.rules === ''),
    'demo leaves at least one member at default profile to show the empty state',
  );
  // New households start every member at clean defaults so existing flows/tests are unaffected.
  const { s: s2 } = fresh();
  s2.createHousehold({ userName: 'Ana', householdName: 'Casa', others: ['Ben', 'Cy'] });
  for (const m of s2.state.members) {
    assert.deepEqual(m.profile, { dietary: '', budgetCents: null, rules: '' });
  }
});

test('updateProfile sets dietary, budget, and rules on the current member', () => {
  const { s } = fresh(); demo(s);
  const maya = id(s, 'Maya');
  const r = s.updateProfile({ dietary: 'Vegetarian, no nuts', budgetCents: '150.50', rules: 'Quiet after 11pm' });
  assert.ok(r.ok);
  const p = profileOf(s, maya);
  assert.equal(p.dietary, 'Vegetarian, no nuts');
  assert.equal(p.budgetCents, 15050);
  assert.equal(p.rules, 'Quiet after 11pm');
});

test('updateProfile only touches fields present in the patch', () => {
  const { s } = fresh(); demo(s);
  const maya = id(s, 'Maya');
  s.updateProfile({ dietary: 'Vegan', budgetCents: '100', rules: 'No loud music' });
  s.updateProfile({ dietary: 'Pescatarian' });
  const p = profileOf(s, maya);
  assert.equal(p.dietary, 'Pescatarian');
  assert.equal(p.budgetCents, 10000); // unchanged
  assert.equal(p.rules, 'No loud music'); // unchanged
});

test('updateProfile trims text and clears budget on empty input', () => {
  const { s } = fresh(); demo(s);
  const maya = id(s, 'Maya');
  s.updateProfile({ budgetCents: '200' });
  assert.equal(profileOf(s, maya).budgetCents, 20000);
  assert.ok(s.updateProfile({ budgetCents: '' }).ok);
  assert.equal(profileOf(s, maya).budgetCents, null);
  s.updateProfile({ dietary: '  Gluten free  ' });
  assert.equal(profileOf(s, maya).dietary, 'Gluten free');
});

test('updateProfile rejects invalid budget amounts with a clear message', () => {
  const { s } = fresh(); demo(s);
  const maya = id(s, 'Maya');
  for (const bad of ['abc', '0', '-5', '1.234']) {
    const r = s.updateProfile({ budgetCents: bad });
    assert.equal(r.ok, false, `expected rejection for ${bad}`);
    assert.ok(r.errors.budgetCents);
  }
  assert.equal(profileOf(s, maya).budgetCents, null); // never mutated by rejected input
});

test('updateProfile rejects over-long text fields', () => {
  const { s } = fresh(); demo(s);
  const maya = id(s, 'Maya');
  const long = 'x'.repeat(301);
  const d = s.updateProfile({ dietary: long });
  assert.equal(d.ok, false);
  assert.ok(d.errors.dietary);
  const r = s.updateProfile({ rules: long });
  assert.equal(r.ok, false);
  assert.ok(r.errors.rules);
  assert.deepEqual(profileOf(s, maya), { dietary: '', budgetCents: null, rules: '' });
});

test("another member's profile is readable (shared-visibility model)", () => {
  const { s } = fresh(); demo(s);
  const maya = id(s, 'Maya'), jordan = id(s, 'Jordan');
  // Jordan sets their profile, then Maya (current user) can read it.
  s.setCurrentUser(jordan);
  s.updateProfile({ dietary: 'Halal', budgetCents: '80', rules: 'No guests past midnight' });
  s.setCurrentUser(maya);
  const p = profileOf(s, jordan);
  assert.equal(p.dietary, 'Halal');
  assert.equal(p.budgetCents, 8000);
  assert.equal(p.rules, 'No guests past midnight');
  // updateProfile only edits the current member — Maya's stays default.
  assert.deepEqual(profileOf(s, maya), { dietary: '', budgetCents: null, rules: '' });
});

test('updateProfile persists across a reload', () => {
  const a = fresh(); a.s.startDemo();
  const maya = id(a.s, 'Maya');
  a.s.updateProfile({ dietary: 'Keto', budgetCents: '120', rules: 'Label your food' });
  const b = fresh({ storage: a.storage });
  const p = b.s.state.members.find((m) => m.id === maya).profile;
  assert.equal(p.dietary, 'Keto');
  assert.equal(p.budgetCents, 12000);
  assert.equal(p.rules, 'Label your food');
});
