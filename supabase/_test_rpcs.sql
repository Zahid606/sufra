-- Local functional tests for the guest-facing RPCs. Run after the migrations
-- against the throwaway test database. Not part of the deployment.
\set ON_ERROR_STOP on
\pset pager off

do $$
declare
  v_r      uuid;
  v_table  uuid;
  v_tok    text;
  v_kebab  uuid;
  v_platter uuid;
  v_kabsa  uuid;
  v_grp_side uuid;
  v_opt_rice uuid;
  v_opt_fries uuid;
  v_opt_garlic uuid;
  v_spice_mild uuid;
  v_res    jsonb;
  v_order  uuid;
  v_sess   text := 'test-session-aaaaaaaaaaaaaaaa';
  v_game   uuid;
  v_hits   int := 0;
  v_jack   int := 0;
  i        int;
  v_fail   int := 0;
  v_super  uuid := '00000000-0000-4000-8000-000000000001';
  v_waiter uuid := '00000000-0000-4000-8000-000000000002';
  v_cook   uuid := '00000000-0000-4000-8000-000000000003';
begin
  select id into v_r from public.restaurants where slug = 'najd-grill';
  select id, qr_token into v_table, v_tok
    from public.restaurant_tables where restaurant_id = v_r and code = '5';
  select id into v_kebab   from public.menu_items where restaurant_id=v_r and name='Lamb Kebab';
  select id into v_platter from public.menu_items where restaurant_id=v_r and name='Mixed Grill Platter';
  select id into v_kabsa   from public.menu_items where restaurant_id=v_r and name='Chicken Kabsa';
  select g.id into v_grp_side from public.modifier_groups g
    where g.menu_item_id=v_platter and g.name='Choose your side';
  select id into v_opt_rice   from public.modifier_options where group_id=v_grp_side and name='Saffron rice';
  select id into v_opt_fries  from public.modifier_options where group_id=v_grp_side and name='French fries';
  select o.id into v_opt_garlic from public.modifier_options o
    join public.modifier_groups g on g.id=o.group_id
    where g.menu_item_id=v_platter and o.name='Garlic sauce';
  select o.id into v_spice_mild from public.modifier_options o
    join public.modifier_groups g on g.id=o.group_id
    where g.menu_item_id=v_kabsa and o.name='Mild';

  -- ===== 1. resolve_table =================================================
  v_res := public.resolve_table('najd-grill','5',v_tok);
  if not (v_res->>'ok')::boolean then
    raise warning 'FAIL 1a: valid scan rejected: %', v_res; v_fail := v_fail+1;
  else raise notice 'PASS 1a: valid QR scan resolves table %', v_res->'table'->>'label';
  end if;

  v_res := public.resolve_table('najd-grill','5','deadbeefdeadbeef');
  if v_res->>'error' = 'invalid_token' then
    raise notice 'PASS 1b: wrong token rejected';
  else raise warning 'FAIL 1b: wrong token accepted: %', v_res; v_fail := v_fail+1;
  end if;

  v_res := public.resolve_table('najd-grill','5',null);
  if v_res->>'error' = 'invalid_token' then
    raise notice 'PASS 1c: missing token rejected';
  else raise warning 'FAIL 1c: %', v_res; v_fail := v_fail+1;
  end if;

  v_res := public.resolve_table('no-such-place','5',v_tok);
  if v_res->>'error' = 'restaurant_not_found' then
    raise notice 'PASS 1d: unknown restaurant rejected';
  else raise warning 'FAIL 1d: %', v_res; v_fail := v_fail+1;
  end if;

  v_res := public.resolve_table('najd-grill','999',v_tok);
  if v_res->>'error' = 'table_not_found' then
    raise notice 'PASS 1e: unknown table rejected';
  else raise warning 'FAIL 1e: %', v_res; v_fail := v_fail+1;
  end if;

  -- ===== 2. place_order: pricing comes from the database ==================
  -- Lamb Kebab is 62.00; send a forged unit price of 1.00 and a forged total.
  v_res := public.place_order(
    v_table, v_sess,
    jsonb_build_array(jsonb_build_object(
      'menu_item_id', v_kebab, 'quantity', 2,
      'unit_price', 1, 'price', 1, 'line_total', 2)),
    'idem-key-tamper-0000001');

  if not (v_res->>'ok')::boolean then
    raise warning 'FAIL 2a: order rejected: %', v_res; v_fail := v_fail+1;
  elsif (v_res->>'subtotal')::numeric = 124.00 then
    raise notice 'PASS 2a: forged price ignored, subtotal = % (2 x 62)', v_res->>'subtotal';
  else
    raise warning 'FAIL 2a: subtotal was % expected 124', v_res->>'subtotal'; v_fail := v_fail+1;
  end if;

  -- VAT is extracted from the gross because prices_include_vat is true
  if (v_res->>'vat_total')::numeric = round(124 * 0.15 / 1.15, 2) then
    raise notice 'PASS 2b: VAT extracted inclusive = %', v_res->>'vat_total';
  else
    raise warning 'FAIL 2b: vat was %', v_res->>'vat_total'; v_fail := v_fail+1;
  end if;

  if (v_res->>'status') = 'pending' then
    raise notice 'PASS 2c: order awaits waiter confirmation';
  else raise warning 'FAIL 2c: status %', v_res->>'status'; v_fail := v_fail+1;
  end if;

  v_order := (v_res->>'order_id')::uuid;

  -- ===== 3. idempotency ===================================================
  v_res := public.place_order(
    v_table, v_sess,
    jsonb_build_array(jsonb_build_object('menu_item_id', v_kebab, 'quantity', 2)),
    'idem-key-tamper-0000001');

  if (v_res->>'ok')::boolean and (v_res->>'duplicate')::boolean
     and (v_res->>'order_id')::uuid = v_order then
    raise notice 'PASS 3a: replayed idempotency key returned the original order';
  else raise warning 'FAIL 3a: %', v_res; v_fail := v_fail+1;
  end if;

  if (select count(*) from public.orders where session_id = v_sess) = 1 then
    raise notice 'PASS 3b: no duplicate row created';
  else raise warning 'FAIL 3b: % orders', (select count(*) from public.orders where session_id=v_sess); v_fail := v_fail+1;
  end if;

  -- a fresh key with the same cart inside the 45s window is a resubmission
  v_res := public.place_order(
    v_table, v_sess,
    jsonb_build_array(jsonb_build_object('menu_item_id', v_kebab, 'quantity', 2)),
    'idem-key-different-000002');
  if v_res->>'error' = 'duplicate_order' then
    raise notice 'PASS 3c: identical cart resubmitted in the dedupe window blocked';
  else raise warning 'FAIL 3c: %', v_res; v_fail := v_fail+1;
  end if;

  -- ===== 4. modifier validation ===========================================
  -- required group omitted
  v_res := public.place_order(
    v_table, 'test-session-bbbbbbbbbbbbbbbb',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_platter, 'quantity', 1)),
    'idem-key-missing-grp-0001');
  if v_res->>'error' = 'modifier_group_required' then
    raise notice 'PASS 4a: required modifier group enforced (%)', v_res->>'group';
  else raise warning 'FAIL 4a: %', v_res; v_fail := v_fail+1;
  end if;

  -- two options in a max-1 group
  v_res := public.place_order(
    v_table, 'test-session-bbbbbbbbbbbbbbbb',
    jsonb_build_array(jsonb_build_object(
      'menu_item_id', v_platter, 'quantity', 1,
      'option_ids', jsonb_build_array(v_opt_rice, v_opt_fries))),
    'idem-key-max-grp-00000001');
  if v_res->>'error' = 'modifier_group_max' then
    raise notice 'PASS 4b: max-select enforced on single-choice group';
  else raise warning 'FAIL 4b: %', v_res; v_fail := v_fail+1;
  end if;

  -- an option that belongs to a different item must be refused
  v_res := public.place_order(
    v_table, 'test-session-bbbbbbbbbbbbbbbb',
    jsonb_build_array(jsonb_build_object(
      'menu_item_id', v_platter, 'quantity', 1,
      'option_ids', jsonb_build_array(v_opt_rice, v_spice_mild))),
    'idem-key-foreign-opt-0001');
  if v_res->>'error' = 'invalid_modifier' then
    raise notice 'PASS 4c: modifier from another item refused';
  else raise warning 'FAIL 4c: %', v_res; v_fail := v_fail+1;
  end if;

  -- valid: platter + fries (+5) + garlic (+4) = 169 + 9 = 178
  v_res := public.place_order(
    v_table, 'test-session-bbbbbbbbbbbbbbbb',
    jsonb_build_array(jsonb_build_object(
      'menu_item_id', v_platter, 'quantity', 1,
      'option_ids', jsonb_build_array(v_opt_fries, v_opt_garlic))),
    'idem-key-valid-mods-00001');
  if (v_res->>'ok')::boolean and (v_res->>'subtotal')::numeric = 178.00 then
    raise notice 'PASS 4d: modifier deltas priced server-side, subtotal = 178';
  else raise warning 'FAIL 4d: %', v_res; v_fail := v_fail+1;
  end if;

  -- ===== 5. unavailable item ==============================================
  update public.menu_items set is_available = false where id = v_kebab;
  v_res := public.place_order(
    v_table, 'test-session-cccccccccccccccc',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_kebab, 'quantity', 1)),
    'idem-key-unavailable-001');
  if v_res->>'error' = 'item_unavailable' then
    raise notice 'PASS 5a: sold-out item cannot be ordered';
  else raise warning 'FAIL 5a: %', v_res; v_fail := v_fail+1;
  end if;
  update public.menu_items set is_available = true where id = v_kebab;

  -- ===== 6. cross-tenant item injection ===================================
  -- an item id from another restaurant must not be orderable at this table
  insert into public.restaurants (slug, name, name_ar, subscription_status)
  values ('other-tenant','Other','آخر','active');
  insert into public.menu_items (restaurant_id, name, name_ar, price)
  select id, 'Foreign Dish', 'طبق غريب', 5 from public.restaurants where slug='other-tenant';

  v_res := public.place_order(
    v_table, 'test-session-dddddddddddddddd',
    jsonb_build_array(jsonb_build_object(
      'menu_item_id', (select id from public.menu_items where name='Foreign Dish'),
      'quantity', 1)),
    'idem-key-crosstenant-01');
  if v_res->>'error' = 'item_not_found' then
    raise notice 'PASS 6a: item from another tenant refused';
  else raise warning 'FAIL 6a: %', v_res; v_fail := v_fail+1;
  end if;

  -- ===== 7. coupons =======================================================
  v_res := public.validate_coupon(v_r, 'WELCOME10', 200, 'test-session-eeeeeeeeeeeeeeee');
  if (v_res->>'ok')::boolean and (v_res->>'discount')::numeric = 20.00 then
    raise notice 'PASS 7a: WELCOME10 gives 20.00 off 200.00';
  else raise warning 'FAIL 7a: %', v_res; v_fail := v_fail+1;
  end if;

  v_res := public.validate_coupon(v_r, 'WELCOME10', 10, 'test-session-eeeeeeeeeeeeeeee');
  if v_res->>'error' = 'coupon_min_order' then
    raise notice 'PASS 7b: minimum order enforced';
  else raise warning 'FAIL 7b: %', v_res; v_fail := v_fail+1;
  end if;

  v_res := public.validate_coupon(v_r, 'NOPE', 200, null);
  if v_res->>'error' = 'coupon_not_found' then
    raise notice 'PASS 7c: unknown coupon rejected';
  else raise warning 'FAIL 7c: %', v_res; v_fail := v_fail+1;
  end if;

  -- order with a coupon: 169 - 10% = 152.10
  v_res := public.place_order(
    v_table, 'test-session-eeeeeeeeeeeeeeee',
    jsonb_build_array(jsonb_build_object(
      'menu_item_id', v_platter, 'quantity', 1,
      'option_ids', jsonb_build_array(v_opt_rice))),
    'idem-key-coupon-0000001', null, null, null, 'WELCOME10');
  if (v_res->>'ok')::boolean and (v_res->>'discount_total')::numeric = 16.90
     and (v_res->>'total')::numeric = 152.10 then
    raise notice 'PASS 7d: coupon applied, total = 152.10';
  else raise warning 'FAIL 7d: %', v_res; v_fail := v_fail+1;
  end if;

  -- per-session limit now consumed
  v_res := public.validate_coupon(v_r, 'WELCOME10', 200, 'test-session-eeeeeeeeeeeeeeee');
  if v_res->>'error' = 'coupon_already_used' then
    raise notice 'PASS 7e: per-session coupon limit enforced';
  else raise warning 'FAIL 7e: %', v_res; v_fail := v_fail+1;
  end if;

  -- ===== 8. service requests ==============================================
  v_res := public.request_service(v_table, v_sess, 'bill');
  if (v_res->>'ok')::boolean then
    raise notice 'PASS 8a: bill request raised';
  else raise warning 'FAIL 8a: %', v_res; v_fail := v_fail+1;
  end if;

  v_res := public.request_service(v_table, v_sess, 'bill');
  if v_res->>'error' = 'already_requested' then
    raise notice 'PASS 8b: duplicate bill request throttled';
  else raise warning 'FAIL 8b: %', v_res; v_fail := v_fail+1;
  end if;

  v_res := public.request_service(v_table, v_sess, 'teleport');
  if v_res->>'error' = 'invalid_type' then
    raise notice 'PASS 8c: unknown request type rejected';
  else raise warning 'FAIL 8c: %', v_res; v_fail := v_fail+1;
  end if;

  -- ===== 9. spin wheel: weighting + cooldown ==============================
  select id into v_game from public.games where restaurant_id=v_r and type='spin_wheel';

  for i in 1..400 loop
    delete from public.game_plays where session_id = 'spin-test-' || i;
    v_res := public.spin_wheel(v_game, 'spin-test-session-' || lpad(i::text,4,'0'));
    if (v_res->>'ok')::boolean then
      v_hits := v_hits + 1;
      if (v_res->>'is_jackpot')::boolean then v_jack := v_jack + 1; end if;
    end if;
  end loop;

  if v_hits = 400 then
    raise notice 'PASS 9a: 400 spins all resolved to a prize';
  else raise warning 'FAIL 9a: only % spins resolved', v_hits; v_fail := v_fail+1;
  end if;

  -- jackpot weight is 5 of 100 → expect roughly 20 in 400; allow a wide band
  if v_jack between 4 and 50 then
    raise notice 'PASS 9b: jackpot hit %/400 times, consistent with weight 5%%', v_jack;
  else raise warning 'FAIL 9b: jackpot hit %/400 — weighting looks wrong', v_jack; v_fail := v_fail+1;
  end if;

  v_res := public.spin_wheel(v_game, 'spin-test-session-0001');
  if v_res->>'error' = 'cooldown' then
    raise notice 'PASS 9c: second spin in the same session blocked by cooldown';
  else raise warning 'FAIL 9c: %', v_res; v_fail := v_fail+1;
  end if;

  if (select count(*) from public.coupons where source='spin_wheel' and usage_limit=1) > 0 then
    raise notice 'PASS 9d: winning spins minted single-use coupons';
  else raise warning 'FAIL 9d: no spin coupons created'; v_fail := v_fail+1;
  end if;

  -- ===== 10. trivia: answers stay server-side =============================
  v_res := public.get_trivia_round(v_r, 5);
  if jsonb_array_length(v_res) = 5 and not (v_res->0 ? 'correct_index') then
    raise notice 'PASS 10a: trivia round returns 5 questions without the answer key';
  else raise warning 'FAIL 10a: %', v_res; v_fail := v_fail+1;
  end if;

  v_res := public.check_trivia_answer((v_res->0->>'id')::uuid, 0);
  if (v_res->>'ok')::boolean and (v_res ? 'correct') then
    raise notice 'PASS 10b: answer graded on the server (correct=%)', v_res->>'correct';
  else raise warning 'FAIL 10b: %', v_res; v_fail := v_fail+1;
  end if;

  -- ===== 11. reviews ======================================================
  v_res := public.submit_review(v_r, 'review-session-11111111', 5, 'Excellent', 'Omar', 5, 5);
  if (v_res->>'ok')::boolean then
    raise notice 'PASS 11a: review submitted';
  else raise warning 'FAIL 11a: %', v_res; v_fail := v_fail+1;
  end if;

  v_res := public.submit_review(v_r, 'review-session-11111111', 4, 'Again', 'Omar');
  if v_res->>'error' = 'already_reviewed' then
    raise notice 'PASS 11b: one review per session per day enforced';
  else raise warning 'FAIL 11b: %', v_res; v_fail := v_fail+1;
  end if;

  v_res := public.submit_review(v_r, 'review-session-22222222', 9);
  if v_res->>'error' = 'invalid_rating' then
    raise notice 'PASS 11c: out-of-range rating rejected';
  else raise warning 'FAIL 11c: %', v_res; v_fail := v_fail+1;
  end if;

  -- ===== 12. get_my_orders is scoped to the session =======================
  v_res := public.get_my_orders(v_sess, v_r);
  if jsonb_array_length(v_res) = 1
     and jsonb_array_length(v_res->0->'items') = 1 then
    raise notice 'PASS 12a: guest sees exactly their own order, with line items';
  else raise warning 'FAIL 12a: % orders returned', jsonb_array_length(v_res); v_fail := v_fail+1;
  end if;

  v_res := public.get_my_orders('some-other-session-xxxxxx', v_r);
  if jsonb_array_length(v_res) = 0 then
    raise notice 'PASS 12b: another session sees nothing';
  else raise warning 'FAIL 12b: leaked % orders', jsonb_array_length(v_res); v_fail := v_fail+1;
  end if;

  -- ===== 13. billing guard: a tenant cannot change its own subscription ===
  -- Running with no JWT, so is_super_admin() is false. The guard trigger must
  -- silently revert the change rather than let a tenant un-suspend itself.
  update public.restaurants set subscription_status = 'suspended' where id = v_r;
  if (select subscription_status from public.restaurants where id = v_r) = 'active' then
    raise notice 'PASS 13a: non-super-admin cannot change subscription_status';
  else
    raise warning 'FAIL 13a: tenant changed its own subscription status'; v_fail := v_fail+1;
  end if;

  -- ===== 14. subscription gate, applied by the platform ===================
  insert into auth.users (id, email) values (v_super, 'super@sufra.test')
    on conflict (id) do nothing;
  insert into public.profiles (id, restaurant_id, full_name, role)
  values (v_super, null, 'Platform Owner', 'super_admin')
  on conflict (id) do update set role = 'super_admin', restaurant_id = null;

  perform set_config('request.jwt.claim.sub', v_super::text, true);

  if public.is_super_admin() then
    raise notice 'PASS 14a: super admin identified from the JWT subject';
  else raise warning 'FAIL 14a: super admin not recognised'; v_fail := v_fail+1;
  end if;

  update public.restaurants set subscription_status = 'suspended' where id = v_r;
  if (select subscription_status from public.restaurants where id = v_r) = 'suspended' then
    raise notice 'PASS 14b: super admin can suspend a tenant';
  else raise warning 'FAIL 14b: suspension did not stick'; v_fail := v_fail+1;
  end if;

  perform set_config('request.jwt.claim.sub', '', true);

  v_res := public.resolve_table('najd-grill','5',v_tok);
  if v_res->>'error' = 'subscription_expired' then
    raise notice 'PASS 14c: suspended tenant stops serving guests';
  else raise warning 'FAIL 14c: %', v_res; v_fail := v_fail+1;
  end if;

  v_res := public.place_order(v_table,'test-session-ffffffffffffffff',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_kabsa, 'quantity', 1,
      'option_ids', jsonb_build_array(v_spice_mild))),
    'idem-key-suspended-0001');
  if v_res->>'error' = 'restaurant_unavailable' then
    raise notice 'PASS 14d: suspended tenant cannot take orders';
  else raise warning 'FAIL 14d: %', v_res; v_fail := v_fail+1;
  end if;

  perform set_config('request.jwt.claim.sub', v_super::text, true);
  update public.restaurants set subscription_status = 'active' where id = v_r;
  perform set_config('request.jwt.claim.sub', '', true);

  -- ===== 15. order lifecycle under role gates =============================
  insert into auth.users (id, email) values (v_waiter, 'waiter@sufra.test')
    on conflict (id) do nothing;
  insert into auth.users (id, email) values (v_cook, 'kitchen@sufra.test')
    on conflict (id) do nothing;
  insert into public.profiles (id, restaurant_id, full_name, role)
  values (v_waiter, v_r, 'Faisal', 'waiter')
  on conflict (id) do update set role='waiter', restaurant_id=v_r;
  insert into public.profiles (id, restaurant_id, full_name, role)
  values (v_cook, v_r, 'Kitchen', 'kitchen')
  on conflict (id) do update set role='kitchen', restaurant_id=v_r;

  -- the kitchen must not be able to confirm an order
  perform set_config('request.jwt.claim.sub', v_cook::text, true);
  begin
    update public.orders set status='confirmed' where id = v_order;
    raise warning 'FAIL 15a: kitchen confirmed an order'; v_fail := v_fail+1;
  exception when others then
    raise notice 'PASS 15a: kitchen blocked from confirming (%)', left(sqlerrm, 48);
  end;

  -- the waiter confirms
  perform set_config('request.jwt.claim.sub', v_waiter::text, true);
  update public.orders set status='confirmed' where id = v_order;
  if (select status from public.orders where id=v_order) = 'confirmed'
     and (select confirmed_by from public.orders where id=v_order) = v_waiter
     and (select confirmed_at from public.orders where id=v_order) is not null then
    raise notice 'PASS 15b: waiter confirmed, timeline and actor stamped';
  else raise warning 'FAIL 15b: confirm did not stamp correctly'; v_fail := v_fail+1;
  end if;

  -- skipping straight to paid is not a legal move for a waiter
  begin
    update public.orders set status='paid' where id = v_order;
    raise warning 'FAIL 15c: illegal jump confirmed → paid allowed'; v_fail := v_fail+1;
  exception when others then
    raise notice 'PASS 15c: illegal status jump refused (%)', left(sqlerrm, 42);
  end;

  -- kitchen advances preparation
  perform set_config('request.jwt.claim.sub', v_cook::text, true);
  update public.orders set status='preparing' where id = v_order;
  update public.orders set status='ready' where id = v_order;
  if (select status from public.orders where id=v_order) = 'ready'
     and (select ready_at from public.orders where id=v_order) is not null then
    raise notice 'PASS 15d: kitchen advanced preparing → ready';
  else raise warning 'FAIL 15d'; v_fail := v_fail+1;
  end if;

  -- waiter serves, then settles; loyalty accrues on payment
  perform set_config('request.jwt.claim.sub', v_waiter::text, true);
  update public.orders set customer_phone='0501112233', customer_name='Nasser'
  where id = v_order;
  update public.orders set status='served' where id = v_order;
  update public.orders set status='paid' where id = v_order;

  if (select status from public.orders where id=v_order) = 'paid' then
    raise notice 'PASS 15e: order settled';
  else raise warning 'FAIL 15e'; v_fail := v_fail+1;
  end if;

  -- the bill is 124.00 VAT-inclusive and the rate is 1 point per SAR
  if (select points from public.loyalty_accounts
      where restaurant_id=v_r and phone='0501112233') = 124 then
    raise notice 'PASS 15f: loyalty accrued 124 points on a 124.00 SAR bill';
  else
    raise warning 'FAIL 15f: points were %',
      (select points from public.loyalty_accounts where restaurant_id=v_r and phone='0501112233');
    v_fail := v_fail+1;
  end if;

  -- ===== 16. tenant isolation of the reporting RPC ========================
  perform set_config('request.jwt.claim.sub', v_waiter::text, true);
  v_res := public.sales_report(v_r);
  if (v_res->'totals'->>'orders')::int > 0 then
    raise notice 'PASS 16a: staff can report on their own restaurant (% orders)',
      v_res->'totals'->>'orders';
  else raise warning 'FAIL 16a: %', v_res; v_fail := v_fail+1;
  end if;

  begin
    v_res := public.sales_report((select id from public.restaurants where slug='other-tenant'));
    raise warning 'FAIL 16b: staff read another tenant''s sales'; v_fail := v_fail+1;
  exception when others then
    raise notice 'PASS 16b: cross-tenant report refused (%)', left(sqlerrm, 40);
  end;

  begin
    v_res := public.platform_stats();
    raise warning 'FAIL 16c: restaurant staff read platform stats'; v_fail := v_fail+1;
  exception when others then
    raise notice 'PASS 16c: platform_stats is super-admin only';
  end;

  perform set_config('request.jwt.claim.sub', v_super::text, true);
  v_res := public.platform_stats();
  if (v_res->>'restaurants')::int >= 2 then
    raise notice 'PASS 16d: super admin sees % restaurants platform-wide', v_res->>'restaurants';
  else raise warning 'FAIL 16d: %', v_res; v_fail := v_fail+1;
  end if;
  perform set_config('request.jwt.claim.sub', '', true);

  -- ===== summary ==========================================================
  if v_fail = 0 then
    raise notice '============================================';
    raise notice 'ALL RPC TESTS PASSED';
    raise notice '============================================';
  else
    raise exception '% RPC TEST(S) FAILED', v_fail;
  end if;
end $$;
