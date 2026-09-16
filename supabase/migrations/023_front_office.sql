-- Front Office (Section 6): walk-up cash ticket sales, reusing the checkout
-- and reservation logic that already exists for self-service customers
-- rather than inventing new business logic. Booking a table for a
-- not-yet-arrived guest and validating a ticket already work through
-- /api/reservations and the scanner/redeem path respectively — the gap is
-- selling a ticket for cash at the door, which never had a path that wasn't
-- Paystack.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Cash needs a named owner, same invariant as the bar
-- ─────────────────────────────────────────────────────────────────────────────
-- cash_collections was built for F&B cash orders only (order_id NOT NULL).
-- A ticket sold for cash needs the exact same accountability — a named
-- waiter/front-office server and an open shift, reconciled at shift close —
-- so this reuses the table rather than building a second cash-tracking
-- mechanism. close_shift, get_waiter_cash_summary and get_shift_revenue all
-- read cash_collections by shift_id/attributed_waiter_id/amount_pesewas only
-- (checked: none of them join back to `orders`), so widening what a row can
-- point at doesn't touch any of them — a cash ticket sale is reconciled at
-- shift close exactly like a cash bar tab, with zero changes to that code.
ALTER TABLE cash_collections ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE cash_collections ADD COLUMN IF NOT EXISTS ticket_checkout_id uuid REFERENCES pending_checkouts(id);
ALTER TABLE cash_collections DROP CONSTRAINT IF EXISTS cash_collections_one_source_check;
ALTER TABLE cash_collections ADD CONSTRAINT cash_collections_one_source_check
  CHECK ((order_id IS NOT NULL)::int + (ticket_checkout_id IS NOT NULL)::int = 1);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_collections_checkout ON cash_collections (ticket_checkout_id);

ALTER TABLE ticket_payments DROP CONSTRAINT IF EXISTS ticket_payments_method_check;
ALTER TABLE ticket_payments ADD CONSTRAINT ticket_payments_method_check
  CHECK (method IN ('momo', 'card', 'ussd', 'cash'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The raffle draw, factored out so it has exactly one implementation
-- ─────────────────────────────────────────────────────────────────────────────
-- complete_cash_ticket_checkout below needs the identical draw
-- complete_paid_checkout already runs — the fixed-count odds calculation is
-- the one piece of this feature that's genuinely expensive to get wrong
-- (per the build brief), so it gets one implementation both checkout paths
-- call rather than a second copy that can silently drift from the first.
CREATE OR REPLACE FUNCTION draw_raffle_for_ticket(
  p_event_id uuid,
  p_ticket_type_id uuid,
  p_ticket_id uuid,
  p_tenant_id uuid,
  p_stock_left int
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prize raffle_prizes;
BEGIN
  FOR v_prize IN
    SELECT * FROM raffle_prizes
     WHERE event_id = p_event_id
       AND active
       AND (ticket_type_id IS NULL OR ticket_type_id = p_ticket_type_id)
       AND quantity_remaining > 0
     ORDER BY id
  LOOP
    IF v_prize.win_mode = 'probability' THEN
      IF random() >= v_prize.win_probability THEN
        CONTINUE;
      END IF;
    ELSE
      IF random() >= v_prize.quantity_remaining::numeric / GREATEST(p_stock_left, v_prize.quantity_remaining) THEN
        CONTINUE;
      END IF;
    END IF;

    UPDATE raffle_prizes
       SET quantity_remaining = quantity_remaining - 1
     WHERE id = v_prize.id
       AND quantity_remaining > 0;
    IF FOUND THEN
      INSERT INTO ticket_rewards (ticket_id, raffle_prize_id, tenant_id)
      VALUES (p_ticket_id, v_prize.id, p_tenant_id);
      EXIT; -- one prize per ticket
    END IF;
  END LOOP;

  RETURN p_stock_left - 1;
END;
$$;
REVOKE ALL ON FUNCTION draw_raffle_for_ticket(uuid, uuid, uuid, uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION draw_raffle_for_ticket(uuid, uuid, uuid, uuid, int) TO service_role;

-- Re-defined only to call the shared draw above instead of the inline block
-- 020 introduced — behaviour is unchanged (still verified by the raffle
-- assertions in money_paths.sql).
CREATE OR REPLACE FUNCTION complete_paid_checkout(
  p_checkout_id uuid,
  p_tickets jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_co pending_checkouts;
  v_ticket_ids uuid[] := '{}';
  v_item jsonb;
  v_id uuid;
  v_serial text;
  v_sum bigint := 0;
  v_n int;
  v_method text;
  v_amount bigint;
  v_fee bigint;
  v_shift uuid;
  v_new_remaining int;
  v_stock_left int;
BEGIN
  SELECT * INTO v_co FROM pending_checkouts WHERE id = p_checkout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'checkout_not_found';
  END IF;

  IF v_co.status = 'issued' THEN
    SELECT coalesce(array_agg(p.ticket_id ORDER BY p.created_at), '{}')
      INTO v_ticket_ids
      FROM ticket_payments p
      WHERE p.paystack_ref LIKE v_co.paystack_ref || '%';
    RETURN jsonb_build_object('ok', true, 'already', true, 'ticket_ids', to_jsonb(v_ticket_ids));
  END IF;

  IF v_co.status NOT IN ('pending', 'paid') THEN
    RAISE EXCEPTION 'checkout_not_payable';
  END IF;

  v_n := jsonb_array_length(p_tickets);
  IF v_n IS NULL OR v_n <> v_co.quantity THEN
    RAISE EXCEPTION 'quantity_mismatch';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_tickets)
  LOOP
    v_sum := v_sum + COALESCE((v_item->>'amount_pesewas')::bigint, 0);
  END LOOP;

  IF v_sum <> v_co.amount_pesewas THEN
    RAISE EXCEPTION 'amount_mismatch';
  END IF;

  -- NULL outside an operating night: advance sales belong to no shift.
  v_shift := current_shift_id(v_co.tenant_id);

  UPDATE ticket_types
     SET remaining = remaining - v_co.quantity
   WHERE id = v_co.ticket_type_id
     AND remaining >= v_co.quantity
   RETURNING remaining INTO v_new_remaining;
  IF NOT FOUND THEN
    UPDATE pending_checkouts SET status = 'failed' WHERE id = v_co.id;
    RAISE EXCEPTION 'sold_out';
  END IF;

  v_stock_left := v_new_remaining + v_co.quantity;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_tickets)
  LOOP
    v_id := gen_random_uuid();
    v_serial := 'MNC-' || to_char(now() AT TIME ZONE 'UTC', 'YYYY') || '-' ||
                lpad(nextval('ticket_serial_seq')::text, 5, '0');
    v_method := COALESCE(NULLIF(v_item->>'method', ''), 'momo');
    IF v_method NOT IN ('momo', 'card', 'ussd') THEN
      v_method := 'momo';
    END IF;
    v_amount := (v_item->>'amount_pesewas')::bigint;
    v_fee := COALESCE((v_item->>'fee_pesewas')::bigint, 0);

    INSERT INTO tickets (
      id, ticket_type_id, event_id, tenant_id,
      buyer_phone, buyer_name, buyer_email,
      serial, totp_secret_enc, status, issued_at
    ) VALUES (
      v_id, v_co.ticket_type_id, v_co.event_id, v_co.tenant_id,
      v_co.buyer_phone, v_co.buyer_name, v_co.buyer_email,
      v_serial, v_item->>'totp_enc', 'issued', now()
    );

    INSERT INTO ticket_access (ticket_id, token_hash)
    VALUES (v_id, v_item->>'access_hash');

    INSERT INTO ownership_history (ticket_id, to_phone, reason)
    VALUES (v_id, v_co.buyer_phone, 'purchase');

    INSERT INTO ticket_payments (
      ticket_id, tenant_id, paystack_ref, amount_pesewas, fee_pesewas,
      status, method, webhook_received_at
    ) VALUES (
      v_id, v_co.tenant_id, v_item->>'paystack_ref',
      v_amount, v_fee, 'successful', v_method, now()
    );

    INSERT INTO ledger_entries (
      tenant_id, shift_id, event_id, account, direction, amount_pesewas, ref_type, ref_id, memo
    ) VALUES
      (v_co.tenant_id, v_shift, v_co.event_id, 'momo_clearing', 'DR', v_amount, 'ticket_payment', v_id, v_co.paystack_ref),
      (v_co.tenant_id, v_shift, v_co.event_id, 'ticket_revenue', 'CR', v_amount, 'ticket_payment', v_id, v_co.paystack_ref);

    IF v_fee > 0 THEN
      INSERT INTO ledger_entries (
        tenant_id, shift_id, event_id, account, direction, amount_pesewas, ref_type, ref_id, memo
      ) VALUES
        (v_co.tenant_id, v_shift, v_co.event_id, 'paystack_fees', 'DR', v_fee, 'ticket_payment', v_id, v_co.paystack_ref),
        (v_co.tenant_id, v_shift, v_co.event_id, 'momo_clearing', 'CR', v_fee, 'ticket_payment', v_id, v_co.paystack_ref);
    END IF;

    v_stock_left := draw_raffle_for_ticket(v_co.event_id, v_co.ticket_type_id, v_id, v_co.tenant_id, v_stock_left);
    v_ticket_ids := array_append(v_ticket_ids, v_id);
  END LOOP;

  UPDATE pending_checkouts SET status = 'issued' WHERE id = v_co.id;

  RETURN jsonb_build_object('ok', true, 'already', false, 'ticket_ids', to_jsonb(v_ticket_ids));
END;
$$;
REVOKE ALL ON FUNCTION complete_paid_checkout(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_paid_checkout(uuid, jsonb) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The cash walk-up equivalent
-- ─────────────────────────────────────────────────────────────────────────────
-- Same shape as complete_paid_checkout, minus Paystack fees, plus the same
-- "cash needs a named owner and an open night" rule place_order already
-- enforces for F&B cash.
CREATE OR REPLACE FUNCTION complete_cash_ticket_checkout(
  p_checkout_id uuid,
  p_tickets jsonb,
  p_waiter_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_co pending_checkouts;
  v_ticket_ids uuid[] := '{}';
  v_item jsonb;
  v_id uuid;
  v_serial text;
  v_sum bigint := 0;
  v_n int;
  v_amount bigint;
  v_shift uuid;
  v_new_remaining int;
  v_stock_left int;
BEGIN
  SELECT * INTO v_co FROM pending_checkouts WHERE id = p_checkout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'checkout_not_found';
  END IF;

  -- Not webhook-driven, but a flaky "Sell" tap can still retry the same
  -- request — same replay guard complete_paid_checkout gives the online path.
  IF v_co.status = 'issued' THEN
    SELECT coalesce(array_agg(p.ticket_id ORDER BY p.created_at), '{}')
      INTO v_ticket_ids
      FROM ticket_payments p
      WHERE p.paystack_ref LIKE v_co.paystack_ref || '%';
    RETURN jsonb_build_object('ok', true, 'already', true, 'ticket_ids', to_jsonb(v_ticket_ids));
  END IF;

  IF v_co.status NOT IN ('pending', 'paid') THEN
    RAISE EXCEPTION 'checkout_not_payable';
  END IF;

  v_n := jsonb_array_length(p_tickets);
  IF v_n IS NULL OR v_n <> v_co.quantity THEN
    RAISE EXCEPTION 'quantity_mismatch';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_tickets)
  LOOP
    v_sum := v_sum + COALESCE((v_item->>'amount_pesewas')::bigint, 0);
  END LOOP;
  IF v_sum <> v_co.amount_pesewas THEN
    RAISE EXCEPTION 'amount_mismatch';
  END IF;

  v_shift := current_shift_id(v_co.tenant_id);
  IF p_waiter_id IS NULL OR v_shift IS NULL THEN
    RAISE EXCEPTION 'cash_needs_waiter_and_shift';
  END IF;

  UPDATE ticket_types
     SET remaining = remaining - v_co.quantity
   WHERE id = v_co.ticket_type_id
     AND remaining >= v_co.quantity
   RETURNING remaining INTO v_new_remaining;
  IF NOT FOUND THEN
    UPDATE pending_checkouts SET status = 'failed' WHERE id = v_co.id;
    RAISE EXCEPTION 'sold_out';
  END IF;

  v_stock_left := v_new_remaining + v_co.quantity;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_tickets)
  LOOP
    v_id := gen_random_uuid();
    v_serial := 'MNC-' || to_char(now() AT TIME ZONE 'UTC', 'YYYY') || '-' ||
                lpad(nextval('ticket_serial_seq')::text, 5, '0');
    v_amount := (v_item->>'amount_pesewas')::bigint;

    INSERT INTO tickets (
      id, ticket_type_id, event_id, tenant_id,
      buyer_phone, buyer_name, buyer_email,
      serial, totp_secret_enc, status, issued_at
    ) VALUES (
      v_id, v_co.ticket_type_id, v_co.event_id, v_co.tenant_id,
      v_co.buyer_phone, v_co.buyer_name, v_co.buyer_email,
      v_serial, v_item->>'totp_enc', 'issued', now()
    );

    INSERT INTO ticket_access (ticket_id, token_hash)
    VALUES (v_id, v_item->>'access_hash');

    INSERT INTO ownership_history (ticket_id, to_phone, reason)
    VALUES (v_id, v_co.buyer_phone, 'purchase');

    INSERT INTO ticket_payments (
      ticket_id, tenant_id, paystack_ref, amount_pesewas, fee_pesewas,
      status, method, webhook_received_at
    ) VALUES (
      v_id, v_co.tenant_id, v_item->>'paystack_ref',
      v_amount, 0, 'successful', 'cash', now()
    );

    INSERT INTO ledger_entries (
      tenant_id, shift_id, event_id, account, direction, amount_pesewas, ref_type, ref_id, memo
    ) VALUES
      (v_co.tenant_id, v_shift, v_co.event_id, 'cash_drawer', 'DR', v_amount, 'ticket_payment', v_id, v_co.paystack_ref),
      (v_co.tenant_id, v_shift, v_co.event_id, 'ticket_revenue', 'CR', v_amount, 'ticket_payment', v_id, v_co.paystack_ref);

    v_stock_left := draw_raffle_for_ticket(v_co.event_id, v_co.ticket_type_id, v_id, v_co.tenant_id, v_stock_left);
    v_ticket_ids := array_append(v_ticket_ids, v_id);
  END LOOP;

  -- Same accountability as a cash F&B order: one row per sale, owned by the
  -- staff member who took the cash, reconciled at shift close.
  INSERT INTO cash_collections (
    tenant_id, shift_id, ticket_checkout_id, attributed_waiter_id, amount_pesewas
  ) VALUES (
    v_co.tenant_id, v_shift, v_co.id, p_waiter_id, v_sum
  );

  UPDATE pending_checkouts SET status = 'issued' WHERE id = v_co.id;

  RETURN jsonb_build_object('ok', true, 'already', false, 'ticket_ids', to_jsonb(v_ticket_ids));
END;
$$;
REVOKE ALL ON FUNCTION complete_cash_ticket_checkout(uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_cash_ticket_checkout(uuid, jsonb, uuid) TO service_role;
