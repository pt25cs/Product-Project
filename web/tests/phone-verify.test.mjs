// Task 7 — phone verification logic (Requirement 2) against a FAKE Twilio + FAKE DB (NFR 5).
// No real SMS, no Twilio account needed. Covers start (valid/invalid/collision), check
// (approved/wrong/expired), and that phone_verified is only set server-side on approval.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startVerify, checkVerify } from '../../supabase/functions/_shared/phone-verify.mjs';

// Fake profiles DB supporting the chained calls phone-verify.mjs uses.
function fakeDb(profiles = []) {
  const rows = profiles.slice();
  function q() {
    let filters = [], op = null, payload = null;
    const api = {
      select() { op = op || 'select'; return api; },
      update(p) { op = 'update'; payload = p; return api; },
      eq(c, v) { filters.push([c, v]); return api; },
      _match(r) { return filters.every(([c, v]) => r[c] === v); },
      async maybeSingle() { const m = rows.filter((r) => api._match(r)); return { data: m[0] ?? null, error: null }; },
      then(resolve) {
        if (op === 'update') { rows.filter((r) => api._match(r)).forEach((r) => Object.assign(r, payload)); }
        resolve({ data: null, error: null });
      },
    };
    return api;
  }
  return { from: q, _rows: rows };
}

function fakeTwilio(opts = {}) {
  return {
    started: [],
    checked: [],
    async startVerification(phone) {
      this.started.push(phone);
      if (opts.startThrows) throw new Error(opts.startThrows);
      return { ok: true, status: 'pending' };
    },
    async checkVerification(phone, code) {
      this.checked.push({ phone, code });
      if (opts.checkThrows) throw new Error(opts.checkThrows);
      return { ok: code === (opts.correctCode ?? '123456'), status: code === (opts.correctCode ?? '123456') ? 'approved' : 'pending' };
    },
  };
}

const profile = (uid, extra = {}) => ({ user_id: uid, phone_e164: null, phone_verified: false, ...extra });

test('startVerify rejects a malformed number before calling Twilio (R2.1)', async () => {
  const db = fakeDb([profile('u1')]);
  const tw = fakeTwilio();
  const res = await startVerify(db, tw, 'u1', '555-1234');
  assert.equal(res.ok, false);
  assert.equal(tw.started.length, 0);
});

test('startVerify texts a code for a valid number and stashes it unverified (R2.1)', async () => {
  const db = fakeDb([profile('u1')]);
  const tw = fakeTwilio();
  const res = await startVerify(db, tw, 'u1', '+15555550123');
  assert.equal(res.ok, true);
  assert.equal(tw.started[0], '+15555550123');
  const row = db._rows.find((r) => r.user_id === 'u1');
  assert.equal(row.phone_e164, '+15555550123');
  assert.equal(row.phone_verified, false, 'not verified yet');
});

test('startVerify rejects a number already verified on another account (R2.5)', async () => {
  const db = fakeDb([
    profile('u1'),
    profile('u2', { phone_e164: '+15555550123', phone_verified: true }),
  ]);
  const tw = fakeTwilio();
  const res = await startVerify(db, tw, 'u1', '+15555550123');
  assert.equal(res.ok, false);
  assert.match(res.error, /another account/i);
  assert.equal(tw.started.length, 0);
});

test('startVerify surfaces a Twilio rate-limit error (R2.4)', async () => {
  const db = fakeDb([profile('u1')]);
  const tw = fakeTwilio({ startThrows: 'Too many requests 429' });
  const res = await startVerify(db, tw, 'u1', '+15555550123');
  assert.equal(res.ok, false);
  assert.match(res.error, /too many/i);
});

test('checkVerify approves a correct code and sets phone_verified server-side (R2.2/2.6)', async () => {
  const db = fakeDb([profile('u1', { phone_e164: '+15555550123' })]);
  const tw = fakeTwilio({ correctCode: '123456' });
  const res = await checkVerify(db, tw, 'u1', '123456');
  assert.equal(res.ok, true);
  assert.equal(res.verified, true);
  assert.equal(db._rows.find((r) => r.user_id === 'u1').phone_verified, true);
});

test('checkVerify rejects a wrong code without flipping the flag (R2.3)', async () => {
  const db = fakeDb([profile('u1', { phone_e164: '+15555550123' })]);
  const tw = fakeTwilio({ correctCode: '123456' });
  const res = await checkVerify(db, tw, 'u1', '000000');
  assert.equal(res.ok, false);
  assert.match(res.error, /incorrect or expired/i);
  assert.equal(db._rows.find((r) => r.user_id === 'u1').phone_verified, false);
});

test('checkVerify rejects a non-numeric code locally (R2.2)', async () => {
  const db = fakeDb([profile('u1', { phone_e164: '+15555550123' })]);
  const tw = fakeTwilio();
  const res = await checkVerify(db, tw, 'u1', 'abcd');
  assert.equal(res.ok, false);
  assert.equal(tw.checked.length, 0);
});

test('checkVerify requires a prior start (no stashed number)', async () => {
  const db = fakeDb([profile('u1')]);  // no phone_e164
  const tw = fakeTwilio();
  const res = await checkVerify(db, tw, 'u1', '123456');
  assert.equal(res.ok, false);
  assert.match(res.error, /start phone verification first/i);
});
