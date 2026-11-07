// Edge function: migrate a local household into the authenticated user's account (Requirement 5).
// Runs with the service-role client so it can create a household + memberships + all content in
// one controlled operation. Atomicity (R5.5): the writes are delegated to the SQL RPC
// `import_household`, which runs inside a single transaction and rolls back on any error. The
// client keeps its local copy until this returns success and only then writes the migrated
// marker (R5.4), so a failure is non-destructive and safely retryable (NFR 6).
import { corsHeaders, json, bearer } from '../_shared/cors.ts';
import { adminClient, uidFromJwt } from '../_shared/supabase.ts';
import { buildImportPlan } from '../_shared/migrate.mjs';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const jwt = bearer(req);
  if (!jwt) return json({ error: 'Not authenticated' }, 401);
  const uid = await uidFromJwt(jwt);
  if (!uid) return json({ error: 'Not authenticated' }, 401);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: 'Invalid request body' }, 400); }

  const { local, meLocalId, sourceSignature } = payload || {};
  if (!local) return json({ error: 'Nothing to import.' }, 400);

  let plan;
  try {
    plan = buildImportPlan(local, uid, meLocalId);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }

  const db = adminClient();

  // Idempotency guard (NFR 6): if this exact source was already imported by this user, return
  // the existing household instead of creating a duplicate.
  if (sourceSignature) {
    const { data: prior } = await db
      .from('households')
      .select('id')
      .eq('created_by', uid)
      .eq('import_signature', sourceSignature)
      .maybeSingle();
    if (prior) return json({ ok: true, householdId: prior.id, alreadyImported: true });
  }

  // Transactional apply via the SQL RPC (single transaction; rolls back on any failure, R5.5).
  const { data, error } = await db.rpc('import_household', {
    p_plan: plan,
    p_signature: sourceSignature ?? null,
  });
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, householdId: data });
});
