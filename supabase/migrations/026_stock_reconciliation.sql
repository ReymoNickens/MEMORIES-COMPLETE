-- Bar stock reconciliation — the second kind of leak, distinct from the cash
-- variance close_shift already catches. Cash reconciliation answers "did the
-- money a waiter handed in match what the till says they took." This
-- answers a different question: "did the number of units that physically
-- left the shelf match the number the till says were sold" — a bartender
-- who under-rings a round and pockets the difference balances their cash
-- perfectly; only a stock count catches that.
--
-- The schema for this (stock_openings, stock_closings, stock_adjustments,
-- stock_shortages) already existed from migration 013/014 — RLS'd, never
-- read or written by anything except one stray comp-adjustment insert. This
-- migration is the reconciliation math and the finalize step; the API
-- routes and the staff screen are separate files in this same change.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Per-product reconciliation for a shift
-- ─────────────────────────────────────────────────────────────────────────────
-- consumed_qty  = opening - closing                    (what physically left)
-- pos_sold_qty  = order_items sold through the till this shift, bar station
-- adjustment_qty = comps/breakage/debt/transfer logged against stock
-- expected_qty  = pos_sold_qty + adjustment_qty         (what should have left)
-- shortage_qty  = consumed_qty - expected_qty           (positive = missing)
--
-- Only meaningful once both an opening and a closing count exist — a
-- product with no closing count yet isn't a shortage, it's just uncounted,
-- and the two must never be confused in what this returns.
CREATE OR REPLACE FUNCTION get_stock_reconciliation(p_shift_id uuid)
RETURNS TABLE (
  product_id            uuid,
  product_name          text,
  opening_qty           int,
  closing_qty           int,
  counted               bool,
  consumed_qty          int,
  pos_sold_qty          int,
  adjustment_qty        int,
  expected_qty          int,
  shortage_qty          int,
  shortage_value_pesewas bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH sold AS (
    SELECT oi.product_id, COALESCE(SUM(oi.quantity), 0)::int AS qty
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.shift_id = p_shift_id
      AND o.status <> 'voided'
      AND oi.status <> 'voided'
    GROUP BY oi.product_id
  ),
  adjusted AS (
    SELECT product_id, COALESCE(SUM(qty), 0)::int AS qty
    FROM stock_adjustments
    WHERE shift_id = p_shift_id AND product_id IS NOT NULL
    GROUP BY product_id
  )
  SELECT
    p.id,
    p.name,
    so.qty,
    sc.qty,
    (so.qty IS NOT NULL AND sc.qty IS NOT NULL),
    CASE WHEN so.qty IS NOT NULL AND sc.qty IS NOT NULL THEN so.qty - sc.qty END,
    COALESCE(sold.qty, 0),
    COALESCE(adjusted.qty, 0),
    CASE WHEN so.qty IS NOT NULL AND sc.qty IS NOT NULL
      THEN COALESCE(sold.qty, 0) + COALESCE(adjusted.qty, 0) END,
    CASE WHEN so.qty IS NOT NULL AND sc.qty IS NOT NULL
      THEN (so.qty - sc.qty) - (COALESCE(sold.qty, 0) + COALESCE(adjusted.qty, 0)) END,
    CASE WHEN so.qty IS NOT NULL AND sc.qty IS NOT NULL
      THEN GREATEST(0, (so.qty - sc.qty) - (COALESCE(sold.qty, 0) + COALESCE(adjusted.qty, 0))) * p.price_pesewas END
  FROM products p
  LEFT JOIN stock_openings so ON so.shift_id = p_shift_id AND so.product_id = p.id
  LEFT JOIN stock_closings sc ON sc.shift_id = p_shift_id AND sc.product_id = p.id
  LEFT JOIN sold           ON sold.product_id = p.id
  LEFT JOIN adjusted       ON adjusted.product_id = p.id
  -- Every bar product, not just ones already touched — the count-entry
  -- screen needs the full list to start a shift's sheet from nothing, and
  -- `counted` is what tells a reconciliation report apart from a stock item
  -- nobody has counted yet.
  WHERE p.station = 'bar' AND p.is_available
  ORDER BY p.name;
$$;
REVOKE ALL ON FUNCTION get_stock_reconciliation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_stock_reconciliation(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Snapshot any real shortages once both counts are in
-- ─────────────────────────────────────────────────────────────────────────────
-- Deliberately separate from close_shift — that function's job is cash, and
-- extending its hard "won't close" invariant to stock counts would refuse a
-- night's close over a bar sheet that might legitimately get counted the
-- next morning. This is an explicit, additive step a bar manager runs once
-- closing counts are in; nothing about shift close depends on it.
CREATE OR REPLACE FUNCTION finalize_stock_reconciliation(
  p_shift_id uuid,
  p_actor_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_row record;
  v_flagged int := 0;
BEGIN
  SELECT tenant_id INTO v_tenant FROM shifts WHERE id = p_shift_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'shift_not_found'; END IF;

  FOR v_row IN SELECT * FROM get_stock_reconciliation(p_shift_id) WHERE counted AND shortage_qty > 0
  LOOP
    INSERT INTO stock_shortages (tenant_id, shift_id, product_id, qty, amount_pesewas, status)
    VALUES (v_tenant, p_shift_id, v_row.product_id, v_row.shortage_qty, v_row.shortage_value_pesewas, 'open')
    ON CONFLICT (shift_id, product_id) DO UPDATE
      SET qty = EXCLUDED.qty, amount_pesewas = EXCLUDED.amount_pesewas
      -- A shortage already marked explained/written_off/waiter_cash by a
      -- manager stays marked — re-running reconciliation after a recount
      -- updates the numbers, not a decision a human already made, unless
      -- it's still sitting open.
      WHERE stock_shortages.status = 'open';
    v_flagged := v_flagged + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'flagged', v_flagged, 'checked_by', p_actor_id);
END;
$$;
REVOKE ALL ON FUNCTION finalize_stock_reconciliation(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finalize_stock_reconciliation(uuid, uuid) TO service_role;
