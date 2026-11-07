# Phase 2 setup — accounts, backend, sign-in

This guide stands up Kasa's **authenticated** path (Phase 2): a Supabase backend, Google
sign-in, server-backed profiles, and local→account migration. It is the reproducible version
of the steps done during Phase 2 implementation.

**You do not need any of this to run the demo.** With no `web/js/config.js`, Kasa runs
demo-only, fully local, no accounts — exactly as before (`npm start`). The steps below only
enable the real backend.

---

## Prerequisites (tooling)

- **Node.js** (for `npm` scripts and the dev server).
- **Docker Desktop** — required by the Supabase CLI for local development. Install the Windows
  per-user build; keep "Use WSL 2" checked. The engine must be running (steady whale icon).
  Note: on a per-user install the `docker` CLI lands under
  `%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin` and may not be on a fresh shell's PATH
  until you reopen the terminal / reboot.
- **Supabase CLI** — install via Scoop (NOT `npm install -g supabase`, which is unsupported):
  ```powershell
  scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
  scoop install supabase
  supabase --version
  ```

---

## 1. Supabase project

1. Create a project at supabase.com (enable RLS — it's per-table and our migrations set it up;
   just don't disable it anywhere).
2. **Link the repo to the project:**
   ```powershell
   supabase link --project-ref <your-project-ref>
   ```
   Linking (and `db push`/`functions deploy`) need a **Supabase access token**. Create one at
   https://supabase.com/dashboard/account/tokens (Full access). Store it where the CLI reads it,
   in a **git-ignored** `.env` at the repo root:
   ```
   SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxx
   ```
   Load it before CLI commands (PowerShell):
   ```powershell
   Get-Content .env | ForEach-Object { if ($_ -match '^\s*([^=]+)=(.*)$') { Set-Item "env:$($Matches[1].Trim())" $Matches[2].Trim() } }
   ```

## 2. Apply the schema

Local (Docker) for development + tests:
```powershell
supabase start          # first run pulls images (~minutes)
supabase db reset        # applies all migrations to the local DB
npm run db:test          # RLS + import RPC tests against local Postgres
```

To your cloud project (this is the first write to production; additive on an empty project):
```powershell
supabase db push --remote --yes
```
This creates the 16 tables, RLS policies, and the `import_household` transactional RPC.

## 3. Google OAuth (sign-in)

Creating an OAuth client is **free** — do NOT activate the paid "free trial" if prompted; go
straight to Credentials.

1. **console.cloud.google.com** → create a project (via the project dropdown → New Project).
2. **APIs & Services → OAuth consent screen**: External; app name "Kasa"; add your own Google
   email under **Test users** (testing mode is fine for development — no Google verification
   needed).
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Type: **Web application**.
   - **Authorized redirect URI** (exactly):
     `https://<your-project-ref>.supabase.co/auth/v1/callback`
   - Create → copy the **Client ID** and **Client Secret**.
4. **Supabase → Authentication → Providers → Google**: enable, paste the Client ID + Secret, save.
   (The secret lives only in Supabase — never in the repo or browser.)
5. **Supabase → Authentication → URL Configuration**: set **Site URL** and add **Redirect URLs**
   for where you run the app — `http://localhost:8080` for local dev (add your Vercel URL too
   when deploying; keep localhost in the list for local testing).

Common pitfall: a **redirect_uri_mismatch** error means the Google Authorized redirect URI isn't
character-for-character `https://<ref>.supabase.co/auth/v1/callback`.

## 4. Browser config

The client reads the publishable values from `web/js/config.js` (git-ignored). Copy the template
and fill it:
```powershell
Copy-Item web/js/config.example.js web/js/config.js
```
```js
export const SUPABASE_URL = 'https://<your-project-ref>.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_...'; // Project Settings → API → publishable/anon key
```
Only these two browser-safe values go here. **Never** put the service-role or secret key in the
browser or in git. (Supabase recently renamed the "anon" key to "publishable" — `sb_publishable_…`
is the right one.)

## 5. Edge functions

Deploy the four functions:
```powershell
supabase functions deploy household migrate-import phone-verify-start phone-verify-check --yes
```
Supabase auto-injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` into
functions, so `household` and `migrate-import` work with no extra secrets.

## 6. Run + verify

```powershell
npm start   # http://localhost:8080
```
- The welcome screen shows **Continue with Google** (because `config.js` is present).
- Sign in → if you have no household yet you land on the onboarding screen: **Create**, **Join
  with a code**, or **Import** your local demo data.
- Signed-in households have no "Viewing as" switcher; your name shows instead.

---

## Phone verification (Twilio) — DEFERRED

Phone verification code is built and unit-tested (`npm test`), but the **live SMS check is
deferred**: Twilio gates Verify Service creation behind a paid-account upgrade, and every real
SMS provider charges to send texts. This is acceptable because phone verification is
**non-blocking** in Phase 2 (an unverified phone can still use the app); the hard dependency is
Phase 3 SMS delivery.

To activate later (no code changes):
1. Create a Twilio **Verify Service** (requires a billing-enabled Twilio account).
2. Set the edge-function secrets:
   ```powershell
   supabase secrets set TWILIO_ACCOUNT_SID=AC... TWILIO_AUTH_TOKEN=... TWILIO_VERIFY_SERVICE_SID=VA...
   ```
3. On a trial you can only text your own verified number — enough for the manual check.

---

## Secrets checklist

| Value | Where it lives | In the browser? | In git? |
| --- | --- | --- | --- |
| Supabase URL | `web/js/config.js` | yes (safe) | no (ignored) |
| Supabase publishable/anon key | `web/js/config.js` | yes (safe, RLS-scoped) | no (ignored) |
| Supabase service-role key | Supabase (edge env) | **no** | **no** |
| Supabase access token | `.env` (CLI only) | no | no (ignored) |
| Google client ID/secret | Supabase Auth provider | no | no |
| Twilio SID/token/service | Supabase secrets (edge) | **no** | **no** |

`web/js/config.js`, `.env`, and `supabase/functions/.env` are all git-ignored.

---

## Live exit-criteria status (roadmap Phase 2)

- ✅ Sign in with Google and get an authenticated session — verified live.
- ✅ Create / import a household server-side; data persists in Postgres with RLS — verified live
  (import populated the real DB: household + members + chores + expenses + events).
- ✅ Same profile on a second device — profiles are server-backed and load per authenticated
  user, so signing in elsewhere shows the same profile.
- ⏳ Verified phone number receives an SMS — deferred (Twilio paid gate; see above).
