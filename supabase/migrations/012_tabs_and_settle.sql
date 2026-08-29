-- Waiter table service: open tab (no guest pay yet), bar pours, bill at the end.
-- Waiter has no float. After the table pays, waiter accounts those tickets to the bar.

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending_payment','on_tab','paid','preparing','complete','voided'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_tab_per_table
  ON orders (venue_table_id)
  WHERE status = 'on_tab' AND venue_table_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS waiter_settlements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  shift_id        uuid REFERENCES shifts(id),
  waiter_id       uuid NOT NULL REFERENCES users(id),
  bar_user_id     uuid REFERENCES users(id),
  order_ids       uuid[] NOT NULL DEFAULT '{}',
  item_count      int NOT NULL DEFAULT 0,
  amount_pesewas  bigint NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','disputed')),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  accepted_at     timestamptz
);

ALTER TABLE waiter_settlements ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION add_tab_item(
  p_tenant_id uuid,
  p_table_id uuid,
  p_waiter_id uuid,
  p_product_id uuid,
  p_quantity int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order orders;
  v_product products;
  v_qty int := GREATEST(1, LEAST(COALESCE(p_quantity, 1), 20));
  v_item_id uuid;
BEGIN
  IF p_table_id IS NULL OR p_waiter_id IS NULL THEN
    RAISE EXCEPTION 'table_and_waiter_required';
  END IF;

  SELECT * INTO v_product
    FROM products
   WHERE id = p_product_id AND tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found'; END IF;
  IF NOT v_product.is_available THEN RAISE EXCEPTION 'product_unavailable'; END IF;

  SELECT * INTO v_order
    FROM orders
   WHERE venue_table_id = p_table_id
     AND tenant_id = p_tenant_id
     AND status = 'on_tab'
   FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO orders (
      tenant_id, venue_table_id, station_label, source,
      guest_name, guest_phone, payment_source,
      amount_pesewas, status, waiter_id
    )
    SELECT
      p_tenant_id, p_table_id, vt.label, 'waiter',
      COALESCE(vt.label, 'Table'), 'pending', 'cash',
      0, 'on_tab', p_waiter_id
    FROM venue_tables vt
    WHERE vt.id = p_table_id AND vt.tenant_id = p_tenant_id
    RETURNING * INTO v_order;
    IF NOT FOUND THEN RAISE EXCEPTION 'table_not_found'; END IF;
  END IF;

  INSERT INTO order_items (
    order_id, product_id, product_name, station, price_pesewas, quantity
  ) VALUES (
    v_order.id, v_product.id, v_product.name, v_product.station, v_product.price_pesewas, v_qty
  )
  RETURNING id INTO v_item_id;

  UPDATE orders
     SET amount_pesewas = amount_pesewas + (v_product.price_pesewas * v_qty),
         waiter_id = p_waiter_id
   WHERE id = v_order.id
   RETURNING * INTO v_order;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'item_id', v_item_id,
    'amount_pesewas', v_order.amount_pesewas
  );
END;
$$;

CREATE OR REPLACE FUNCTION close_tab(
  p_order_id uuid,
  p_method text,
  p_waiter_id uuid,
  p_shift_id uuid,
  p_paystack_ref text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order orders;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.status <> 'on_tab' THEN RAISE EXCEPTION 'not_an_open_tab'; END IF;
  IF v_order.amount_pesewas <= 0 THEN RAISE EXCEPTION 'empty_tab'; END IF;

  IF p_method = 'momo' THEN
    UPDATE orders
       SET status = 'pending_payment',
           payment_source = 'momo',
           paystack_ref = p_paystack_ref
     WHERE id = v_order.id;
    RETURN jsonb_build_object('ok', true, 'status', 'pending_payment', 'order_id', v_order.id);
  END IF;

  IF p_method <> 'cash' THEN RAISE EXCEPTION 'bad_method'; END IF;
  IF p_waiter_id IS NULL OR p_shift_id IS NULL THEN
    RAISE EXCEPTION 'cash_needs_waiter_and_shift';
  END IF;

  UPDATE orders
     SET status = 'paid',
         payment_source = 'cash',
         paid_at = now(),
         shift_id = p_shift_id,
         waiter_id = p_waiter_id
   WHERE id = v_order.id;

  INSERT INTO cash_collections (
    tenant_id, shift_id, order_id, attributed_waiter_id, amount_pesewas
  ) VALUES (
    v_order.tenant_id, p_shift_id, v_order.id, p_waiter_id, v_order.amount_pesewas
  );

  INSERT INTO ledger_entries (
    tenant_id, shift_id, account, direction, amount_pesewas, ref_type, ref_id, actor_id, memo
  ) VALUES
    (v_order.tenant_id, p_shift_id, 'cash_drawer', 'DR', v_order.amount_pesewas, 'order', v_order.id, p_waiter_id, 'tab close cash'),
    (v_order.tenant_id, p_shift_id, 'fb_revenue', 'CR', v_order.amount_pesewas, 'order', v_order.id, p_waiter_id, 'tab close cash');

  RETURN jsonb_build_object('ok', true, 'status', 'paid', 'order_id', v_order.id, 'amount_pesewas', v_order.amount_pesewas);
END;
$$;

REVOKE ALL ON FUNCTION add_tab_item(uuid, uuid, uuid, uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION close_tab(uuid, text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION add_tab_item(uuid, uuid, uuid, uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION close_tab(uuid, text, uuid, uuid, text) TO service_role;
