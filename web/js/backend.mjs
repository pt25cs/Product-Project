// Supabase-backed adapter implementing the store's `backend` interface (Requirement 8).
// Constructed ONLY on the authenticated path (when config + a session exist); the demo path
// never imports or builds this. Kept small; the heavy lifting (RLS, transactions) is server-side.
//
// The store expects: loadHousehold(), saveHousehold(state, meta), currentUserId().
//
// Note: this adapter maps the single in-memory `state` blob to/from the normalized server
// tables. For Phase 2 we load the authenticated user's one household and persist mutations
// through; real-time multi-device convergence is Phase 5 (see spec scope boundary).

export function createBackend({ client, auth, invokeMigration }) {
  // `client` is a Supabase browser client (anon key + the user's session).
  // `auth` is the createAuth(...) instance (for currentUserId / token).

  function currentUserId() {
    const u = auth.currentUser();
    // The store uses membership client_ids; for authenticated households we expose the
    // signed-in user's membership id, resolved during loadHousehold and cached here.
    return u ? (cachedMembershipId || u.id) : null;
  }

  let cachedMembershipId = null;
  let cachedHouseholdId = null;

  /** Load the signed-in user's household into the client state shape, or null if none yet. */
  async function loadHousehold() {
    const { data: memberships, error: mErr } = await client
      .from('memberships')
      .select('household_id')
      .limit(1);
    if (mErr) throw mErr;
    if (!memberships || !memberships.length) return null; // no household yet (create/join flow)

    const hid = memberships[0].household_id;
    cachedHouseholdId = hid;

    // Pull every collection scoped to this household (RLS guarantees it's ours).
    const tables = ['households', 'memberships', 'profiles', 'chores', 'occurrences', 'expenses',
      'reimbursements', 'shopping', 'events', 'expectations', 'purchasing', 'swaps',
      'notifications', 'activity', 'prefs'];
    const results = {};
    for (const t of tables) {
      const { data, error } = t === 'households'
        ? await client.from(t).select('*').eq('id', hid)
        : t === 'profiles'
          ? await client.from('household_profiles').select('*')
          : await client.from(t).select('*').eq('household_id', hid);
      if (error) throw error;
      results[t] = data || [];
    }

    // Resolve the signed-in user's membership client_id (used as me()).
    const u = auth.currentUser();
    const myMem = (results.memberships || []).find((m) => m.user_id === (u && u.id));
    cachedMembershipId = myMem ? (myMem.client_id || myMem.id) : null;

    return assembleState(results, hid);
  }

  /** Persist the current state. For Phase 2 this upserts the mutated collections for the household. */
  async function saveHousehold(state /*, meta */) {
    if (!cachedHouseholdId) return; // nothing to persist against yet
    // A full, robust diff/sync is Phase 5. Here we rely on the server as source of truth for
    // identity/profile; broad collection sync is intentionally out of Phase 2 scope. We persist
    // the profile (the Phase 2 portable datum) via upsert; other collections are written by their
    // own server operations in later phases. This keeps Phase 2 focused (see spec NFR 8).
    const u = auth.currentUser();
    const meRow = (state.members || []).find((m) => (m.id === cachedMembershipId));
    if (u && meRow && meRow.profile) {
      const p = meRow.profile;
      const { error } = await client.from('profiles').upsert({
        user_id: u.id,
        dietary: p.dietary || '',
        budget_cents: Number.isInteger(p.budgetCents) ? p.budgetCents : null,
        rules: p.rules || '',
      });
      if (error) throw error;
    }
  }

  return { loadHousehold, saveHousehold, currentUserId, migrateImport: invokeMigration };
}

// Map server rows back to the client `state` shape (inverse of the migration mapper).
function assembleState(r, hid) {
  const hh = r.households[0] || { id: hid, name: 'Household' };
  const members = (r.memberships || []).map((m) => {
    const prof = (r.profiles || []).find((p) => p.user_id === m.user_id) || {};
    return {
      id: m.client_id || m.id,
      name: m.display_name,
      profile: { dietary: prof.dietary || '', budgetCents: prof.budget_cents ?? null, rules: prof.rules || '' },
    };
  });
  const purch = r.purchasing[0] || { budget_cents: null, preferred_products: [], store_preferences: [] };
  return {
    version: 1,
    mode: 'account',
    household: { id: hh.id, name: hh.name, createdAt: hh.created_at },
    members,
    currentUserId: members[0] ? members[0].id : null,
    chores: (r.chores || []).map((c) => ({ id: c.client_id || c.id, title: c.title, notes: c.notes, recurrence: c.recurrence, rotation: c.rotation, autoRotate: c.auto_rotate, anchorDate: c.anchor_date, cycleDays: c.cycle_days, startIdx: c.start_idx, createdBy: null, createdAt: c.created_at })),
    occurrences: (r.occurrences || []).map((o) => ({ id: o.client_id || o.id, choreId: o.chore_client_id, title: o.title, notes: o.notes, due: o.due, assigneeId: o.assignee_id, rotIdx: o.rot_idx, doneBy: o.done_by, doneAt: o.done_at, nextOccId: o.next_occ_id, manualOverride: o.manual_override })),
    expenses: (r.expenses || []).map((e) => ({ id: e.client_id || e.id, description: e.description, amountCents: e.amount_cents, date: e.date, payerId: e.payer_id, participantIds: e.participant_ids, splits: e.splits, shoppingItemId: e.shopping_item_id, token: e.token, createdAt: e.created_at })),
    reimbursements: (r.reimbursements || []).map((x) => ({ id: x.client_id || x.id, fromId: x.from_id, toId: x.to_id, amountCents: x.amount_cents, date: x.date, note: x.note, token: x.token, createdAt: x.created_at })),
    shopping: (r.shopping || []).map((s) => ({ id: s.client_id || s.id, name: s.name, qty: s.qty, notes: s.notes, buyerId: s.buyer_id, status: s.status, purchasedBy: s.purchased_by, purchasedAt: s.purchased_at, expenseId: s.expense_id, createdAt: s.created_at })),
    events: (r.events || []).map((ev) => ({ id: ev.client_id || ev.id, title: ev.title, category: ev.category, creatorId: ev.creator_id, start: ev.start, end: ev.end, notes: ev.notes, createdAt: ev.created_at })),
    notifications: (r.notifications || []).map((n) => ({ id: n.client_id || n.id, userId: n.user_id, type: n.type, title: n.title, body: n.body, link: n.link, key: n.key, read: n.read, createdAt: n.created_at })),
    activity: (r.activity || []).map((a) => ({ id: a.client_id || a.id, actorId: a.actor_id, verb: a.verb, subject: a.subject, link: a.link, ref: a.ref, ts: a.ts })),
    expectations: (r.expectations || []).map((x) => ({ id: x.client_id || x.id, text: x.text, createdBy: x.created_by, createdAt: x.created_at, updatedBy: x.updated_by, updatedAt: x.updated_at })),
    purchasing: { budgetCents: purch.budget_cents ?? null, preferredProducts: purch.preferred_products || [], storePreferences: purch.store_preferences || [] },
    swaps: (r.swaps || []).map((sw) => ({ id: sw.client_id || sw.id, kind: sw.kind, occId: sw.occ_id, targetOccId: sw.target_occ_id, requesterId: sw.requester_id, addresseeId: sw.addressee_id, status: sw.status, resolvedBy: sw.resolved_by, createdAt: sw.created_at, resolvedAt: sw.resolved_at })),
    prefs: Object.fromEntries((r.prefs || []).map((p) => [p.user_id, p.data])),
    analytics: [],
  };
}
