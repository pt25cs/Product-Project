# Tasks — Push & SMS Delivery (Phase 3)

_Spec status: draft for review. **Do not start coding** until requirements.md and design.md are
approved by the team and the SMS/billing open question is resolved. Everything below is
buildable mock-first; the only hard external dependency is a billing-enabled SMS provider for the
**live** SMS send (Task 7's live half)._

Ordering: data model + the pure dispatch/gating logic first, then push, then SMS, then the
scheduler, then quiet-hours/rate-limiting, then verification. Each task is test-backed with
mocked providers, matching the Phase 2 pattern.

---

- [ ] 1. Schema: push subscriptions, deliveries, quiet-hours prefs
  - Migration adding `push_subscriptions` and `deliveries` tables with RLS (per-user /
    per-household isolation), and the `prefs.data.channels` / `prefs.data.quietHours` shape used
    by the scheduler.
  - _Requirements: 1, 4, 5; NFR 1._
  - _Test:_ RLS SQL tests (a user sees only their own subscriptions/deliveries); `deliveries`
    unique `(user, channel, dedupe_key)` enforces idempotency.

- [ ] 2. The `deliver()` dispatcher + channel/per-type gating (pure, mockable)
  - Shared module taking a notification + recipient prefs + injected channel senders; applies
    per-type prefs, `channels`, fail-safe-to-inApp, and records attempts.
  - _Requirements: 3.1–3.4._
  - _Test:_ channel on/off, reminders/updates off suppresses all channels, backend-unreachable
    fails safe to in-app, dedupe via deliveries.

- [ ] 3. Web Push: service worker + opt-in + subscription storage
  - `web/sw.js` (push + notificationclick → deep link); Settings "Enable push on this device"
    opt-in; `push-subscribe` edge function storing subscriptions; VAPID keys (public to browser,
    private edge-only).
  - _Requirements: 1.1, 1.4, 1.5, 1.6; NFR 1._
  - _Test:_ subscribe flow stores a subscription; permission-denied path is graceful.

- [ ] 4. Web Push: dispatch + dead-subscription pruning
  - `send-push` path signs with VAPID and POSTs to endpoints; prune 404/410 endpoints.
  - _Requirements: 1.2, 1.3._
  - _Test (fake transport):_ payload build; delivers to each subscription; prunes dead endpoints.

- [ ] 5. Activate channel toggles in Settings (wire the Phase 1 seam)
  - Make `push`/`sms` toggles live: persist to the account, drive `deliver()`; show "verify a
    phone to enable SMS" when `sms` is on without a verified number.
  - _Requirements: 3.2, 2.3._
  - _Test:_ toggling persists and changes subsequent delivery gating.

- [ ] 6. SMS adapter: extend `twilio` with `sendSms` + allowlist gating
  - Add `sendSms(to, body)` to the Phase 2 Twilio adapter; `deliver()` sends SMS only for the
    time-sensitive type allowlist, only to verified numbers.
  - _Requirements: 2.1, 2.2, 2.5, 2.6._
  - _Test (fake twilio):_ allowlist enforced; unverified phone skipped; creds never client-side.

- [ ] 7. SMS delivery end-to-end (mock) + live gate
  - Wire SMS into `deliver()`; failures logged, in-app unaffected.
  - _Requirements: 2.1, 2.4._
  - _Test (mock):_ send path + failure handling.
  - **LIVE (gated):** a real SMS for an overdue chore — requires a billing-enabled provider
    (open question 1). Deferred until resolved; no code change to enable.

- [ ] 8. Server-side scheduler (cron edge function)
  - Scheduled function sweeping due/overdue occurrences across households, building reminders
    with the same `logic.js` rules, calling `deliver()`; idempotent via `deliveries`.
  - _Requirements: 4.1–4.5._
  - _Test:_ trigger evaluation over fixtures + controllable clock; dedupe across re-runs; parity
    with in-app reminder timing.

- [ ] 9. Quiet hours + rate limiting
  - Quiet-hours window per user (defer or suppress — per design decision); per-user/channel rate
    limits with batching/summarizing; in-app always unaffected.
  - _Requirements: 5.1–5.4; NFR 6._
  - _Test:_ in-window delivery suppressed/deferred; burst collapses to a batch; in-app intact.

- [ ] 10. Full verification pass
  - `node --test` (deliver/push/sms/scheduler/quiet-hours) + RLS SQL tests; confirm no secret in
    git/browser; demo path still in-app-only and offline. Record live-check results (push
    arriving; SMS gated on billing). Update README/roadmap Phase 3 status.
  - _Requirements: all; NFR 1–6._

---

## Traceability summary

| Requirement                   | Tasks         |
| ----------------------------- | ------------- |
| 1 Web Push                    | 1, 3, 4, 10   |
| 2 SMS                         | 1, 6, 7, 10   |
| 3 Channel prefs gate          | 2, 5, 10      |
| 4 Scheduler                   | 1, 8, 10      |
| 5 Quiet hours & rate limiting | 1, 9, 10      |
| NFR                           | 1, 2, 7, 10   |

---

## Blocking decisions before build (team review)

1. **SMS: live in Phase 3 or push-only now?** Depends on the Twilio/billing resolution. Push has
   no billing gate and can ship independently; SMS code is built + mock-tested either way.
2. **Scheduler platform** (Supabase-native recommended).
3. **Quiet hours: defer vs. suppress.**
4. **iOS push scope** (Web Push + PWA-install guidance vs. desktop/Android only).

All Phase 3 code is buildable and testable against mocked providers with **no new paid service**;
the sole money dependency is live SMS sending.
