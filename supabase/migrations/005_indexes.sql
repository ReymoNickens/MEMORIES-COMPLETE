-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_tickets_event ON tickets(event_id);
CREATE INDEX IF NOT EXISTS idx_tickets_phone ON tickets(buyer_phone);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_serial ON tickets(serial);
CREATE INDEX IF NOT EXISTS idx_ticket_redemptions_ticket ON ticket_redemptions(ticket_id);
CREATE INDEX IF NOT EXISTS idx_orders_event ON orders(event_id);
CREATE INDEX IF NOT EXISTS idx_orders_shift ON orders(shift_id);
CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(venue_table_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_station ON order_items(station, status);
CREATE INDEX IF NOT EXISTS idx_ledger_tenant_account ON ledger_entries(tenant_id, account);
CREATE INDEX IF NOT EXISTS idx_ledger_event ON ledger_entries(event_id);
CREATE INDEX IF NOT EXISTS idx_ledger_shift ON ledger_entries(shift_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_type ON webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_cash_collections_waiter ON cash_collections(attributed_waiter_id, shift_id);
CREATE INDEX IF NOT EXISTS idx_revocations_revoked_at ON revocations(revoked_at);
