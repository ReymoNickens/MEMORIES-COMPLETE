-- Atomic stock decrement for ticket purchase
-- Returns the ticket_type row data needed for issuance, or null if stock is exhausted
CREATE OR REPLACE FUNCTION decrement_ticket_stock(
  p_ticket_type_id uuid,
  p_quantity int DEFAULT 1
) RETURNS table (
  event_id uuid,
  tenant_id uuid,
  price_pesewas bigint,
  payment_id uuid
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_result ticket_types;
BEGIN
  UPDATE ticket_types
  SET remaining = remaining - p_quantity
  WHERE id = p_ticket_type_id
    AND remaining >= p_quantity
  RETURNING * INTO v_result;

  IF NOT FOUND THEN
    RETURN;  -- empty result = sold out
  END IF;

  RETURN QUERY SELECT
    v_result.event_id,
    v_result.tenant_id,
    v_result.price_pesewas,
    gen_random_uuid();
END; $$;

-- Atomic ticket redeem (hub and cloud both call this)
CREATE OR REPLACE FUNCTION redeem_ticket(
  p_ticket_id uuid,
  p_device_id uuid,
  p_device_name text,
  p_door_label text,
  p_mode text DEFAULT 'online'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ticket tickets;
  v_redemption ticket_redemptions;
BEGIN
  -- Lock the ticket row
  SELECT * INTO v_ticket FROM tickets WHERE id = p_ticket_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_ticket.status != 'issued' THEN
    -- Check if already redeemed
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

  -- Check revocations
  IF EXISTS (SELECT 1 FROM revocations WHERE ticket_id = p_ticket_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'voided');
  END IF;

  -- Check event window
  IF NOT EXISTS (
    SELECT 1 FROM events e
    JOIN ticket_types tt ON tt.event_id = e.id
    WHERE tt.id = v_ticket.ticket_type_id
      AND now() BETWEEN e.check_in_from AND e.check_in_until
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'outside_window');
  END IF;

  -- Atomic UPDATE + INSERT
  UPDATE tickets SET status = 'used', used_at = now() WHERE id = p_ticket_id;

  INSERT INTO ticket_redemptions (
    ticket_id, device_id, device_name, door_label, mode
  ) VALUES (
    p_ticket_id, p_device_id, p_device_name, p_door_label, p_mode
  );

  RETURN jsonb_build_object(
    'ok', true,
    'holder_name', v_ticket.buyer_name,
    'ticket_type', (SELECT name FROM ticket_types WHERE id = v_ticket.ticket_type_id),
    'event_name', (SELECT e.name FROM events e JOIN ticket_types tt ON tt.event_id = e.id WHERE tt.id = v_ticket.ticket_type_id)
  );

EXCEPTION WHEN unique_violation THEN
  -- Race condition: another scanner got there first
  SELECT * INTO v_redemption FROM ticket_redemptions WHERE ticket_id = p_ticket_id;
  RETURN jsonb_build_object(
    'ok', false,
    'reason', 'already_used',
    'scanned_at', v_redemption.scanned_at,
    'door_label', v_redemption.door_label
  );
END; $$;

-- Shift revenue summary (for owner dashboard and shift close)
CREATE OR REPLACE FUNCTION get_shift_revenue(p_shift_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT jsonb_build_object(
    'ticket_revenue',  COALESCE(SUM(CASE WHEN account='ticket_revenue' AND direction='CR' THEN amount_pesewas END), 0),
    'fb_revenue',      COALESCE(SUM(CASE WHEN account='fb_revenue' AND direction='CR' THEN amount_pesewas END), 0),
    'comps',           COALESCE(SUM(CASE WHEN account='comps' AND direction='DR' THEN amount_pesewas END), 0),
    'refunds',         COALESCE(SUM(CASE WHEN account='refunds' AND direction='DR' THEN amount_pesewas END), 0),
    'paystack_fees',   COALESCE(SUM(CASE WHEN account='paystack_fees' AND direction='DR' THEN amount_pesewas END), 0),
    'momo_received',   COALESCE(SUM(CASE WHEN account='momo_clearing' AND direction='DR' THEN amount_pesewas END), 0),
    'cash_collected',  COALESCE(SUM(CASE WHEN account='cash_drawer' AND direction='DR' THEN amount_pesewas END), 0)
  )
  FROM ledger_entries
  WHERE shift_id = p_shift_id;
$$;

-- Per-waiter cash reconciliation for shift close
CREATE OR REPLACE FUNCTION get_waiter_cash_summary(p_shift_id uuid)
RETURNS TABLE (
  waiter_id uuid,
  waiter_name text,
  expected_pesewas bigint,
  handed_in_pesewas bigint,
  variance_pesewas bigint,
  order_count int
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    cc.attributed_waiter_id,
    u.full_name,
    SUM(cc.amount_pesewas) AS expected_pesewas,
    SUM(COALESCE(cc.physical_amount_pesewas, 0)) AS handed_in_pesewas,
    SUM(cc.amount_pesewas) - SUM(COALESCE(cc.physical_amount_pesewas, 0)) AS variance_pesewas,
    COUNT(*)::int AS order_count
  FROM cash_collections cc
  JOIN users u ON u.id = cc.attributed_waiter_id
  WHERE cc.shift_id = p_shift_id
  GROUP BY cc.attributed_waiter_id, u.full_name
  ORDER BY variance_pesewas DESC;
$$;

-- Settlement computation
CREATE OR REPLACE FUNCTION compute_settlement(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_event events;
  v_tenant tenants;
  v_gate_gross bigint;
  v_table_gross bigint;
  v_refunds bigint;
  v_comps bigint;
  v_comp_allowance_pesewas bigint;
  v_organiser_gate bigint;
  v_organiser_table bigint;
  v_organiser_total bigint;
BEGIN
  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  SELECT * INTO v_tenant FROM tenants WHERE id = v_event.tenant_id;

  SELECT COALESCE(SUM(amount_pesewas), 0) INTO v_gate_gross
  FROM ledger_entries
  WHERE event_id = p_event_id AND account = 'ticket_revenue' AND direction = 'CR';

  SELECT COALESCE(SUM(amount_pesewas), 0) INTO v_table_gross
  FROM ledger_entries
  WHERE event_id = p_event_id AND account = 'fb_revenue' AND direction = 'CR';

  SELECT COALESCE(SUM(amount_pesewas), 0) INTO v_refunds
  FROM ledger_entries
  WHERE event_id = p_event_id AND account = 'refunds' AND direction = 'DR';

  SELECT COALESCE(SUM(amount_pesewas), 0) INTO v_comps
  FROM ledger_entries
  WHERE event_id = p_event_id AND account = 'comps' AND direction = 'DR';

  -- Organiser comp allowance (from submission)
  SELECT COALESCE(os.comp_allowance * 100, 0) INTO v_comp_allowance_pesewas
  FROM organiser_submissions os WHERE os.event_id = p_event_id;

  v_organiser_gate  := ROUND((v_gate_gross - v_refunds) * (10000 - v_tenant.gate_split_club_bps) / 10000.0);
  v_organiser_table := ROUND(v_table_gross * (10000 - v_tenant.table_split_club_bps) / 10000.0);

  -- Deduct comps over allowance from organiser share
  v_organiser_total := v_organiser_gate + v_organiser_table
                       - GREATEST(0, v_comps - v_comp_allowance_pesewas);

  RETURN jsonb_build_object(
    'gate_gross',           v_gate_gross,
    'table_gross',          v_table_gross,
    'refunds',              v_refunds,
    'comps',                v_comps,
    'comp_allowance',       v_comp_allowance_pesewas,
    'organiser_gate',       v_organiser_gate,
    'organiser_table',      v_organiser_table,
    'organiser_total',      v_organiser_total,
    'club_total',           (v_gate_gross + v_table_gross - v_refunds - v_comps) - v_organiser_total,
    'gate_split_club_bps',  v_tenant.gate_split_club_bps,
    'table_split_club_bps', v_tenant.table_split_club_bps
  );
END; $$;
