// Dummy ("mock") Supabase-shaped client for local use — NO network, NO real accounts.
//
// Why this exists: real Google sign-in needs a Supabase project + Google OAuth client. This
// module stands in for that client so the whole authenticated path (sign-in, create / join /
// import a household, profile sync, sign-out) can be completed with dummy values. It implements
// only the slice of the @supabase/supabase-js surface Kasa actually calls:
//   client.auth.{getSession,onAuthStateChange,signInWithOAuth,signOut,refreshSession}
//   client.functions.invoke('household' | 'migrate-import' | 'phone-verify-start' | 'phone-verify-check')
//   client.from(table).select/eq/limit/insert/update/upsert/maybeSingle/single
//
// Data lives in the browser's localStorage (keys below), shaped like the server tables, with a
// tiny emulation of row-level security (you only see households you belong to). Nothing here is
// secure and nothing leaves the device. It is used only when web/js/config.js has no real
// Supabase values (see tryInitBackend in app.js).
import { createStore } from './store.js';

export const MOCK_DB_KEY = 'kasa.mock.db.v1';
export const MOCK_SESSION_KEY = 'kasa.mock.session.v1';

/** The one dummy identity every mock sign-in resolves to. */
export const DUMMY_USER = { id: 'mock-user-0001', email: 'dummy.user@example.com' };

const CONTENT_TABLES = ['chores', 'occurrences', 'expenses', 'reimbursements', 'shopping', 'events',
  'expectations', 'swaps', 'notifications', 'activity', 'prefs', 'purchasing'];
const TABLES = ['households', 'memberships', 'profiles', 'invitations', 'imports', ...CONTENT_TABLES];

let seq = 0;
const newId = (p) => `${p}-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const nowISO = () => new Date().toISOString();
const clone = (x) => JSON.parse(JSON.stringify(x));

export function createMockClient({ storage, latencyMs = 0, user = DUMMY_USER } = {}) {
  // ---------- persistence ----------
  const read = (key, fallback) => { try { const raw = storage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };
  const write = (key, val) => { try { storage.setItem(key, JSON.stringify(val)); } catch { /* storage blocked: in-memory only */ } };
  const emptyDb = () => Object.fromEntries(TABLES.map((t) => [t, []]));
  let db = { ...emptyDb(), ...read(MOCK_DB_KEY, {}) };
  const saveDb = () => write(MOCK_DB_KEY, db);
  const pause = () => (latencyMs ? new Promise((r) => setTimeout(r, latencyMs)) : Promise.resolve());

  // ---------- auth ----------
  let session = read(MOCK_SESSION_KEY, null);
  const listeners = new Set();
  const publish = (event) => listeners.forEach((fn) => fn(event, session));
  const makeSession = (phoneVerified) => ({
    access_token: 'mock-token', refresh_token: 'mock-refresh',
    user: { id: user.id, email: user.email, user_metadata: { phone_verified: !!phoneVerified, full_name: 'Dummy User' } },
  });
  const uid = () => session?.user?.id ?? null;

  const auth = {
    async getSession() { return { data: { session }, error: null }; },
    onAuthStateChange(cb) {
      listeners.add(cb);
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
    },
    // No redirect, no popup: "Continue with Google" simply signs in as the dummy user.
    async signInWithOAuth({ provider } = {}) {
      await pause();
      session = makeSession(read('kasa.mock.phone', false));
      write(MOCK_SESSION_KEY, session);
      publish('SIGNED_IN');
      return { data: { provider: provider || 'google', url: null }, error: null };
    },
    async signOut() {
      session = null;
      try { storage.removeItem(MOCK_SESSION_KEY); } catch { /* ignore */ }
      publish('SIGNED_OUT');
      return { error: null };
    },
    async refreshSession() {
      if (!session) return { data: { session: null }, error: { message: 'No session' } };
      session = makeSession(read('kasa.mock.phone', false));
      write(MOCK_SESSION_KEY, session);
      return { data: { session }, error: null };
    },
  };

  // ---------- row-level-security emulation ----------
  const myHouseholdIds = () => new Set(db.memberships.filter((m) => m.user_id === uid()).map((m) => m.household_id));
  function visibleRows(table) {
    if (!uid()) return [];
    const hids = myHouseholdIds();
    if (table === 'households') return db.households.filter((h) => hids.has(h.id));
    if (table === 'household_profiles') {
      // Teammates' profile fields, as the real view exposes them: only people who share a household.
      const peers = new Set(db.memberships.filter((m) => hids.has(m.household_id) && m.user_id).map((m) => m.user_id));
      return db.profiles.filter((p) => peers.has(p.user_id));
    }
    if (table === 'profiles') return db.profiles.filter((p) => p.user_id === uid());
    if (table === 'invitations' || table === 'imports') return db[table].filter((r) => hids.has(r.household_id));
    return (db[table] || []).filter((r) => hids.has(r.household_id));
  }

  // ---------- minimal query builder (thenable, like supabase-js) ----------
  function from(table) {
    const q = { op: 'select', filters: [], max: null, payload: null, single: null, onConflict: null };
    const run = async () => {
      await pause();
      if (!uid()) return { data: null, error: { message: 'Not authenticated' } };
      const known = TABLES.includes(table) || table === 'household_profiles';
      if (!known) return { data: null, error: { message: `Unknown table ${table}` } };
      const match = (r) => q.filters.every(([c, v]) => r[c] === v);
      let rows;
      if (q.op === 'select') {
        rows = visibleRows(table).filter(match);
        if (q.max != null) rows = rows.slice(0, q.max);
      } else if (q.op === 'insert') {
        rows = (Array.isArray(q.payload) ? q.payload : [q.payload]).map((r) => ({ id: newId('row'), created_at: nowISO(), ...r }));
        db[table].push(...rows);
        saveDb();
      } else if (q.op === 'update') {
        rows = visibleRows(table).filter(match);
        rows.forEach((r) => Object.assign(r, q.payload));
        saveDb();
      } else if (q.op === 'upsert') {
        // Only `profiles` (keyed by user_id) is upserted by the client; the caller owns the row.
        const row = q.payload;
        if (table === 'profiles' && row.user_id !== uid()) return { data: null, error: { message: 'Not allowed' } };
        const key = q.onConflict || 'user_id';
        const i = db[table].findIndex((r) => r[key] === row[key]);
        if (i >= 0) Object.assign(db[table][i], row, { updated_at: nowISO() }); else db[table].push({ created_at: nowISO(), ...row });
        saveDb();
        rows = [row];
      }
      rows = clone(rows || []);
      if (q.single === 'one') return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'Expected a single row' } };
      if (q.single === 'maybe') return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    };
    const api = {
      select() { return api; },   // after insert/update this just requests the rows back
      eq(col, val) { q.filters.push([col, val]); return api; },
      limit(n) { q.max = n; return api; },
      insert(p) { q.op = 'insert'; q.payload = p; return api; },
      update(p) { q.op = 'update'; q.payload = p; return api; },
      upsert(p, opts) { q.op = 'upsert'; q.payload = p; q.onConflict = opts?.onConflict || null; return api; },
      maybeSingle() { q.single = 'maybe'; return api; },
      single() { q.single = 'one'; return api; },
      then(res, rej) { return run().then(res, rej); },
    };
    return api;
  }

  // ---------- "edge functions" ----------
  const MAX_MEMBERS = 5;
  const myMembership = (hid) => db.memberships.find((m) => m.household_id === hid && m.user_id === uid());

  function createHousehold({ name, displayName }) {
    const n = String(name || '').trim(), dn = String(displayName || '').trim();
    if (!n || n.length > 60) return { ok: false, error: 'Give your household a name (1–60 characters).' };
    if (!dn || dn.length > 30) return { ok: false, error: 'Enter your display name (1–30 characters).' };
    const hid = newId('hh');
    db.households.push({ id: hid, name: n, created_by: uid(), created_at: nowISO() });
    db.memberships.push({ id: newId('mem'), household_id: hid, user_id: uid(), role: 'owner', display_name: dn, claimed: true, created_at: nowISO() });
    saveDb();
    return { ok: true, householdId: hid };
  }

  function createInvitation({ householdId }) {
    if (!myMembership(householdId)) return { ok: false, error: 'Only a member can invite to this household.' };
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    db.invitations.push({ id: newId('inv'), household_id: householdId, code, created_by: uid(), accepted_by: null, created_at: nowISO() });
    saveDb();
    return { ok: true, code };
  }

  // Dummy-friendly join: a code from a mock invitation joins that household; ANY other
  // non-empty code joins a freshly seeded sample household (the demo roommates and data), so
  // the join screen can always be completed without a real invite.
  function acceptInvitation({ code, displayName }) {
    const c = String(code || '').trim().toUpperCase();
    if (!c) return { ok: false, error: 'Enter an invitation code.' };
    const dn = String(displayName || '').trim().slice(0, 30);
    const inv = db.invitations.find((i) => i.code === c);
    if (inv) {
      if (inv.accepted_by) return { ok: false, error: 'This invitation has already been used.' };
      if (myMembership(inv.household_id)) return { ok: false, error: 'You are already a member of this household.' };
      if (db.memberships.filter((m) => m.household_id === inv.household_id).length >= MAX_MEMBERS) return { ok: false, error: 'This household is full.' };
      db.memberships.push({ id: newId('mem'), household_id: inv.household_id, user_id: uid(), role: 'member', display_name: dn || 'Roommate', claimed: true, created_at: nowISO() });
      inv.accepted_by = uid();
      saveDb();
      return { ok: true, householdId: inv.household_id };
    }
    const mem = new Map();
    const seed = createStore({ storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) } });
    seed.load(); seed.startDemo();
    const local = seed.state;
    // You take the place of a sample roommate (the demo's "Maya") and keep the others as housemates.
    const res = importHousehold({ local, meLocalId: local.currentUserId, sourceSignature: `sample:${newId('s')}` }, 'Sample household');
    if (res.ok && dn) {
      const m = db.memberships.find((x) => x.household_id === res.householdId && x.user_id === uid());
      if (m) { m.display_name = dn; saveDb(); }
    }
    return res;
  }

  // Maps a normalized local household (v1 state) to server-shaped rows. Mirrors
  // supabase/functions/_shared/migrate.mjs#buildImportPlan (that file can't be imported here:
  // the browser only serves web/, and the edge function bundle can't import from web/).
  function importHousehold({ local, meLocalId, sourceSignature }, nameOverride) {
    if (!local || !local.household || !Array.isArray(local.members)) return { ok: false, error: 'Local data is not a recognized household.' };
    const prior = db.imports.find((i) => i.signature === sourceSignature && i.user_id === uid());
    if (prior) return { ok: true, householdId: prior.household_id, alreadyImported: true };
    const me = local.members.find((m) => m.id === meLocalId) || local.members[0];
    const hid = newId('hh');
    const rows = (list, f) => (list || []).map((x) => ({ id: newId('row'), household_id: hid, created_at: nowISO(), ...f(x) }));
    db.households.push({ id: hid, name: nameOverride || local.household.name, created_by: uid(), created_at: nowISO() });
    db.memberships.push(...local.members.map((m) => ({
      id: newId('mem'), household_id: hid, client_id: m.id, user_id: m.id === me.id ? uid() : null,
      claimed: m.id === me.id, role: m.id === me.id ? 'owner' : 'member', display_name: (m.name || 'Roommate').slice(0, 30), created_at: nowISO(),
    })));
    const p = me.profile || {};
    const i = db.profiles.findIndex((r) => r.user_id === uid());
    const profile = { user_id: uid(), display_name: (me.name || '').slice(0, 30), dietary: p.dietary || '', budget_cents: Number.isInteger(p.budgetCents) ? p.budgetCents : null, rules: p.rules || '' };
    if (i >= 0) Object.assign(db.profiles[i], profile); else db.profiles.push(profile);
    db.chores.push(...rows(local.chores, (c) => ({ client_id: c.id, title: c.title, notes: c.notes || '', recurrence: c.recurrence, rotation: c.rotation || [], auto_rotate: !!c.autoRotate, anchor_date: c.anchorDate ?? null, cycle_days: c.cycleDays ?? 7, start_idx: c.startIdx ?? 0 })));
    db.occurrences.push(...rows(local.occurrences, (o) => ({ client_id: o.id, chore_client_id: o.choreId, title: o.title, notes: o.notes || '', due: o.due, assignee_id: o.assigneeId ?? null, rot_idx: o.rotIdx ?? null, done_by: o.doneBy ?? null, done_at: o.doneAt ?? null, next_occ_id: o.nextOccId ?? null, manual_override: !!o.manualOverride })));
    db.expenses.push(...rows(local.expenses, (e) => ({ client_id: e.id, description: e.description, amount_cents: e.amountCents, date: e.date, payer_id: e.payerId, participant_ids: e.participantIds || [], splits: e.splits || {}, shopping_item_id: e.shoppingItemId ?? null, token: e.token ?? null })));
    db.reimbursements.push(...rows(local.reimbursements, (r) => ({ client_id: r.id, from_id: r.fromId, to_id: r.toId, amount_cents: r.amountCents, date: r.date, note: r.note || '', token: r.token ?? null })));
    db.shopping.push(...rows(local.shopping, (s) => ({ client_id: s.id, name: s.name, qty: s.qty || '1', notes: s.notes || '', buyer_id: s.buyerId ?? null, status: s.status, purchased_by: s.purchasedBy ?? null, purchased_at: s.purchasedAt ?? null, expense_id: s.expenseId ?? null })));
    db.events.push(...rows(local.events, (ev) => ({ client_id: ev.id, title: ev.title, category: ev.category, creator_id: ev.creatorId, start: ev.start, end: ev.end, notes: ev.notes || '' })));
    db.expectations.push(...rows(local.expectations, (x) => ({ client_id: x.id, text: x.text, created_by: x.createdBy ?? null, updated_by: x.updatedBy ?? null })));
    db.swaps.push(...rows(local.swaps, (sw) => ({ client_id: sw.id, kind: sw.kind, occ_id: sw.occId ?? null, target_occ_id: sw.targetOccId ?? null, requester_id: sw.requesterId ?? null, addressee_id: sw.addresseeId ?? null, status: sw.status, resolved_by: sw.resolvedBy ?? null, resolved_at: sw.resolvedAt ?? null })));
    db.notifications.push(...rows(local.notifications, (n) => ({ client_id: n.id, user_id: n.userId, type: n.type, title: n.title, body: n.body || '', link: n.link || '#/home', key: n.key ?? null, read: !!n.read })));
    db.activity.push(...rows(local.activity, (a) => ({ client_id: a.id, actor_id: a.actorId ?? null, verb: a.verb, subject: a.subject || '', link: a.link ?? null, ref: a.ref ?? null })));
    db.prefs.push(...rows(Object.entries(local.prefs || {}), ([userId, data]) => ({ user_id: userId, data })));
    const pu = local.purchasing || {};
    db.purchasing.push({ id: newId('row'), household_id: hid, budget_cents: pu.budgetCents ?? null, preferred_products: pu.preferredProducts || [], store_preferences: pu.storePreferences || [] });
    db.imports.push({ id: newId('imp'), household_id: hid, user_id: uid(), signature: sourceSignature });
    saveDb();
    return { ok: true, householdId: hid };
  }

  // Phone verification: no SMS is sent. Any well-formed number is accepted, and any 4–8 digit
  // code verifies it (auth.js already validates the formats before calling these).
  const functions = {
    async invoke(name, { body } = {}) {
      await pause();
      if (!uid()) return { data: { error: 'Not authenticated' }, error: null };
      let data;
      switch (name) {
        case 'household':
          data = body?.action === 'create' ? createHousehold(body)
            : body?.action === 'invite' ? createInvitation(body)
              : body?.action === 'accept' ? acceptInvitation(body)
                : { ok: false, error: 'Unknown action' };
          break;
        case 'migrate-import': data = importHousehold(body || {}); break;
        case 'phone-verify-start': data = { ok: true, dummy: true }; break;
        case 'phone-verify-check': write('kasa.mock.phone', true); data = { ok: true }; break;
        default: return { data: null, error: { message: `Unknown function ${name}` } };
      }
      return { data, error: null };
    },
  };

  /** Wipe all dummy data and sign out (handy from the console: __kasaMock.reset()). */
  function reset() {
    db = emptyDb();
    try { storage.removeItem(MOCK_DB_KEY); storage.removeItem(MOCK_SESSION_KEY); storage.removeItem('kasa.mock.phone'); } catch { /* ignore */ }
    session = null;
    publish('SIGNED_OUT');
  }

  return { auth, functions, from, isMock: true, reset };
}
