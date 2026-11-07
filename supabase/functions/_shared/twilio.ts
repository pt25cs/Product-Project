// Twilio Verify client (Deno). Wraps the two REST calls we use. Credentials come from edge
// function env ONLY (never the browser, Requirement 6.4 / NFR 2):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID
//
// Returns a small { startVerification, checkVerification } shape matching what phone-verify.mjs
// expects, so the logic module stays provider-agnostic and unit-testable with a fake.

export function createTwilio() {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID')!;
  const token = Deno.env.get('TWILIO_AUTH_TOKEN')!;
  const service = Deno.env.get('TWILIO_VERIFY_SERVICE_SID')!;
  const base = `https://verify.twilio.com/v2/Services/${service}`;
  const auth = 'Basic ' + btoa(`${sid}:${token}`);

  async function post(path: string, form: Record<string, string>) {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Surface Twilio's status so the logic layer can map rate-limit/expiry (R2.3/2.4).
      throw new Error(body?.message || `twilio ${res.status}`);
    }
    return body;
  }

  return {
    async startVerification(phone: string) {
      const body = await post('/Verifications', { To: phone, Channel: 'sms' });
      return { ok: true, status: body.status };
    },
    async checkVerification(phone: string, code: string) {
      const body = await post('/VerificationCheck', { To: phone, Code: code });
      return { ok: body.status === 'approved', status: body.status };
    },
  };
}
