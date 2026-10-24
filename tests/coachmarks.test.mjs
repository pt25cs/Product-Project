import test from 'node:test';
import assert from 'node:assert/strict';
import { coachSeen, markCoachSeen, resetCoachmarks } from '../js/tour.js';

// In-memory storage mirroring the localStorage surface used by tour.js.
const mem = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    m,
  };
};

// Storage that throws on every operation (models a blocked/disabled storage, 6.6).
const throwing = () => ({
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
  removeItem() { throw new Error('blocked'); },
});

test('coachmark seen-state is independent per tab (6.3)', () => {
  const storage = mem();
  // Nothing seen initially.
  for (const tab of ['home', 'chores', 'money', 'calendar', 'profile']) {
    assert.equal(coachSeen(storage, tab), false);
  }
  // Mark one tab seen; others stay unseen.
  markCoachSeen(storage, 'money');
  assert.equal(coachSeen(storage, 'money'), true);
  assert.equal(coachSeen(storage, 'home'), false);
  assert.equal(coachSeen(storage, 'chores'), false);
  assert.equal(coachSeen(storage, 'calendar'), false);
  assert.equal(coachSeen(storage, 'profile'), false);

  // Marking a second tab leaves the first intact.
  markCoachSeen(storage, 'home');
  assert.equal(coachSeen(storage, 'home'), true);
  assert.equal(coachSeen(storage, 'money'), true);
  assert.equal(coachSeen(storage, 'chores'), false);
});

test('marking a tab seen twice is idempotent', () => {
  const storage = mem();
  markCoachSeen(storage, 'home');
  markCoachSeen(storage, 'home');
  assert.equal(coachSeen(storage, 'home'), true);
});

test('resetCoachmarks clears all per-tab seen-state (6.4)', () => {
  const storage = mem();
  markCoachSeen(storage, 'home');
  markCoachSeen(storage, 'money');
  markCoachSeen(storage, 'calendar');
  resetCoachmarks(storage);
  for (const tab of ['home', 'chores', 'money', 'calendar', 'profile']) {
    assert.equal(coachSeen(storage, tab), false);
  }
});

test('storage-blocked (throwing) path fails quietly without throwing (6.6)', () => {
  const storage = throwing();
  // None of these should throw.
  assert.doesNotThrow(() => markCoachSeen(storage, 'home'));
  assert.doesNotThrow(() => resetCoachmarks(storage));
  // Reads return a safe default.
  assert.equal(coachSeen(storage, 'home'), false);
});

test('corrupt stored value degrades to unseen without throwing', () => {
  const storage = mem();
  storage.setItem('roomsync.coach.v1', 'not json{');
  assert.doesNotThrow(() => coachSeen(storage, 'home'));
  assert.equal(coachSeen(storage, 'home'), false);
  // A subsequent mark recovers to a valid map.
  markCoachSeen(storage, 'home');
  assert.equal(coachSeen(storage, 'home'), true);
});
