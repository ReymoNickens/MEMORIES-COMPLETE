-- Money-path integration tests. Every one of these asserts a behaviour
-- that was wrong before the 30 Aug 2026 audit, so a regression fails the
-- build rather than a Friday. Run against a database with migrations
-- applied and NO demo night seeded:
--     psql "$DATABASE_URL" -f supabase/tests/money_paths.sql

-- ══ 1. Sold-out race: money in, money back, book balanced ══════════════════
DO $$
DECLARE
  v_t uuid; v_co uuid; v_ref text := 'test_soldout_' || encode(gen_random_bytes(5),'hex'); v_ok bool; v_err text;
BEGIN
  SELECT id INTO v_t FROM tenants WHERE slug='memories-nc';
  -- Drain the type so issuance must fail.
  UPDATE ticket_types SET remaining = 0 WHERE id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  INSERT INTO pending_checkouts (tenant_id, ticket_type_id, event_id, quantity,
    buyer_name, buyer_phone, buyer_email, amount_pesewas, paystack_ref, status)
  VALUES (v_t,'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    2,'Race Loser','+2332449' || lpad((floor(random()*100000))::int::text,5,'0'),'race@example.gh',16000,v_ref,'paid')
  RETURNING id INTO v_co;

  BEGIN
    PERFORM complete_paid_checkout(v_co, jsonb_build_array(
      jsonb_build_object('totp_enc','x','access_hash',encode(gen_random_bytes(16),'hex'),'amount_pesewas',8000,'paystack_ref',v_ref||'-1'),
      jsonb_build_object('totp_enc','y','access_hash',encode(gen_random_bytes(16),'hex'),'amount_pesewas',8000,'paystack_ref',v_ref||'-2')));
    RAISE EXCEPTION 'FAIL: oversold';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err <> 'sold_out' THEN RAISE EXCEPTION 'FAIL: expected sold_out, got %', v_err; END IF;
  END;

  v_ok := begin_checkout_refund(v_co, 'rf_' || encode(gen_random_bytes(5),'hex'), 16000);
  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL: could not claim refund'; END IF;
  -- A redelivered webhook must not claim it again.
  IF begin_checkout_refund(v_co, 'rf_' || encode(gen_random_bytes(5),'hex'), 16000) THEN
    RAISE EXCEPTION 'FAIL: refund claimed twice';
  END IF;

  PERFORM settle_checkout_refund(v_co, true, 312, NULL);
  IF (SELECT status FROM pending_checkouts WHERE id=v_co) <> 'refunded' THEN
    RAISE EXCEPTION 'FAIL: checkout not marked refunded';
  END IF;
  -- Settling twice is a no-op.
  PERFORM settle_checkout_refund(v_co, true, 0, NULL);
  RAISE NOTICE 'PASS  sold-out race refunds once, idempotently';
END $$;

-- ══ 2. Installments: half now, reserved ticket, balance, then valid ════════
DO $$
DECLARE
  v_t uuid; v_co uuid; v_ref text := 'test_inst_' || encode(gen_random_bytes(5),'hex'); v_r jsonb; v_tid uuid; v_st text;
BEGIN
  SELECT id INTO v_t FROM tenants WHERE slug='memories-nc';
  UPDATE ticket_types SET remaining = 50 WHERE id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  UPDATE events SET starts_at = now() + interval '10 days' WHERE id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  INSERT INTO pending_checkouts (tenant_id, ticket_type_id, event_id, quantity,
    buyer_name, buyer_phone, buyer_email, amount_pesewas, paystack_ref, status, use_installments)
  VALUES (v_t,'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    1,'Layaway Buyer','+2332449' || lpad((floor(random()*100000))::int::text,5,'0'),'lay@example.gh',8000,v_ref,'paid',true)
  RETURNING id INTO v_co;

  v_r := complete_installment_checkout(v_co, jsonb_build_array(
    jsonb_build_object('totp_enc','z','access_hash',encode(gen_random_bytes(16),'hex'),'fee_pesewas',78,'method','momo',
                       'paystack_ref',v_ref||'-1')), 4000);
  v_tid := ((v_r->'ticket_ids')->>0)::uuid;

  SELECT status INTO v_st FROM tickets WHERE id=v_tid;
  IF v_st <> 'reserved' THEN RAISE EXCEPTION 'FAIL: expected reserved, got %', v_st; END IF;

  -- A reserved ticket must not open the door.
  IF (redeem_ticket(v_tid,NULL,'d','Door 1','online')->>'ok')::bool THEN
    RAISE EXCEPTION 'FAIL: a half-paid ticket opened the door';
  END IF;

  IF (SELECT status FROM pending_checkouts WHERE id=v_co) <> 'part_paid' THEN
    RAISE EXCEPTION 'FAIL: checkout not part_paid';
  END IF;
  IF (SELECT COALESCE(SUM(amount_pesewas),0) FROM ledger_entries
       WHERE ref_id=v_co AND account='ticket_revenue') <> 0 THEN
    RAISE EXCEPTION 'FAIL: revenue recognised before the ticket was valid';
  END IF;

  PERFORM complete_installment_balance(v_co, 4000, 78, v_ref||'-bal');

  SELECT status INTO v_st FROM tickets WHERE id=v_tid;
  IF v_st <> 'issued' THEN RAISE EXCEPTION 'FAIL: balance paid but ticket is %', v_st; END IF;
  IF (SELECT COALESCE(SUM(amount_pesewas),0) FROM ledger_entries
       WHERE ref_id=v_co AND account='ticket_revenue' AND direction='CR') <> 8000 THEN
    RAISE EXCEPTION 'FAIL: full face value not recognised on completion';
  END IF;
  IF (SELECT status FROM payment_plans WHERE checkout_id=v_co) <> 'completed' THEN
    RAISE EXCEPTION 'FAIL: plan not completed';
  END IF;
  RAISE NOTICE 'PASS  installments: reserved, refused at door, valid on balance';
END $$;

-- ══ 3. Default: seat released, forfeiture booked, refund booked ════════════
DO $$
DECLARE
  v_t uuid; v_co uuid; v_r jsonb; v_plan uuid; v_before int; v_after int; v_res jsonb;
  v_ref text := 'test_lapse_' || encode(gen_random_bytes(5),'hex');
BEGIN
  SELECT id INTO v_t FROM tenants WHERE slug='memories-nc';
  INSERT INTO pending_checkouts (tenant_id, ticket_type_id, event_id, quantity,
    buyer_name, buyer_phone, buyer_email, amount_pesewas, paystack_ref, status, use_installments)
  VALUES (v_t,'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    1,'Lapser','+2332449' || lpad((floor(random()*100000))::int::text,5,'0'),'lapse@example.gh',8000,v_ref,'paid',true)
  RETURNING id INTO v_co;

  v_r := complete_installment_checkout(v_co, jsonb_build_array(
    jsonb_build_object('totp_enc','q','access_hash',encode(gen_random_bytes(16),'hex'),'paystack_ref',v_ref||'-1')), 4000);

  SELECT id INTO v_plan FROM payment_plans WHERE checkout_id=v_co;
  SELECT remaining INTO v_before FROM ticket_types WHERE id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  v_res := default_installment_plan(v_plan, 1000);
  SELECT remaining INTO v_after FROM ticket_types WHERE id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  IF v_after <> v_before + 1 THEN RAISE EXCEPTION 'FAIL: seat not returned to stock'; END IF;
  IF (v_res->>'forfeit_pesewas')::bigint <> 800 THEN
    RAISE EXCEPTION 'FAIL: forfeiture is %, expected 800 (10%% of 8000)', v_res->>'forfeit_pesewas';
  END IF;
  IF (v_res->>'refund_pesewas')::bigint <> 3200 THEN
    RAISE EXCEPTION 'FAIL: refund is %, expected 3200', v_res->>'refund_pesewas';
  END IF;
  IF (SELECT status FROM tickets WHERE id=((v_r->'ticket_ids')->>0)::uuid) <> 'voided' THEN
    RAISE EXCEPTION 'FAIL: ticket not voided on default';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM revocations WHERE ticket_id=((v_r->'ticket_ids')->>0)::uuid) THEN
    RAISE EXCEPTION 'FAIL: no revocation written';
  END IF;
  -- Running it again changes nothing.
  IF NOT ((default_installment_plan(v_plan,1000)->>'already')::bool) THEN
    RAISE EXCEPTION 'FAIL: default is not idempotent';
  END IF;
  RAISE NOTICE 'PASS  default: seat released, 10%% kept, rest refunded, idempotent';
END $$;

-- ══ 4. Table deposit: held as a liability, forfeited on a no-show ══════════
DO $$
DECLARE
  v_t uuid; v_tbl uuid; v_res uuid; v_liab bigint; v_inc bigint;
  v_ref text := 'test_dep_' || encode(gen_random_bytes(5),'hex');
BEGIN
  SELECT id INTO v_t FROM tenants WHERE slug='memories-nc';
  SELECT id INTO v_tbl FROM venue_tables WHERE tenant_id=v_t LIMIT 1;

  INSERT INTO table_reservations (tenant_id, venue_table_id, guest_name, guest_phone,
    reserved_for, deposit_pesewas, paystack_ref, status)
  VALUES (v_t, v_tbl, 'Deposit Guest', '+2332449' || lpad((floor(random()*100000))::int::text,5,'0'), now() - interval '3 hours',
          50000, v_ref, 'pending')
  RETURNING id INTO v_res;

  PERFORM confirm_reservation_deposit(v_res, 50000, v_ref);
  IF (SELECT status FROM table_reservations WHERE id=v_res) <> 'confirmed' THEN
    RAISE EXCEPTION 'FAIL: deposit did not confirm the hold';
  END IF;

  SELECT COALESCE(SUM(CASE WHEN direction='CR' THEN amount_pesewas ELSE -amount_pesewas END),0)
    INTO v_liab FROM ledger_entries WHERE ref_id=v_res AND account='deposit_liability';
  IF v_liab <> 50000 THEN RAISE EXCEPTION 'FAIL: deposit not held as a liability (%)', v_liab; END IF;

  -- Underpaying must not confirm a table.
  BEGIN
    PERFORM confirm_reservation_deposit(v_res, 100, 'x');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  PERFORM forfeit_reservation_deposit(v_res);
  SELECT COALESCE(SUM(amount_pesewas),0) INTO v_inc
    FROM ledger_entries WHERE ref_id=v_res AND account='forfeiture_income' AND direction='CR';
  IF v_inc <> 50000 THEN RAISE EXCEPTION 'FAIL: forfeiture not recognised (%)', v_inc; END IF;

  SELECT COALESCE(SUM(CASE WHEN direction='CR' THEN amount_pesewas ELSE -amount_pesewas END),0)
    INTO v_liab FROM ledger_entries WHERE ref_id=v_res AND account='deposit_liability';
  IF v_liab <> 0 THEN RAISE EXCEPTION 'FAIL: liability not discharged (%)', v_liab; END IF;

  IF NOT ((forfeit_reservation_deposit(v_res)->>'already')::bool) THEN
    RAISE EXCEPTION 'FAIL: forfeiture is not idempotent';
  END IF;
  RAISE NOTICE 'PASS  deposit held as liability, forfeited cleanly on no-show';
END $$;

-- ══ 5. Settlement values a comp at the ticket face, not at GHS 1 ═══════════
DO $$
DECLARE
  v_t uuid; v_s jsonb;
BEGIN
  SELECT id INTO v_t FROM tenants WHERE slug='memories-nc';
  DELETE FROM organiser_submissions WHERE event_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  INSERT INTO organiser_submissions (tenant_id, organiser_id, event_id, preferred_date,
    event_name, host_name, description, estimated_attendance, comp_allowance, status)
  VALUES (v_t,'66666666-6666-6666-6666-666666666666','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    current_date,'Test','Host','d',200,50,'approved');

  v_s := compute_settlement('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

  -- 50 comps at the GHS 80 general-admission face = GHS 4,000, not GHS 50.
  IF (v_s->>'comp_allowance')::bigint <> 400000 THEN
    RAISE EXCEPTION 'FAIL: allowance is % pesewas, expected 400000', v_s->>'comp_allowance';
  END IF;
  IF (v_s->>'comp_face_pesewas')::bigint <> 8000 THEN
    RAISE EXCEPTION 'FAIL: comp valued at %, expected the GA face of 8000', v_s->>'comp_face_pesewas';
  END IF;
  -- Organiser and club shares must still account for the whole net take.
  IF (v_s->>'organiser_total')::bigint + (v_s->>'club_total')::bigint
     <> (v_s->>'net_gate')::bigint + (v_s->>'table_gross')::bigint - (v_s->>'comps')::bigint THEN
    RAISE EXCEPTION 'FAIL: settlement shares do not sum to the net take';
  END IF;
  RAISE NOTICE 'PASS  settlement values a comp at ticket face and the split adds up';
END $$;

-- ══ 6. The outbox claims once and backs off ════════════════════════════════
DO $$
DECLARE
  v_t uuid; v_id uuid; v_n int;
  v_dk text := 'dk_' || encode(gen_random_bytes(5),'hex');
BEGIN
  SELECT id INTO v_t FROM tenants WHERE slug='memories-nc';
  INSERT INTO notification_outbox (tenant_id, kind, to_phone, payload, dedupe_key)
  VALUES (v_t,'ticket_delivery','+2332449' || lpad((floor(random()*100000))::int::text,5,'0'),'{"deep_link":"x"}',v_dk)
  RETURNING id INTO v_id;

  -- Enqueuing the same logical message twice must not send it twice.
  BEGIN
    INSERT INTO notification_outbox (tenant_id, kind, to_phone, payload, dedupe_key)
    VALUES (v_t,'ticket_delivery','+2332449' || lpad((floor(random()*100000))::int::text,5,'0'),'{"deep_link":"x"}',v_dk);
    RAISE EXCEPTION 'FAIL: duplicate dedupe_key accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  SELECT count(*) INTO v_n FROM claim_outbox_batch(10);
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL: claimed % rows, expected 1', v_n; END IF;

  -- A second drain overlapping the first must find nothing due.
  SELECT count(*) INTO v_n FROM claim_outbox_batch(10);
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL: second drain re-claimed a row in flight'; END IF;

  PERFORM resolve_outbox(v_id, true, NULL);
  IF (SELECT status FROM notification_outbox WHERE id=v_id) <> 'sent' THEN
    RAISE EXCEPTION 'FAIL: outbox row not marked sent';
  END IF;
  RAISE NOTICE 'PASS  outbox dedupes, claims once, and backs off';
END $$;

-- ══ 7. The whole book still balances after all of it ═══════════════════════
DO $$
DECLARE v_dr bigint; v_cr bigint; v_bad int;
BEGIN
  SELECT COALESCE(SUM(amount_pesewas) FILTER (WHERE direction='DR'),0),
         COALESCE(SUM(amount_pesewas) FILTER (WHERE direction='CR'),0)
    INTO v_dr, v_cr FROM ledger_entries;
  IF v_dr <> v_cr THEN RAISE EXCEPTION 'FAIL: book does not balance % vs %', v_dr, v_cr; END IF;

  SELECT count(*) INTO v_bad FROM (
    SELECT ref_type, ref_id FROM ledger_entries GROUP BY ref_type, ref_id
    HAVING COALESCE(SUM(amount_pesewas) FILTER (WHERE direction='DR'),0)
        <> COALESCE(SUM(amount_pesewas) FILTER (WHERE direction='CR'),0)) x;
  IF v_bad > 0 THEN RAISE EXCEPTION 'FAIL: % posting groups unbalanced', v_bad; END IF;
  RAISE NOTICE 'PASS  every posting group balances (% DR = % CR)', v_dr, v_cr;
END $$;
