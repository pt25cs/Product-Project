// Edge function: start phone verification (Requirement 2.1). Verifies the caller's JWT, then
// uses the service-role DB client + Twilio Verify to text a code. The Twilio auth token lives
// only in this function's env, never in the browser (R6.4 / NFR 2).
import { corsHeaders, json, bearer } from '../_shared/cors.ts';
import { adminClient, uidFromJwt } from '../_shared/supabase.ts';
import { createTwilio } from '../_shared/twilio.ts';
import { startVerify } from '../_shared/phone-verify.mjs';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const jwt = bearer(req);
  if (!jwt) return json({ error: 'Not authenticated' }, 401);
  const uid = await uidFromJwt(jwt);
  if (!uid) return json({ error: 'Not authenticated' }, 401);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: 'Invalid request body' }, 400); }

  const result = await startVerify(adminClient(), createTwilio(), uid, payload?.phone);
  return json(result, result.ok ? 200 : 400);
});
