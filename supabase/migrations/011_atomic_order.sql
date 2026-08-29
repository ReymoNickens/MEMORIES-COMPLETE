-- Place an F&B order and, for cash, post the ledger in the same transaction.
-- MoMo orders stay pending_payment until mark_order_paid runs from the webhook.

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
AS $$
DECLARE
  v_order_id uuid;
  v_total bigint := 0;
  v_item jsonb;
  v_product products;
  v_qty int;
BEGIN
  IF p_source NOT IN ('counter_qr', 'table_qr', 'waiter') THEN
    RAISE EXCEPTION 'bad_source';
  END IF;
  IF p_payment_source NOT IN ('momo', 'cash') THEN
    RAISE EXCEPTION 'bad_payment';
  END IF;
  IF p_payment_source = 'cash' AND (p_waiter_id IS NULL OR p_shift_id IS NULL) THEN
    RAISE EXCEPTION 'cash_needs_waiter_and_shift';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) < 1 THEN
    RAISE EXCEPTION 'empty_order';
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
    p_waiter_id, p_shift_id,
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
      p_tenant_id, p_shift_id, v_order_id, p_waiter_id, v_total
    );

    INSERT INTO ledger_entries (
      tenant_id, shift_id, account, direction, amount_pesewas, ref_type, ref_id, actor_id, memo
    ) VALUES
      (p_tenant_id, p_shift_id, 'cash_drawer', 'DR', v_total, 'order', v_order_id, p_waiter_id, 'cash order'),
      (p_tenant_id, p_shift_id, 'fb_revenue', 'CR', v_total, 'order', v_order_id, p_waiter_id, 'cash order');
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
AS $$
DECLARE
  v_order orders;
  v_fee bigint := GREATEST(COALESCE(p_fee_pesewas, 0), 0);
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

  UPDATE orders
     SET status = 'paid',
         paid_at = now(),
         fee_pesewas = v_fee
   WHERE id = v_order.id;

  INSERT INTO ledger_entries (
    tenant_id, shift_id, event_id, account, direction, amount_pesewas, ref_type, ref_id, memo
  ) VALUES
    (v_order.tenant_id, v_order.shift_id, v_order.event_id, 'momo_clearing', 'DR', v_order.amount_pesewas, 'order', v_order.id, v_order.paystack_ref),
    (v_order.tenant_id, v_order.shift_id, v_order.event_id, 'fb_revenue', 'CR', v_order.amount_pesewas, 'order', v_order.id, v_order.paystack_ref);

  IF v_fee > 0 THEN
    INSERT INTO ledger_entries (
      tenant_id, shift_id, event_id, account, direction, amount_pesewas, ref_type, ref_id, memo
    ) VALUES
      (v_order.tenant_id, v_order.shift_id, v_order.event_id, 'paystack_fees', 'DR', v_fee, 'order', v_order.id, v_order.paystack_ref),
      (v_order.tenant_id, v_order.shift_id, v_order.event_id, 'momo_clearing', 'CR', v_fee, 'order', v_order.id, v_order.paystack_ref);
  END IF;

  RETURN jsonb_build_object('ok', true, 'already', false, 'order_id', v_order.id);
END;
$$;

REVOKE ALL ON FUNCTION place_order(uuid, text, text, text, text, text, uuid, text, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_order_paid(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION place_order(uuid, text, text, text, text, text, uuid, text, uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION mark_order_paid(uuid, bigint) TO service_role;
