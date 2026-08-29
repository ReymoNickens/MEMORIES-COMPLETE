-- House roles, bar stock sheet, attendance, staff chat.

ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_check CHECK (role IN (
  'owner', 'manager', 'door', 'waiter', 'bartender', 'kitchen', 'cashier', 'organiser',
  'hr', 'finance', 'front_office', 'dj', 'mc', 'event_manager'
));

CREATE TABLE IF NOT EXISTS stock_openings (
  shift_id     uuid NOT NULL REFERENCES shifts(id),
  product_id   uuid NOT NULL REFERENCES products(id),
  qty          int NOT NULL CHECK (qty >= 0),
  amount_hint_pesewas bigint,
  set_by       uuid NOT NULL REFERENCES users(id),
  set_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shift_id, product_id)
);

CREATE TABLE IF NOT EXISTS stock_closings (
  shift_id     uuid NOT NULL REFERENCES shifts(id),
  product_id   uuid NOT NULL REFERENCES products(id),
  qty          int NOT NULL CHECK (qty >= 0),
  set_by       uuid NOT NULL REFERENCES users(id),
  set_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shift_id, product_id)
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  shift_id        uuid NOT NULL REFERENCES shifts(id),
  product_id      uuid REFERENCES products(id),
  kind            text NOT NULL CHECK (kind IN ('comp', 'debt', 'breakage', 'transfer')),
  qty             int NOT NULL CHECK (qty > 0),
  amount_pesewas  bigint NOT NULL CHECK (amount_pesewas >= 0),
  guest_name      text,
  note            text,
  actor_id        uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_shift_meta (
  shift_id               uuid PRIMARY KEY REFERENCES shifts(id),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  declared_cash_pesewas  bigint NOT NULL DEFAULT 0,
  notes                  text,
  updated_by             uuid REFERENCES users(id),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_attendance (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  shift_id    uuid REFERENCES shifts(id),
  clock_in    timestamptz NOT NULL DEFAULT now(),
  clock_out   timestamptz,
  note        text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_open_clock
  ON staff_attendance (user_id) WHERE clock_out IS NULL;

CREATE TABLE IF NOT EXISTS staff_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
