-- Enable RLS on every tenant-scoped table
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ownership_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE organiser_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_statements ENABLE ROW LEVEL SECURITY;

-- Helper functions
CREATE OR REPLACE FUNCTION get_my_tenant_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT tenant_id FROM users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION has_role(r text)
RETURNS bool LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
      AND tenant_id = get_my_tenant_id()
      AND role = r
  )
$$;

-- Customers see only their own tickets
CREATE POLICY customer_own_tickets ON tickets
  FOR SELECT USING (buyer_user_id = auth.uid());

-- Tickets: only service_role may INSERT (webhook handler only)
CREATE POLICY service_role_insert_tickets ON tickets
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Staff read all tickets for their tenant
CREATE POLICY staff_read_tickets ON tickets
  FOR SELECT USING (
    tenant_id = get_my_tenant_id()
    AND (has_role('manager') OR has_role('owner') OR has_role('door'))
  );

-- Redemptions: only hub and door devices may insert
CREATE POLICY device_insert_redemption ON ticket_redemptions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM devices d
      WHERE d.id::text = current_setting('app.device_id', true)
        AND d.role IN ('hub', 'door')
        AND d.revoked_at IS NULL
    )
  );

-- Ledger: owner and manager may read; nobody may write except service_role
CREATE POLICY ledger_read ON ledger_entries
  FOR SELECT USING (
    tenant_id = get_my_tenant_id()
    AND (has_role('owner') OR has_role('manager'))
  );

-- Cash collections: waiters see only their own
CREATE POLICY waiter_own_cash ON cash_collections
  FOR ALL USING (attributed_waiter_id = auth.uid());

-- Managers and owners see all cash collections
CREATE POLICY manager_all_cash ON cash_collections
  FOR SELECT USING (
    tenant_id = get_my_tenant_id()
    AND (has_role('manager') OR has_role('owner'))
  );

-- Orders: waiters see their assigned tables; bar staff see paid orders for their station
CREATE POLICY waiter_own_orders ON orders
  FOR SELECT USING (waiter_id = auth.uid());

CREATE POLICY manager_all_orders ON orders
  FOR SELECT USING (
    tenant_id = get_my_tenant_id()
    AND (has_role('manager') OR has_role('owner'))
  );

-- Organiser submissions: organisers see their own; managers see all
CREATE POLICY organiser_own_submissions ON organiser_submissions
  FOR SELECT USING (organiser_id = auth.uid());

CREATE POLICY manager_all_submissions ON organiser_submissions
  FOR SELECT USING (
    tenant_id = get_my_tenant_id()
    AND (has_role('manager') OR has_role('owner'))
  );
