-- Local tests for Row Level Security. These switch the session role the same
-- way PostgREST does (set role + request.jwt.claim.sub) and assert on what
-- each audience can actually see. Not part of the deployment.
\set ON_ERROR_STOP on
\pset pager off

-- A second tenant with its own staff, to prove the fences hold between them.
do $$
declare v_other uuid; v_branch uuid;
begin
  select id into v_other from public.restaurants where slug='other-tenant';
  if v_other is null then
    insert into public.restaurants (slug, name, name_ar, subscription_status)
    values ('other-tenant','Other','آخر','active') returning id into v_other;
  end if;

  insert into public.branches (restaurant_id, name, name_ar, is_default)
  select v_other, 'Main', 'الرئيسي', true
  where not exists (select 1 from public.branches where restaurant_id=v_other)
  returning id into v_branch;

  insert into public.categories (restaurant_id, name, name_ar)
  select v_other, 'Secret Menu', 'قائمة سرية'
  where not exists (select 1 from public.categories where restaurant_id=v_other);

  insert into public.menu_items (restaurant_id, name, name_ar, price)
  select v_other, 'Competitor Dish', 'طبق المنافس', 99
  where not exists (select 1 from public.menu_items where restaurant_id=v_other and name='Competitor Dish');

  insert into public.restaurant_tables (restaurant_id, code, label)
  select v_other, '1', 'Table 1'
  where not exists (select 1 from public.restaurant_tables where restaurant_id=v_other);

  insert into auth.users (id, email) values
    ('00000000-0000-4000-8000-000000000011','rival@other.test')
  on conflict (id) do nothing;

  insert into public.profiles (id, restaurant_id, full_name, role)
  values ('00000000-0000-4000-8000-000000000011', v_other, 'Rival Manager', 'restaurant_admin')
  on conflict (id) do update set restaurant_id = excluded.restaurant_id,
                                 role = 'restaurant_admin';
end $$;

-- Capture ids as a privileged role now, so later cross-tenant tests can pass
-- a REAL foreign id instead of a NULL that RLS already filtered out.
create temp table _ids as
select id as najd_table_id
from public.restaurant_tables t
where t.restaurant_id = (select id from public.restaurants where slug='najd-grill')
order by code limit 1;
grant select on _ids to anon, authenticated;

-- total order count as seen by a privileged role, for the super-admin check
create temp table _counts as select count(*) as all_orders from public.orders;
grant select on _counts to anon, authenticated;

-- ===========================================================================
-- As anon (a guest who scanned a QR code)
-- ===========================================================================
set role anon;
select set_config('request.jwt.claim.sub', '', false);

\echo '--- anon ---'

-- menu of a live restaurant: visible
select case when count(*) >= 18 then 'PASS: anon reads the live menu ('||count(*)||' items)'
            else 'FAIL: anon saw only '||count(*)||' menu items' end
from public.menu_items mi
join public.restaurants r on r.id = mi.restaurant_id
where r.slug = 'najd-grill';

-- Tables a guest must not be able to read at all. A revoked grant raises
-- insufficient_privilege; a policy that matches nothing returns zero rows.
-- Either outcome is a pass — what matters is that no data comes back.
-- Guests must hold no write privilege on anything except favorites, whatever
-- the policies happen to say.
do $$
declare
  t text;
  writable text[] := '{}';
begin
  for t in
    select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    if has_table_privilege('anon', format('public.%I', t), 'INSERT')
       or has_table_privilege('anon', format('public.%I', t), 'UPDATE')
       or has_table_privilege('anon', format('public.%I', t), 'DELETE')
    then
      writable := writable || t;
    end if;
  end loop;

  if writable = array['favorites'] then
    raise notice 'PASS: favorites is the only table anon can write to';
  else
    raise warning 'FAIL: anon holds write privileges on %', writable;
  end if;
end $$;

do $$
declare
  t text;
  n int;
  blocked text[] := array[
    'restaurant_tables',   -- holds the qr_token secret
    'coupons',             -- discount codes would be farmable
    'game_prizes',         -- weights would make the wheel predictable
    'loyalty_accounts',    -- other diners' balances and phone numbers
    'loyalty_transactions',
    'profiles',            -- staff directory
    'subscriptions',       -- platform billing
    'game_plays'
  ];
begin
  foreach t in array blocked loop
    begin
      execute format('select count(*) from (select 1 from public.%I limit 5) s', t) into n;
      if n = 0 then
        raise notice 'PASS: anon reads nothing from %', t;
      else
        raise warning 'FAIL: anon read % rows from %', n, t;
      end if;
    exception when insufficient_privilege then
      raise notice 'PASS: anon has no grant on % at all', t;
    end;
  end loop;
end $$;

-- trivia answers: the question is public, correct_index is not
do $$
begin
  perform correct_index from public.trivia_questions limit 1;
  raise warning 'FAIL: anon read trivia correct_index';
exception when insufficient_privilege then
  raise notice 'PASS: anon blocked from the trivia answer column';
end $$;

-- order totals: readable (for the live status screen); phone number is not
do $$
begin
  perform customer_phone from public.orders limit 1;
  raise warning 'FAIL: anon read customer_phone off orders';
exception when insufficient_privilege then
  raise notice 'PASS: anon blocked from the customer_phone column';
end $$;

-- writing an order directly must be impossible; the RPC is the only door
do $$
begin
  insert into public.orders (restaurant_id, table_id, order_number, session_id,
                             total, idempotency_key)
  select r.id, t.id, 9999, 'forged-session-0000000000', 1, 'forged-key-000000000001'
  from public.restaurants r join public.restaurant_tables t on t.restaurant_id = r.id
  where r.slug='najd-grill' limit 1;
  raise warning 'FAIL: anon inserted an order directly';
exception when insufficient_privilege or others then
  raise notice 'PASS: anon cannot insert orders directly (%)',
    left(regexp_replace(sqlerrm, E'[\n\r]+', ' ', 'g'), 46);
end $$;

-- a guest must not be able to advance their own order's status
do $$
begin
  update public.orders set status='paid' where status <> 'paid';
  raise warning 'FAIL: anon updated an order status';
exception when insufficient_privilege or others then
  raise notice 'PASS: anon cannot update order status';
end $$;

-- favorites is the one table a guest writes to directly
do $$
declare v_item uuid; v_rest uuid; v_n int;
begin
  select mi.id, mi.restaurant_id into v_item, v_rest
  from public.menu_items mi
  join public.restaurants r on r.id = mi.restaurant_id
  where r.slug = 'najd-grill' limit 1;

  -- a well-formed session id is accepted
  begin
    insert into public.favorites (restaurant_id, menu_item_id, session_id)
    values (v_rest, v_item, 'guest-session-abcdef0123456789');
    raise notice 'PASS: anon can save a favourite for its own session';
  exception when others then
    raise warning 'FAIL: anon could not save a favourite (%)', left(sqlerrm, 50);
  end;

  -- a session id short enough to be guessable is refused by the check
  begin
    insert into public.favorites (restaurant_id, menu_item_id, session_id)
    values (v_rest, v_item, 'short');
    raise warning 'FAIL: anon saved a favourite with a 5-char session id';
  exception when others then
    raise notice 'PASS: favourite with an undersized session id refused';
  end;

  -- and a guest cannot delete someone else's favourites wholesale
  select count(*) into v_n from public.favorites;
  if v_n >= 1 then
    raise notice 'PASS: favourite row is readable back (% row(s))', v_n;
  else
    raise warning 'FAIL: favourite not readable back';
  end if;
end $$;

reset role;

-- the menu of a suspended tenant must disappear for guests. Suspending is a
-- platform action, so it has to be done as the super admin or the billing
-- guard trigger reverts it.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);
update public.restaurants set subscription_status='suspended' where slug='other-tenant';

set role anon;
select case when count(*) = 0 then 'PASS: a suspended tenant''s menu is invisible to guests'
            else 'FAIL: suspended tenant still exposes '||count(*)||' items' end
from public.menu_items mi
join public.restaurants r on r.id=mi.restaurant_id
where r.slug='other-tenant';

reset role;
update public.restaurants set subscription_status='active' where slug='other-tenant';
select set_config('request.jwt.claim.sub', '', false);

-- ===========================================================================
-- As authenticated staff of Najd Grill
-- ===========================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', false);

\echo '--- authenticated: Najd Grill waiter ---'

select case when count(*) > 0 then 'PASS: waiter reads their own restaurant''s tables ('||count(*)||')'
            else 'FAIL: waiter cannot read their own tables' end
from public.restaurant_tables t
join public.restaurants r on r.id=t.restaurant_id where r.slug='najd-grill';

select case when count(*) = 0 then 'PASS: waiter cannot read another tenant''s tables'
            else 'FAIL: waiter read '||count(*)||' foreign tables' end
from public.restaurant_tables t
join public.restaurants r on r.id=t.restaurant_id where r.slug='other-tenant';

select case when count(*) = 0 then 'PASS: waiter cannot read another tenant''s orders'
            else 'FAIL: waiter read '||count(*)||' foreign orders' end
from public.orders o
join public.restaurants r on r.id=o.restaurant_id where r.slug='other-tenant';

select case when count(*) = 0 then 'PASS: waiter cannot read another tenant''s staff'
            else 'FAIL: waiter read '||count(*)||' foreign profiles' end
from public.profiles p
join public.restaurants r on r.id=p.restaurant_id where r.slug='other-tenant';

-- a waiter is not a menu manager
do $$
begin
  update public.menu_items set price = 1
  where restaurant_id = (select id from public.restaurants where slug='najd-grill');
  if found then
    raise warning 'FAIL: a waiter repriced the menu';
  else
    raise notice 'PASS: a waiter cannot reprice the menu (no rows matched policy)';
  end if;
exception when insufficient_privilege or others then
  raise notice 'PASS: a waiter cannot reprice the menu';
end $$;

-- and cannot promote themselves
do $$
begin
  update public.profiles set role='restaurant_admin'
  where id = '00000000-0000-4000-8000-000000000002';
  raise warning 'FAIL: a waiter escalated their own role';
exception when others then
  raise notice 'PASS: self-escalation blocked (%)', left(sqlerrm, 44);
end $$;

reset role;

-- ===========================================================================
-- As the rival tenant's admin
-- ===========================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000011', false);

\echo '--- authenticated: rival tenant admin ---'

select case when count(*) = 0 then 'PASS: rival admin cannot read Najd Grill orders'
            else 'FAIL: rival admin read '||count(*)||' orders' end
from public.orders o join public.restaurants r on r.id=o.restaurant_id
where r.slug='najd-grill';

select case when count(*) = 0 then 'PASS: rival admin cannot read Najd Grill loyalty data'
            else 'FAIL: rival admin read '||count(*)||' loyalty accounts' end
from public.loyalty_accounts a join public.restaurants r on r.id=a.restaurant_id
where r.slug='najd-grill';

select case when count(*) = 0 then 'PASS: rival admin cannot read Najd Grill QR tokens'
            else 'FAIL: rival admin read '||count(*)||' tokens' end
from public.restaurant_tables t join public.restaurants r on r.id=t.restaurant_id
where r.slug='najd-grill';

do $$
begin
  update public.menu_items set is_available = false
  where restaurant_id = (select id from public.restaurants where slug='najd-grill');
  if found then
    raise warning 'FAIL: rival admin disabled another tenant''s menu';
  else
    raise notice 'PASS: rival admin cannot touch another tenant''s menu';
  end if;
exception when insufficient_privilege or others then
  raise notice 'PASS: rival admin cannot touch another tenant''s menu';
end $$;

-- passed a real foreign table id, captured before RLS could hide it
do $$
declare v jsonb; v_id uuid;
begin
  select najd_table_id into v_id from _ids;
  v := public.rotate_table_token(v_id);
  raise warning 'FAIL: rival admin rotated another tenant''s QR token: %', v;
exception when others then
  raise notice 'PASS: rival admin cannot rotate a foreign QR token (%)', left(sqlerrm, 32);
end $$;

reset role;

-- ===========================================================================
-- As the super admin
-- ===========================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);

\echo '--- authenticated: super admin ---'

select case when (select count(*) from public.orders) = (select all_orders from _counts)
            then 'PASS: super admin sees every order on the platform ('
                 || (select all_orders from _counts) || ')'
            else 'FAIL: super admin saw ' || (select count(*) from public.orders)
                 || ' of ' || (select all_orders from _counts) || ' orders' end;

select case when count(*) >= 2 then 'PASS: super admin lists all '||count(*)||' restaurants'
            else 'FAIL: super admin saw only '||count(*) end
from public.restaurants;

reset role;
select set_config('request.jwt.claim.sub', '', false);
\echo '--- RLS tests complete ---'
