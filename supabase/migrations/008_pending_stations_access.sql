-- Pending checkouts: payments exist before any ticket row
CREATE TABLE IF NOT EXISTS pending_checkouts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  ticket_type_id    uuid NOT NULL REFERENCES ticket_types(id),
  event_id          uuid NOT NULL REFERENCES events(id),
  quantity          int NOT NULL CHECK (quantity BETWEEN 1 AND 6),
  buyer_name        text NOT NULL,
  buyer_phone       text NOT NULL,
  buyer_email       text NOT NULL,
  amount_pesewas    bigint NOT NULL,
  paystack_ref      text UNIQUE NOT NULL,
  use_installments  bool NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','paid','issued','failed','refunded')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Counter / kitchen / door stations (QR tokens)
CREATE TABLE IF NOT EXISTS stations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  kind            text NOT NULL CHECK (kind IN ('door','bar','kitchen','cashier','floor')),
  label           text NOT NULL,
  qr_token        text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(12), 'hex'),
  is_active       bool NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Staff PIN credentials (demo uses sha256; production should be argon2id)
CREATE TABLE IF NOT EXISTS staff_credentials (
  user_id     uuid PRIMARY KEY REFERENCES users(id),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  pin_hash    text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Station claim: one open claim per user
CREATE TABLE IF NOT EXISTS station_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  user_id         uuid NOT NULL REFERENCES users(id),
  role            text NOT NULL,
  station_kind    text NOT NULL,
  station_label   text NOT NULL,
  device_id       uuid REFERENCES devices(id),
  claimed_at      timestamptz NOT NULL DEFAULT now(),
  released_at     timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_station_sessions_open_user
  ON station_sessions(user_id) WHERE released_at IS NULL;

-- Customer ticket page access token (hashed). Raw token is shown once after issue.
CREATE TABLE IF NOT EXISTS ticket_access (
  ticket_id     uuid PRIMARY KEY REFERENCES tickets(id),
  token_hash    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pending_checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE station_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_read_stations ON stations
  FOR SELECT USING (tenant_id = get_my_tenant_id());

CREATE POLICY staff_own_sessions ON station_sessions
  FOR SELECT USING (user_id = auth.uid() OR (
    tenant_id = get_my_tenant_id() AND (has_role('owner') OR has_role('manager'))
  ));

CREATE INDEX IF NOT EXISTS idx_pending_checkouts_ref ON pending_checkouts(paystack_ref);
CREATE INDEX IF NOT EXISTS idx_station_sessions_open ON station_sessions(tenant_id) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_table_reservations_event ON table_reservations(event_id, status);
