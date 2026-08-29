-- Atomic paid-checkout completion. Stock, tickets, access, payments, and
-- ledger rows commit together or not at all.

CREATE SEQUENCE IF NOT EXISTS ticket_serial_seq;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_access_hash ON ticket_access(token_hash);

CREATE OR REPLACE FUNCTION complete_paid_checkout(
  p_checkout_id uuid,
  p_tickets jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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

  UPDATE ticket_types
     SET remaining = remaining - v_co.quantity
   WHERE id = v_co.ticket_type_id
     AND remaining >= v_co.quantity;
  IF NOT FOUND THEN
    UPDATE pending_checkouts SET status = 'failed' WHERE id = v_co.id;
    RAISE EXCEPTION 'sold_out';
  END IF;

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
      tenant_id, event_id, account, direction, amount_pesewas, ref_type, ref_id, memo
    ) VALUES
      (v_co.tenant_id, v_co.event_id, 'momo_clearing', 'DR', v_amount, 'ticket_payment', v_id, v_co.paystack_ref),
      (v_co.tenant_id, v_co.event_id, 'ticket_revenue', 'CR', v_amount, 'ticket_payment', v_id, v_co.paystack_ref);

    IF v_fee > 0 THEN
      INSERT INTO ledger_entries (
        tenant_id, event_id, account, direction, amount_pesewas, ref_type, ref_id, memo
      ) VALUES
        (v_co.tenant_id, v_co.event_id, 'paystack_fees', 'DR', v_fee, 'ticket_payment', v_id, v_co.paystack_ref),
        (v_co.tenant_id, v_co.event_id, 'momo_clearing', 'CR', v_fee, 'ticket_payment', v_id, v_co.paystack_ref);
    END IF;

    v_ticket_ids := array_append(v_ticket_ids, v_id);
  END LOOP;

  UPDATE pending_checkouts SET status = 'issued' WHERE id = v_co.id;

  RETURN jsonb_build_object('ok', true, 'already', false, 'ticket_ids', to_jsonb(v_ticket_ids));
END;
$$;

REVOKE ALL ON FUNCTION complete_paid_checkout(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_paid_checkout(uuid, jsonb) TO service_role;
