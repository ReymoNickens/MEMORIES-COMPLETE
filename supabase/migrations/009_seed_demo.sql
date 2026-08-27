-- Demo operating data for Memories Night Club.
-- Staff PINs (sha256 of tenant_id:pin) are inserted after users exist.

DO $$
DECLARE
  v_tenant uuid;
  v_owner uuid := '11111111-1111-1111-1111-111111111111';
  v_door uuid := '22222222-2222-2222-2222-222222222222';
  v_bar uuid := '33333333-3333-3333-3333-333333333333';
  v_kitchen uuid := '44444444-4444-4444-4444-444444444444';
  v_waiter uuid := '55555555-5555-5555-5555-555555555555';
  v_organiser uuid := '66666666-6666-6666-6666-666666666666';
  v_event uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_ga uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_vip uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE slug = 'memories-nc';

  INSERT INTO users (id, tenant_id, full_name, phone, email)
  VALUES
    (v_owner, v_tenant, 'Ama Owner', '+233547180023', 'owner@memories.evolveit.io'),
    (v_door, v_tenant, 'Kojo Door', '+233201111111', 'door@memories.evolveit.io'),
    (v_bar, v_tenant, 'Efua Bar', '+233202222222', 'bar@memories.evolveit.io'),
    (v_kitchen, v_tenant, 'Yaw Kitchen', '+233203333333', 'kitchen@memories.evolveit.io'),
    (v_waiter, v_tenant, 'Abena Waiter', '+233204444444', 'waiter@memories.evolveit.io'),
    (v_organiser, v_tenant, 'Nana Organiser', '+233205555555', 'organiser@memories.evolveit.io')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO user_roles (user_id, tenant_id, role) VALUES
    (v_owner, v_tenant, 'owner'),
    (v_door, v_tenant, 'door'),
    (v_bar, v_tenant, 'bartender'),
    (v_kitchen, v_tenant, 'kitchen'),
    (v_waiter, v_tenant, 'waiter'),
    (v_organiser, v_tenant, 'organiser')
  ON CONFLICT DO NOTHING;

  INSERT INTO staff_credentials (user_id, tenant_id, pin_hash) VALUES
    (v_owner, v_tenant, encode(digest(v_tenant::text || ':1111', 'sha256'), 'hex')),
    (v_door, v_tenant, encode(digest(v_tenant::text || ':2222', 'sha256'), 'hex')),
    (v_bar, v_tenant, encode(digest(v_tenant::text || ':3333', 'sha256'), 'hex')),
    (v_kitchen, v_tenant, encode(digest(v_tenant::text || ':4444', 'sha256'), 'hex')),
    (v_waiter, v_tenant, encode(digest(v_tenant::text || ':5555', 'sha256'), 'hex')),
    (v_organiser, v_tenant, encode(digest(v_tenant::text || ':6666', 'sha256'), 'hex'))
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO events (
    id, tenant_id, name, description, host_name,
    starts_at, ends_at, check_in_from, check_in_until,
    venue_capacity, status, created_by
  ) VALUES (
    v_event, v_tenant,
    'Friday Night — Memories',
    'Afrobeats, Amapiano, Afro house. Doors 10PM. SamRit Hotel, Cape Coast.',
    'Memories Night Club',
    date_trunc('week', now() AT TIME ZONE 'Africa/Accra') + interval '4 days' + interval '22 hours',
    date_trunc('week', now() AT TIME ZONE 'Africa/Accra') + interval '5 days' + interval '4 hours',
    date_trunc('week', now() AT TIME ZONE 'Africa/Accra') + interval '4 days' + interval '21 hours',
    date_trunc('week', now() AT TIME ZONE 'Africa/Accra') + interval '5 days' + interval '5 hours',
    400, 'published', v_owner
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO ticket_types (
    id, event_id, tenant_id, name, description,
    price_pesewas, remaining, total, sale_starts_at, sale_ends_at, allow_installments
  ) VALUES
    (v_ga, v_event, v_tenant, 'General Admission', 'Floor access. Skip the gate queue.',
     8000, 280, 280, now() - interval '7 days', now() + interval '30 days', true),
    (v_vip, v_event, v_tenant, 'VIP', 'Priority entry. Dedicated floor host.',
     20000, 40, 40, now() - interval '7 days', now() + interval '30 days', false)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO venue_tables (tenant_id, label, zone, seats, min_spend_pesewas)
  VALUES
    (v_tenant, 'Table 1', 'main_floor', 6, 50000),
    (v_tenant, 'Table 2', 'main_floor', 6, 50000),
    (v_tenant, 'Table 3', 'main_floor', 8, 80000),
    (v_tenant, 'VIP Booth A', 'vip', 8, 200000),
    (v_tenant, 'VIP Booth B', 'vip', 8, 200000)
  ON CONFLICT DO NOTHING;

  INSERT INTO stations (tenant_id, kind, label) VALUES
    (v_tenant, 'door', 'Door 1'),
    (v_tenant, 'door', 'Door 2'),
    (v_tenant, 'bar', 'Bar Main'),
    (v_tenant, 'bar', 'Bar VIP'),
    (v_tenant, 'kitchen', 'Kitchen'),
    (v_tenant, 'floor', 'Floor'),
    (v_tenant, 'cashier', 'Cash Office')
  ON CONFLICT DO NOTHING;

  INSERT INTO products (tenant_id, name, category, station, price_pesewas, sort_order) VALUES
    (v_tenant, 'Star Lager', 'beer', 'bar', 2500, 1),
    (v_tenant, 'Club Beer', 'beer', 'bar', 2500, 2),
    (v_tenant, 'Heineken', 'beer', 'bar', 3500, 3),
    (v_tenant, 'Alomo Bitters shot', 'spirits', 'bar', 2000, 4),
    (v_tenant, 'Hennessy VS bottle', 'spirits', 'bar', 85000, 5),
    (v_tenant, 'Jollof plate', 'food', 'kitchen', 4500, 10),
    (v_tenant, 'Kelewele', 'food', 'kitchen', 3000, 11),
    (v_tenant, 'Chicken wings', 'food', 'kitchen', 5500, 12),
    (v_tenant, 'Bottled water', 'soft', 'bar', 1000, 20)
  ON CONFLICT DO NOTHING;
END $$;
