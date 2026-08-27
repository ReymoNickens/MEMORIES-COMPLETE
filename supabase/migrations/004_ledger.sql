-- THE FINANCIAL LEDGER — append-only, no UPDATE or DELETE ever
CREATE TABLE IF NOT EXISTS ledger_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  shift_id      uuid REFERENCES shifts(id),
  event_id      uuid REFERENCES events(id),
  account       text NOT NULL CHECK (account IN (
    'momo_clearing', 'cash_drawer',
    'ticket_revenue', 'fb_revenue',
    'deposit_liability', 'forfeiture_income',
    'refunds', 'comps',
    'paystack_fees', 'organiser_payable', 'club_retained'
  )),
  direction     text NOT NULL CHECK (direction IN ('DR', 'CR')),
  amount_pesewas bigint NOT NULL CHECK (amount_pesewas > 0),
  currency      char(3) NOT NULL DEFAULT 'GHS',
  ref_type      text NOT NULL,         -- 'ticket_payment', 'order', 'cash_collection', 'comp', 'void', 'refund', 'settlement'
  ref_id        uuid NOT NULL,         -- FK to the relevant table
  actor_id      uuid REFERENCES users(id),
  device_id     uuid REFERENCES devices(id),
  memo          text,
  recorded_at   timestamptz NOT NULL DEFAULT now()
);

-- ENFORCE IMMUTABILITY
CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Ledger entries are immutable. Create a correcting entry instead.';
END; $$;

CREATE OR REPLACE TRIGGER ledger_no_update
  BEFORE UPDATE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

CREATE OR REPLACE TRIGGER ledger_no_delete
  BEFORE DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

-- Organiser event submissions
CREATE TABLE IF NOT EXISTS organiser_submissions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  organiser_id      uuid NOT NULL REFERENCES users(id),
  event_id          uuid REFERENCES events(id),
  preferred_date    date NOT NULL,
  event_name        text NOT NULL,
  host_name         text NOT NULL,
  description       text NOT NULL,
  estimated_attendance int NOT NULL,
  dj_details        text,
  comp_allowance    int NOT NULL DEFAULT 0,
  special_requirements text,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','declined')),
  reviewed_by       uuid REFERENCES users(id),
  reviewed_at       timestamptz,
  decline_reason    text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Settlement statements
CREATE TABLE IF NOT EXISTS settlement_statements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  event_id              uuid UNIQUE NOT NULL REFERENCES events(id),
  organiser_id          uuid NOT NULL REFERENCES users(id),
  gate_gross_pesewas    bigint NOT NULL DEFAULT 0,
  table_gross_pesewas   bigint NOT NULL DEFAULT 0,
  refunds_pesewas       bigint NOT NULL DEFAULT 0,
  comps_pesewas         bigint NOT NULL DEFAULT 0,
  comp_allowance_pesewas bigint NOT NULL DEFAULT 0,
  organiser_gate_pesewas bigint NOT NULL DEFAULT 0,
  organiser_table_pesewas bigint NOT NULL DEFAULT 0,
  organiser_total_pesewas bigint NOT NULL DEFAULT 0,
  club_total_pesewas    bigint NOT NULL DEFAULT 0,
  gate_split_club_bps   int NOT NULL,
  table_split_club_bps  int NOT NULL,
  status                text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','approved','paid')),
  approved_by           uuid REFERENCES users(id),
  approved_at           timestamptz,
  paid_at               timestamptz,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
