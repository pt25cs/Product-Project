// Shared Supabase client builders for edge functions (Deno).
// - userClient: acts AS the caller (respects RLS) using their JWT.
// - adminClient: service-role (bypasses RLS) for controlled cross-household operations
//   like accepting an invitation or running the migration import transactionally.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0';

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export function userClient(jwt: string): SupabaseClient {
  return createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function adminClient(): SupabaseClient {
  return createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Resolve the authenticated user id from a JWT, or null if invalid. */
export async function uidFromJwt(jwt: string): Promise<string | null> {
  const c = userClient(jwt);
  const { data, error } = await c.auth.getUser();
  if (error || !data?.user) return null;
  return data.user.id;
}
