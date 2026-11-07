import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';
import { createStore } from '../js/store.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m }; };
const fresh = (opts = {}) => { const storage = opts.storage || mem(); const s = createStore({ storage, now: opts.now }); s.load(); return { s, storage }; };
const id = (s, name) => s.state.members.find((m) => m.name === name).id;
// startDemo seeds a sample budget + preferred product/store preference (Task 14). These suites
// test the purchasing-rule logic from a known-empty baseline (but keep the demo's expenses for
// budgetStatus), so reset just the purchasing collection after starting the demo.
const demo = (s) => { s.startDemo(); s.state.purchasing = { budgetCents: null, preferredProducts: [], storePreferences: [] }; return s; };

test('purchasing: budget parse rejects invalid and accepts valid cents', () => {
  const { s } = fresh(); demo(s);
  // Invalid amounts are rejected with a clear message and never written.
  for (const bad of ['0', '-5', '1.234', 'abc']) {
    const r = s.setPurchasingBudget(bad);
    assert.equal(r.ok, false, `expected ${bad} to be rejected`);
    assert.ok(r.error);
  }
  assert.equal(s.state.purchasing.budgetCents, null);
  // Valid money input parses to positive integer cents (same rules as expenses).
  const ok = s.setPurchasingBudget('$300.50');
  assert.ok(ok.ok);
  assert.equal(ok.budgetCents, 30050);
  assert.equal(s.state.purchasing.budgetCents, 30050);
  assert.equal(s.state.purchasing.budgetCents, L.parseMoney('300.50'));
  // Empty value clears the budget (back to display-only "no budget set").
  const cleared = s.setPurchasingBudget('');
  assert.ok(cleared.ok && cleared.cleared);
  assert.equal(s.state.purchasing.budgetCents, null);
});

test('purchasing: budget persists across reload and logs activity', () => {
  const storage = mem();
  const { s } = fresh({ storage });
  demo(s);
  assert.ok(s.setPurchasingBudget('250').ok);
  assert.ok(s.state.activity.some((a) => a.verb === 'set the shared purchasing budget to'));
  // Round-trip through storage (the real save path) keeps the shared budget.
  const { s: s2 } = fresh({ storage });
  assert.equal(s2.state.purchasing.budgetCents, 25000);
});

test('purchasing: budgetStatus reports remaining vs over-budget using monthTotal (display only)', () => {
  const { s } = fresh(); demo(s);
  const spent = s.sel.monthTotal();
  assert.ok(spent > 0, 'demo seeds current-month expenses');

  // No budget set yet: status reflects that, remaining is null, never "over".
  let st = s.sel.budgetStatus();
  assert.equal(st.set, false);
  assert.equal(st.budgetCents, null);
  assert.equal(st.spentCents, spent);
  assert.equal(st.remainingCents, null);
  assert.equal(st.over, false);

  // Budget comfortably above spend -> positive remaining, not over.
  s.setPurchasingBudget(String((spent + 5000) / 100));
  st = s.sel.budgetStatus();
  assert.equal(st.set, true);
  assert.equal(st.spentCents, spent);
  assert.equal(st.remainingCents, st.budgetCents - spent);
  assert.equal(st.remainingCents, 5000);
  assert.equal(st.over, false);

  // Budget below spend -> negative remaining, flagged over (but never blocks).
  s.setPurchasingBudget(String((spent - 1000) / 100));
  st = s.sel.budgetStatus();
  assert.equal(st.over, true);
  assert.equal(st.remainingCents, -1000);
  assert.ok(st.remainingCents < 0);

  // Budget exactly equal to spend -> remaining 0, not over.
  s.setPurchasingBudget(String(spent / 100));
  st = s.sel.budgetStatus();
  assert.equal(st.remainingCents, 0);
  assert.equal(st.over, false);
});

test('purchasing: add preferred products and store preferences (shared, validated)', () => {
  const { s } = fresh(); demo(s);
  const maya = id(s, 'Maya');

  // Empty / whitespace is rejected.
  assert.equal(s.addPreferredProduct('   ').ok, false);
  assert.equal(s.addStorePreference('').ok, false);
  // Length cap (300 chars) is enforced.
  assert.equal(s.addPreferredProduct('x'.repeat(301)).ok, false);
  assert.equal(s.addStorePreference('y'.repeat(301)).ok, false);

  const pp = s.addPreferredProduct('  Seventh Generation dish soap  ');
  assert.ok(pp.ok);
  const sp = s.addStorePreference('Costco for bulk paper goods');
  assert.ok(sp.ok);

  const product = s.state.purchasing.preferredProducts.find((x) => x.id === pp.id);
  assert.equal(product.text, 'Seventh Generation dish soap'); // trimmed
  assert.equal(product.createdBy, maya);
  assert.ok(product.createdAt);
  const store = s.state.purchasing.storePreferences.find((x) => x.id === sp.id);
  assert.equal(store.text, 'Costco for bulk paper goods');
  assert.ok(s.state.activity.some((a) => a.verb === 'added the preferred product'));
  assert.ok(s.state.activity.some((a) => a.verb === 'added the store preference'));
});

test('purchasing: removals are undoable and restore the exact item', () => {
  const { s } = fresh(); demo(s);
  const pp = s.addPreferredProduct('Organic eggs');
  const sp = s.addStorePreference('Trader Joe’s');

  // Remove a preferred product -> gone, undo label set, undo restores it.
  assert.ok(s.removePreferredProduct(pp.id).ok);
  assert.equal(s.state.purchasing.preferredProducts.some((x) => x.id === pp.id), false);
  assert.ok(s.undoLabel);
  assert.ok(s.undoLast());
  assert.equal(s.state.purchasing.preferredProducts.some((x) => x.id === pp.id), true);

  // Same for a store preference.
  assert.ok(s.removeStorePreference(sp.id).ok);
  assert.equal(s.state.purchasing.storePreferences.some((x) => x.id === sp.id), false);
  assert.ok(s.undoLast());
  assert.equal(s.state.purchasing.storePreferences.some((x) => x.id === sp.id), true);

  // Removing something that isn't there fails cleanly.
  assert.equal(s.removePreferredProduct('nope').ok, false);
  assert.equal(s.removeStorePreference('nope').ok, false);
});
