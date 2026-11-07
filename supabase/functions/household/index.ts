// Edge function: household operations (Requirement 7).
// Routes { action, ... } to the shared household-ops with the service-role client, after
// verifying the caller's JWT. Service role is used so invitation acceptance can insert a
// membership into a household the caller is not yet in (RLS would block a plain client write).
import { corsHeaders, json, bearer } from '../_shared/cors.ts';
import { adminClient, uidFromJwt } from '../_shared/supabase.ts';
import { createHousehold, createInvitation, acceptInvitation } from '../_shared/household-ops.mjs';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const jwt = bearer(req);
  if (!jwt) return json({ error: 'Not authenticated' }, 401);
  const uid = await uidFromJwt(jwt);
  if (!uid) return json({ error: 'Not authenticated' }, 401);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: 'Invalid request body' }, 400); }

  const db = adminClient();
  const { action } = payload || {};
  let result;
  switch (action) {
    case 'create':
      result = await createHousehold(db, uid, { name: payload.name, displayName: payload.displayName });
      break;
    case 'invite':
      result = await createInvitation(db, uid, {
        householdId: payload.householdId,
        placeholderMembershipId: payload.placeholderMembershipId ?? null,
        expiresAt: payload.expiresAt ?? null,
      });
      break;
    case 'accept':
      result = await acceptInvitation(db, uid, { code: payload.code, displayName: payload.displayName });
      break;
    default:
      return json({ error: 'Unknown action' }, 400);
  }
  return json(result, result.ok ? 200 : 400);
});
