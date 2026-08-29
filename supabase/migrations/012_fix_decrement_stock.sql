-- Remove the fake payment_id from decrement_ticket_stock return type.
-- The payment ID must come from the actual ticket_payments insert, not a random UUID
-- generated here (which references no real row and corrupts ledger audit trails).
CREATE OR REPLACE FUNCTION decrement_ticket_stock(
  p_ticket_type_id uuid,
  p_quantity int DEFAULT 1
) RETURNS table (
  event_id uuid,
  tenant_id uuid,
  price_pesewas bigint
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
    v_result.price_pesewas;
END; $$;
