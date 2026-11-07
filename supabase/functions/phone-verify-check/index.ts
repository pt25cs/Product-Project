// Edge function: check a phone verification code (Requirement 2.2). Verifies the caller's JWT,
// confirms the code with Twilio, and marks phone_verified server-side on success (R2.6).
import { corsHeaders, json, bearer } from '../_shared/cors.ts';
import { adminClient, uidFromJwt } from '../_shared/supabase.ts';
import { createTwilio } from '../_shared/twilio.ts';
import { checkVerify } from '../_shared/phone-verify.mjs';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const jwt = bearer(req);
  if (!jwt) return json({ error: 'Not authenticated' }, 401);
  const uid = await uidFromJwt(jwt);
  if (!uid) return json({ error: 'Not authenticated' }, 401);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: 'Invalid request body' }, 400); }

  const result = await checkVerify(adminClient(), createTwilio(), uid, payload?.code);
  return json(result, result.ok ? 200 : 400);
});
