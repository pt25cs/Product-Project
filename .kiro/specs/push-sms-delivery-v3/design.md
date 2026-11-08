# Design — Push & SMS Delivery (Phase 3)

_Spec status: draft for review. Build gated on team review + the SMS/billing decision._

This design maps the Phase 3 requirements onto Kasa's architecture. It reuses three seams that
already exist:

- **`notify(userIds, {type,title,body,link,key}, opts)`** in `web/js/store.js` — the single
  point where every notification record is created. Phase 3 adds a **delivery step** triggered
  from this point (for client-driven events) and from the scheduler (for time-based events),
  without changing notification *creation*.
- **`prefs[userId].channels = { inApp, push, sms }`** — the per-user channel model and the
  Settings toggles already exist (`push`/`sms` currently inert). Phase 3 activates them.
- **Phase 2 backend** — Supabase, verified `profiles.phone_e164`, the service-role edge-function
  pattern, and the `twilio` adapter (built for verification) that SMS delivery reuses.

> **Invariant:** the demo/local path has no backend and gains nothing here — it keeps showing
> in-app notifications only, fully offline (NFR 2/3). All Phase 3 delivery is authenticated-only.

---

## 0. Architecture overview

Two dispatch origins feed one delivery pipeline:

```
 client event (addChore, addExpense, swap, ...) ─┐
                                                  ├─► deliver(notification, recipient) ─► channels
 scheduler (cron): due/overdue chore sweep ──────┘        │
                                                           ├─ inApp : existing record (already written)
                                                           ├─ push  : Web Push to stored subscriptions
                                                           └─ sms   : provider (Twilio) to verified phone
```

- **`deliver()`** is a new server-side function (edge) that takes a notification + recipient,
  consults `prefs.channels` + per-type prefs + quiet-hours/rate-limits, and fans out to the
  enabled channels.
- **Client-driven notifications** already create the in-app record in `notify()`. For
  authenticated households, the same action triggers `deliver()` for push/SMS (the in-app record
  is the `inApp` channel, unchanged).
- **Time-based notifications** (due/overdue) are produced by the **scheduler**, not by an open
  client — this is the key new capability (Requirement 4).

---

## 1. Data model additions (Supabase migration)

```sql
-- Web Push subscriptions, one per device per user (Requirement 1)
create table push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
-- RLS: a user manages only their own subscriptions.

-- Delivery log for dedupe + rate limiting + quiet-hours accounting (Requirements 4, 5)
create table deliveries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  household_id uuid references households on delete cascade,
  channel      text not null check (channel in ('push','sms')),
  dedupe_key   text not null,            -- mirrors the in-app (user,key) discipline
  status       text not null,            -- 'sent' | 'failed' | 'suppressed_quiet' | 'rate_limited'
  created_at   timestamptz not null default now(),
  unique (user_id, channel, dedupe_key)  -- idempotency per channel (R4.4)
);

-- Notification preferences extended with quiet hours (Requirement 5). Channels already exist
-- in the client prefs model; here we persist per-user delivery settings server-side.
-- (Either extend the Phase 2 `prefs` table's JSON `data`, or add columns — design choice below.)
```

**Decision — where channel/quiet-hour prefs live:** Phase 2 stores `prefs` as a per-household
JSON row (`prefs.data`). For delivery we need them **server-readable by the scheduler** too.
Recommendation: keep the client-facing shape in `prefs.data.channels` + `prefs.data.quietHours`,
and have the scheduler read that row. No schema churn; the scheduler already queries by household.

---

## 2. Web Push (Requirement 1)

- **Service worker** `web/sw.js` — handles `push` (show notification) and `notificationclick`
  (focus/open Kasa at the notification's `link`). Registered only on the authenticated path.
- **Opt-in UX** — a "Enable push on this device" control in Settings (next to the existing
  channel toggles). On click: request `Notification.permission`, subscribe via
  `pushManager.subscribe({ applicationServerKey: VAPID_PUBLIC })`, POST the subscription to a
  `push-subscribe` edge function which stores it (R1.1).
- **Dispatch** — a `send-push` path (in `deliver()`/edge) signs payloads with the VAPID private
  key and POSTs to each subscription endpoint. Expired/invalid endpoints (404/410) are deleted
  (R1.3).
- **Keys** — VAPID public key ships to the browser (safe); private key is edge-env only (NFR 1).
  Generated once with `web-push generate-vapid-keys` (free, no third party).
- **iOS note** — Web Push on iOS requires the site installed as a PWA. See open question 4;
  design assumes Web Push for desktop/Android first, PWA-install as a documented path for iOS.

Pure/testable piece: payload building + subscription pruning logic as a mockable module; the
actual network POST is injected.

---

## 3. SMS (Requirement 2)

- **Reuse the `twilio` adapter** from Phase 2 (`supabase/functions/_shared/twilio.ts`), extended
  with a `sendSms(to, body)` method (Twilio Messages API) alongside the existing Verify calls.
  Keep it behind the adapter interface so it's swappable/mockable (R2.6).
- **Time-sensitive allowlist** — a constant set of notification `type`s eligible for SMS
  (`chore_due`, `chore_overdue`, `swap`, `rotation turn`, conflict). `deliver()` sends SMS only
  for those (R2.2), only to users with `sms` enabled AND `phone_verified` (R2.1/2.3).
- **Body** — reuse the notification `title` (+ a short deep link or app name); keep texts terse
  to control cost (NFR 6).
- **Failure** — logged to `deliveries` with `status='failed'`; in-app record untouched (R2.4).
- **Credentials** — Twilio SID/token/from-number in edge env only (R2.5, NFR 1).

> **Billing reality (carried from Phase 2):** sending SMS requires a billing-enabled Twilio
> account. All SMS logic is built provider-agnostic and mock-tested; the **live** SMS send is
> gated on the billing decision (requirements open question 1). A clean fallback is to ship
> **push-only** and enable SMS once billing is resolved — no code changes, just config + flipping
> the allowlist on.

---

## 4. The `deliver()` dispatcher (Requirement 3)

A server-side function (edge, service role) that is the single fan-out point:

```
deliver(notification, recipientUserId):
  prefs   = load prefs for recipient
  if not prefs.updates/reminders for this type: stop (R3.3)        # per-type gate, existing
  channels = prefs.channels                                         # inApp always; push/sms opt-in
  if quietHours active or rateLimited: record + skip push/sms (R5)  # in-app already written
  if channels.push and has subscriptions: send-push (+ prune dead)
  if channels.sms and type in SMS_ALLOWLIST and phone_verified: send-sms
  record each attempt in `deliveries` (dedupe/idempotency, R4.4)
```

- Fails safe to in-app only if prefs can't load (R3.4).
- Dedupe via `deliveries (user, channel, dedupe_key)` so a client-driven and a scheduler-driven
  attempt for the same reminder don't double-send (R4.2/4.3).

---

## 5. Scheduler (Requirement 4)

- **Platform:** a Supabase **scheduled edge function** (or `pg_cron` invoking an edge function).
  Recommendation: Supabase-native so no new infra (open question 2).
- **Cadence:** every ~15 minutes (tunable). Each run:
  1. Query open occurrences across households whose due/overdue state crosses a reminder
     threshold within this window, for assignees with reminders enabled.
  2. For each, build the same reminder a client would (reuse `js/logic.js` timing rules so
     client-open and scheduler reminders are identical — R4.3), then call `deliver()`.
  3. `deliveries` dedupe makes re-runs idempotent (R4.4).
- **Consistency with in-app:** because both paths use the same `(user, key)` dedupe and the same
  `logic.js` timing, a reminder is sent once regardless of which path fires first (R4.2).
- The scheduler reuses the **pure** rotation/reminder helpers already in `logic.js` — they're
  DOM-free and run in Deno too.

---

## 6. Quiet hours & rate limiting (Requirement 5)

- **Quiet hours:** per-user window in `prefs.data.quietHours` (e.g. `{ start:'22:00',
  end:'07:00' }`). `deliver()` checks the recipient's local time; within the window, push/SMS are
  **deferred** (preferred) by writing a pending delivery the next scheduler run picks up after the
  window, or **suppressed** (simpler) — decision in open question 3. In-app is never affected
  (R5.3).
- **Rate limiting:** per-user, per-channel caps in a rolling window, enforced via the
  `deliveries` log; prefer **batching/summarizing** bursts (e.g. "3 chores due today") over N
  texts (R5.2, NFR 6).

---

## 7. Testing strategy (NFR 4)

Mock-first, mirroring Phase 2:
- **`deliver()` gating** — channel on/off, per-type prefs, quiet hours, rate limit, fail-safe —
  unit-tested with injected prefs + fake channel senders.
- **Push** — payload build + dead-subscription pruning with a fake push transport.
- **SMS** — allowlist + verified-phone gating with a fake `twilio.sendSms`.
- **Scheduler** — trigger evaluation over a fixture of occurrences + a controllable clock;
  dedupe/idempotency across re-runs; parity with `logic.js` in-app timing.
- **RLS** — `push_subscriptions` and `deliveries` are per-user/household isolated (SQL tests like
  Phase 2's `db:test`).
- **Live checks (manual, documented):** a real push arriving on a subscribed device; a real SMS
  for an overdue chore (gated on the billing decision).

---

## 8. Requirement → design traceability

| Requirement                    | Design sections        |
| ------------------------------ | ---------------------- |
| 1 Web Push                     | 1, 2, 4                |
| 2 SMS                          | 1, 3, 4                |
| 3 Channel prefs gate           | 4                      |
| 4 Scheduler                    | 1, 4, 5                |
| 5 Quiet hours & rate limiting  | 1, 6                   |
| NFR (secrets/demo/test/reuse/  | 0, 2, 3, 7             |
| cost)                          |                        |

---

## Open questions (carry to team review)

1. **SMS live vs. push-only Phase 3** — hinges on the Twilio/billing decision. Build everything
   mock-tested; decide whether the live SMS send ships in Phase 3 or follows once billing is set.
2. **Scheduler platform** — Supabase scheduled function / `pg_cron` (recommended) vs. external.
3. **Quiet hours: defer vs. suppress** — defer needs a small delivery queue; suppress is simpler.
4. **iOS push** — Web Push only (desktop/Android) vs. also guiding PWA install for iOS.
