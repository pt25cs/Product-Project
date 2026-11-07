// Phone verification logic (Requirement 2). Plain ESM shared by the edge functions (Deno) and
// Node --test. Twilio Verify owns code generation, expiry, and rate limiting (R2.3/2.4); we only
// start a verification and check a code, then persist the verified number server-side (R2.6).
//
// Dependencies are INJECTED so this is testable without Twilio or a DB (NFR 5):
//   twilio = { startVerification(phone), checkVerification(phone, code) }
//            -> { status: 'pending'|'approved'|'canceled'|..., ok, error? }
//   db     = Supabase service-role client (reads/writes public.profiles)

export const E164 = /^\+[1-9]\d{1,14}$/;

/**
 * Start a verification: validate, reject a number already verified on ANOTHER account (R2.5),
 * then ask Twilio to text a code. Returns { ok } or { ok:false, error } (rate-limit/collision
 * messages are surfaced to the client, R2.3–2.5).
 */
export async function startVerify(db, twilio, uid, phone) {
  const p = String(phone || '').trim();
  if (!E164.test(p)) return { ok: false, error: 'Enter a phone number in international format, e.g. +15555550123.' };

  // Collision: is this number already verified on a different user's profile? (R2.5)
  const { data: clash } = await db
    .from('profiles')
    .select('user_id')
    .eq('phone_e164', p)
    .eq('phone_verified', true)
    .maybeSingle();
  if (clash && clash.user_id !== uid) {
    return { ok: false, error: 'That phone number is already verified on another account.' };
  }

  // Stash the pending (unverified) number on the user's profile so check() knows what to confirm.
  const { error: upErr } = await db
    .from('profiles')
    .update({ phone_e164: p, phone_verified: false })
    .eq('user_id', uid);
  if (upErr) return { ok: false, error: upErr.message };

  let res;
  try { res = await twilio.startVerification(p); }
  catch (e) { return { ok: false, error: friendly(e) }; }
  if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'Could not send a code. Try again shortly.' };
  return { ok: true };
}

/**
 * Check a submitted code against Twilio; on approval mark the user's phone verified (R2.2/2.6).
 * Wrong/expired codes return { ok:false, error } without flipping the flag (R2.3).
 */
export async function checkVerify(db, twilio, uid, code) {
  const c = String(code || '').trim();
  if (!/^\d{4,8}$/.test(c)) return { ok: false, error: 'Enter the numeric code we texted you.' };

  // the pending number stashed by start()
  const { data: prof } = await db.from('profiles').select('phone_e164').eq('user_id', uid).maybeSingle();
  if (!prof || !prof.phone_e164) return { ok: false, error: 'Start phone verification first.' };

  let res;
  try { res = await twilio.checkVerification(prof.phone_e164, c); }
  catch (e) { return { ok: false, error: friendly(e) }; }

  if (!res || res.status !== 'approved') {
    return { ok: false, error: 'That code is incorrect or expired. Request a new one and try again.' };
  }

  // Double-check no one verified this number in the meantime (race on R2.5).
  const { data: clash } = await db
    .from('profiles').select('user_id').eq('phone_e164', prof.phone_e164).eq('phone_verified', true).maybeSingle();
  if (clash && clash.user_id !== uid) {
    return { ok: false, error: 'That phone number was just verified on another account.' };
  }

  const { error } = await db.from('profiles').update({ phone_verified: true }).eq('user_id', uid);
  if (error) return { ok: false, error: error.message };
  return { ok: true, verified: true };
}

function friendly(e) {
  const msg = (e && (e.message || e.error)) || '';
  if (/rate|too many|429/i.test(msg)) return 'Too many attempts. Please wait a bit and try again.';
  if (/not found|404/i.test(msg)) return 'Verification expired. Request a new code.';
  return 'Could not verify right now. Please try again.';
}
