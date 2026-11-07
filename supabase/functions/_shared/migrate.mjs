// Local-to-account migration logic (Requirement 5). Plain ESM, shared by the migrate-import
// edge function (Deno) and Node --test. Split into a PURE mapper (buildImportPlan) that is
// fully unit-testable, and an applier (applyImportPlan) that writes the plan to an injected DB
// transactionally. Keeping the mapping pure is what lets the tests assert the exact server
// insert payloads without a database (R5.2–R5.4, NFR 5/6).

export const MIGRATED_MARKER_KEY = 'roomsync.migrated.v1';

/**
 * Turn a normalized local household state into a server import plan.
 *
 * @param {object} local   normalized local state (household, members, chores, ... — the v1 shape)
 * @param {string} uid      the authenticated user's id (the person doing the import)
 * @param {string} meLocalId  which LOCAL member id maps to the signing-in user (R5.3)
 * @returns {object} plan: { household, memberships, profile, content }
 *   - the signing-in user's chosen member becomes a CLAIMED membership tied to uid
 *   - every other local member becomes an UNCLAIMED placeholder (user_id null) to be claimed
 *     later by a real user joining (R5.3 / R7.3)
 *   - content rows carry the local string id as client_id so relationships are preserved (R5.2)
 */
export function buildImportPlan(local, uid, meLocalId) {
  if (!local || !local.household || !Array.isArray(local.members)) {
    throw new Error('Local data is not a recognized household.');
  }
  const me = local.members.find((m) => m.id === meLocalId) || local.members[0];

  const household = { name: local.household.name, created_by: uid };

  const memberships = local.members.map((m) => {
    const isMe = m.id === me.id;
    return {
      client_id: m.id,                     // preserve local member id as client_id for linking
      user_id: isMe ? uid : null,          // only the signer is claimed; others are placeholders
      claimed: isMe,
      role: isMe ? 'owner' : 'member',
      display_name: (m.name || 'Roommate').slice(0, 30),
    };
  });

  // The signing-in user's profile fields migrate to their own server profile row (R5.2).
  const p = me.profile || {};
  const profile = {
    user_id: uid,
    display_name: (me.name || '').slice(0, 30),
    dietary: (p.dietary || '').slice(0, 300),
    budget_cents: Number.isInteger(p.budgetCents) ? p.budgetCents : null,
    rules: (p.rules || '').slice(0, 300),
  };

  // Content: map each collection to rows carrying client_id (and chore/occurrence links).
  const content = {
    chores: (local.chores || []).map((c) => ({
      client_id: c.id, title: c.title, notes: c.notes || '', recurrence: c.recurrence,
      rotation: c.rotation || [], auto_rotate: !!c.autoRotate, anchor_date: c.anchorDate ?? null,
      cycle_days: c.cycleDays ?? 7, start_idx: c.startIdx ?? 0,
    })),
    occurrences: (local.occurrences || []).map((o) => ({
      client_id: o.id, chore_client_id: o.choreId, title: o.title, notes: o.notes || '',
      due: o.due, assignee_id: o.assigneeId ?? null, rot_idx: o.rotIdx ?? null,
      done_by: o.doneBy ?? null, done_at: o.doneAt ?? null, next_occ_id: o.nextOccId ?? null,
      manual_override: !!o.manualOverride,
    })),
    expenses: (local.expenses || []).map((e) => ({
      client_id: e.id, description: e.description, amount_cents: e.amountCents, date: e.date,
      payer_id: e.payerId, participant_ids: e.participantIds || [], splits: e.splits || {},
      shopping_item_id: e.shoppingItemId ?? null, token: e.token ?? null,
    })),
    reimbursements: (local.reimbursements || []).map((r) => ({
      client_id: r.id, from_id: r.fromId, to_id: r.toId, amount_cents: r.amountCents,
      date: r.date, note: r.note || '', token: r.token ?? null,
    })),
    shopping: (local.shopping || []).map((s) => ({
      client_id: s.id, name: s.name, qty: s.qty || '1', notes: s.notes || '',
      buyer_id: s.buyerId ?? null, status: s.status, purchased_by: s.purchasedBy ?? null,
      purchased_at: s.purchasedAt ?? null, expense_id: s.expenseId ?? null,
    })),
    events: (local.events || []).map((ev) => ({
      client_id: ev.id, title: ev.title, category: ev.category, creator_id: ev.creatorId,
      start: ev.start, end: ev.end, notes: ev.notes || '',
    })),
    expectations: (local.expectations || []).map((x) => ({
      client_id: x.id, text: x.text, created_by: x.createdBy ?? null, updated_by: x.updatedBy ?? null,
    })),
    swaps: (local.swaps || []).map((sw) => ({
      client_id: sw.id, kind: sw.kind, occ_id: sw.occId ?? null, target_occ_id: sw.targetOccId ?? null,
      requester_id: sw.requesterId ?? null, addressee_id: sw.addresseeId ?? null, status: sw.status,
      resolved_by: sw.resolvedBy ?? null, resolved_at: sw.resolvedAt ?? null,
    })),
    notifications: (local.notifications || []).map((n) => ({
      client_id: n.id, user_id: n.userId, type: n.type, title: n.title, body: n.body || '',
      link: n.link || '#/home', key: n.key ?? null, read: !!n.read,
    })),
    activity: (local.activity || []).map((a) => ({
      client_id: a.id, actor_id: a.actorId ?? null, verb: a.verb, subject: a.subject || '',
      link: a.link ?? null, ref: a.ref ?? null,
    })),
    purchasing: {
      budget_cents: (local.purchasing && local.purchasing.budgetCents) ?? null,
      preferred_products: (local.purchasing && local.purchasing.preferredProducts) || [],
      store_preferences: (local.purchasing && local.purchasing.storePreferences) || [],
    },
    prefs: Object.entries(local.prefs || {}).map(([userId, data]) => ({ user_id: userId, data })),
  };

  return { household, memberships, profile, content };
}

/**
 * Apply an import plan to the database. In production this runs inside the migrate-import edge
 * function with the service-role client. It is designed to be transactional/atomic: callers
 * should wrap it in a DB transaction (the edge function uses an RPC `import_household` that runs
 * in a single transaction) so a partial failure rolls back entirely (R5.5), and idempotent via
 * the client-side migrated marker plus a source-signature guard (R5.4/NFR 6).
 *
 * This JS applier is used by tests with a fake DB; the production path prefers the SQL RPC.
 */
export async function applyImportPlan(db, plan) {
  const { data: hh, error: hhErr } = await db.from('households').insert(plan.household).select().single();
  if (hhErr) throw new Error(`household: ${hhErr.message}`);
  const hid = hh.id;

  const withHid = (rows) => rows.map((r) => ({ ...r, household_id: hid }));

  const steps = [
    ['memberships', withHid(plan.memberships)],
    ['chores', withHid(plan.content.chores)],
    ['occurrences', withHid(plan.content.occurrences)],
    ['expenses', withHid(plan.content.expenses)],
    ['reimbursements', withHid(plan.content.reimbursements)],
    ['shopping', withHid(plan.content.shopping)],
    ['events', withHid(plan.content.events)],
    ['expectations', withHid(plan.content.expectations)],
    ['swaps', withHid(plan.content.swaps)],
    ['notifications', withHid(plan.content.notifications)],
    ['activity', withHid(plan.content.activity)],
    ['prefs', withHid(plan.content.prefs)],
  ];
  for (const [table, rows] of steps) {
    if (!rows.length) continue;
    const { error } = await db.from(table).insert(rows);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  // purchasing (single row) + the owner's profile
  const { error: pErr } = await db.from('purchasing').insert({ household_id: hid, ...plan.content.purchasing });
  if (pErr) throw new Error(`purchasing: ${pErr.message}`);
  const { error: prErr } = await db.from('profiles').upsert(plan.profile);
  if (prErr) throw new Error(`profile: ${prErr.message}`);

  return { ok: true, householdId: hid };
}
