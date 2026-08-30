-- Audit 30 Aug 2026 — hardening pass.
--
-- Fixes, in order of how much money each one loses:
--   1. Shift ledger rows were only stamped for cash. Tickets and MoMo F&B
--      landed with shift_id NULL, so get_shift_revenue reported a fraction of
--      the night. Every posting route now resolves the open shift.
--   2. Cash hand-ins were smeared across every cash_collections row for the
--      waiter, so handed_in summed to (amount x order count). Hand-ins now
--      live in their own one-row-per-waiter-per-shift table.
--   3. SECURITY DEFINER functions were executable by PUBLIC, which includes
--      the anon key that ships in the browser bundle.
--   4. The 013/014/015 house tables (salaries, bank details, payroll, stock)
--      never had RLS enabled.
--   5. Nothing ever closed an order, so the bar rail accumulated forever.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Row level security on every table that missed it
-- ─────────────────────────────────────────────────────────────────────────────
-- These tables are reached only through the service role in API routes.
-- Enabling RLS with no policy denies anon and authenticated outright.
ALTER TABLE stock_openings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_closings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_shift_meta   ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_shortages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_attendance   ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills              ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_lines      ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_notes  ENABLE ROW LEVEL SECURITY;

-- Belt and braces: revoke the table grants PostgREST relies on, so a future
-- permissive policy cannot on its own re-expose payroll to the browser key.
REVOKE ALL ON staff_profiles, payroll_runs, payroll_lines,
              performance_notes, bills, suppliers,
              stock_openings, stock_closings, stock_adjustments,
              stock_shift_meta, stock_shortages
  FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SECURITY DEFINER functions are service-role only
-- ─────────────────────────────────────────────────────────────────────────────
-- get_shift_revenue and get_waiter_cash_summary were callable by anyone
-- holding the anon key. They bypass RLS by definition.
REVOKE ALL ON FUNCTION get_shift_revenue(uuid)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION compute_settlement(uuid)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION redeem_ticket(uuid, uuid, text, text, text)
                                                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION decrement_ticket_stock(uuid, int)
                                                      FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_shift_revenue(uuid)       TO service_role;
GRANT EXECUTE ON FUNCTION compute_settlement(uuid)      TO service_role;
GRANT EXECUTE ON FUNCTION redeem_ticket(uuid, uuid, text, text, text) TO service_role;

-- decrement_ticket_stock is superseded by complete_paid_checkout, which does
-- stock, tickets, access, payments and ledger in one transaction. Leaving a
-- second, non-atomic stock path callable invites split-brain issuance.
DROP FUNCTION IF EXISTS decrement_ticket_stock(uuid, int);

-- The helper used by every RLS policy must not be shadowable.
ALTER FUNCTION get_my_tenant_id() SET search_path = public, pg_temp;
ALTER FUNCTION has_role(text)     SET search_path = public, pg_temp;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. One open shift per tenant, and a way to find it
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_shift_per_tenant
  ON shifts (tenant_id) WHERE closed_at IS NULL;

CREATE OR REPLACE FUNCTION current_shift_id(p_tenant_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT id FROM shifts
   WHERE tenant_id = p_tenant_id AND closed_at IS NULL
   ORDER BY opened_at DESC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION current_shift_id(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION current_shift_id(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. The ledger must balance
-- ─────────────────────────────────────────────────────────────────────────────
-- Nothing stopped a half-posting. The no-show job credited forfeiture_income
-- with no matching debit; a bad hand-written insert would silently skew the
-- P&L. Checked at commit so a posting routine can write its legs in any order.
CREATE OR REPLACE FUNCTION assert_ledger_balanced()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  v_dr bigint;
  v_cr bigint;
BEGIN
  SELECT
    COALESCE(SUM(amount_pesewas) FILTER (WHERE direction = 'DR'), 0),
    COALESCE(SUM(amount_pesewas) FILTER (WHERE direction = 'CR'), 0)
    INTO v_dr, v_cr
    FROM ledger_entries
   WHERE ref_type = NEW.ref_type AND ref_id = NEW.ref_id;

  IF v_dr <> v_cr THEN
    RAISE EXCEPTION
      'ledger_unbalanced: % % debits=% credits=%',
      NEW.ref_type, NEW.ref_id, v_dr, v_cr;
  END IF;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS ledger_balanced ON ledger_entries;
CREATE CONSTRAINT TRIGGER ledger_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_ledger_balanced();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Cash hand-ins get their own table
-- ─────────────────────────────────────────────────────────────────────────────
-- Previously /api/shifts/close wrote the same physical_amount_pesewas onto
-- every cash_collections row belonging to the waiter, and
-- get_waiter_cash_summary then SUMmed them. A waiter with 20 orders who
-- handed in GHS 5,000 reconciled as GHS 100,000 handed in. One row per
-- waiter per shift removes the multiplication entirely.
CREATE TABLE IF NOT EXISTS shift_handovers (
  shift_id          uuid NOT NULL REFERENCES shifts(id),
  waiter_id         uuid NOT NULL REFERENCES users(id),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  expected_pesewas  bigint NOT NULL CHECK (expected_pesewas >= 0),
  physical_pesewas  bigint NOT NULL CHECK (physical_pesewas >= 0),
  counted_by        uuid NOT NULL REFERENCES users(id),
  note              text,
  counted_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shift_id, waiter_id)
);
ALTER TABLE shift_handovers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON shift_handovers FROM anon, authenticated;

-- physical_amount_pesewas on cash_collections is now advisory only; the
-- authoritative count is the handover row a manager records at close.
COMMENT ON COLUMN cash_collections.physical_amount_pesewas IS
  'Deprecated by shift_handovers. Do not sum — one value per order, not per night.';

-- The return type gains a `counted` column, so the old signature must go.
DROP FUNCTION IF EXISTS get_waiter_cash_summary(uuid);
CREATE FUNCTION get_waiter_cash_summary(p_shift_id uuid)
RETURNS TABLE (
  waiter_id uuid,
  waiter_name text,
  expected_pesewas bigint,
  handed_in_pesewas bigint,
  variance_pesewas bigint,
  order_count int,
  counted bool
) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT
    cc.attributed_waiter_id,
    u.full_name,
    SUM(cc.amount_pesewas)::bigint,
    COALESCE(MAX(sh.physical_pesewas), 0)::bigint,
    (SUM(cc.amount_pesewas) - COALESCE(MAX(sh.physical_pesewas), 0))::bigint,
    COUNT(*)::int,
    bool_or(sh.waiter_id IS NOT NULL)
  FROM cash_collections cc
  JOIN users u ON u.id = cc.attributed_waiter_id
  LEFT JOIN shift_handovers sh
         ON sh.shift_id = cc.shift_id
        AND sh.waiter_id = cc.attributed_waiter_id
  WHERE cc.shift_id = p_shift_id
  GROUP BY cc.attributed_waiter_id, u.full_name
  ORDER BY (SUM(cc.amount_pesewas) - COALESCE(MAX(sh.physical_pesewas), 0)) DESC;
$$;
REVOKE ALL ON FUNCTION get_waiter_cash_summary(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_waiter_cash_summary(uuid) TO service_role;

-- Record a count. Managers only — enforced by the API route that calls this.
CREATE OR REPLACE FUNCTION record_handover(
  p_shift_id uuid,
  p_waiter_id uuid,
  p_physical_pesewas bigint,
  p_counted_by uuid,
  p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_shift shifts;
  v_expected bigint;
BEGIN
  IF p_physical_pesewas IS NULL OR p_physical_pesewas < 0 THEN
    RAISE EXCEPTION 'bad_amount';
  END IF;

  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'shift_not_found'; END IF;

  SELECT COALESCE(SUM(amount_pesewas), 0) INTO v_expected
    FROM cash_collections
   WHERE shift_id = p_shift_id AND attributed_waiter_id = p_waiter_id;

  INSERT INTO shift_handovers (
    shift_id, waiter_id, tenant_id, expected_pesewas,
    physical_pesewas, counted_by, note
  ) VALUES (
    p_shift_id, p_waiter_id, v_shift.tenant_id, v_expected,
    p_physical_pesewas, p_counted_by, p_note
  )
  ON CONFLICT (shift_id, waiter_id) DO UPDATE
    SET expected_pesewas = EXCLUDED.expected_pesewas,
        physical_pesewas = EXCLUDED.physical_pesewas,
        counted_by       = EXCLUDED.counted_by,
        note             = EXCLUDED.note,
        counted_at       = now();

  -- Stamp the orders so the waiter view can show what has been handed in.
  UPDATE cash_collections
     SET handed_in_at = now()
   WHERE shift_id = p_shift_id
     AND attributed_waiter_id = p_waiter_id
     AND handed_in_at IS NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'expected_pesewas', v_expected,
    'physical_pesewas', p_physical_pesewas,
    'variance_pesewas', v_expected - p_physical_pesewas
  );
END; $$;
REVOKE ALL ON FUNCTION record_handover(uuid, uuid, bigint, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_handover(uuid, uuid, bigint, uuid, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Every posting is stamped with the shift it belongs to
-- ─────────────────────────────────────────────────────────────────────────────
-- complete_paid_checkout wrote event_id but never shift_id, and place_order
-- only passed a shift for cash. get_shift_revenue filters on shift_id, so the
-- owner's screen showed cash and nothing else. Tickets sold in advance still
-- resolve to NULL, which is correct — they belong to no operating night.
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

    v_ticket_ids := array_append(v_ticket_ids, v_id);
  END LOOP;

  UPDATE pending_checkouts SET status = 'issued' WHERE id = v_co.id;

  RETURN jsonb_build_object('ok', true, 'already', false, 'ticket_ids', to_jsonb(v_ticket_ids));
END;
$$;
REVOKE ALL ON FUNCTION complete_paid_checkout(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_paid_checkout(uuid, jsonb) TO service_role;

-- MoMo F&B had the same hole: orders/initiate passed p_shift_id only for cash,
-- so a night that ran 60% on MoMo reported 40% of its bar take.
CREATE OR REPLACE FUNCTION place_order(
  p_tenant_id uuid,
  p_source text,
  p_guest_name text,
  p_guest_phone text,
  p_payment_source text,
  p_paystack_ref text,
  p_venue_table_id uuid,
  p_station_label text,
  p_waiter_id uuid,
  p_shift_id uuid,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id uuid;
  v_total bigint := 0;
  v_item jsonb;
  v_product products;
  v_qty int;
  v_shift uuid;
BEGIN
  IF p_source NOT IN ('counter_qr', 'table_qr', 'waiter') THEN
    RAISE EXCEPTION 'bad_source';
  END IF;
  IF p_payment_source NOT IN ('momo', 'cash') THEN
    RAISE EXCEPTION 'bad_payment';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) < 1 THEN
    RAISE EXCEPTION 'empty_order';
  END IF;

  -- Trust the caller's shift when given, otherwise bind to the open night.
  v_shift := COALESCE(p_shift_id, current_shift_id(p_tenant_id));

  -- Cash still needs a named owner and an open night: unattributed cash is
  -- how a club loses money it never knows it had.
  IF p_payment_source = 'cash' AND (p_waiter_id IS NULL OR v_shift IS NULL) THEN
    RAISE EXCEPTION 'cash_needs_waiter_and_shift';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty < 1 OR v_qty > 20 THEN
      RAISE EXCEPTION 'bad_quantity';
    END IF;

    SELECT * INTO v_product
      FROM products
     WHERE id = (v_item->>'product_id')::uuid
       AND tenant_id = p_tenant_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_found';
    END IF;
    IF NOT v_product.is_available THEN
      RAISE EXCEPTION 'product_unavailable';
    END IF;

    v_total := v_total + (v_product.price_pesewas * v_qty);
  END LOOP;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'zero_total';
  END IF;

  INSERT INTO orders (
    tenant_id, venue_table_id, station_label, source,
    guest_name, guest_phone, payment_source, paystack_ref,
    amount_pesewas, status, waiter_id, shift_id, paid_at
  ) VALUES (
    p_tenant_id, p_venue_table_id, p_station_label, p_source,
    p_guest_name, p_guest_phone, p_payment_source, p_paystack_ref,
    v_total,
    CASE WHEN p_payment_source = 'cash' THEN 'paid' ELSE 'pending_payment' END,
    p_waiter_id, v_shift,
    CASE WHEN p_payment_source = 'cash' THEN now() ELSE NULL END
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_product FROM products WHERE id = (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::int;
    INSERT INTO order_items (
      order_id, product_id, product_name, station, price_pesewas, quantity
    ) VALUES (
      v_order_id, v_product.id, v_product.name, v_product.station, v_product.price_pesewas, v_qty
    );
  END LOOP;

  IF p_payment_source = 'cash' THEN
    INSERT INTO cash_collections (
      tenant_id, shift_id, order_id, attributed_waiter_id, amount_pesewas
    ) VALUES (
      p_tenant_id, v_shift, v_order_id, p_waiter_id, v_total
    );

    INSERT INTO ledger_entries (
      tenant_id, shift_id, account, direction, amount_pesewas, ref_type, ref_id, actor_id, memo
    ) VALUES
      (p_tenant_id, v_shift, 'cash_drawer', 'DR', v_total, 'order', v_order_id, p_waiter_id, 'cash order'),
      (p_tenant_id, v_shift, 'fb_revenue', 'CR', v_total, 'order', v_order_id, p_waiter_id, 'cash order');
  END IF;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id, 'amount_pesewas', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION mark_order_paid(
  p_order_id uuid,
  p_fee_pesewas bigint DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order orders;
  v_fee bigint := GREATEST(COALESCE(p_fee_pesewas, 0), 0);
  v_shift uuid;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;
  IF v_order.status IN ('paid', 'preparing', 'complete') THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'order_id', v_order.id);
  END IF;
  IF v_order.status <> 'pending_payment' THEN
    RAISE EXCEPTION 'order_not_payable';
  END IF;

  -- An order placed before the shift opened settles into the open night.
  v_shift := COALESCE(v_order.shift_id, current_shift_id(v_order.tenant_id));

  UPDATE orders
     SET status = 'paid',
         paid_at = now(),
         fee_pesewas = v_fee,
         shift_id = v_shift
   WHERE id = v_order.id;

  INSERT INTO ledger_entries (
    tenant_id, shift_id, event_id, account, direction, amount_pesewas, ref_type, ref_id, memo
  ) VALUES
    (v_order.tenant_id, v_shift, v_order.event_id, 'momo_clearing', 'DR', v_order.amount_pesewas, 'order', v_order.id, v_order.paystack_ref),
    (v_order.tenant_id, v_shift, v_order.event_id, 'fb_revenue', 'CR', v_order.amount_pesewas, 'order', v_order.id, v_order.paystack_ref);

  IF v_fee > 0 THEN
    INSERT INTO ledger_entries (
      tenant_id, shift_id, event_id, account, direction, amount_pesewas, ref_type, ref_id, memo
    ) VALUES
      (v_order.tenant_id, v_shift, v_order.event_id, 'paystack_fees', 'DR', v_fee, 'order', v_order.id, v_order.paystack_ref),
      (v_order.tenant_id, v_shift, v_order.event_id, 'momo_clearing', 'CR', v_fee, 'order', v_order.id, v_order.paystack_ref);
  END IF;

  RETURN jsonb_build_object('ok', true, 'already', false, 'order_id', v_order.id);
END;
$$;

REVOKE ALL ON FUNCTION place_order(uuid, text, text, text, text, text, uuid, text, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION mark_order_paid(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION place_order(uuid, text, text, text, text, text, uuid, text, uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION mark_order_paid(uuid, bigint) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Orders finish. The rail clears.
-- ─────────────────────────────────────────────────────────────────────────────
-- Nothing in the codebase ever wrote status = 'complete', so every paid order
-- ever placed stayed on the bar and kitchen rails forever. Two nights in, the
-- bar is reading last week's tickets.
CREATE OR REPLACE FUNCTION complete_order_when_served()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status NOT IN ('delivered', 'voided') THEN
    RETURN NEW;
  END IF;

  UPDATE orders o
     SET status = 'complete'
   WHERE o.id = NEW.order_id
     AND o.status IN ('paid', 'preparing')
     AND NOT EXISTS (
       SELECT 1 FROM order_items oi
        WHERE oi.order_id = NEW.order_id
          AND oi.status NOT IN ('delivered', 'voided')
     );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS order_items_complete_order ON order_items;
CREATE TRIGGER order_items_complete_order
  AFTER UPDATE OF status ON order_items
  FOR EACH ROW EXECUTE FUNCTION complete_order_when_served();

-- An order that has been touched by the bar is 'preparing', so the floor can
-- tell "nobody has picked this up" from "it is being poured".
CREATE OR REPLACE FUNCTION start_order_when_fired()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status IN ('preparing', 'ready') THEN
    UPDATE orders SET status = 'preparing'
     WHERE id = NEW.order_id AND status = 'paid';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS order_items_start_order ON order_items;
CREATE TRIGGER order_items_start_order
  AFTER UPDATE OF status ON order_items
  FOR EACH ROW EXECUTE FUNCTION start_order_when_fired();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Closing the night, with the variance on the record
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_account_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_account_check
  CHECK (account IN (
    'momo_clearing', 'cash_drawer',
    'ticket_revenue', 'fb_revenue',
    'deposit_liability', 'forfeiture_income',
    'refunds', 'comps',
    'paystack_fees', 'organiser_payable', 'club_retained',
    'cash_variance'
  ));

-- Close the night in one transaction: force any tab still open onto the
-- record, post each waiter's cash variance, then stamp the shift closed.
CREATE OR REPLACE FUNCTION close_shift(
  p_shift_id uuid,
  p_closed_by uuid,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift shifts;
  v_row record;
  v_variance bigint;
  v_open_tabs int;
  v_uncounted int;
  v_total_variance bigint := 0;
BEGIN
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shift_not_found'; END IF;
  IF v_shift.closed_at IS NOT NULL THEN RAISE EXCEPTION 'shift_already_closed'; END IF;

  -- A tab left open is an unbilled table. Refuse rather than silently drop it.
  SELECT COUNT(*) INTO v_open_tabs
    FROM orders
   WHERE tenant_id = v_shift.tenant_id AND status = 'on_tab';
  IF v_open_tabs > 0 THEN
    RAISE EXCEPTION 'open_tabs_remain:%', v_open_tabs;
  END IF;

  -- Every waiter who took cash must have been counted.
  SELECT COUNT(*) INTO v_uncounted
    FROM (
      SELECT cc.attributed_waiter_id
        FROM cash_collections cc
       WHERE cc.shift_id = p_shift_id
       GROUP BY cc.attributed_waiter_id
    ) w
   WHERE NOT EXISTS (
     SELECT 1 FROM shift_handovers sh
      WHERE sh.shift_id = p_shift_id AND sh.waiter_id = w.attributed_waiter_id
   );
  IF v_uncounted > 0 THEN
    RAISE EXCEPTION 'uncounted_waiters:%', v_uncounted;
  END IF;

  -- Post the variance so the drawer reconciles to what was actually handed in.
  FOR v_row IN
    SELECT sh.waiter_id, sh.expected_pesewas, sh.physical_pesewas
      FROM shift_handovers sh
     WHERE sh.shift_id = p_shift_id
  LOOP
    v_variance := v_row.expected_pesewas - v_row.physical_pesewas;
    IF v_variance <> 0 THEN
      v_total_variance := v_total_variance + v_variance;
      IF v_variance > 0 THEN
        -- Short: the drawer holds less than the orders say it should.
        INSERT INTO ledger_entries (tenant_id, shift_id, account, direction, amount_pesewas, ref_type, ref_id, actor_id, memo)
        VALUES
          (v_shift.tenant_id, p_shift_id, 'cash_variance', 'DR', v_variance, 'shift_close', p_shift_id, v_row.waiter_id, 'cash short'),
          (v_shift.tenant_id, p_shift_id, 'cash_drawer',   'CR', v_variance, 'shift_close', p_shift_id, v_row.waiter_id, 'cash short');
      ELSE
        INSERT INTO ledger_entries (tenant_id, shift_id, account, direction, amount_pesewas, ref_type, ref_id, actor_id, memo)
        VALUES
          (v_shift.tenant_id, p_shift_id, 'cash_drawer',   'DR', -v_variance, 'shift_close', p_shift_id, v_row.waiter_id, 'cash over'),
          (v_shift.tenant_id, p_shift_id, 'cash_variance', 'CR', -v_variance, 'shift_close', p_shift_id, v_row.waiter_id, 'cash over');
      END IF;
    END IF;
  END LOOP;

  UPDATE shifts
     SET closed_at = now(), closed_by = p_closed_by, notes = p_notes
   WHERE id = p_shift_id;

  RETURN jsonb_build_object(
    'ok', true,
    'shift_id', p_shift_id,
    'total_variance_pesewas', v_total_variance
  );
END; $$;
REVOKE ALL ON FUNCTION close_shift(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION close_shift(uuid, uuid, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. One read for the whole night
-- ─────────────────────────────────────────────────────────────────────────────
-- The old dashboard fired four browser queries against RLS-protected tables
-- with the anon key and rendered eight identical money tiles. What an owner
-- standing in their own club at 1am actually needs is: what came in, what is
-- still out on the floor, whether the door matches the tickets, and which
-- server is drifting.
CREATE OR REPLACE FUNCTION get_night_dashboard(p_shift_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift shifts;
  v_ledger jsonb;
  v_fb jsonb;
  v_door jsonb;
  v_rail jsonb;
  v_tables jsonb;
  v_movers jsonb;
  v_night jsonb;
  v_cash_out bigint;
BEGIN
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'shift_not_found'); END IF;

  SELECT jsonb_build_object(
    'ticket_revenue', COALESCE(SUM(amount_pesewas) FILTER (WHERE account='ticket_revenue' AND direction='CR'), 0),
    'fb_revenue',     COALESCE(SUM(amount_pesewas) FILTER (WHERE account='fb_revenue'     AND direction='CR'), 0),
    'momo_gross',     COALESCE(SUM(amount_pesewas) FILTER (WHERE account='momo_clearing'  AND direction='DR'), 0),
    'cash_gross',     COALESCE(SUM(amount_pesewas) FILTER (WHERE account='cash_drawer'    AND direction='DR'), 0),
    'fees',           COALESCE(SUM(amount_pesewas) FILTER (WHERE account='paystack_fees'  AND direction='DR'), 0),
    'comps',          COALESCE(SUM(amount_pesewas) FILTER (WHERE account='comps'          AND direction='DR'), 0),
    'refunds',        COALESCE(SUM(amount_pesewas) FILTER (WHERE account='refunds'        AND direction='DR'), 0),
    'cash_variance',  COALESCE(SUM(amount_pesewas) FILTER (WHERE account='cash_variance'  AND direction='DR'), 0)
                    - COALESCE(SUM(amount_pesewas) FILTER (WHERE account='cash_variance'  AND direction='CR'), 0)
  ) INTO v_ledger
  FROM ledger_entries WHERE shift_id = p_shift_id;

  -- Cash taken but not yet counted in — the number that walks out of the door.
  SELECT COALESCE(SUM(cc.amount_pesewas), 0) INTO v_cash_out
    FROM cash_collections cc
   WHERE cc.shift_id = p_shift_id
     AND NOT EXISTS (
       SELECT 1 FROM shift_handovers sh
        WHERE sh.shift_id = cc.shift_id AND sh.waiter_id = cc.attributed_waiter_id
     );

  SELECT jsonb_build_object(
    'orders',        COUNT(*),
    'open_tabs',     COUNT(*) FILTER (WHERE status = 'on_tab'),
    'unpaid',        COUNT(*) FILTER (WHERE status = 'pending_payment'),
    'voided',        COUNT(*) FILTER (WHERE status = 'voided'),
    'avg_pesewas',   COALESCE(ROUND(AVG(amount_pesewas) FILTER (WHERE status <> 'voided')), 0)
  ) INTO v_fb
  FROM orders WHERE shift_id = p_shift_id;

  -- Door count against tickets sold for the event running tonight.
  SELECT jsonb_build_object(
    'admitted',  COUNT(*) FILTER (WHERE r.id IS NOT NULL),
    'issued',    COUNT(*),
    'capacity',  MAX(e.venue_capacity)
  ) INTO v_door
  FROM tickets t
  JOIN events e ON e.id = t.event_id
  LEFT JOIN ticket_redemptions r ON r.ticket_id = t.id
  WHERE t.tenant_id = v_shift.tenant_id
    AND t.status IN ('issued', 'used')
    -- The event this shift is working: its check-in window overlaps the night.
    AND e.check_in_from  <= COALESCE(v_shift.closed_at, now())
    AND e.check_in_until >= v_shift.opened_at;

  -- Service health: how long the oldest unserved item has been waiting.
  SELECT jsonb_build_object(
    'waiting_items', COUNT(*),
    'oldest_secs',   COALESCE(EXTRACT(epoch FROM now() - MIN(o.paid_at))::int, 0)
  ) INTO v_rail
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE o.shift_id = p_shift_id
    AND oi.status IN ('pending', 'preparing');

  -- Tables against their minimum spend: the floor manager's whole job.
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'label'), '[]'::jsonb) INTO v_tables
  FROM (
    SELECT jsonb_build_object(
      'label', vt.label,
      'zone', vt.zone,
      'min_spend_pesewas', vt.min_spend_pesewas,
      'spend_pesewas', COALESCE(SUM(o.amount_pesewas) FILTER (WHERE o.status <> 'voided'), 0),
      'open_tab', bool_or(o.status = 'on_tab')
    ) AS x
    FROM venue_tables vt
    LEFT JOIN orders o
           ON o.venue_table_id = vt.id
          AND o.shift_id = p_shift_id
    WHERE vt.tenant_id = v_shift.tenant_id AND vt.is_active
    GROUP BY vt.id, vt.label, vt.zone, vt.min_spend_pesewas
  ) t;

  -- What is actually moving, so the owner knows what to restock at 2am.
  SELECT COALESCE(jsonb_agg(m ORDER BY (m->>'revenue_pesewas')::bigint DESC), '[]'::jsonb)
    INTO v_movers
  FROM (
    SELECT jsonb_build_object(
      'product_name', oi.product_name,
      'station', oi.station,
      'qty', SUM(oi.quantity),
      'revenue_pesewas', SUM(oi.line_total_pesewas)
    ) AS m
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.shift_id = p_shift_id
      AND o.status <> 'voided'
      AND oi.status <> 'voided'
    GROUP BY oi.product_name, oi.station
    ORDER BY SUM(oi.line_total_pesewas) DESC
    LIMIT 8
  ) mv;

  -- The commercial view of the night, which is not the same as the shift
  -- ledger: an owner counts tonight's door as tonight's money even though the
  -- tickets were sold on Tuesday. The ledger stays honest — advance sales are
  -- stamped with no shift — and this is the reconciled read on top of it.
  SELECT jsonb_build_object(
    'gate_pesewas', COALESCE(SUM(le.amount_pesewas), 0)
  ) INTO v_night
  FROM ledger_entries le
  JOIN events e ON e.id = le.event_id
  WHERE le.tenant_id = v_shift.tenant_id
    AND le.account = 'ticket_revenue' AND le.direction = 'CR'
    AND e.check_in_from  <= COALESCE(v_shift.closed_at, now())
    AND e.check_in_until >= v_shift.opened_at;

  v_night := v_night
    || jsonb_build_object('fb_pesewas', v_ledger->'fb_revenue')
    || jsonb_build_object(
         'gross_pesewas',
         (v_night->>'gate_pesewas')::bigint + (v_ledger->>'fb_revenue')::bigint
       );

  RETURN jsonb_build_object(
    'ok', true,
    'shift_id', p_shift_id,
    'opened_at', v_shift.opened_at,
    'closed_at', v_shift.closed_at,
    'night', v_night,
    'ledger', v_ledger,
    'cash_uncounted_pesewas', v_cash_out,
    'fb', v_fb,
    'door', v_door,
    'rail', v_rail,
    'tables', v_tables,
    'movers', v_movers
  );
END; $$;
REVOKE ALL ON FUNCTION get_night_dashboard(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_night_dashboard(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Indexes the hot paths were missing
-- ─────────────────────────────────────────────────────────────────────────────
-- The bar rail reads by station on every realtime event; on a 200-cover night
-- that is a sequential scan of the whole orders table per poll.
CREATE INDEX IF NOT EXISTS idx_orders_rail
  ON orders (tenant_id, shift_id, station_label)
  WHERE status IN ('paid', 'preparing');
CREATE INDEX IF NOT EXISTS idx_ledger_shift_account
  ON ledger_entries (shift_id, account, direction);
CREATE INDEX IF NOT EXISTS idx_ledger_ref
  ON ledger_entries (ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_order_items_open
  ON order_items (order_id) WHERE status IN ('pending', 'preparing');
CREATE INDEX IF NOT EXISTS idx_tickets_event_status
  ON tickets (event_id, status);
CREATE INDEX IF NOT EXISTS idx_cash_collections_shift
  ON cash_collections (shift_id, attributed_waiter_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Offline door scans survive the sync
-- ─────────────────────────────────────────────────────────────────────────────
-- redeem_ticket checked the event window against now(). A scan taken at the
-- door at 23:10 but pushed up from the hub at 05:30 — because the venue link
-- was down, which is the entire reason the hub exists — came back
-- 'outside_window' and the guest never appeared in the cloud's head count.
-- The window is now checked against when the scan happened, not when the
-- cloud heard about it.
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
BEGIN
  IF p_mode NOT IN ('online', 'offline_deferred') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_mode');
  END IF;

  -- An online scan is happening now; a client cannot backdate itself past the
  -- door closing by passing a timestamp.
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

  RETURN jsonb_build_object(
    'ok', true,
    'holder_name', v_ticket.buyer_name,
    'ticket_type', (SELECT name FROM ticket_types WHERE id = v_ticket.ticket_type_id),
    'event_name',  (SELECT name FROM events WHERE id = v_ticket.event_id)
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

-- The five-argument form is now ambiguous against the six-argument default.
DROP FUNCTION IF EXISTS redeem_ticket(uuid, uuid, text, text, text);
REVOKE ALL ON FUNCTION redeem_ticket(uuid, uuid, text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION redeem_ticket(uuid, uuid, text, text, text, timestamptz) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Staff PINs stop being guessable
-- ─────────────────────────────────────────────────────────────────────────────
-- A four-digit PIN is 10,000 possibilities and /api/staff/login had no rate
-- limit, no lockout and no record of failures. Anyone who knew a staff phone
-- number — which is on the roster by the office door — could walk the whole
-- keyspace in minutes and come out holding a manager session.
CREATE TABLE IF NOT EXISTS staff_login_attempts (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid REFERENCES tenants(id),
  phone       text NOT NULL,
  succeeded   bool NOT NULL,
  ip          text,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE staff_login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON staff_login_attempts FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_login_attempts_phone
  ON staff_login_attempts (phone, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip
  ON staff_login_attempts (ip, attempted_at DESC) WHERE ip IS NOT NULL;

-- Returns how long the caller must wait, in seconds. Zero means go ahead.
-- Counts by phone and by source address, so neither spraying one number nor
-- spreading across the roster gets round it.
CREATE OR REPLACE FUNCTION staff_login_lockout(p_phone text, p_ip text)
RETURNS int LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_phone_fails int;
  v_ip_fails int;
  v_last timestamptz;
BEGIN
  SELECT COUNT(*), MAX(attempted_at) INTO v_phone_fails, v_last
    FROM staff_login_attempts
   WHERE phone = p_phone
     AND NOT succeeded
     AND attempted_at > now() - interval '15 minutes'
     AND attempted_at > COALESCE((
       SELECT MAX(attempted_at) FROM staff_login_attempts
        WHERE phone = p_phone AND succeeded
     ), '-infinity'::timestamptz);

  SELECT COUNT(*) INTO v_ip_fails
    FROM staff_login_attempts
   WHERE p_ip IS NOT NULL AND ip = p_ip
     AND NOT succeeded
     AND attempted_at > now() - interval '15 minutes';

  -- Five wrong PINs on one phone, or thirty from one address, and the door
  -- shuts for the rest of the window. A server who has genuinely forgotten
  -- their PIN asks the duty manager, which is the correct outcome anyway.
  IF v_phone_fails >= 5 OR v_ip_fails >= 30 THEN
    RETURN GREATEST(1, CEIL(EXTRACT(epoch FROM (v_last + interval '15 minutes' - now())))::int);
  END IF;
  RETURN 0;
END; $$;
REVOKE ALL ON FUNCTION staff_login_lockout(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION staff_login_lockout(text, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. A buyer can get back to the ticket they paid for
-- ─────────────────────────────────────────────────────────────────────────────
-- On the live rail the buyer received nothing. The access token is generated
-- in Node at issuance and only its sha256 is stored, so when the webhook mints
-- the tickets server-side the raw token exists nowhere the browser can reach —
-- and the return page's poll never navigated anywhere. Combined with
-- sendTicketDelivery() having no callers anywhere in the repo, a customer who
-- paid on the live rail got no ticket in the browser, no WhatsApp and no SMS.
--
-- This re-issues an access grant to someone who can present both the checkout
-- reference (24 random hex characters, handed only to the buyer) and the phone
-- number the ticket was bought against.
CREATE OR REPLACE FUNCTION claim_ticket_access(
  p_paystack_ref text,
  p_phone text,
  p_grants jsonb          -- [{ticket_id, access_hash}, …]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_co pending_checkouts;
  v_item jsonb;
  v_ids uuid[];
BEGIN
  SELECT * INTO v_co FROM pending_checkouts WHERE paystack_ref = p_paystack_ref;
  IF NOT FOUND OR v_co.status <> 'issued' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_issued');
  END IF;
  IF v_co.buyer_phone IS DISTINCT FROM p_phone THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'phone_mismatch');
  END IF;

  SELECT array_agg(p.ticket_id ORDER BY p.created_at) INTO v_ids
    FROM ticket_payments p
   WHERE p.paystack_ref LIKE p_paystack_ref || '-%';

  IF v_ids IS NULL OR array_length(v_ids, 1) IS DISTINCT FROM jsonb_array_length(p_grants) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'grant_count_mismatch');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_grants)
  LOOP
    IF NOT ((v_item->>'ticket_id')::uuid = ANY (v_ids)) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'unknown_ticket');
    END IF;
    -- Replacing the grant invalidates any previous link, so a claim from a new
    -- device retires the old one rather than leaving both live.
    UPDATE ticket_access
       SET token_hash = v_item->>'access_hash', created_at = now()
     WHERE ticket_id = (v_item->>'ticket_id')::uuid;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'ticket_ids', to_jsonb(v_ids));
END; $$;
REVOKE ALL ON FUNCTION claim_ticket_access(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_ticket_access(text, text, jsonb) TO service_role;
