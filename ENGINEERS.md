# Memories / EvolveIT — engineer handoff

This repo is the venue OS. Demo money is off unless `EVOLVEIT_DEMO=1` **and**
the Paystack key is not `sk_live`.

## Apply before first live charge

1. Run Supabase migrations `001` through `019` in order. `017`, `018` and `019`
   are the audit passes and are **not optional** — between them they enable
   RLS on the payroll and stock tables, revoke the financial RPCs from the
   browser key, stamp every posting with its shift, add the ledger balance
   constraint, and index the door's hottest query.
2. Generate secrets (do not commit):

```
openssl rand -hex 32   # TICKET_MASTER_KEY
openssl rand -hex 32   # STAFF_SESSION_SECRET
openssl rand -hex 32   # HUB_SECRET
openssl rand -hex 16   # PIN_PEPPER
```

3. Set on the host:

- `TICKET_MASTER_KEY`
- `STAFF_SESSION_SECRET`
- `PIN_PEPPER` (when rotating PINs off the demo sha256 seed)
- `PAYSTACK_SECRET_KEY` (`sk_live_…`)
- `PAYSTACK_WEBHOOK_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL`
- `HUB_SECRET` — the hub now refuses to start without it
- `CRON_SECRET` — required by the scheduled jobs and the delivery drain

4. Point Paystack webhook at `/api/webhooks/paystack`, and subscribe to
   `charge.success`, `refund.processed` and `refund.failed`. There is no Edge
   Function alternative; the old one was removed — see
   `supabase/functions/webhook-paystack/README.md` for why.
5. Do **not** set `EVOLVEIT_DEMO` on that host.
6. Schedule three jobs, each with `x-cron-secret`:

   | Job | Frequency | What it does |
   |---|---|---|
   | `POST /api/jobs/notifications` | every minute | drains the delivery outbox |
   | `jobs/installment-deadline` | hourly | reminds at 24h, defaults past the deadline |
   | `jobs/no-show` | hourly | releases tables and forfeits their deposits |

   Without the first, no buyer is sent their ticket.

7. Provision each door scanner with **two** localStorage values: `device_id`
   (which row in `devices`) and `device_key` (the secret whose sha256 is
   `devices.key_hash`). They are not the same value. A scanner with only an id
   is now rejected by both the hub and the cloud.

## Invariants the code enforces

- Tickets are minted only after a `pending_checkouts` row exists.
- `complete_paid_checkout` is one transaction: stock + tickets + access grant +
  ownership history + payments + ledger.
- The webhook checks the **amount, currency and status** on `charge.success`
  before issuing. A valid signature proves Paystack sent it, not that the
  customer paid what was asked.
- Every ledger posting group balances: `sum(DR) = sum(CR)` per
  `(ref_type, ref_id)`, enforced by a deferred constraint trigger. A
  half-posting aborts the transaction.
- Every posting is stamped with the shift it belongs to, resolved through
  `current_shift_id()`. Advance ticket sales are deliberately unstamped — they
  belong to no operating night — and the dashboard reconciles them back in via
  the event's check-in window.
- Door QR is minted on the server. The TOTP secret never goes to the browser.
- `redeem_ticket` locks the row. One redemption per ticket. An offline scan
  pushed up late is validated against **when it was scanned**, not when the
  cloud heard about it.
- Amounts are integer pesewas. Splits keep the remainder.
- Cash is counted by a manager into `shift_handovers`, one row per server per
  shift. A server cannot record their own hand-in.
- A checkout that loses the stock race is refunded automatically. The
  idempotency marker is claimed in the database *before* the Paystack call, so
  a webhook redelivery cannot refund twice. A refund that fails is recorded
  with `refund_status = 'failed'` and needs a person — query
  `pending_checkouts` where `refund_status` is `pending` or `failed`.
- Ticket delivery is queued into `notification_outbox` inside the same
  transaction as issuance and drained separately, so a slow WhatsApp API never
  holds a webhook open and a crash mid-send loses nothing.
- Installments take half up front. The ticket exists immediately but is
  `reserved`, which `redeem_ticket` refuses, and the money sits in
  `deposit_liability` until the balance lands. Revenue is recognised in full at
  that moment, not before.
- Deposits — table and installment alike — are liabilities until they are
  earned or forfeited. Nothing credits `forfeiture_income` without discharging
  the matching liability.
- `close_shift` refuses while any table is on an open tab or any server who
  took cash has not been counted down, and posts the variance to the ledger.

## What the browser key may touch

Nothing that holds money. `SUPABASE_ANON_KEY` ships in the client bundle, so
every financial read goes through a Next.js route holding the service role:

| Screen | Route |
|---|---|
| Owner dashboard, shift close | `GET /api/night` |
| Bar and kitchen rails | `GET /api/rail` |
| A server's own section | `GET /api/waiter` |
| Advancing a rail line | `POST /api/orders/status` |
| Counting a server in | `PATCH /api/shifts/close` |
| Closing the night | `POST /api/shifts/close` |
| Settling an installment balance | `GET`/`POST /api/checkout/balance` |
| Opening a paid pass | `POST /api/tickets/claim` |

`get_shift_revenue`, `get_waiter_cash_summary`, `get_night_dashboard`,
`compute_settlement`, `redeem_ticket` and the posting functions are
`SECURITY DEFINER` and granted to `service_role` only. If you add another,
`REVOKE ALL … FROM PUBLIC, anon, authenticated` in the same migration —
Postgres grants `EXECUTE` to `PUBLIC` by default.

## Demo data

`supabase/seed/demo_night.sql` builds one full Friday: 200 guests, 186 through
the door, GHS 130,000 taken across the gate and the bar, four servers on cash
with one materially short and one uncounted. It writes through the real
transaction functions, so it doubles as an integration test of the payment
paths, and it asserts its own totals — if a change silently drops revenue from
a posting path, the seed fails instead of the Friday.

```
psql "$DATABASE_URL" -f supabase/seed/demo_night.sql
```

It refuses to run against a tenant that already has ledger entries. The ledger
is append-only and there is no undo.

Demo staff PINs are seeded in `009` and in the demo night. Rotate them before
any public deploy — they are sha256 with no pepper.

## Things that were never true before, and are now

- `next build` works. `next.config.ts` is not a format Next 14 loads, so the
  build had never succeeded and `transpilePackages` had never been applied.
  The config is `next.config.mjs`.
- `packages/ui` is gone. Nothing imported it and it carried a third palette.

## Branch reconciliation, 31 Aug 2026

A second audit had been run independently on this codebase, on a branch
(`claude/continue-previous-ds4ie6`) that forked before migration 010 and never
merged forward. Most of its findings were already fixed here, differently and
more completely, by the time it was reviewed — real-time ticket issuance,
device authentication, TOTP encryption, and PIN throttling were all already
stronger on this line. The genuinely new, non-overlapping items were ported:

- **F&B MoMo orders had no working return path.** `orders/initiate` sent every
  MoMo payer to `/checkout/return`, which only ever checks `pending_checkouts`
  — an order's reference lives on `orders`. A guest who paid for a round at
  the bar sat on "Waiting for MoMo" forever. Fixed with a dedicated
  `/order/return` page and a `GET` on `/api/orders/status`. The same gap
  existed in demo mode from a different angle — nothing ever marked a demo
  F&B order paid — fixed alongside it.
- **A deactivated staff member's session stayed valid until it expired.**
  `getStaffSession()` verified the cookie's signature and expiry but never
  checked `users.is_active`. Fired staff or a compromised PIN now loses access
  immediately, not up to 12 hours later.
- **The hub had no startup validation or graceful shutdown.** A missing
  `SUPABASE_SERVICE_ROLE_KEY` failed confusingly on the first sync attempt
  instead of at boot; a `SIGTERM` (redeploy, reboot) could kill the process
  mid-write with the WAL never checkpointed — a real corruption risk for the
  one system that exists to survive the venue link going down.
- **Hub ticket sync filtered on `starts_at`**, an approximation, instead of
  `check_in_from`/`check_in_until`, the columns the schema defines specifically
  for the admission window.
- **A malformed ciphertext could 500 the door.** `decodeTotpSecret` in the
  redeem route wasn't wrapped — one corrupted row would throw instead of
  failing as a bad code for that one ticket.
- **Reservations had no state-machine validation.** Nothing stopped a seated
  guest (`arrived`) being flipped to `no_show`, forfeiting their deposit while
  they sat at the table.
- **`organiser/submissions` `POST` had no role check** — any signed-in staff
  member could file an event proposal.
- **`settlement-draft.ts` could silently skip an event forever.** `.single()`
  on `organiser_submissions` throws when a query matches more than one row,
  and nothing stops two `approved` submissions landing on the same event; the
  error was never checked, so the job just moved on with no settlement drafted
  and no record of why.
- **`devices.key_hash` had no index**, despite being the predicate on the
  door's single hottest query.
- A presence-only `middleware.ts` now redirects a signed-out visitor before
  the page shell renders for `/dashboard`, `/bar`, `/kitchen`, `/floor`,
  `/waiter`, `/organiser`, `/reissue`, `/staff/claim`. It checks only that the
  cookie exists — the actual signature verification needs `node:crypto`, which
  does not run in Next 14's Edge Middleware runtime (confirmed by trying: the
  build fails outright). Every route still calls `getStaffSession()` and
  re-verifies fully server-side; a forged cookie passes the middleware and is
  still correctly rejected there. The other branch's middleware imported the
  signing code directly and would have failed to build the first time anyone
  tried.
- 7 new unit tests (QR payload negative cases, phone/money edge cases, signed
  payload mutation, cross-key decrypt failure) and one new integration test
  (reservation status transitions), closing coverage gaps the other branch
  had found but never landed in a form trunk's test runner could use.

Declined, with reason: PBKDF2 for PINs (trunk's scrypt is already stronger,
swapping would just be churn plus a rehash migration), HMAC-keyed device
hashes (real device keys are 256-bit random per the provisioning instructions
above — a keyed HMAC only helps if an operator sets a weak one, and the
migration cost wasn't worth that marginal case), hub SSE client capping and
heartbeat (nothing in the current system consumes that endpoint — `/api/rail`
polling replaced it — so it's fixing dead code), and a device-registration API
(bigger scope than a reconciliation pass; still manual per the provisioning
note above).

## CI

`.github/workflows/ci.yml` type-checks and **builds** every workspace, runs the
shared unit tests, applies all migrations against a real Postgres, runs
`supabase/tests/money_paths.sql`, runs the demo night, and then asserts the
things that matter: that `anon` cannot read payroll or call
the money RPCs, that an unbalanced ledger entry is rejected, and that a night
with uncounted cash will not close.

`supabase/tests/money_paths.sql` covers the seven paths that carry money: a
sold-out race refunding exactly once, an installment ticket being refused at
the door until the balance lands, a lapsed plan returning its seat to stock and
keeping 10%, a table deposit held and forfeited, a comp valued at ticket face
rather than GHS 1, the outbox claiming a message once, and the whole book
balancing after all of it.
