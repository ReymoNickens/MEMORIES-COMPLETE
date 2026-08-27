-- Venue tables
CREATE TABLE IF NOT EXISTS venue_tables (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  label           text NOT NULL,       -- 'Table 1', 'VIP Booth A'
  zone            text NOT NULL,       -- 'main_floor', 'vip', 'terrace'
  seats           int NOT NULL,
  min_spend_pesewas bigint NOT NULL DEFAULT 0,
  qr_token        text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(12), 'hex'),
  is_active       bool NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Table reservations
CREATE TABLE IF NOT EXISTS table_reservations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  venue_table_id    uuid NOT NULL REFERENCES venue_tables(id),
  event_id          uuid REFERENCES events(id),
  guest_name        text NOT NULL,
  guest_phone       text NOT NULL,
  reserved_for      timestamptz NOT NULL,
  deposit_pesewas   bigint NOT NULL DEFAULT 0,
  deposit_paid_at   timestamptz,
  paystack_ref      text,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','confirmed','arrived','no_show','cancelled')),
  arrived_at        timestamptz,
  cancelled_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Menu products
CREATE TABLE IF NOT EXISTS products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  name            text NOT NULL,
  description     text,
  category        text NOT NULL,       -- 'spirits', 'beer', 'wine', 'cocktail', 'soft', 'food', 'other'
  station         text NOT NULL CHECK (station IN ('bar', 'kitchen')),
  price_pesewas   bigint NOT NULL CHECK (price_pesewas > 0),
  is_available    bool NOT NULL DEFAULT true,
  sort_order      int NOT NULL DEFAULT 0,
  image_url       text,
  section_access  text[],              -- null = all sections; set to restrict to ['vip']
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Orders (one per QR checkout session)
CREATE TABLE IF NOT EXISTS orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  event_id          uuid REFERENCES events(id),
  shift_id          uuid REFERENCES shifts(id),
  venue_table_id    uuid REFERENCES venue_tables(id),
  station_label     text,              -- 'Bar Main', 'Bar VIP' — from counter QR
  source            text NOT NULL CHECK (source IN ('counter_qr', 'table_qr', 'waiter')),
  guest_name        text NOT NULL,
  guest_phone       text NOT NULL,
  payment_source    text NOT NULL DEFAULT 'momo' CHECK (payment_source IN ('momo', 'cash')),
  paystack_ref      text UNIQUE,       -- null for cash orders
  amount_pesewas    bigint NOT NULL,
  fee_pesewas       bigint NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'pending_payment'
                    CHECK (status IN ('pending_payment','paid','preparing','complete','voided')),
  waiter_id         uuid REFERENCES users(id),
  local_ref         text UNIQUE,       -- hub idempotency key
  paid_at           timestamptz,
  voided_at         timestamptz,
  voided_reason     text,
  voided_by         uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Order line items
CREATE TABLE IF NOT EXISTS order_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES orders(id),
  product_id      uuid NOT NULL REFERENCES products(id),
  product_name    text NOT NULL,       -- denormalised snapshot
  station         text NOT NULL,       -- denormalised snapshot
  price_pesewas   bigint NOT NULL,     -- snapshot at order time
  quantity        int NOT NULL CHECK (quantity > 0),
  line_total_pesewas bigint GENERATED ALWAYS AS (price_pesewas * quantity) STORED,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','preparing','ready','delivered','voided')),
  ready_at        timestamptz,
  delivered_at    timestamptz
);

-- Waiter cash collections (per-waiter accountability)
CREATE TABLE IF NOT EXISTS cash_collections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  shift_id              uuid NOT NULL REFERENCES shifts(id),
  order_id              uuid UNIQUE NOT NULL REFERENCES orders(id),
  attributed_waiter_id  uuid NOT NULL REFERENCES users(id),  -- NOT NULL: must have an owner
  amount_pesewas        bigint NOT NULL,
  collected_at          timestamptz NOT NULL DEFAULT now(),
  handed_in_at          timestamptz,   -- set at shift close when waiter hands in cash
  physical_amount_pesewas bigint       -- what the waiter actually handed in at shift close
);
