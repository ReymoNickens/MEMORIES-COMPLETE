-- Raffle / reward system.
--
-- Design constraint from the build brief: the draw must happen inside
-- complete_paid_checkout itself, in the same transaction that mints the
-- ticket, never as a step before or after it. A ticket must never exist
-- without its reward outcome already decided, and a rolled-back checkout
-- must never have consumed a prize from the pool. Putting the draw in a
-- trigger on `tickets` would satisfy "same transaction" too, but a trigger
-- can't see `p_tickets` (the per-item amount/method/paystack_ref payload)
-- and would fire again on every future UPDATE of a ticket row unless
-- carefully guarded — folding it into the existing insert loop is simpler
-- and keeps the whole issuance path in one place to audit.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Schema
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS raffle_prizes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid NOT NULL REFERENCES events(id),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  -- NULL = eligible across every ticket type on the event; set = scoped to
  -- one ticket type, per "a probability per ticket type" in the brief.
  ticket_type_id      uuid REFERENCES ticket_types(id),
  name                text NOT NULL,
  description         text,
  redemption_type      text NOT NULL CHECK (redemption_type IN ('free_item', 'upgrade', 'digital_only')),
  win_mode            text NOT NULL CHECK (win_mode IN ('fixed_count', 'probability')),
  -- Only meaningful when win_mode = 'probability'. A fraction in [0,1].
  win_probability     numeric(6,5) CHECK (win_probability IS NULL OR (win_probability >= 0 AND win_probability <= 1)),
  quantity_available  int NOT NULL CHECK (quantity_available >= 0),
  quantity_remaining  int NOT NULL CHECK (quantity_remaining >= 0),
  -- If the prize costs the venue money when honored (a free drink, an
  -- upgrade), the ledger account it posts against — 'comps' in practice.
  -- NULL/0 for a digital-only prize with no redemption cost.
  ledger_account      text CHECK (ledger_account IS NULL OR ledger_account IN (
                        'comps', 'fb_revenue', 'ticket_revenue'
                      )),
  cost_pesewas        bigint NOT NULL DEFAULT 0 CHECK (cost_pesewas >= 0),
  active              bool NOT NULL DEFAULT true,
  created_by          uuid NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (quantity_remaining <= quantity_available),
  CHECK (win_mode <> 'probability' OR win_probability IS NOT NULL),
  CHECK (cost_pesewas = 0 OR ledger_account IS NOT NULL)
);
ALTER TABLE raffle_prizes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON raffle_prizes FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_raffle_prizes_event
  ON raffle_prizes (event_id, active) WHERE active;

-- One reward per ticket: a ticket wins at most one prize. Keeps redemption
-- and the door/bar UI simple, and matches "a ticket must never exist
-- without its reward outcome already decided" without needing to decide
-- how to rank multiple simultaneous wins.
CREATE TABLE IF NOT EXISTS ticket_rewards (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id           uuid NOT NULL UNIQUE REFERENCES tickets(id),
  raffle_prize_id     uuid NOT NULL REFERENCES raffle_prizes(id),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  awarded_at          timestamptz NOT NULL DEFAULT now(),
  redeemed_at         timestamptz,
  redeemed_by_user_id uuid REFERENCES users(id)
);
ALTER TABLE ticket_rewards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ticket_rewards FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_ticket_rewards_prize
  ON ticket_rewards (raffle_prize_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Draw, folded into complete_paid_checkout
-- ─────────────────────────────────────────────────────────────────────────────
-- Same shape as 017's version, with the draw added inside the per-ticket
-- insert loop, after the ticket row exists and before the loop moves on.
-- Uses the same CAS discipline as ticket_types.remaining: the UPDATE that
-- claims a prize is itself the lock (`WHERE quantity_remaining > 0`), so two
-- concurrent checkouts racing for the last prize can never both win it — one
-- UPDATE matches zero rows and that ticket simply doesn't win.
--
-- Fair-odds note for 'fixed_count' prizes: probability per ticket is
-- prize.quantity_remaining / tickets_left_in_this_type, recomputed for each
-- ticket in the batch (v_stock_left counts down as we go). This is standard
-- streaming/reservoir selection — it converges to certainty once
-- tickets_left equals prizes_left, so a fixed-count pool is guaranteed to be
-- fully awarded by the time the type sells out, without ever handing out
-- more than quantity_available regardless of draw order.
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
  v_prize raffle_prizes;
  v_won uuid;
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

  -- Stock as it stood before this batch, so we can walk it down ticket by
  -- ticket for the fixed-count odds below.
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

    -- ── Raffle draw for this ticket ──
    -- Candidate prizes: active, on this event, scoped to this ticket type
    -- or unscoped. Deterministic order (by id) so concurrent checkouts
    -- touching overlapping prize sets never lock rows in different orders.
    v_won := NULL;
    FOR v_prize IN
      SELECT * FROM raffle_prizes
       WHERE event_id = v_co.event_id
         AND active
         AND (ticket_type_id IS NULL OR ticket_type_id = v_co.ticket_type_id)
         AND quantity_remaining > 0
       ORDER BY id
    LOOP
      IF v_prize.win_mode = 'probability' THEN
        IF random() >= v_prize.win_probability THEN
          CONTINUE;
        END IF;
      ELSE
        -- fixed_count: odds are prizes-left / tickets-left, so the pool is
        -- fully awarded by the time the type sells out.
        IF random() >= v_prize.quantity_remaining::numeric / GREATEST(v_stock_left, v_prize.quantity_remaining) THEN
          CONTINUE;
        END IF;
      END IF;

      UPDATE raffle_prizes
         SET quantity_remaining = quantity_remaining - 1
       WHERE id = v_prize.id
         AND quantity_remaining > 0;
      IF FOUND THEN
        INSERT INTO ticket_rewards (ticket_id, raffle_prize_id, tenant_id)
        VALUES (v_id, v_prize.id, v_co.tenant_id);
        v_won := v_prize.id;
        EXIT; -- one prize per ticket
      END IF;
    END LOOP;

    v_stock_left := v_stock_left - 1;
    v_ticket_ids := array_append(v_ticket_ids, v_id);
  END LOOP;

  UPDATE pending_checkouts SET status = 'issued' WHERE id = v_co.id;

  RETURN jsonb_build_object('ok', true, 'already', false, 'ticket_ids', to_jsonb(v_ticket_ids));
END;
$$;
REVOKE ALL ON FUNCTION complete_paid_checkout(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_paid_checkout(uuid, jsonb) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Lookup: what did this ticket win, if anything
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_ticket_reward(p_ticket_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'won', true,
    'reward_id', tr.id,
    'prize_name', rp.name,
    'redemption_type', rp.redemption_type,
    'redeemed_at', tr.redeemed_at,
    'redeemed_by_user_id', tr.redeemed_by_user_id
  )
  FROM ticket_rewards tr
  JOIN raffle_prizes rp ON rp.id = tr.raffle_prize_id
  WHERE tr.ticket_id = p_ticket_id;
$$;
REVOKE ALL ON FUNCTION get_ticket_reward(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_ticket_reward(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Redemption at the door/bar — one-tap, one-time, same locking discipline
--    redeem_ticket already uses for one-time ticket redemption.
-- ─────────────────────────────────────────────────────────────────────────────
-- Only redeemable once a ticket has actually been admitted (status='used'),
-- so a prize can't be honored on a ticket that never showed up. If the
-- prize has a ledger cost it posts DR the prize's ledger_account (comps in
-- the common case) against CR fb_revenue, the same "recognise the giveaway
-- at face value, then expense it" shape settlement already uses for comps
-- valued at ticket face.
CREATE OR REPLACE FUNCTION redeem_raffle_prize(
  p_ticket_id uuid,
  p_redeemed_by_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_reward ticket_rewards;
  v_prize raffle_prizes;
  v_ticket tickets;
  v_shift uuid;
BEGIN
  SELECT * INTO v_reward FROM ticket_rewards WHERE ticket_id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_reward');
  END IF;
  IF v_reward.redeemed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_redeemed', 'redeemed_at', v_reward.redeemed_at);
  END IF;

  SELECT * INTO v_ticket FROM tickets WHERE id = p_ticket_id;
  IF NOT FOUND OR v_ticket.status <> 'used' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ticket_not_admitted');
  END IF;

  SELECT * INTO v_prize FROM raffle_prizes WHERE id = v_reward.raffle_prize_id;

  UPDATE ticket_rewards
     SET redeemed_at = now(), redeemed_by_user_id = p_redeemed_by_user_id
   WHERE id = v_reward.id;

  IF v_prize.ledger_account IS NOT NULL AND v_prize.cost_pesewas > 0 THEN
    v_shift := current_shift_id(v_prize.tenant_id);
    INSERT INTO ledger_entries (
      tenant_id, shift_id, event_id, account, direction, amount_pesewas, ref_type, ref_id, memo
    ) VALUES
      (v_prize.tenant_id, v_shift, v_prize.event_id, v_prize.ledger_account, 'DR', v_prize.cost_pesewas, 'raffle_redemption', v_reward.id, v_prize.name),
      (v_prize.tenant_id, v_shift, v_prize.event_id, 'fb_revenue', 'CR', v_prize.cost_pesewas, 'raffle_redemption', v_reward.id, v_prize.name);
  END IF;

  RETURN jsonb_build_object('ok', true, 'prize_name', v_prize.name, 'redemption_type', v_prize.redemption_type);
END;
$$;
REVOKE ALL ON FUNCTION redeem_raffle_prize(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION redeem_raffle_prize(uuid, uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. redeem_ticket now also reports whether the admitted ticket won
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION redeem_ticket(
  p_ticket_id uuid,
  p_device_id uuid,
  p_device_name text,
  p_door_label text,
  p_mode text DEFAULT 'online',
  p_scanned_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_ticket tickets;
  v_redemption ticket_redemptions;
  v_at timestamptz := COALESCE(p_scanned_at, now());
  v_reward jsonb;
BEGIN
  IF p_mode NOT IN ('online', 'offline_deferred') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_mode');
  END IF;

  IF p_mode = 'online' THEN
    v_at := now();
  ELSIF v_at > now() OR v_at < now() - interval '24 hours' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_scan_time');
  END IF;

  SELECT * INTO v_ticket FROM tickets WHERE id = p_ticket_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_ticket.status <> 'issued' THEN
    SELECT * INTO v_redemption FROM ticket_redemptions WHERE ticket_id = p_ticket_id;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'already_used',
        'scanned_at', v_redemption.scanned_at,
        'door_label', v_redemption.door_label
      );
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', v_ticket.status);
  END IF;

  IF EXISTS (SELECT 1 FROM revocations WHERE ticket_id = p_ticket_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'voided');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM events e
     WHERE e.id = v_ticket.event_id
       AND v_at BETWEEN e.check_in_from AND e.check_in_until
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'outside_window');
  END IF;

  UPDATE tickets SET status = 'used', used_at = v_at WHERE id = p_ticket_id;

  INSERT INTO ticket_redemptions (
    ticket_id, device_id, device_name, door_label, mode, scanned_at
  ) VALUES (
    p_ticket_id, p_device_id, p_device_name, p_door_label, p_mode, v_at
  );

  SELECT jsonb_build_object(
    'won', true,
    'prize_name', rp.name,
    'redemption_type', rp.redemption_type
  ) INTO v_reward
  FROM ticket_rewards tr
  JOIN raffle_prizes rp ON rp.id = tr.raffle_prize_id
  WHERE tr.ticket_id = p_ticket_id;

  RETURN jsonb_build_object(
    'ok', true,
    'holder_name', v_ticket.buyer_name,
    'ticket_type', (SELECT name FROM ticket_types WHERE id = v_ticket.ticket_type_id),
    'event_name',  (SELECT name FROM events WHERE id = v_ticket.event_id),
    'reward', COALESCE(v_reward, jsonb_build_object('won', false))
  );

EXCEPTION WHEN unique_violation THEN
  SELECT * INTO v_redemption FROM ticket_redemptions WHERE ticket_id = p_ticket_id;
  RETURN jsonb_build_object(
    'ok', false,
    'reason', 'already_used',
    'scanned_at', v_redemption.scanned_at,
    'door_label', v_redemption.door_label
  );
END; $$;
REVOKE ALL ON FUNCTION redeem_ticket(uuid, uuid, text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION redeem_ticket(uuid, uuid, text, text, text, timestamptz) TO service_role;
