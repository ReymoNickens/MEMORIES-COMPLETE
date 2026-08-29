-- HIGH-3: Atomic ticket issuance — stock decrement and all related inserts in one transaction.
-- A mid-loop failure previously left stock decremented with no tickets issued.
CREATE OR REPLACE FUNCTION issue_tickets_atomic(
  p_checkout_id    uuid,
  p_tenant_id      uuid,
  p_event_id       uuid,
  p_ticket_type_id uuid,
  p_quantity       int,
  p_buyer_name     text,
  p_buyer_phone    text,
  p_buyer_email    text,
  p_paystack_ref   text,
  p_amount_pesewas bigint,
  p_fee_pesewas    bigint,
  p_method         text,
  p_totp_secrets   text[],   -- AES-256-GCM encrypted, one per ticket
  p_serials        text[],   -- pre-generated serials, one per ticket
  p_token_hashes   text[]    -- sha256(access_token), one per ticket — raw tokens not stored
) RETURNS TABLE (ticket_id uuid) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ticket_id  uuid;
  v_per_amount bigint;
  v_per_fee    bigint;
  i            int;
BEGIN
  UPDATE ticket_types
  SET remaining = remaining - p_quantity
  WHERE id = p_ticket_type_id AND remaining >= p_quantity;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sold_out';
  END IF;

  v_per_amount := ROUND(p_amount_pesewas::numeric / p_quantity);
  v_per_fee    := ROUND(p_fee_pesewas::numeric / p_quantity);

  FOR i IN 1..p_quantity LOOP
    INSERT INTO tickets (
      ticket_type_id, event_id, tenant_id,
      buyer_phone, buyer_name, buyer_email,
      serial, totp_secret_enc, status, issued_at
    ) VALUES (
      p_ticket_type_id, p_event_id, p_tenant_id,
      p_buyer_phone, p_buyer_name, p_buyer_email,
      p_serials[i], p_totp_secrets[i], 'issued', now()
    ) RETURNING id INTO v_ticket_id;

    INSERT INTO ticket_access (ticket_id, token_hash)
    VALUES (v_ticket_id, p_token_hashes[i]);

    INSERT INTO ownership_history (ticket_id, to_phone, reason)
    VALUES (v_ticket_id, p_buyer_phone, 'purchase');

    INSERT INTO ticket_payments (
      ticket_id, tenant_id, paystack_ref,
      amount_pesewas, fee_pesewas, status, method, webhook_received_at
    ) VALUES (
      v_ticket_id, p_tenant_id, p_paystack_ref || '-' || i,
      v_per_amount, v_per_fee, 'successful', p_method, now()
    );

    -- Double-entry: DR momo_clearing / CR ticket_revenue
    INSERT INTO ledger_entries (
      tenant_id, event_id, account, direction, amount_pesewas, ref_type, ref_id, memo
    ) VALUES
    (p_tenant_id, p_event_id, 'momo_clearing', 'DR', v_per_amount, 'ticket_payment', v_ticket_id, p_paystack_ref),
    (p_tenant_id, p_event_id, 'ticket_revenue', 'CR', v_per_amount, 'ticket_payment', v_ticket_id, p_paystack_ref);

    RETURN NEXT v_ticket_id;
  END LOOP;

  -- Mark checkout issued; access_tokens stored separately (encrypted) by the caller
  UPDATE pending_checkouts SET status = 'issued' WHERE id = p_checkout_id;
END;
$$;

-- HIGH-9: Atomic void + revocation for defaulted installment plans.
-- Previously the three writes were non-atomic; a crash between them left the plan
-- defaulted but the ticket still valid (or vice versa).
CREATE OR REPLACE FUNCTION void_defaulted_plan(
  p_plan_id   uuid,
  p_ticket_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Idempotent: if plan is already defaulted, nothing to do
  UPDATE payment_plans
  SET status = 'defaulted'
  WHERE id = p_plan_id AND status = 'active';

  IF NOT FOUND THEN RETURN; END IF;

  UPDATE tickets
  SET status = 'voided',
      voided_at = now(),
      voided_reason = 'installment_defaulted'
  WHERE id = p_ticket_id;

  -- revocations.ticket_id is a PK so ON CONFLICT is safe for idempotency
  INSERT INTO revocations (ticket_id, reason)
  VALUES (p_ticket_id, 'installment_defaulted')
  ON CONFLICT (ticket_id) DO NOTHING;
END;
$$;

-- CRIT-6: Add column for PBKDF2-SHA256 PIN hashes (stronger than plain SHA-256).
-- Login migrates users transparently on next successful login.
ALTER TABLE staff_credentials
  ADD COLUMN IF NOT EXISTS pin_hash_v2 text;
