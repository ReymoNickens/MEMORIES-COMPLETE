-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Tenants (isolation root)
CREATE TABLE IF NOT EXISTS tenants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text UNIQUE NOT NULL,
  name            text NOT NULL,
  timezone        text NOT NULL DEFAULT 'Africa/Accra',
  currency        char(3) NOT NULL DEFAULT 'GHS',
  gate_split_club_bps  int NOT NULL DEFAULT 7000,  -- 70% club
  table_split_club_bps int NOT NULL DEFAULT 9000,  -- 90% club
  settings        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Feature flags per tenant
CREATE TABLE IF NOT EXISTS tenant_features (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  key         text NOT NULL,
  enabled     bool NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, key)
);

-- Tenant branding
CREATE TABLE IF NOT EXISTS tenant_branding (
  tenant_id       uuid PRIMARY KEY REFERENCES tenants(id),
  primary_hex     char(7),
  secondary_hex   char(7),
  logo_url        text,
  hero_url        text
);

-- Users (staff and customers, linked to Supabase auth.uid)
CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY,  -- auth.uid()
  tenant_id       uuid REFERENCES tenants(id),  -- null for evolveit_admin
  full_name       text NOT NULL,
  phone           text,              -- E.164 format
  email           text,
  token_version   int NOT NULL DEFAULT 1,
  is_active       bool NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone),
  UNIQUE (tenant_id, email)
);

-- Roles (a user may hold multiple)
CREATE TABLE IF NOT EXISTS user_roles (
  user_id     uuid NOT NULL REFERENCES users(id),
  tenant_id   uuid NOT NULL,
  role        text NOT NULL CHECK (role IN (
    'owner', 'manager', 'door', 'waiter',
    'bartender', 'kitchen', 'cashier', 'organiser'
  )),
  PRIMARY KEY (user_id, tenant_id, role)
);

-- Devices (scanners, displays, hub — separate from user accounts)
CREATE TABLE IF NOT EXISTS devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  name          text NOT NULL,
  role          text NOT NULL CHECK (role IN ('hub', 'door', 'bar_display', 'kitchen_display')),
  key_hash      text NOT NULL,      -- argon2id hash of device API key
  event_ids     uuid[],             -- null = all events; set to lock scanner to specific events
  revoked_at    timestamptz,
  last_seen_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Shifts (operating night, unit of financial accountability)
CREATE TABLE IF NOT EXISTS shifts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  opened_at       timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  opened_by       uuid NOT NULL REFERENCES users(id),
  closed_by       uuid REFERENCES users(id),
  hub_device_id   uuid REFERENCES devices(id),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Seed Memories Night Club as tenant 0
INSERT INTO tenants (slug, name)
VALUES ('memories-nc', 'Memories Night Club')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO tenant_features (tenant_id, key, enabled)
SELECT id, unnest(ARRAY[
  'ticketing', 'ordering.counter', 'ordering.table',
  'accounting', 'organiser', 'venue',
  'ticketing.installments'
]), true
FROM tenants WHERE slug = 'memories-nc'
ON CONFLICT DO NOTHING;

INSERT INTO tenant_branding (tenant_id, primary_hex, secondary_hex)
SELECT id, '#B8122A', '#08070D'
FROM tenants WHERE slug = 'memories-nc'
ON CONFLICT DO NOTHING;
