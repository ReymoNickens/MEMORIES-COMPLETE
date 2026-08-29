-- Store issued access tokens on the pending_checkout row so the
-- polling /api/tickets/status endpoint can return them to the customer
-- without storing raw tokens long-term elsewhere.
ALTER TABLE pending_checkouts
  ADD COLUMN IF NOT EXISTS access_tokens text[] DEFAULT NULL;
