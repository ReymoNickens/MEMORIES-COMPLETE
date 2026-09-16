-- PWA offline order queueing (Section 7). The waitstaff-on-a-bad-connection
-- case: an order placed while offline is queued in the browser and retried
-- when the connection returns. A retry of the same order must never create
-- a second one — this migration is the server-side half of that guarantee.
--
-- orders.local_ref already existed ("hub idempotency key", unique, never
-- wired up anywhere) for exactly this purpose on the door hub's offline
-- path. Reused here for the browser PWA's offline queue rather than adding
-- a second idempotency column that means the same thing.
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
  p_items jsonb,
  p_local_ref text DEFAULT NULL
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
  v_existing orders;
BEGIN
  -- A queued order retried after reconnecting carries the same local_ref it
  -- was queued with — if that ref already landed, hand back the order it
  -- already created instead of placing a second one.
  IF p_local_ref IS NOT NULL THEN
    SELECT * INTO v_existing FROM orders WHERE local_ref = p_local_ref;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'already', true, 'order_id', v_existing.id, 'amount_pesewas', v_existing.amount_pesewas);
    END IF;
  END IF;

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
    amount_pesewas, status, waiter_id, shift_id, paid_at, local_ref
  ) VALUES (
    p_tenant_id, p_venue_table_id, p_station_label, p_source,
    p_guest_name, p_guest_phone, p_payment_source, p_paystack_ref,
    v_total,
    CASE WHEN p_payment_source = 'cash' THEN 'paid' ELSE 'pending_payment' END,
    p_waiter_id, v_shift,
    CASE WHEN p_payment_source = 'cash' THEN now() ELSE NULL END,
    p_local_ref
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

  RETURN jsonb_build_object('ok', true, 'already', false, 'order_id', v_order_id, 'amount_pesewas', v_total);
END;
$$;

-- The 11-argument form is now ambiguous against the 12-argument default.
DROP FUNCTION IF EXISTS place_order(uuid, text, text, text, text, text, uuid, text, uuid, uuid, jsonb);
REVOKE ALL ON FUNCTION place_order(uuid, text, text, text, text, text, uuid, text, uuid, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION place_order(uuid, text, text, text, text, text, uuid, text, uuid, uuid, jsonb, text) TO service_role;
