-- Audit follow-up, 30 Aug 2026. Closes the four gaps left open by 017:
--
--   1. A sold-out race charged the customer and refunded nothing.
--   2. notify.ts implemented WhatsApp and SMS delivery and had no callers, so
--      no ticket was ever delivered to a buyer.
--   3. The installments flag was on, allow_installments was set on general
--      admission, use_installments was written to pending_checkouts — and no
--      payment_plans row was ever created, so the deadline job had nothing to
--      work on and a buyer who chose to pay in two never could.
--   4. Table deposits were recorded but never charged, so a deposit
--      reservation stayed pending forever and there was nothing to forfeit.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Refunds against a checkout that never became a ticket
-- ─────────────────────────────────────────────────────────────────────────────
-- ticket_payments.refund_ref already existed for refunding an issued ticket.
-- A sold-out race has no ticket row to hang a refund on — the money arrived
-- and complete_paid_checkout aborted — so the marker lives on the checkout.
ALTER TABLE pending_checkouts
  ADD COLUMN IF NOT EXISTS refund_ref             text UNIQUE,
  ADD COLUMN IF NOT EXISTS refund_amount_pesewas  bigint,
  ADD COLUMN IF NOT EXISTS refund_status          text
    CHECK (refund_status IS NULL OR refund_status IN ('pending', 'processed', 'failed')),
  ADD COLUMN IF NOT EXISTS refund_error           text,
  ADD COLUMN IF NOT EXISTS refunded_at            timestamptz;

ALTER TABLE pending_checkouts DROP CONSTRAINT IF EXISTS pending_checkouts_status_check;
ALTER TABLE pending_checkouts ADD CONSTRAINT pending_checkouts_status_check
  CHECK (status IN ('pending', 'paid', 'issued', 'part_paid', 'failed', 'refunding', 'refunded'));

-- Claim the right to refund exactly once. Returns false if another delivery of
-- the same webhook already took it, so a Paystack retry cannot double-refund
-- even before the API call is made.
CREATE OR REPLACE FUNCTION begin_checkout_refund(
  p_checkout_id uuid,
  p_refund_ref text,
  p_amount_pesewas bigint
) RETURNS bool
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_co pending_checkouts;
BEGIN
  SELECT * INTO v_co FROM pending_checkouts WHERE id = p_checkout_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'checkout_not_found'; END IF;

  -- Already refunding, refunded, or successfully issued: nothing owed back.
  IF v_co.refund_ref IS NOT NULL OR v_co.status IN ('issued', 'refunding', 'refunded') THEN
    RETURN false;
  END IF;

  UPDATE pending_checkouts
     SET status                = 'refunding',
         refund_ref            = p_refund_ref,
         refund_amount_pesewas = p_amount_pesewas,
         refund_status         = 'pending'
   WHERE id = p_checkout_id;
  RETURN true;
END; $$;

-- Settle the refund and put both sides of it on the record.
--
-- Nothing was booked when the charge landed, because complete_paid_checkout
-- aborted before writing any ledger row. But the money did move at Paystack,
-- and the clearing account has to reconcile against their settlement
-- statement — so the receipt is booked as a liability (it was never ours) and
-- then discharged by the refund. The fee, if Paystack kept it, is a real cost
-- of a race the club lost and is booked as one.
CREATE OR REPLACE FUNCTION settle_checkout_refund(
  p_checkout_id uuid,
  p_ok bool,
  p_fee_kept_pesewas bigint DEFAULT 0,
  p_error text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_co pending_checkouts;
  v_fee bigint := GREATEST(COALESCE(p_fee_kept_pesewas, 0), 0);
  v_shift uuid;
BEGIN
  SELECT * INTO v_co FROM pending_checkouts WHERE id = p_checkout_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'checkout_not_found'; END IF;

  IF NOT p_ok THEN
    -- Leave the refund_ref in place: it is the idempotency marker, and a
    -- failed refund must be visible and retried by a human, not silently
    -- dropped. The customer is out of pocket until it is.
    UPDATE pending_checkouts
       SET refund_status = 'failed', refund_error = p_error
     WHERE id = p_checkout_id;
    RETURN jsonb_build_object('ok', false, 'reason', 'refund_failed');
  END IF;

  IF v_co.refund_status = 'processed' THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;

  v_shift := current_shift_id(v_co.tenant_id);

  -- Received, and owed straight back.
  INSERT INTO ledger_entries (tenant_id, shift_id, event_id, account, direction, amount_pesewas, ref_type, ref_id, memo)
  VALUES
    (v_co.tenant_id, v_shift, v_co.event_id, 'momo_clearing',     'DR', v_co.amount_pesewas, 'checkout_refund', v_co.id, v_co.paystack_ref),
    (v_co.tenant_id, v_shift, v_co.event_id, 'deposit_liability', 'CR', v_co.amount_pesewas, 'checkout_refund', v_co.id, v_co.paystack_ref),
    (v_co.tenant_id, v_shift, v_co.event_id, 'deposit_liability', 'DR', v_co.amount_pesewas, 'checkout_refund', v_co.id, 'sold out — refunded'),
    (v_co.tenant_id, v_shift, v_co.event_id, 'momo_clearing',     'CR', v_co.amount_pesewas, 'checkout_refund', v_co.id, 'sold out — refunded');

  IF v_fee > 0 THEN
    INSERT INTO ledger_entries (tenant_id, shift_id, event_id, account, direction, amount_pesewas, ref_type, ref_id, memo)
    VALUES
      (v_co.tenant_id, v_shift, v_co.event_id, 'paystack_fees', 'DR', v_fee, 'checkout_refund', v_co.id, 'fee retained on refund'),
      (v_co.tenant_id, v_shift, v_co.event_id, 'momo_clearing', 'CR', v_fee, 'checkout_refund', v_co.id, 'fee retained on refund');
  END IF;

  UPDATE pending_checkouts
     SET status = 'refunded', refund_status = 'processed',
         refunded_at = now(), refund_error = NULL
   WHERE id = p_checkout_id;

  RETURN jsonb_build_object('ok', true, 'already', false, 'amount_pesewas', v_co.amount_pesewas);
END; $$;

REVOKE ALL ON FUNCTION begin_checkout_refund(uuid, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION settle_checkout_refund(uuid, bool, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION begin_checkout_refund(uuid, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION settle_checkout_refund(uuid, bool, bigint, text) TO service_role;

CREATE INDEX IF NOT EXISTS idx_checkouts_refund_attention
  ON pending_checkouts (tenant_id, refund_status)
  WHERE refund_status IN ('pending', 'failed');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. A delivery outbox
-- ─────────────────────────────────────────────────────────────────────────────
-- sendTicketDelivery() had no callers, so no buyer was ever sent anything.
-- Calling it inline from the webhook would be worse than nothing: Meta or
-- Arkesel being slow would hold the webhook open, and a failure there would
-- either lose the message or fail a webhook whose tickets are already issued.
-- The message is written in the same transaction as the ticket and drained
-- separately, so it survives the process dying mid-send.
CREATE TABLE IF NOT EXISTS notification_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  kind            text NOT NULL CHECK (kind IN (
    'ticket_delivery', 'installment_reminder', 'installment_defaulted',
    'reservation_deposit', 'reservation_cancelled'
  )),
  to_phone        text NOT NULL,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'sent', 'failed', 'abandoned')),
  attempts        int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  sent_at         timestamptz,
  -- Lets a caller enqueue the same logical message twice without sending it
  -- twice: a webhook redelivery re-runs issuance and re-enqueues.
  dedupe_key      text UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON notification_outbox FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_outbox_due
  ON notification_outbox (next_attempt_at)
  WHERE status IN ('queued', 'failed');

-- Take a batch and mark it in flight, so two overlapping drains do not both
-- send the same message.
CREATE OR REPLACE FUNCTION claim_outbox_batch(p_limit int DEFAULT 25)
RETURNS SETOF notification_outbox
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE notification_outbox o
     SET attempts = o.attempts + 1,
         -- Push the next attempt out before sending, so a crash mid-send does
         -- not spin: 1, 4, 9, 16 minutes.
         next_attempt_at = now() + ((o.attempts + 1) * (o.attempts + 1) * interval '1 minute')
   WHERE o.id IN (
     SELECT id FROM notification_outbox
      WHERE status IN ('queued', 'failed')
        AND next_attempt_at <= now()
        AND attempts < 5
      ORDER BY created_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING o.*;
$$;

CREATE OR REPLACE FUNCTION resolve_outbox(
  p_id uuid, p_ok bool, p_error text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_ok THEN
    UPDATE notification_outbox
       SET status = 'sent', sent_at = now(), last_error = NULL
     WHERE id = p_id;
  ELSE
    -- Five attempts over roughly half an hour, then stop and stay visible.
    -- A ticket the buyer never received is a person at the door, so this is
    -- abandoned loudly rather than deleted.
    UPDATE notification_outbox
       SET status = CASE WHEN attempts >= 5 THEN 'abandoned' ELSE 'failed' END,
           last_error = p_error
     WHERE id = p_id;
  END IF;
END; $$;

REVOKE ALL ON FUNCTION claim_outbox_batch(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION resolve_outbox(uuid, bool, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_outbox_batch(int) TO service_role;
GRANT EXECUTE ON FUNCTION resolve_outbox(uuid, bool, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Installments, end to end
-- ─────────────────────────────────────────────────────────────────────────────
-- The schema for this shipped in 002 and the default job in
-- jobs/installment-deadline.ts has been ready to expire plans since. Nothing
-- ever created one. A buyer who ticked "pay in two" was charged the full
-- amount like everyone else.
--
-- The shape, which is how layaway ticketing normally works:
--   · half now, half by 48 hours before doors
--   · the ticket exists immediately but is 'reserved', not 'issued' — it will
--     not open the door, and redeem_ticket already refuses anything that is
--     not 'issued'
--   · the money taken is a liability, not revenue, until the ticket is valid
--   · miss the deadline and the existing job voids it and refunds less a
--     forfeiture
ALTER TABLE payment_plans
  ADD COLUMN IF NOT EXISTS tenant_id       uuid REFERENCES tenants(id),
  ADD COLUMN IF NOT EXISTS checkout_id     uuid REFERENCES pending_checkouts(id),
  ADD COLUMN IF NOT EXISTS balance_ref     text UNIQUE,
  ADD COLUMN IF NOT EXISTS reminded_at     timestamptz;

ALTER TABLE payment_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON payment_plans FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_payment_plans_due
  ON payment_plans (status, deadline_at) WHERE status = 'active';

-- Ticket types that allow installments need a deadline to work back from.
CREATE OR REPLACE FUNCTION installment_deadline(p_event_id uuid)
RETURNS timestamptz LANGUAGE sql STABLE
SET search_path = public, pg_temp AS $$
  SELECT starts_at - interval '48 hours' FROM events WHERE id = p_event_id;
$$;

-- First leg. Mirrors complete_paid_checkout, but the ticket comes out
-- 'reserved' and the money is held rather than earned.
CREATE OR REPLACE FUNCTION complete_installment_checkout(
  p_checkout_id uuid,
  p_tickets jsonb,
  p_paid_pesewas bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_co pending_checkouts;
  v_ids uuid[] := '{}';
  v_item jsonb;
  v_id uuid;
  v_serial text;
  v_n int;
  v_shift uuid;
  v_deadline timestamptz;
  v_slice bigint;
  v_rem bigint;
  v_i int := 0;
BEGIN
  SELECT * INTO v_co FROM pending_checkouts WHERE id = p_checkout_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'checkout_not_found'; END IF;

  IF v_co.status IN ('part_paid', 'issued') THEN
    SELECT coalesce(array_agg(pp.ticket_id), '{}') INTO v_ids
      FROM payment_plans pp WHERE pp.checkout_id = v_co.id;
    RETURN jsonb_build_object('ok', true, 'already', true, 'ticket_ids', to_jsonb(v_ids));
  END IF;
  IF v_co.status NOT IN ('pending', 'paid') THEN RAISE EXCEPTION 'checkout_not_payable'; END IF;
  IF NOT v_co.use_installments THEN RAISE EXCEPTION 'not_an_installment_checkout'; END IF;

  v_n := jsonb_array_length(p_tickets);
  IF v_n IS NULL OR v_n <> v_co.quantity THEN RAISE EXCEPTION 'quantity_mismatch'; END IF;

  -- The first leg must be at least half, or the club is carrying the risk.
  IF p_paid_pesewas < (v_co.amount_pesewas + 1) / 2 THEN
    RAISE EXCEPTION 'first_installment_too_small';
  END IF;
  IF p_paid_pesewas >= v_co.amount_pesewas THEN
    RAISE EXCEPTION 'paid_in_full_use_complete_paid_checkout';
  END IF;

  v_deadline := installment_deadline(v_co.event_id);
  IF v_deadline IS NULL OR v_deadline <= now() THEN
    RAISE EXCEPTION 'too_late_for_installments';
  END IF;

  -- Stock is committed now. A reserved seat is a sold seat: the club cannot
  -- sell it twice and then choose which buyer to disappoint.
  UPDATE ticket_types SET remaining = remaining - v_co.quantity
   WHERE id = v_co.ticket_type_id AND remaining >= v_co.quantity;
  IF NOT FOUND THEN
    UPDATE pending_checkouts SET status = 'failed' WHERE id = v_co.id;
    RAISE EXCEPTION 'sold_out';
  END IF;

  v_shift := current_shift_id(v_co.tenant_id);
  v_slice := p_paid_pesewas / v_co.quantity;
  v_rem   := p_paid_pesewas - (v_slice * v_co.quantity);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_tickets)
  LOOP
    v_i := v_i + 1;
    v_id := gen_random_uuid();
    v_serial := 'MNC-' || to_char(now() AT TIME ZONE 'UTC', 'YYYY') || '-' ||
                lpad(nextval('ticket_serial_seq')::text, 5, '0');

    INSERT INTO tickets (
      id, ticket_type_id, event_id, tenant_id,
      buyer_phone, buyer_name, buyer_email,
      serial, totp_secret_enc, status
    ) VALUES (
      v_id, v_co.ticket_type_id, v_co.event_id, v_co.tenant_id,
      v_co.buyer_phone, v_co.buyer_name, v_co.buyer_email,
      v_serial, v_item->>'totp_enc', 'reserved'
    );

    INSERT INTO ticket_access (ticket_id, token_hash) VALUES (v_id, v_item->>'access_hash');
    INSERT INTO ownership_history (ticket_id, to_phone, reason) VALUES (v_id, v_co.buyer_phone, 'purchase');

    INSERT INTO ticket_payments (
      ticket_id, tenant_id, paystack_ref, amount_pesewas, fee_pesewas,
      status, method, webhook_received_at
    ) VALUES (
      v_id, v_co.tenant_id, v_item->>'paystack_ref',
      v_slice + CASE WHEN v_i = v_co.quantity THEN v_rem ELSE 0 END,
      COALESCE((v_item->>'fee_pesewas')::bigint, 0),
      'successful', COALESCE(NULLIF(v_item->>'method', ''), 'momo'), now()
    );

    INSERT INTO payment_plans (
      tenant_id, checkout_id, ticket_id, total_pesewas, paid_pesewas,
      installments_n, deadline_at, status
    ) VALUES (
      v_co.tenant_id, v_co.id, v_id,
      v_co.amount_pesewas / v_co.quantity,
      v_slice + CASE WHEN v_i = v_co.quantity THEN v_rem ELSE 0 END,
      2, v_deadline, 'active'
    );

    v_ids := array_append(v_ids, v_id);
  END LOOP;

  -- Held, not earned. Revenue is recognised when the ticket becomes valid.
  INSERT INTO ledger_entries (tenant_id, shift_id, event_id, account, direction, amount_pesewas, ref_type, ref_id, memo)
  VALUES
    (v_co.tenant_id, v_shift, v_co.event_id, 'momo_clearing',     'DR', p_paid_pesewas, 'installment', v_co.id, v_co.paystack_ref),
    (v_co.tenant_id, v_shift, v_co.event_id, 'deposit_liability', 'CR', p_paid_pesewas, 'installment', v_co.id, 'first installment held');

  UPDATE pending_checkouts SET status = 'part_paid' WHERE id = v_co.id;

  RETURN jsonb_build_object(
    'ok', true, 'already', false,
    'ticket_ids', to_jsonb(v_ids),
    'balance_pesewas', v_co.amount_pesewas - p_paid_pesewas,
    'deadline_at', v_deadline
  );
END; $$;

-- Second leg. The balance lands, the tickets become admissible, and the whole
-- amount moves out of the liability and into revenue at once — which is the
-- moment the club has actually earned it.
CREATE OR REPLACE FUNCTION complete_installment_balance(
  p_checkout_id uuid,
  p_paid_pesewas bigint,
  p_fee_pesewas bigint DEFAULT 0,
  p_paystack_ref text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_co pending_checkouts;
  v_plan payment_plans;
  v_ids uuid[] := '{}';
  v_shift uuid;
  v_outstanding bigint;
  v_first bigint;
  v_fee bigint := GREATEST(COALESCE(p_fee_pesewas, 0), 0);
BEGIN
  SELECT * INTO v_co FROM pending_checkouts WHERE id = p_checkout_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'checkout_not_found'; END IF;

  IF v_co.status = 'issued' THEN
    SELECT coalesce(array_agg(pp.ticket_id), '{}') INTO v_ids
      FROM payment_plans pp WHERE pp.checkout_id = v_co.id;
    RETURN jsonb_build_object('ok', true, 'already', true, 'ticket_ids', to_jsonb(v_ids));
  END IF;
  IF v_co.status <> 'part_paid' THEN RAISE EXCEPTION 'no_balance_outstanding'; END IF;

  SELECT COALESCE(SUM(paid_pesewas), 0) INTO v_first
    FROM payment_plans WHERE checkout_id = v_co.id;
  v_outstanding := v_co.amount_pesewas - v_first;

  IF p_paid_pesewas < v_outstanding THEN
    RAISE EXCEPTION 'balance_underpaid:%', v_outstanding;
  END IF;

  -- A plan that already defaulted has had its ticket voided and its first leg
  -- refunded. Money arriving after that is not a balance payment.
  IF EXISTS (SELECT 1 FROM payment_plans WHERE checkout_id = v_co.id AND status <> 'active') THEN
    RAISE EXCEPTION 'plan_no_longer_active';
  END IF;

  v_shift := current_shift_id(v_co.tenant_id);

  FOR v_plan IN SELECT * FROM payment_plans WHERE checkout_id = v_co.id FOR UPDATE
  LOOP
    UPDATE tickets
       SET status = 'issued', issued_at = now()
     WHERE id = v_plan.ticket_id AND status = 'reserved';

    UPDATE payment_plans
       SET paid_pesewas = total_pesewas, status = 'completed'
     WHERE id = v_plan.id;

    INSERT INTO ticket_payments (
      ticket_id, tenant_id, paystack_ref, amount_pesewas, fee_pesewas,
      status, method, webhook_received_at
    ) VALUES (
      v_plan.ticket_id, v_co.tenant_id,
      COALESCE(p_paystack_ref, v_co.paystack_ref) || '-bal-' || v_plan.ticket_id::text,
      v_plan.total_pesewas - v_plan.paid_pesewas, 0,
      'successful', 'momo', now()
    );

    v_ids := array_append(v_ids, v_plan.ticket_id);
  END LOOP;

  INSERT INTO ledger_entries (tenant_id, shift_id, event_id, account, direction, amount_pesewas, ref_type, ref_id, memo)
  VALUES
    -- The balance arrives.
    (v_co.tenant_id, v_shift, v_co.event_id, 'momo_clearing',     'DR', v_outstanding, 'installment', v_co.id, 'balance'),
    (v_co.tenant_id, v_shift, v_co.event_id, 'deposit_liability', 'CR', v_outstanding, 'installment', v_co.id, 'balance held'),
    -- And the whole thing is earned.
    (v_co.tenant_id, v_shift, v_co.event_id, 'deposit_liability', 'DR', v_co.amount_pesewas, 'installment', v_co.id, 'plan completed'),
    (v_co.tenant_id, v_shift, v_co.event_id, 'ticket_revenue',    'CR', v_co.amount_pesewas, 'installment', v_co.id, 'plan completed');

  IF v_fee > 0 THEN
    INSERT INTO ledger_entries (tenant_id, shift_id, event_id, account, direction, amount_pesewas, ref_type, ref_id, memo)
    VALUES
      (v_co.tenant_id, v_shift, v_co.event_id, 'paystack_fees', 'DR', v_fee, 'installment', v_co.id, 'balance fee'),
      (v_co.tenant_id, v_shift, v_co.event_id, 'momo_clearing', 'CR', v_fee, 'installment', v_co.id, 'balance fee');
  END IF;

  UPDATE pending_checkouts SET status = 'issued' WHERE id = v_co.id;

  RETURN jsonb_build_object('ok', true, 'already', false, 'ticket_ids', to_jsonb(v_ids));
END; $$;

-- Default. The existing job voided the ticket and refunded through Paystack
-- but wrote nothing to the ledger, so a forfeiture never reached the P&L and
-- the held liability was never discharged.
CREATE OR REPLACE FUNCTION default_installment_plan(
  p_plan_id uuid,
  p_forfeit_bps int DEFAULT 1000     -- 10%, matching the existing job
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan payment_plans;
  v_shift uuid;
  v_forfeit bigint;
  v_refund bigint;
  v_type_id uuid;
BEGIN
  SELECT * INTO v_plan FROM payment_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan_not_found'; END IF;
  IF v_plan.status <> 'active' THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;

  -- The forfeiture is a share of the plan's face value, not of what was paid,
  -- and it can never exceed what the club is actually holding.
  v_forfeit := LEAST(v_plan.paid_pesewas,
                     (v_plan.total_pesewas * p_forfeit_bps) / 10000);
  v_refund  := v_plan.paid_pesewas - v_forfeit;
  v_shift   := current_shift_id(v_plan.tenant_id);

  UPDATE payment_plans SET status = 'defaulted' WHERE id = p_plan_id;

  UPDATE tickets
     SET status = 'voided', voided_at = now(), voided_reason = 'installment_defaulted'
   WHERE id = v_plan.ticket_id
   RETURNING ticket_type_id INTO v_type_id;

  INSERT INTO revocations (ticket_id, reason)
  VALUES (v_plan.ticket_id, 'installment_defaulted')
  ON CONFLICT (ticket_id) DO NOTHING;

  -- The seat goes back on sale. It was held for a buyer who did not complete.
  UPDATE ticket_types SET remaining = LEAST(total, remaining + 1) WHERE id = v_type_id;

  IF v_forfeit > 0 THEN
    INSERT INTO ledger_entries (tenant_id, shift_id, account, direction, amount_pesewas, ref_type, ref_id, memo)
    VALUES
      (v_plan.tenant_id, v_shift, 'deposit_liability',  'DR', v_forfeit, 'installment_default', p_plan_id, 'forfeiture retained'),
      (v_plan.tenant_id, v_shift, 'forfeiture_income',  'CR', v_forfeit, 'installment_default', p_plan_id, 'forfeiture retained');
  END IF;

  IF v_refund > 0 THEN
    INSERT INTO ledger_entries (tenant_id, shift_id, account, direction, amount_pesewas, ref_type, ref_id, memo)
    VALUES
      (v_plan.tenant_id, v_shift, 'deposit_liability', 'DR', v_refund, 'installment_default', p_plan_id, 'balance returned'),
      (v_plan.tenant_id, v_shift, 'momo_clearing',     'CR', v_refund, 'installment_default', p_plan_id, 'balance returned');
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'already', false,
    'ticket_id', v_plan.ticket_id,
    'forfeit_pesewas', v_forfeit,
    'refund_pesewas', v_refund
  );
END; $$;

REVOKE ALL ON FUNCTION complete_installment_checkout(uuid, jsonb, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION complete_installment_balance(uuid, bigint, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION default_installment_plan(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_installment_checkout(uuid, jsonb, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION complete_installment_balance(uuid, bigint, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION default_installment_plan(uuid, int) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. The organiser comp allowance was valued at GHS 1 per comp
-- ─────────────────────────────────────────────────────────────────────────────
-- compute_settlement read `comp_allowance * 100` as pesewas.
-- organiser_submissions.comp_allowance sits beside estimated_attendance and is
-- a count of comped entries, so multiplying by 100 valued every free entry at
-- one cedi. On an event with a 50-comp allowance and GHS 80 general admission
-- the organiser was charged for GHS 3,950 of comps they had been promised.
COMMENT ON COLUMN organiser_submissions.comp_allowance IS
  'Number of comped entries the organiser may give away, valued at the
   event''s lowest ticket face value by compute_settlement. A count, not money.';

CREATE OR REPLACE FUNCTION compute_settlement(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event events;
  v_tenant tenants;
  v_gate_gross bigint;
  v_table_gross bigint;
  v_refunds bigint;
  v_comps bigint;
  v_comp_allowance_n int;
  v_face bigint;
  v_comp_allowance_pesewas bigint;
  v_net_gate bigint;
  v_organiser_gate bigint;
  v_organiser_table bigint;
  v_excess_comps bigint;
  v_organiser_total bigint;
  v_club_total bigint;
BEGIN
  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'event_not_found'); END IF;
  SELECT * INTO v_tenant FROM tenants WHERE id = v_event.tenant_id;

  SELECT COALESCE(SUM(amount_pesewas) FILTER (WHERE account = 'ticket_revenue' AND direction = 'CR'), 0),
         COALESCE(SUM(amount_pesewas) FILTER (WHERE account = 'fb_revenue'     AND direction = 'CR'), 0),
         COALESCE(SUM(amount_pesewas) FILTER (WHERE account = 'refunds'        AND direction = 'DR'), 0),
         COALESCE(SUM(amount_pesewas) FILTER (WHERE account = 'comps'          AND direction = 'DR'), 0)
    INTO v_gate_gross, v_table_gross, v_refunds, v_comps
    FROM ledger_entries WHERE event_id = p_event_id;

  SELECT COALESCE(os.comp_allowance, 0) INTO v_comp_allowance_n
    FROM organiser_submissions os WHERE os.event_id = p_event_id;
  v_comp_allowance_n := COALESCE(v_comp_allowance_n, 0);

  -- A comped entry is worth what the cheapest paid entry costs. Using the top
  -- price would let an organiser paper the room against VIP face value.
  SELECT COALESCE(MIN(price_pesewas), 0) INTO v_face
    FROM ticket_types WHERE event_id = p_event_id AND price_pesewas > 0;

  v_comp_allowance_pesewas := v_comp_allowance_n * v_face;

  -- Refunds reduce the gate they were refunded from before it is split, so the
  -- organiser is not paid a share of money the club gave back.
  v_net_gate := GREATEST(0, v_gate_gross - v_refunds);

  v_organiser_gate  := ROUND(v_net_gate    * (10000 - v_tenant.gate_split_club_bps)  / 10000.0);
  v_organiser_table := ROUND(v_table_gross * (10000 - v_tenant.table_split_club_bps) / 10000.0);

  -- Comps inside the allowance are the club's cost of doing the night; only
  -- what the organiser gave away beyond it comes out of their share.
  v_excess_comps    := GREATEST(0, v_comps - v_comp_allowance_pesewas);
  v_organiser_total := GREATEST(0, v_organiser_gate + v_organiser_table - v_excess_comps);

  -- The club keeps everything that is left after the organiser is paid and the
  -- comps the club agreed to absorb are taken off.
  v_club_total := v_net_gate + v_table_gross
                  - LEAST(v_comps, v_comp_allowance_pesewas)
                  - v_organiser_total;

  RETURN jsonb_build_object(
    'ok',                    true,
    'gate_gross',            v_gate_gross,
    'table_gross',           v_table_gross,
    'refunds',               v_refunds,
    'net_gate',              v_net_gate,
    'comps',                 v_comps,
    'comp_allowance_count',  v_comp_allowance_n,
    'comp_face_pesewas',     v_face,
    'comp_allowance',        v_comp_allowance_pesewas,
    'comps_over_allowance',  v_excess_comps,
    'organiser_gate',        v_organiser_gate,
    'organiser_table',       v_organiser_table,
    'organiser_total',       v_organiser_total,
    'club_total',            v_club_total,
    'gate_split_club_bps',   v_tenant.gate_split_club_bps,
    'table_split_club_bps',  v_tenant.table_split_club_bps
  );
END; $$;
REVOKE ALL ON FUNCTION compute_settlement(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION compute_settlement(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Table deposits are actually taken
-- ─────────────────────────────────────────────────────────────────────────────
-- The floor screen wrote deposit_pesewas and set the reservation to pending,
-- but raised no charge — so a deposit booking stayed pending forever, the
-- confirm-on-webhook branch never fired, and the no-show job had nothing to
-- forfeit. Booking the deposit as a liability is what makes the forfeiture in
-- jobs/no-show.ts a real transfer rather than income out of nowhere.
CREATE OR REPLACE FUNCTION confirm_reservation_deposit(
  p_reservation_id uuid,
  p_paid_pesewas bigint,
  p_paystack_ref text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res table_reservations;
  v_shift uuid;
BEGIN
  SELECT * INTO v_res FROM table_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation_not_found'; END IF;

  IF v_res.deposit_paid_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;
  IF p_paid_pesewas < v_res.deposit_pesewas THEN
    RAISE EXCEPTION 'deposit_underpaid';
  END IF;

  v_shift := current_shift_id(v_res.tenant_id);

  UPDATE table_reservations
     SET status = 'confirmed', deposit_paid_at = now(), paystack_ref = p_paystack_ref
   WHERE id = p_reservation_id;

  -- Held against the table, not earned. It becomes income if they no-show and
  -- comes off their bill if they turn up.
  INSERT INTO ledger_entries (tenant_id, shift_id, event_id, account, direction, amount_pesewas, ref_type, ref_id, memo)
  VALUES
    (v_res.tenant_id, v_shift, v_res.event_id, 'momo_clearing',     'DR', v_res.deposit_pesewas, 'reservation', v_res.id, p_paystack_ref),
    (v_res.tenant_id, v_shift, v_res.event_id, 'deposit_liability', 'CR', v_res.deposit_pesewas, 'reservation', v_res.id, 'table deposit held');

  RETURN jsonb_build_object('ok', true, 'already', false, 'amount_pesewas', v_res.deposit_pesewas);
END; $$;
REVOKE ALL ON FUNCTION confirm_reservation_deposit(uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_reservation_deposit(uuid, bigint, text) TO service_role;

-- Forfeiting a no-show deposit. The old job wrote a lone credit to
-- forfeiture_income with no matching debit, which the 017 balance trigger now
-- rejects outright — income appearing from nowhere while the liability the
-- club was carrying stayed on the book forever.
CREATE OR REPLACE FUNCTION forfeit_reservation_deposit(p_reservation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res table_reservations;
  v_shift uuid;
BEGIN
  SELECT * INTO v_res FROM table_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation_not_found'; END IF;
  IF v_res.status = 'no_show' THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;

  UPDATE table_reservations SET status = 'no_show' WHERE id = p_reservation_id;

  -- Only a deposit that was actually taken can be forfeited.
  IF v_res.deposit_pesewas > 0 AND v_res.deposit_paid_at IS NOT NULL THEN
    v_shift := current_shift_id(v_res.tenant_id);
    INSERT INTO ledger_entries (tenant_id, shift_id, event_id, account, direction, amount_pesewas, ref_type, ref_id, memo)
    VALUES
      (v_res.tenant_id, v_shift, v_res.event_id, 'deposit_liability', 'DR', v_res.deposit_pesewas, 'reservation_forfeit', v_res.id, 'no-show: deposit released'),
      (v_res.tenant_id, v_shift, v_res.event_id, 'forfeiture_income', 'CR', v_res.deposit_pesewas, 'reservation_forfeit', v_res.id, 'no-show: ' || v_res.guest_name);
  END IF;

  RETURN jsonb_build_object('ok', true, 'already', false, 'forfeited_pesewas',
    CASE WHEN v_res.deposit_paid_at IS NOT NULL THEN v_res.deposit_pesewas ELSE 0 END);
END; $$;
REVOKE ALL ON FUNCTION forfeit_reservation_deposit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION forfeit_reservation_deposit(uuid) TO service_role;
