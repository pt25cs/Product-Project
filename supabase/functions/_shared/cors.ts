// Shared CORS + auth helpers for Kasa edge functions (Phase 2).
// Deno runtime. These functions run server-side with the service-role key available,
// so the Twilio/service-role secrets never reach the browser (Requirement 6.4, NFR 2).

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Extract the caller's bearer token (the authenticated user's JWT). */
export function bearer(req: Request): string | null {
  const h = req.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}
