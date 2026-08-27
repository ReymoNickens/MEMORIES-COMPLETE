-- Events
CREATE TABLE IF NOT EXISTS events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  name                text NOT NULL,
  description         text,
  artwork_url         text,
  host_name           text NOT NULL,   -- display name for organiser/promoter
  starts_at           timestamptz NOT NULL,
  ends_at             timestamptz NOT NULL,
  check_in_from       timestamptz NOT NULL,
  check_in_until      timestamptz NOT NULL,
  venue_capacity      int,
  status              text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','published','cancelled')),
  event_private_key_enc text,         -- Ed25519 private key, encrypted at rest
  event_public_key    text,           -- Ed25519 public key, distributed to scanners
  created_by          uuid NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Ticket types (GA, VIP, Early Bird, etc.)
CREATE TABLE IF NOT EXISTS ticket_types (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES events(id),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  name            text NOT NULL,
  description     text,
  price_pesewas   bigint NOT NULL CHECK (price_pesewas >= 0),
  remaining       int NOT NULL,       -- atomic CAS counter
  total           int NOT NULL,
  sale_starts_at  timestamptz NOT NULL,
  sale_ends_at    timestamptz NOT NULL,
  allow_installments bool NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (remaining >= 0),
  CHECK (remaining <= total)
);

-- Individual tickets
CREATE TABLE IF NOT EXISTS tickets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_type_id    uuid NOT NULL REFERENCES ticket_types(id),
  event_id          uuid NOT NULL REFERENCES events(id),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  buyer_user_id     uuid REFERENCES users(id),
  buyer_phone       text NOT NULL,
  buyer_name        text NOT NULL,
  buyer_email       text NOT NULL,
  serial            text UNIQUE NOT NULL,     -- human-readable MNC-2026-XXXX
  totp_secret_enc   text NOT NULL,            -- encrypted TOTP secret
  status            text NOT NULL DEFAULT 'issued'
                    CHECK (status IN ('reserved','issued','used','voided')),
  issued_at         timestamptz,
  used_at           timestamptz,
  voided_at         timestamptz,
  voided_reason     text,
  reissue_count     int NOT NULL DEFAULT 0 CHECK (reissue_count <= 2),
  transfer_count    int NOT NULL DEFAULT 0 CHECK (transfer_count <= 1),
  metadata          jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- THE DOUBLE-ENTRY LOCK — one row per ticket, ever
CREATE TABLE IF NOT EXISTS ticket_redemptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id         uuid UNIQUE NOT NULL REFERENCES tickets(id),
  scanned_at        timestamptz NOT NULL DEFAULT now(),
  device_id         uuid REFERENCES devices(id),
  device_name       text NOT NULL,    -- denormalised for offline sync
  door_label        text NOT NULL,    -- 'Door 1', 'Door 2', etc.
  mode              text NOT NULL CHECK (mode IN ('online','offline_deferred')),
  hub_synced_at     timestamptz,
  cloud_synced_at   timestamptz
);

-- Payment records (one per Paystack charge or installment slice)
CREATE TABLE IF NOT EXISTS ticket_payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id         uuid NOT NULL REFERENCES tickets(id),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  paystack_ref      text UNIQUE NOT NULL,
  amount_pesewas    bigint NOT NULL,
  fee_pesewas       bigint,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','successful','failed','refunded')),
  method            text NOT NULL CHECK (method IN ('momo','card','ussd')),
  momo_number       text,
  webhook_received_at timestamptz,
  raw_webhook       jsonb,
  refund_ref        text UNIQUE,      -- Paystack refund reference, for idempotency
  refunded_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Webhook deduplication
CREATE TABLE IF NOT EXISTS webhook_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paystack_event_id     text UNIQUE NOT NULL,
  event_type            text NOT NULL,
  processed_at          timestamptz NOT NULL DEFAULT now(),
  raw_payload           jsonb
);

-- Ownership history (append-only)
CREATE TABLE IF NOT EXISTS ownership_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid NOT NULL REFERENCES tickets(id),
  from_phone      text,
  to_phone        text NOT NULL,
  reason          text NOT NULL CHECK (reason IN (
    'purchase','transfer','reissue_lost','reissue_stolen','admin'
  )),
  performed_by    uuid REFERENCES users(id),
  performed_at    timestamptz NOT NULL DEFAULT now()
);

-- Revocations (voided tickets, synced to hub for offline rejection)
CREATE TABLE IF NOT EXISTS revocations (
  ticket_id     uuid PRIMARY KEY REFERENCES tickets(id),
  revoked_at    timestamptz NOT NULL DEFAULT now(),
  reason        text NOT NULL,
  revoked_by    uuid REFERENCES users(id)
);

-- Installment payment plans
CREATE TABLE IF NOT EXISTS payment_plans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id         uuid UNIQUE NOT NULL REFERENCES tickets(id),
  total_pesewas     bigint NOT NULL,
  paid_pesewas      bigint NOT NULL DEFAULT 0,  -- updated by trigger from ticket_payments
  installments_n    int NOT NULL DEFAULT 2,
  deadline_at       timestamptz NOT NULL,       -- 48h before event
  status            text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','completed','defaulted','cancelled')),
  created_at        timestamptz NOT NULL DEFAULT now()
);
