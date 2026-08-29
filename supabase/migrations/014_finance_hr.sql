-- Shortages, announcements, payables, payroll, performance.

ALTER TABLE staff_messages ADD COLUMN IF NOT EXISTS urgent boolean NOT NULL DEFAULT false;
ALTER TABLE staff_messages ADD COLUMN IF NOT EXISTS to_role text;
ALTER TABLE staff_messages ADD COLUMN IF NOT EXISTS to_user uuid REFERENCES users(id);

CREATE TABLE IF NOT EXISTS stock_shortages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  shift_id        uuid NOT NULL REFERENCES shifts(id),
  product_id      uuid NOT NULL REFERENCES products(id),
  qty             int NOT NULL,
  amount_pesewas  bigint NOT NULL,
  status          text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'waiter_cash', 'unaccounted_pour', 'explained', 'written_off')),
  assigned_user   uuid REFERENCES users(id),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shift_id, product_id)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  name        text NOT NULL,
  phone       text,
  category    text NOT NULL DEFAULT 'general',
  is_active   bool NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  supplier_id     uuid REFERENCES suppliers(id),
  title           text NOT NULL,
  category        text NOT NULL DEFAULT 'opex',
  amount_pesewas  bigint NOT NULL CHECK (amount_pesewas > 0),
  due_on          date NOT NULL,
  status          text NOT NULL DEFAULT 'due'
                  CHECK (status IN ('draft', 'due', 'paid', 'overdue', 'void')),
  paid_at         timestamptz,
  paid_from       text CHECK (paid_from IS NULL OR paid_from IN ('cash', 'momo', 'bank')),
  memo            text,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_profiles (
  user_id             uuid PRIMARY KEY REFERENCES users(id),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  job_title           text,
  monthly_pesewas     bigint NOT NULL DEFAULT 0,
  bank_name           text,
  account_name        text,
  hired_on            date
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  period_label    text NOT NULL,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'approved', 'paid')),
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payroll_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id),
  gross_pesewas   bigint NOT NULL DEFAULT 0,
  deductions_pesewas bigint NOT NULL DEFAULT 0,
  net_pesewas     bigint NOT NULL DEFAULT 0,
  note            text
);

CREATE TABLE IF NOT EXISTS performance_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  author_id   uuid NOT NULL REFERENCES users(id),
  period      text NOT NULL,
  score       int NOT NULL CHECK (score BETWEEN 1 AND 5),
  note        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
