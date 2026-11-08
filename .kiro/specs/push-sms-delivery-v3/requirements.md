# Requirements — Push & SMS Delivery (Phase 3)

_Spec status: draft for review. No implementation until team review; the SMS (Twilio billing)
question must be resolved first — see "Open questions"._

## Introduction

This spec covers **Phase 3** from `docs/roadmap.md`: turning Kasa's notifications from
**in-app-only** into real **push and SMS delivery** on roommates' phones. It builds directly on
Phase 2 (accounts, verified phone numbers, the Supabase backend) and on seams deliberately left
in Phase 1 (the `prefs.channels` toggles) and the store's single `notify()` dispatch point.

The core shift: today in-app reminders are evaluated **only while the app is open** (on load,
every 60s, and on visibility change). Phase 3 must deliver notifications **when the app is
closed**, which requires a **server-side scheduler** — the main new architectural piece.

### In scope

1. Web Push delivery of existing notification types to subscribed devices.
2. SMS delivery (via Twilio) of time-sensitive notifications to verified phone numbers.
3. Wiring the existing per-user, per-channel preferences (`inApp` / `push` / `sms`) so they
   actually gate delivery.
4. A server-side scheduler that evaluates due/overdue chores (and other time-based triggers)
   and dispatches push/SMS when no client is open.
5. Quiet hours and rate limiting so delivery never becomes spam.

### Out of scope (later phases / unchanged)

- New notification *types* — Phase 3 delivers the existing set (chore assigned/due/overdue,
  expense added, event changes, swap requests, rotation turn) over new channels; it doesn't
  invent new events.
- B2B multi-tenancy (Phase 4) and full real-time cross-device state sync (Phase 5).
- The in-app notification center itself (already shipped) — it keeps working as the `inApp`
  channel.

### Dependencies (from the roadmap)

- **Phase 2** (done): verified phone numbers, user accounts, the Supabase backend, and the
  `notify()` + preferences model as the dispatch layer.
- **An SMS provider** (Twilio) with **billing enabled** — this is the known blocker; Phase 2
  deferred live SMS because Twilio gates sending behind a paid account.
- **Push infrastructure**: Web Push (VAPID keys — free) + a service worker + stored push
  subscriptions.

### Conventions

- EARS phrasing ("WHEN … THE SYSTEM SHALL …").
- "Delivery" means a notification leaving the app to a device (push) or phone (SMS), as opposed
  to the in-app record (which Phase 2 already writes).
- "Verified phone" is `profiles.phone_verified = true` with a stored `phone_e164` (Phase 2).
- Channel preferences are the Phase 1 `prefs[userId].channels = { inApp, push, sms }` model.

---

## Requirement 1 — Web Push delivery

**User story:** As a roommate, I want Kasa to push notifications to my phone/browser even when
the app isn't open, so I find out about my chores and shared activity without checking the app.

#### Acceptance criteria

1. WHEN an authenticated user opts in to push on a device, THE SYSTEM SHALL request browser
   notification permission and, on grant, register a service worker and store the resulting push
   subscription server-side against that user.
2. WHEN a notification is created for a user who has push enabled and at least one active
   subscription, THE SYSTEM SHALL deliver it as a Web Push message to their subscribed devices.
3. WHEN a push subscription is rejected by the push service as expired/invalid, THE SYSTEM SHALL
   remove it server-side so it is not retried indefinitely.
4. WHEN the user revokes browser permission or disables push in Settings, THE SYSTEM SHALL stop
   delivering push to that device and SHALL reflect the change in their preferences.
5. WHEN a pushed notification is activated (clicked), THE SYSTEM SHALL open Kasa to the
   notification's existing deep link (the same `link` the in-app record uses).
6. THE SYSTEM SHALL require no third-party paid service for push (Web Push + VAPID only).

---

## Requirement 2 — SMS delivery

**User story:** As a roommate, I want a text for the time-sensitive things (an overdue chore, a
swap request, a conflict needing a decision), so I don't miss what actually matters.

#### Acceptance criteria

1. WHEN a notification of a **time-sensitive type** is created for a user who has SMS enabled and
   a **verified** phone number, THE SYSTEM SHALL send it as an SMS via the provider.
2. THE SYSTEM SHALL restrict SMS to a defined set of time-sensitive types (e.g. chore
   due/overdue, incoming swap request, rotation turn, conflict), NOT every in-app notice.
3. WHEN a user has SMS enabled but **no verified phone**, THE SYSTEM SHALL NOT attempt an SMS and
   SHALL surface (in Settings) that a verified number is required.
4. WHEN the SMS provider reports a send failure, THE SYSTEM SHALL log it and SHALL NOT present
   the notification as delivered by SMS; the in-app record is unaffected.
5. THE SYSTEM SHALL keep the SMS provider credentials server-side only (edge function env),
   never in the browser (consistent with Phase 2 NFR 2).
6. THE SYSTEM SHALL make the SMS provider pluggable behind an adapter so it can be swapped or
   mocked (the Phase 2 `twilio` adapter is the starting point).

---

## Requirement 3 — Channel preferences gate delivery

**User story:** As a roommate, I want to choose how I'm reached per channel, so I'm not
over-notified.

#### Acceptance criteria

1. WHEN a notification is dispatched, THE SYSTEM SHALL consult the recipient's
   `prefs.channels` and deliver only on the channels they have enabled (`inApp` always on;
   `push` and `sms` opt-in).
2. WHEN a user toggles push or sms in Settings, THE SYSTEM SHALL persist the change to their
   account and apply it to subsequent deliveries (the toggles stop being inert — Phase 1 seam
   is activated).
3. THE SYSTEM SHALL continue to honor the existing per-type `reminders` / `updates` preferences
   in addition to channel selection (a user who turned off reminders gets no reminder on ANY
   channel).
4. WHEN channel preferences can't be loaded (backend unreachable), THE SYSTEM SHALL fail safe to
   in-app only, never over-deliver.

---

## Requirement 4 — Server-side scheduler

**User story:** As a roommate, I want to be reminded about a due or overdue chore even if nobody
has the app open, so reminders are reliable rather than only firing when someone happens to be
looking.

#### Acceptance criteria

1. THE SYSTEM SHALL run a scheduled server-side job (e.g. a cron-triggered Supabase function)
   that evaluates time-based triggers (chore due within lead time, overdue) across households,
   independent of any client being open.
2. WHEN the scheduler finds a due/overdue chore for an assignee with reminders enabled, THE
   SYSTEM SHALL dispatch the reminder on that user's enabled delivery channels, deduped so the
   same reminder is not sent repeatedly (reuse the existing `(user, key)` dedupe discipline).
3. THE SYSTEM SHALL compute reminder timing using the same rules as the in-app reminders (lead
   days, overdue), so client-open and scheduler-driven reminders are consistent and never
   double-sent.
4. THE SYSTEM SHALL be idempotent per run: re-running the job for the same window SHALL NOT
   produce duplicate deliveries.
5. THE SYSTEM SHALL record enough delivery state server-side to support dedupe and quiet
   hours/rate limiting (Requirement 5).

---

## Requirement 5 — Quiet hours and rate limiting

**User story:** As a roommate, I don't want texts in the middle of the night or a flood of
messages, so notifications stay helpful rather than annoying.

#### Acceptance criteria

1. WHEN a user has configured quiet hours, THE SYSTEM SHALL NOT send push/SMS during that
   window and SHALL either suppress or defer delivery to after the window (decision in design).
2. THE SYSTEM SHALL rate-limit per-user delivery (especially SMS) so a burst of events does not
   produce a burst of texts; batching/summarizing is preferred where reasonable.
3. THE SYSTEM SHALL always keep the in-app record regardless of quiet hours/rate limits (the
   user sees everything in-app; only out-of-app delivery is throttled).
4. THE SYSTEM SHALL apply rate limits to the verification-send path too (already partly handled
   by Twilio Verify in Phase 2) so delivery and verification share sane limits.

---

## Non-functional requirements

1. **Security & secrets.** VAPID private key and SMS provider credentials live server-side only
   (edge function env); the browser holds only the VAPID public key and its own push
   subscription. No secret in git or the browser (Phase 2 parity).
2. **Demo path unaffected.** The local/demo path has no accounts, no backend, and therefore no
   push/SMS — it continues to show in-app notifications only, fully offline. Phase 3 adds nothing
   the demo must load.
3. **Backend-dependent, authenticated only.** All delivery is for authenticated households;
   nothing in Phase 3 changes the no-backend demo behavior.
4. **Testability.** Push dispatch, SMS dispatch, the scheduler's trigger evaluation, channel
   gating, and quiet-hours/rate-limit logic MUST be unit-testable with mocked providers under
   `node --test` (Phase 2 pattern), without live push/SMS credentials.
5. **Reuse, not rewrite.** Delivery slots in behind the existing `notify()` dispatch point and
   the `prefs.channels` model; notification *creation* logic is unchanged.
6. **Cost awareness.** SMS has real per-message cost. The design SHALL minimize SMS volume
   (time-sensitive types only, rate limiting, batching) and SHALL make push the default
   out-of-app channel where possible.

---

## Open questions (resolve in team review before building)

1. **SMS provider & billing.** Live SMS requires a billing-enabled account (the Phase 2 blocker:
   Twilio gates Verify Service + sending behind a paid upgrade). Options: (a) enable Twilio
   billing; (b) choose another provider (all charge for SMS); (c) ship **push-only** for Phase 3
   and defer SMS delivery as a follow-on once billing is sorted. The code can be built
   provider-agnostic and mock-tested regardless; this decides the live scope.
2. **Scheduler platform.** Supabase scheduled edge functions / `pg_cron` vs. an external cron.
   Recommendation: Supabase-native (no new infra), confirm in design.
3. **Quiet-hours behavior.** Suppress entirely vs. defer-until-morning. Defer is friendlier but
   needs a delivery queue; suppress is simpler. Decide in design.
4. **Push scope.** Web Push covers desktop + Android browsers well; iOS Safari Web Push needs an
   installed PWA. Decide whether Phase 3 targets Web Push only or also treats "install as PWA" as
   part of the push story.
