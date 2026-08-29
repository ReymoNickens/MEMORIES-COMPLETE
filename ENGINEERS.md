# Memories / EvolveIT — engineer handoff

This repo is the venue OS. Demo money is off unless `EVOLVEIT_DEMO=1` **and** the Paystack key is not `sk_live`.

## Apply before first live charge

1. Run Supabase migrations `001` through `010` in order.
2. Generate secrets (do not commit):

```
openssl rand -hex 32   # TICKET_MASTER_KEY
openssl rand -hex 32   # STAFF_SESSION_SECRET
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

4. Point Paystack webhook at `/api/webhooks/paystack`.
5. Do **not** set `EVOLVEIT_DEMO` on that host.

## Invariants the code already enforces

- Tickets are minted only after a `pending_checkouts` row exists.
- `complete_paid_checkout` is one transaction: stock + tickets + ledger.
- Door QR is minted on the server. The TOTP secret never goes to the browser.
- `redeem_ticket` locks the row. One redemption per ticket.
- Amounts are integer pesewas. Splits keep the remainder.

## Demo staff (local only)

Seeded in `009_seed_demo.sql`. Rotate those PINs before a public deploy.
