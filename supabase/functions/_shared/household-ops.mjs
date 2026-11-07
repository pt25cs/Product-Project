// Pure household operations (Requirement 7). The DB client is injected so these run in Deno
// edge functions (service-role client) AND under Node --test with a fake DB (NFR 5). Written
// as plain ESM (no TS) so both runtimes import it directly, keeping one source of truth.
//
// `db` is a Supabase-shaped client; in production it is the service-role client so invitation
// acceptance can insert a membership into a household the caller is not yet in (RLS would block
// a plain client write, R7.2/7.3). Every op takes the authenticated `uid` explicitly so
// authorization derives from the verified token, never client-supplied identity.

export const MAX_MEMBERS = 5;

export function randomCode(rand = Math.random) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(rand() * alphabet.length)];
  return s;
}

/** Create a household and seed the caller as its first (owner) member (R7.1). */
export async function createHousehold(db, uid, { name, displayName }) {
  const n = String(name || '').trim();
  const dn = String(displayName || '').trim();
  if (!n || n.length > 60) return { ok: false, error: 'Give your household a name (1–60 characters).' };
  if (!dn || dn.length > 30) return { ok: false, error: 'Enter your display name (1–30 characters).' };

  const { data: hh, error: hhErr } = await db.from('households').insert({ name: n, created_by: uid }).select().single();
  if (hhErr) return { ok: false, error: hhErr.message };

  const { error: mErr } = await db.from('memberships').insert({
    household_id: hh.id, user_id: uid, role: 'owner', display_name: dn, claimed: true,
  });
  if (mErr) return { ok: false, error: mErr.message };

  return { ok: true, householdId: hh.id };
}

/** Create a shareable invitation, optionally to claim a specific placeholder member (R7.2/7.3). */
export async function createInvitation(db, uid, { householdId, placeholderMembershipId = null, expiresAt = null }) {
  const { data: mem } = await db.from('memberships').select('id').eq('household_id', householdId).eq('user_id', uid).maybeSingle();
  if (!mem) return { ok: false, error: 'Only a member can invite to this household.' };

  const code = randomCode();
  const { data, error } = await db.from('invitations').insert({
    household_id: householdId,
    code,
    created_by: uid,
    placeholder_membership: placeholderMembershipId,
    expires_at: expiresAt,
  }).select().single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, code, invitationId: data.id };
}

/**
 * Accept an invitation (R7.2). If it targets a placeholder membership, claim it (bind to the
 * user); otherwise add a new membership. Enforces: exists, not expired, not already accepted,
 * household not full, user not already a member.
 */
export async function acceptInvitation(db, uid, { code, displayName }) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return { ok: false, error: 'Enter an invitation code.' };

  const { data: inv } = await db.from('invitations').select('*').eq('code', c).maybeSingle();
  if (!inv) return { ok: false, error: 'That invitation code is not valid.' };
  if (inv.accepted_by) return { ok: false, error: 'This invitation has already been used.' };
  if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) return { ok: false, error: 'This invitation has expired.' };

  const { data: existing } = await db.from('memberships').select('id').eq('household_id', inv.household_id).eq('user_id', uid).maybeSingle();
  if (existing) return { ok: false, error: 'You are already a member of this household.' };

  const { data: members } = await db.from('memberships').select('id, claimed, user_id').eq('household_id', inv.household_id);
  const count = (members || []).length;

  if (inv.placeholder_membership) {
    const ph = (members || []).find((m) => m.id === inv.placeholder_membership);
    if (!ph) return { ok: false, error: 'The spot this invite points to is no longer available.' };
    if (ph.claimed || ph.user_id) return { ok: false, error: 'That spot has already been claimed.' };
    const patch = { user_id: uid, claimed: true };
    if (displayName && String(displayName).trim()) patch.display_name = String(displayName).trim().slice(0, 30);
    const { error } = await db.from('memberships').update(patch).eq('id', ph.id);
    if (error) return { ok: false, error: error.message };
  } else {
    if (count >= MAX_MEMBERS) return { ok: false, error: 'This household is already full (max 5 roommates).' };
    const dn = (displayName && String(displayName).trim()) ? String(displayName).trim().slice(0, 30) : 'Roommate';
    const { error } = await db.from('memberships').insert({
      household_id: inv.household_id, user_id: uid, role: 'member', display_name: dn, claimed: true,
    });
    if (error) return { ok: false, error: error.message };
  }

  await db.from('invitations').update({ accepted_by: uid, accepted_at: new Date().toISOString() }).eq('id', inv.id);
  return { ok: true, householdId: inv.household_id };
}
