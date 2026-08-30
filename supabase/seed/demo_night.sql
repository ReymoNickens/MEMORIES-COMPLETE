-- ═══════════════════════════════════════════════════════════════════════════
-- DEMO NIGHT — Memories Night Club, one Friday, 200 guests, GHS 130,000.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- This is a load-bearing fixture, not decoration. It exists so that the owner
-- dashboard, the shift-close reconciliation, the bar rail, the floor plan and
-- the settlement maths can all be looked at with a full house on them, and so
-- that a regression that silently drops revenue shows up as a failed assert
-- instead of a quiet zero.
--
-- The money:
--     Gate    200 tickets   160 GA @ GHS 80 + 40 VIP @ GHS 200 = GHS  20,800
--     Bar     bottles, beer, shots, kitchen                    = GHS 109,200
--                                                                ───────────
--                                                                GHS 130,000
--
-- Everything is written through the real transaction functions —
-- complete_paid_checkout, place_order, mark_order_paid, add_tab_item,
-- close_tab, record_handover — so the ledger balances by construction and the
-- seed doubles as an integration test of the payment paths.
--
-- NOT A MIGRATION. Run it deliberately:
--     psql "$DATABASE_URL" -f supabase/seed/demo_night.sql
-- It refuses to run against a database that already carries real trade, and
-- it refuses to run twice.

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_tenant uuid;
  v_event  uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_ga     uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_vip    uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_owner  uuid := '11111111-1111-1111-1111-111111111111';
  v_existing int;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE slug = 'memories-nc';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'demo seed: tenant memories-nc not found — run migrations first';
  END IF;

  -- Guard 1: never drop 130k of fabricated revenue onto a ledger that has
  -- real trade on it. ledger_entries is append-only; there is no undo.
  SELECT COUNT(*) INTO v_existing FROM ledger_entries WHERE tenant_id = v_tenant;
  IF v_existing > 0 THEN
    RAISE EXCEPTION
      'demo seed refused: % ledger entries already exist for this tenant. '
      'The ledger is immutable — seed only into an empty book.', v_existing;
  END IF;

  -- Guard 2: idempotence.
  IF EXISTS (SELECT 1 FROM shifts WHERE tenant_id = v_tenant AND notes = 'demo-night') THEN
    RAISE EXCEPTION 'demo seed refused: demo night already seeded';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- The house that works this night
-- ─────────────────────────────────────────────────────────────────────────────
-- 009 seeds one waiter. One waiter does not serve 200 people, and a cash
-- reconciliation screen with a single row teaches the owner nothing.
DO $$
DECLARE
  v_tenant uuid;
  v_row record;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE slug = 'memories-nc';

  FOR v_row IN
    SELECT * FROM (VALUES
      ('a0000000-0000-4000-8000-000000000001'::uuid, 'Serwaa Mensah',   '+233244100001', 'waiter',    'Floor server'),
      ('a0000000-0000-4000-8000-000000000002'::uuid, 'Kwesi Boateng',   '+233244100002', 'waiter',    'Floor server'),
      ('a0000000-0000-4000-8000-000000000003'::uuid, 'Adjoa Nyarko',    '+233244100003', 'waiter',    'VIP server'),
      ('a0000000-0000-4000-8000-000000000004'::uuid, 'Kofi Antwi',      '+233244100004', 'waiter',    'Floor server'),
      ('a0000000-0000-4000-8000-000000000005'::uuid, 'Akua Darko',      '+233244100005', 'bartender', 'Bar Main lead'),
      ('a0000000-0000-4000-8000-000000000006'::uuid, 'Mensah Appiah',   '+233244100006', 'bartender', 'Bar VIP'),
      ('a0000000-0000-4000-8000-000000000007'::uuid, 'Selorm Agbeko',   '+233244100007', 'manager',   'Duty manager'),
      ('a0000000-0000-4000-8000-000000000008'::uuid, 'Nii Lartey',      '+233244100008', 'door',      'Head of door')
    ) AS t(id, name, phone, role, title)
  LOOP
    INSERT INTO users (id, tenant_id, full_name, phone, email)
    VALUES (v_row.id, v_tenant, v_row.name, v_row.phone,
            lower(replace(v_row.name, ' ', '.')) || '@memories.evolveit.io')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO user_roles (user_id, tenant_id, role)
    VALUES (v_row.id, v_tenant, v_row.role)
    ON CONFLICT DO NOTHING;

    -- Demo PIN is the last four of the phone. Rotate before any public deploy.
    INSERT INTO staff_credentials (user_id, tenant_id, pin_hash)
    VALUES (v_row.id, v_tenant,
            encode(digest(v_tenant::text || ':' || right(v_row.phone, 4), 'sha256'), 'hex'))
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO staff_profiles (user_id, tenant_id, job_title, monthly_pesewas, hired_on)
    VALUES (v_row.id, v_tenant, v_row.title,
            CASE v_row.role WHEN 'manager' THEN 280000
                            WHEN 'bartender' THEN 160000
                            WHEN 'door' THEN 150000
                            ELSE 120000 END,
            date '2026-01-15')
    ON CONFLICT (user_id) DO NOTHING;
  END LOOP;

  -- VIP stock in 009 is 40 seats; this night sells all of them.
  UPDATE ticket_types SET total = 40, remaining = 40
   WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' AND remaining = total;
  UPDATE ticket_types SET total = 280, remaining = 280
   WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' AND remaining = total;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Gate: 200 tickets, GHS 20,800
-- ─────────────────────────────────────────────────────────────────────────────
-- 150 sold in the week before (no shift — they belong to no operating night)
-- and 50 sold at the door once the shift is open. Both paths run through
-- complete_paid_checkout so stock, tickets, access grants, payments and the
-- ledger commit together, exactly as the live webhook does it.
CREATE OR REPLACE FUNCTION pg_temp.demo_sell(
  p_type_id uuid,
  p_count int,
  p_tag text
) RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_first text[] := ARRAY['Kwame','Ama','Yaw','Akosua','Kojo','Efua','Kwesi','Abena',
                          'Kofi','Adjoa','Nana','Esi','Fiifi','Maame','Paa','Araba'];
  v_last  text[] := ARRAY['Mensah','Owusu','Asante','Boateng','Appiah','Nyarko','Darko',
                          'Ofori','Addo','Quartey','Amoah','Tetteh','Bediako','Sarpong'];
  v_type  ticket_types;
  v_sold  int := 0;
  v_batch int;
  v_ref   text;
  v_co    uuid;
  v_name  text;
  v_phone text;
  v_bundle jsonb;
  v_i     int;
BEGIN
  SELECT * INTO v_type FROM ticket_types WHERE id = p_type_id;

  WHILE v_sold < p_count LOOP
    -- Real buying behaviour: mostly pairs, some singles, the odd group of four.
    v_batch := LEAST(p_count - v_sold,
                     (ARRAY[1,1,2,2,2,2,3,4])[1 + floor(random() * 8)::int]);

    v_name  := v_first[1 + floor(random() * array_length(v_first, 1))::int] || ' ' ||
               v_last[1 + floor(random() * array_length(v_last, 1))::int];
    v_phone := '+2332' || lpad((floor(random() * 100000000))::bigint::text, 8, '0');
    v_ref   := 'demo_' || p_tag || '_' || encode(gen_random_bytes(6), 'hex');

    INSERT INTO pending_checkouts (
      tenant_id, ticket_type_id, event_id, quantity,
      buyer_name, buyer_phone, buyer_email,
      amount_pesewas, paystack_ref, status
    ) VALUES (
      v_type.tenant_id, p_type_id, v_type.event_id, v_batch,
      v_name, v_phone,
      lower(replace(v_name, ' ', '.')) || v_sold::text || '@example.gh',
      v_type.price_pesewas * v_batch, v_ref, 'paid'
    ) RETURNING id INTO v_co;

    -- One entry per ticket, mirroring what issue-tickets.ts builds in Node.
    -- Demo TOTP secrets use the legacy base64 envelope: decodeTotpSecret reads
    -- it, but it is NOT encrypted. Never seed this into a live database.
    v_bundle := '[]'::jsonb;
    FOR v_i IN 1..v_batch LOOP
      v_bundle := v_bundle || jsonb_build_object(
        'totp_enc',       encode(gen_random_bytes(20), 'base64'),
        'access_hash',    encode(digest(gen_random_uuid()::text, 'sha256'), 'hex'),
        'amount_pesewas', v_type.price_pesewas,
        'fee_pesewas',    round(v_type.price_pesewas * 0.0195),  -- Paystack GH MoMo
        'method',         'momo',
        'paystack_ref',   v_ref || '-' || v_i::text
      );
    END LOOP;

    PERFORM complete_paid_checkout(v_co, v_bundle);
    v_sold := v_sold + v_batch;
  END LOOP;

  RETURN v_sold;
END; $$;

-- Advance sales, before the shift opens.
SELECT setseed(0.4242);
SELECT pg_temp.demo_sell('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 120, 'adv_ga');
SELECT pg_temp.demo_sell('cccccccc-cccc-cccc-cccc-cccccccccccc',  30, 'adv_vip');

-- ─────────────────────────────────────────────────────────────────────────────
-- The shift opens
-- ─────────────────────────────────────────────────────────────────────────────
-- Everything is anchored on now() rather than a wall clock, so whenever the
-- seed is run the demo lands you in the middle of the night rather than in
-- last Friday's archive: doors open four hours ago, the room is full, the bar
-- still has live tickets on the rail, and the cash has not all been counted.
UPDATE events SET
  starts_at      = now() - interval '3 hours 40 minutes',
  ends_at        = now() + interval '2 hours 20 minutes',
  check_in_from  = now() - interval '4 hours 40 minutes',
  check_in_until = now() + interval '3 hours'
WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

INSERT INTO shifts (id, tenant_id, opened_at, opened_by, notes)
SELECT
  'd0000000-0000-4000-8000-00000000000f',
  t.id,
  now() - interval '4 hours 40 minutes',
  'a0000000-0000-4000-8000-000000000007',   -- Selorm, duty manager
  'demo-night'
FROM tenants t WHERE t.slug = 'memories-nc';

-- Door sales, now inside the operating night.
SELECT pg_temp.demo_sell('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 40, 'door_ga');
SELECT pg_temp.demo_sell('cccccccc-cccc-cccc-cccc-cccccccccccc', 10, 'door_vip');

-- Opening stock count, so the shortage report has a baseline to work against.
INSERT INTO stock_openings (shift_id, product_id, qty, amount_hint_pesewas, set_by)
SELECT
  'd0000000-0000-4000-8000-00000000000f', p.id,
  CASE p.name
    WHEN 'Hennessy VS bottle' THEN 72
    WHEN 'Heineken'           THEN 480
    WHEN 'Star Lager'         THEN 600
    WHEN 'Club Beer'          THEN 480
    WHEN 'Alomo Bitters shot' THEN 420
    WHEN 'Bottled water'      THEN 240
    ELSE 200
  END,
  p.price_pesewas,
  'a0000000-0000-4000-8000-000000000005'    -- Akua, bar lead
FROM products p
JOIN tenants t ON t.id = p.tenant_id AND t.slug = 'memories-nc';

-- Everyone on tonight clocks in.
INSERT INTO staff_attendance (tenant_id, user_id, shift_id, clock_in)
SELECT u.tenant_id, u.id, 'd0000000-0000-4000-8000-00000000000f',
       now() - interval '5 hours'
FROM users u
JOIN tenants t ON t.id = u.tenant_id AND t.slug = 'memories-nc'
WHERE u.id::text LIKE 'a0000000%'
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- The bar: GHS 109,200 across the night
-- ─────────────────────────────────────────────────────────────────────────────
-- Demand is fixed up front and then drained into orders, so the grand total is
-- exact by construction rather than by luck. Baskets, channels and the
-- cash/MoMo split are shaped to look like a real Friday in Cape Coast:
-- bottle service on the booths, beer and shots at the counter, kitchen tickets
-- from the tables, and roughly a third of the room paying in cash.
CREATE TEMP TABLE demo_demand (
  product_id uuid PRIMARY KEY,
  name       text NOT NULL,
  price      bigint NOT NULL,
  station    text NOT NULL,
  remaining  int NOT NULL,
  max_line   int NOT NULL
);

INSERT INTO demo_demand
SELECT p.id, p.name, p.price_pesewas, p.station, d.qty, d.max_line
FROM (VALUES
  ('Hennessy VS bottle',  58, 3),
  ('Heineken',           400, 8),
  ('Star Lager',         480, 10),
  ('Club Beer',          400, 8),
  ('Jollof plate',       180, 4),
  ('Alomo Bitters shot', 350, 6),
  ('Chicken wings',       90, 3),
  ('Kelewele',           120, 3),
  ('Bottled water',       25, 4)
) AS d(name, qty, max_line)
JOIN products p ON p.name = d.name
JOIN tenants t ON t.id = p.tenant_id AND t.slug = 'memories-nc';

DO $$
DECLARE
  v_expected bigint;
BEGIN
  SELECT SUM(price * remaining) INTO v_expected FROM demo_demand;
  IF v_expected <> 10920000 THEN
    RAISE EXCEPTION 'demo demand is GHS %, expected GHS 109,200',
      round(v_expected / 100.0, 2);
  END IF;
END $$;

-- ── Bottle service on the five tables ───────────────────────────────────────
-- Opened as tabs by the VIP and floor servers, run all night, billed at close.
DO $$
DECLARE
  v_tenant  uuid;
  v_shift   uuid := 'd0000000-0000-4000-8000-00000000000f';
  v_hennessy uuid;
  v_heineken uuid;
  v_water    uuid;
  v_tbl     record;
  v_waiter  uuid;
  v_bottles int;
  v_res     jsonb;
  v_idx     int := 0;
  v_waiters uuid[] := ARRAY[
    'a0000000-0000-4000-8000-000000000003'::uuid,  -- Adjoa, VIP
    'a0000000-0000-4000-8000-000000000001'::uuid,  -- Serwaa
    'a0000000-0000-4000-8000-000000000002'::uuid,  -- Kwesi
    'a0000000-0000-4000-8000-000000000004'::uuid   -- Kofi
  ];
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE slug = 'memories-nc';
  SELECT product_id INTO v_hennessy FROM demo_demand WHERE name = 'Hennessy VS bottle';
  SELECT product_id INTO v_heineken FROM demo_demand WHERE name = 'Heineken';
  SELECT product_id INTO v_water    FROM demo_demand WHERE name = 'Bottled water';

  FOR v_tbl IN
    SELECT id, label, zone, min_spend_pesewas
      FROM venue_tables
     WHERE tenant_id = v_tenant AND is_active
     ORDER BY zone DESC, label
  LOOP
    v_idx := v_idx + 1;
    v_waiter := v_waiters[1 + (v_idx - 1) % array_length(v_waiters, 1)];

    -- A VIP booth clears its GHS 2,000 minimum on bottles alone.
    v_bottles := CASE WHEN v_tbl.zone = 'vip' THEN 5 ELSE 3 END;

    PERFORM add_tab_item(v_tenant, v_tbl.id, v_waiter, v_hennessy, v_bottles);
    UPDATE demo_demand SET remaining = remaining - v_bottles WHERE product_id = v_hennessy;

    PERFORM add_tab_item(v_tenant, v_tbl.id, v_waiter, v_heineken, 6);
    UPDATE demo_demand SET remaining = remaining - 6 WHERE product_id = v_heineken;

    PERFORM add_tab_item(v_tenant, v_tbl.id, v_waiter, v_water, 4);
    UPDATE demo_demand SET remaining = remaining - 4 WHERE product_id = v_water;

    -- VIP settles on MoMo, the main floor pays the server in cash.
    IF v_tbl.zone = 'vip' THEN
      v_res := close_tab(
        (SELECT id FROM orders WHERE venue_table_id = v_tbl.id AND status = 'on_tab'),
        'momo', v_waiter, v_shift,
        'demo_tab_' || encode(gen_random_bytes(5), 'hex'));
      PERFORM mark_order_paid((v_res->>'order_id')::uuid, 0);
    ELSE
      PERFORM close_tab(
        (SELECT id FROM orders WHERE venue_table_id = v_tbl.id AND status = 'on_tab'),
        'cash', v_waiter, v_shift, NULL);
    END IF;
  END LOOP;
END $$;

-- ── The rest of the room ────────────────────────────────────────────────────
-- Drains whatever the tabs did not take, through the counter and table QRs.
DO $$
DECLARE
  v_tenant   uuid;
  v_shift    uuid := 'd0000000-0000-4000-8000-00000000000f';
  v_first    text[] := ARRAY['Kwame','Ama','Yaw','Akosua','Kojo','Efua','Kwesi','Abena',
                             'Kofi','Adjoa','Nana','Esi','Fiifi','Maame','Paa','Araba'];
  v_last     text[] := ARRAY['Mensah','Owusu','Asante','Boateng','Appiah','Nyarko',
                             'Darko','Ofori','Addo','Quartey','Amoah','Tetteh'];
  v_waiters  uuid[] := ARRAY[
    'a0000000-0000-4000-8000-000000000001'::uuid,
    'a0000000-0000-4000-8000-000000000002'::uuid,
    'a0000000-0000-4000-8000-000000000003'::uuid,
    'a0000000-0000-4000-8000-000000000004'::uuid
  ];
  v_tables   uuid[];
  v_line     record;
  v_items    jsonb;
  v_lines    int;
  v_qty      int;
  v_cash     bool;
  v_table    uuid;
  v_source   text;
  v_station  text;
  v_waiter   uuid;
  v_res      jsonb;
  v_orders   int := 0;
  v_guard    int := 0;
  v_name     text;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE slug = 'memories-nc';
  SELECT array_agg(id) INTO v_tables
    FROM venue_tables WHERE tenant_id = v_tenant AND is_active;

  LOOP
    EXIT WHEN NOT EXISTS (SELECT 1 FROM demo_demand WHERE remaining > 0);
    v_guard := v_guard + 1;
    IF v_guard > 5000 THEN
      RAISE EXCEPTION 'demo seed: order generator failed to converge';
    END IF;

    -- Between one and three lines, taken from whatever is still owed.
    v_items := '[]'::jsonb;
    v_lines := 1 + floor(random() * 3)::int;

    FOR v_line IN
      SELECT * FROM demo_demand
       WHERE remaining > 0
       ORDER BY random()
       LIMIT v_lines
    LOOP
      v_qty := LEAST(v_line.remaining, 1 + floor(random() * v_line.max_line)::int);
      v_items := v_items || jsonb_build_object(
        'product_id', v_line.product_id, 'quantity', v_qty);
      UPDATE demo_demand
         SET remaining = remaining - v_qty
       WHERE product_id = v_line.product_id;
    END LOOP;

    CONTINUE WHEN jsonb_array_length(v_items) = 0;

    -- 38% cash, which is what a Ghanaian club floor actually looks like even
    -- with MoMo everywhere. Cash always carries a named server.
    v_cash := random() < 0.38;

    -- Two thirds of the room orders from a table QR, the rest at the counter.
    IF random() < 0.66 THEN
      v_source  := 'table_qr';
      v_table   := v_tables[1 + floor(random() * array_length(v_tables, 1))::int];
      v_station := (SELECT label FROM venue_tables WHERE id = v_table);
    ELSE
      v_source  := 'counter_qr';
      v_table   := NULL;
      v_station := CASE WHEN random() < 0.75 THEN 'Bar Main' ELSE 'Bar VIP' END;
    END IF;

    v_waiter := v_waiters[1 + floor(random() * array_length(v_waiters, 1))::int];
    v_name   := v_first[1 + floor(random() * array_length(v_first, 1))::int] || ' ' ||
                v_last[1 + floor(random() * array_length(v_last, 1))::int];

    v_res := place_order(
      v_tenant,
      v_source,
      v_name,
      '+2332' || lpad((floor(random() * 100000000))::bigint::text, 8, '0'),
      CASE WHEN v_cash THEN 'cash' ELSE 'momo' END,
      CASE WHEN v_cash THEN NULL ELSE 'demo_ord_' || encode(gen_random_bytes(6), 'hex') END,
      v_table,
      v_station,
      CASE WHEN v_cash THEN v_waiter ELSE NULL END,
      v_shift,
      v_items
    );

    IF NOT v_cash THEN
      -- Paystack GH MoMo is 1.95%; the fee posts against momo_clearing.
      PERFORM mark_order_paid(
        (v_res->>'order_id')::uuid,
        round((v_res->>'amount_pesewas')::bigint * 0.0195)::bigint);
    END IF;

    v_orders := v_orders + 1;
  END LOOP;

  RAISE NOTICE 'demo night: % counter and table orders placed', v_orders;
END $$;

-- ── Spread the night over its real hours ────────────────────────────────────
-- Orders were written in a tight loop, so without this every ticket carries
-- the same timestamp and the rail age, the hourly curve and the "oldest
-- unserved" alarm are all meaningless. Weighted toward midnight, which is when
-- a Cape Coast Friday actually peaks.
UPDATE orders o
   SET created_at = t.at,
       paid_at    = CASE WHEN o.paid_at IS NULL THEN NULL
                         ELSE t.at + interval '20 seconds' END
  FROM (
    SELECT id,
           now() - interval '4 hours 10 minutes'
             + (interval '3 hours 50 minutes'
                -- squaring the uniform draw pulls the mass toward the end of
                -- the night; the room fills slowly and empties fast
                * (1 - power(random(), 1.7)))
             AS at
      FROM orders
     WHERE shift_id = 'd0000000-0000-4000-8000-00000000000f'
  ) t
 WHERE o.id = t.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- The door: 186 of 200 through the gate
-- ─────────────────────────────────────────────────────────────────────────────
-- A 7% no-show is normal on a presold Friday. The gap between issued and
-- admitted is the number the owner reads to decide next week's allocation.
DO $$
DECLARE
  v_tenant uuid;
  v_door   uuid;
  v_t      record;
  v_n      int := 0;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE slug = 'memories-nc';

  INSERT INTO devices (id, tenant_id, name, role, key_hash)
  VALUES ('e0000000-0000-4000-8000-000000000001', v_tenant, 'Door scanner 1', 'door',
          encode(digest('demo-door-key-1', 'sha256'), 'hex'))
  ON CONFLICT (id) DO NOTHING;
  v_door := 'e0000000-0000-4000-8000-000000000001';

  FOR v_t IN
    SELECT id FROM tickets
     WHERE tenant_id = v_tenant AND status = 'issued'
     ORDER BY random()
     LIMIT 186
  LOOP
    v_n := v_n + 1;
    UPDATE tickets SET status = 'used', used_at =
      now() - interval '4 hours 30 minutes' + (v_n * interval '48 seconds')
     WHERE id = v_t.id;

    INSERT INTO ticket_redemptions (ticket_id, device_id, device_name, door_label, mode, scanned_at)
    VALUES (v_t.id, v_door, 'Door scanner 1',
            CASE WHEN v_n % 2 = 0 THEN 'Door 1' ELSE 'Door 2' END,
            'online',
            now() - interval '4 hours 30 minutes' + (v_n * interval '48 seconds'));
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Service state at 01:40 — mid-night, not a tidy end state
-- ─────────────────────────────────────────────────────────────────────────────
-- Most of the night is served. A handful of tickets are still live on the bar
-- and kitchen rails, which is what the displays should look like when someone
-- walks up to them. Written straight to order_items so the completion triggers
-- from 017 run and close the orders they finish.
UPDATE order_items SET status = 'delivered', ready_at = now() - interval '40 minutes',
                       delivered_at = now() - interval '38 minutes'
 WHERE order_id IN (
   SELECT id FROM orders
    WHERE shift_id = 'd0000000-0000-4000-8000-00000000000f'
      AND status IN ('paid', 'preparing')
    ORDER BY created_at
    OFFSET 0
 )
   AND order_id NOT IN (
     SELECT id FROM orders
      WHERE shift_id = 'd0000000-0000-4000-8000-00000000000f'
        AND status IN ('paid', 'preparing')
      ORDER BY created_at DESC
      LIMIT 14
   );

-- Of the 14 still live: some are being poured, some have not been picked up.
UPDATE order_items SET status = 'preparing'
 WHERE order_id IN (
   SELECT id FROM orders
    WHERE shift_id = 'd0000000-0000-4000-8000-00000000000f'
      AND status = 'paid'
    ORDER BY created_at DESC
    LIMIT 6
 );

-- ─────────────────────────────────────────────────────────────────────────────
-- Cash count: three servers straight, one drifting
-- ─────────────────────────────────────────────────────────────────────────────
-- The whole point of the reconciliation screen is that it makes one row look
-- different from the others. Two servers are counted exact, one is a few cedis
-- light (rounding and float), and one is materially short — the row a duty
-- manager is supposed to stop and ask about. One server is deliberately left
-- uncounted, so close_shift refuses and the manager has to finish the job.
DO $$
DECLARE
  v_shift uuid := 'd0000000-0000-4000-8000-00000000000f';
  v_mgr   uuid := 'a0000000-0000-4000-8000-000000000007';
  v_w     record;
  v_i     int := 0;
  v_expected bigint;
BEGIN
  FOR v_w IN
    SELECT attributed_waiter_id AS id, SUM(amount_pesewas) AS expected
      FROM cash_collections
     WHERE shift_id = v_shift
     GROUP BY attributed_waiter_id
     ORDER BY attributed_waiter_id
  LOOP
    v_i := v_i + 1;
    v_expected := v_w.expected;

    -- Leave the last server uncounted on purpose.
    CONTINUE WHEN v_i = 4;

    PERFORM record_handover(
      v_shift, v_w.id,
      CASE v_i
        WHEN 1 THEN v_expected                      -- exact
        WHEN 2 THEN v_expected - 1500               -- GHS 15 light: float drift
        ELSE        v_expected - 42000              -- GHS 420 short: investigate
      END,
      v_mgr,
      CASE v_i
        WHEN 1 THEN 'Counted with server present. Straight.'
        WHEN 2 THEN 'GHS 15 under. Says a guest short-paid a round; accepted.'
        ELSE 'GHS 420 under. Two table settlements unaccounted. Escalated.'
      END
    );
  END LOOP;
END $$;

-- Stock variance on the two lines that move fastest, so the shortage report
-- has real numbers rather than an empty state.
INSERT INTO stock_closings (shift_id, product_id, qty, set_by)
SELECT
  'd0000000-0000-4000-8000-00000000000f',
  o.product_id,
  GREATEST(0, o.qty - COALESCE(sold.qty, 0) - CASE p.name
    WHEN 'Star Lager' THEN 9    -- 9 bottles gone with no ticket against them
    WHEN 'Heineken'   THEN 4
    ELSE 0 END),
  'a0000000-0000-4000-8000-000000000005'
FROM stock_openings o
JOIN products p ON p.id = o.product_id
LEFT JOIN (
  SELECT oi.product_id, SUM(oi.quantity)::int AS qty
    FROM order_items oi
    JOIN orders ord ON ord.id = oi.order_id
   WHERE ord.shift_id = 'd0000000-0000-4000-8000-00000000000f'
     AND ord.status <> 'voided' AND oi.status <> 'voided'
   GROUP BY oi.product_id
) sold ON sold.product_id = o.product_id
WHERE o.shift_id = 'd0000000-0000-4000-8000-00000000000f';

INSERT INTO stock_shortages (tenant_id, shift_id, product_id, qty, amount_pesewas, status, note)
SELECT
  p.tenant_id, 'd0000000-0000-4000-8000-00000000000f', p.id,
  CASE p.name WHEN 'Star Lager' THEN 9 ELSE 4 END,
  p.price_pesewas * CASE p.name WHEN 'Star Lager' THEN 9 ELSE 4 END,
  'open',
  'Poured against no ticket. Reconcile with Bar Main before next service.'
FROM products p
JOIN tenants t ON t.id = p.tenant_id AND t.slug = 'memories-nc'
WHERE p.name IN ('Star Lager', 'Heineken')
ON CONFLICT (shift_id, product_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Assertions — the seed fails loudly rather than seeding a wrong night
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_tenant  uuid;
  v_shift   uuid := 'd0000000-0000-4000-8000-00000000000f';
  v_gate    bigint;
  v_fb      bigint;
  v_gross   bigint;
  v_tickets int;
  v_admit   int;
  v_dr      bigint;
  v_cr      bigint;
  v_unbal   int;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE slug = 'memories-nc';

  SELECT COALESCE(SUM(amount_pesewas), 0) INTO v_gate
    FROM ledger_entries
   WHERE tenant_id = v_tenant AND account = 'ticket_revenue' AND direction = 'CR';

  SELECT COALESCE(SUM(amount_pesewas), 0) INTO v_fb
    FROM ledger_entries
   WHERE tenant_id = v_tenant AND account = 'fb_revenue' AND direction = 'CR';

  v_gross := v_gate + v_fb;

  SELECT COUNT(*) INTO v_tickets FROM tickets WHERE tenant_id = v_tenant;
  SELECT COUNT(*) INTO v_admit FROM ticket_redemptions r
    JOIN tickets t ON t.id = r.ticket_id WHERE t.tenant_id = v_tenant;

  IF v_gate <> 2080000 THEN
    RAISE EXCEPTION 'gate is GHS %, expected GHS 20,800', round(v_gate/100.0, 2);
  END IF;
  IF v_fb <> 10920000 THEN
    RAISE EXCEPTION 'bar is GHS %, expected GHS 109,200', round(v_fb/100.0, 2);
  END IF;
  IF v_gross <> 13000000 THEN
    RAISE EXCEPTION 'night is GHS %, expected GHS 130,000', round(v_gross/100.0, 2);
  END IF;
  IF v_tickets <> 200 THEN
    RAISE EXCEPTION 'issued % tickets, expected 200', v_tickets;
  END IF;
  IF v_admit <> 186 THEN
    RAISE EXCEPTION 'admitted %, expected 186', v_admit;
  END IF;

  -- Double entry: the whole book, and every posting group within it.
  SELECT
    COALESCE(SUM(amount_pesewas) FILTER (WHERE direction='DR'), 0),
    COALESCE(SUM(amount_pesewas) FILTER (WHERE direction='CR'), 0)
    INTO v_dr, v_cr
    FROM ledger_entries WHERE tenant_id = v_tenant;
  IF v_dr <> v_cr THEN
    RAISE EXCEPTION 'ledger does not balance: debits % credits %', v_dr, v_cr;
  END IF;

  SELECT COUNT(*) INTO v_unbal FROM (
    SELECT ref_type, ref_id
      FROM ledger_entries WHERE tenant_id = v_tenant
     GROUP BY ref_type, ref_id
    HAVING COALESCE(SUM(amount_pesewas) FILTER (WHERE direction='DR'), 0)
        <> COALESCE(SUM(amount_pesewas) FILTER (WHERE direction='CR'), 0)
  ) x;
  IF v_unbal > 0 THEN
    RAISE EXCEPTION '% posting groups do not balance', v_unbal;
  END IF;

  -- No cash without a named owner. This is the control that stops a night
  -- from quietly losing money nobody is accountable for.
  IF EXISTS (
    SELECT 1 FROM orders
     WHERE shift_id = v_shift AND payment_source = 'cash'
       AND (waiter_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM cash_collections cc WHERE cc.order_id = orders.id))
  ) THEN
    RAISE EXCEPTION 'cash orders exist with no attributed collection';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '  Memories Night Club — demo night seeded';
  RAISE NOTICE '  ─────────────────────────────────────────';
  RAISE NOTICE '  Gate            GHS % (200 tickets, 186 admitted)',
    to_char(v_gate/100.0, 'FM999,999.00');
  RAISE NOTICE '  Bar and kitchen GHS %', to_char(v_fb/100.0, 'FM999,999.00');
  RAISE NOTICE '  Night gross     GHS %', to_char(v_gross/100.0, 'FM999,999.00');
  RAISE NOTICE '  Ledger balances: % DR = % CR', v_dr, v_cr;
  RAISE NOTICE '';
END $$;
