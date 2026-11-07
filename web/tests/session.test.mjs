// Task 8 — session controller (Requirement 1, 9). DOM-free unit tests of the mode state machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../js/session.mjs';

const fakeAuth = (authed) => ({ isAuthenticated: () => authed });

test('no auth configured + no local household => signed-out (R1.1)', () => {
  const s = createSession({ getAuth: () => null, hasLocalHousehold: () => false });
  assert.equal(s.mode(), 'signed-out');
  assert.equal(s.canSignIn(), false); // nothing to sign in to on a pure-demo deploy
  assert.equal(s.showViewingAs(), false);
});

test('entering demo activates the local path without any backend (R8.6)', () => {
  const s = createSession({ getAuth: () => null, hasLocalHousehold: () => false });
  s.enterDemo();
  assert.equal(s.mode(), 'demo');
  assert.equal(s.showViewingAs(), true, 'Viewing as is kept in demo mode (R9.2)');
});

test('an existing local household is treated as demo mode', () => {
  const s = createSession({ getAuth: () => null, hasLocalHousehold: () => true });
  assert.equal(s.mode(), 'demo');
});

test('an authenticated session => authenticated mode, no Viewing as (R9.1)', () => {
  const s = createSession({ getAuth: () => fakeAuth(true), hasLocalHousehold: () => false });
  assert.equal(s.mode(), 'authenticated');
  assert.equal(s.showViewingAs(), false, 'Viewing as is retired when signed in');
  assert.equal(s.canSignIn(), true);
});

test('authenticated takes precedence over a lingering local household', () => {
  const s = createSession({ getAuth: () => fakeAuth(true), hasLocalHousehold: () => true });
  assert.equal(s.mode(), 'authenticated');
});

test('auth configured but not signed in, no local data => signed-out with sign-in offered', () => {
  const s = createSession({ getAuth: () => fakeAuth(false), hasLocalHousehold: () => false });
  assert.equal(s.mode(), 'signed-out');
  assert.equal(s.canSignIn(), true);
});

test('exitDemo returns to signed-out when nothing else is active', () => {
  const s = createSession({ getAuth: () => null, hasLocalHousehold: () => false });
  s.enterDemo();
  assert.equal(s.mode(), 'demo');
  s.exitDemo();
  assert.equal(s.mode(), 'signed-out');
});

test('getAuth is read live: auth wired in after construction is reflected (the boot-timing bug)', () => {
  let live = null;
  const s = createSession({ getAuth: () => live, hasLocalHousehold: () => false });
  assert.equal(s.canSignIn(), false);         // not wired yet at construction
  live = fakeAuth(false);                       // backend becomes ready after boot
  assert.equal(s.canSignIn(), true, 'session sees auth wired in asynchronously');
});
