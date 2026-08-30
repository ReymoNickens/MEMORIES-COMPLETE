# Removed — 30 Aug 2026

This Edge Function was a second, older implementation of the Paystack webhook
that `apps/web/src/app/api/webhooks/paystack/route.ts` already handles, and
ENGINEERS.md already points Paystack at the Next.js route. Keeping a divergent
copy live was a standing risk rather than a fallback:

- `encryptSecret()` base64-encoded the TOTP secret and said so in a comment.
  Anything it minted stored a door credential in plaintext-equivalent form.
- It inserted tickets directly instead of calling `complete_paid_checkout`, so
  it bypassed `pending_checkouts`, wrote no `ticket_access` grant and no
  `ownership_history` row, and was not atomic: a failed insert mid-loop left
  stock decremented with no ticket against it.
- `generateSerial()` drew six random base-36 characters for a UNIQUE column,
  with no retry on collision.
- The sold-out path called `triggerRefund()`, which was a `console.error` and a
  TODO. A customer charged for a sold-out ticket got neither ticket nor money.

If an Edge Function is wanted later — for latency, or to survive the Next.js
host being down — it must call `complete_paid_checkout` exactly as
`issue-tickets.ts` does, and encrypt with the same AES-GCM envelope from
`@evolveit/shared/crypto`. Do not restore this file.
