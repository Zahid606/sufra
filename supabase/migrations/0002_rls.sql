-- ============================================================================
-- Migration 0002: Row Level Security
--
-- Model
--   anon           guests who scanned a QR / tapped an NFC tag. Read-only on
--                  published content of ACTIVE restaurants. They never INSERT
--                  directly into orders — everything goes through the
--                  security-definer RPCs in 0003 so prices, discounts and
--                  rate limits are computed on the server.
--   authenticated  staff. Every policy is fenced to their own restaurant_id.
--   super_admin    cross-tenant access, identified by profiles.role.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers. SECURITY DEFINER so reading profiles inside a profiles policy
-- cannot recurse. STABLE so the planner calls them once per statement.
-- ---------------------------------------------------------------------------
create or replace function public.auth_role()
returns app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.auth_restaurant()
returns uuid language sql stable security definer set search_path = public as $$
  select restaurant_id from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and role = 'super_admin'
  )
$$;

-- Staff member of this restaurant (any role).
create or replace function public.is_staff(p_restaurant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and restaurant_id = p_restaurant
  )
$$;

-- Staff member of this restaurant holding one of the given roles.
create or replace function public.has_role(p_restaurant uuid, p_roles app_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and restaurant_id = p_restaurant
      and role = any (p_roles)
  )
$$;

-- Can this restaurant currently serve customers? Guests see nothing from a
-- suspended or expired tenant, which is how subscription enforcement bites.
create or replace function public.restaurant_is_live(p_restaurant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.restaurants r
    where r.id = p_restaurant
      and r.is_active
      and (
        r.subscription_status in ('active','past_due')
        or (r.subscription_status = 'trialing' and r.trial_ends_at > now())
      )
  )
$$;

grant execute on function public.auth_role, public.auth_restaurant,
  public.is_super_admin, public.is_staff, public.has_role,
  public.restaurant_is_live to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere. Nothing is readable until a policy says so.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'plans','restaurants','branches','profiles','categories','menu_items',
    'modifier_groups','modifier_options','restaurant_tables','coupons',
    'promotions','orders','order_items','order_counters','service_requests',
    'reviews','loyalty_accounts','loyalty_transactions','rewards','games',
    'game_prizes','game_plays','trivia_questions','favorites','subscriptions'
  ] loop
    -- ENABLE only, never FORCE: the SECURITY DEFINER RPCs in 0003 must be able
    -- to write rows on a guest's behalf, and FORCE would apply RLS to the
    -- table owner they run as.
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Guests write to exactly one table directly (favorites); everything else
-- goes through the RPCs in 0003. Supabase grants anon full DML on public by
-- default, and the policies below happen not to permit those writes — but
-- relying on the absence of a policy is weaker than removing the privilege.
-- Revoke writes from anon wholesale here, then hand back only favorites.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'plans','restaurants','branches','profiles','categories','menu_items',
    'modifier_groups','modifier_options','restaurant_tables','coupons',
    'promotions','orders','order_items','order_counters','service_requests',
    'reviews','loyalty_accounts','loyalty_transactions','rewards','games',
    'game_prizes','game_plays','trivia_questions','favorites','subscriptions'
  ] loop
    execute format('revoke insert, update, delete, truncate on public.%I from anon;', t);
  end loop;
end $$;

grant insert, delete on public.favorites to anon;

-- ===========================================================================
-- PLANS — public pricing page; only super admin writes
-- ===========================================================================
drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans
  for select to anon, authenticated using (is_active or public.is_super_admin());

drop policy if exists plans_write on public.plans;
create policy plans_write on public.plans
  for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ===========================================================================
-- RESTAURANTS
-- ===========================================================================
drop policy if exists restaurants_public_read on public.restaurants;
create policy restaurants_public_read on public.restaurants
  for select to anon, authenticated
  using (public.restaurant_is_live(id));

drop policy if exists restaurants_staff_read on public.restaurants;
create policy restaurants_staff_read on public.restaurants
  for select to authenticated
  using (public.is_staff(id) or public.is_super_admin());

-- Owners/managers may edit their own profile page; only super admin may touch
-- plan or subscription columns (enforced by the trigger below).
drop policy if exists restaurants_admin_update on public.restaurants;
create policy restaurants_admin_update on public.restaurants
  for update to authenticated
  using (public.has_role(id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin())
  with check (public.has_role(id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin());

drop policy if exists restaurants_super_all on public.restaurants;
create policy restaurants_super_all on public.restaurants
  for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create or replace function public.guard_restaurant_billing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_super_admin() then return new; end if;
  -- a tenant cannot promote its own plan, extend its own trial or reactivate
  -- itself; those are billing decisions that belong to the platform
  new.plan_id             := old.plan_id;
  new.subscription_status := old.subscription_status;
  new.trial_ends_at       := old.trial_ends_at;
  new.current_period_end  := old.current_period_end;
  new.is_active           := old.is_active;
  new.slug                := old.slug;
  return new;
end $$;

drop trigger if exists guard_restaurant_billing_trg on public.restaurants;
create trigger guard_restaurant_billing_trg
  before update on public.restaurants
  for each row execute function public.guard_restaurant_billing();

-- ===========================================================================
-- BRANCHES
-- ===========================================================================
drop policy if exists branches_read on public.branches;
create policy branches_read on public.branches
  for select to anon, authenticated
  using ((is_active and public.restaurant_is_live(restaurant_id))
         or public.is_staff(restaurant_id) or public.is_super_admin());

drop policy if exists branches_write on public.branches;
create policy branches_write on public.branches
  for all to authenticated
  using (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin())
  with check (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin());

-- ===========================================================================
-- PROFILES — staff directory, never exposed to anon
-- ===========================================================================
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists profiles_tenant_read on public.profiles;
create policy profiles_tenant_read on public.profiles
  for select to authenticated
  using (public.is_staff(restaurant_id) or public.is_super_admin());

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin())
  with check (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin());

-- Nobody escalates their own role, and nobody moves staff between tenants.
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_super_admin() then return new; end if;

  if new.id = auth.uid() and (new.role <> old.role or new.restaurant_id is distinct from old.restaurant_id) then
    raise exception 'You cannot change your own role or restaurant';
  end if;

  if new.restaurant_id is distinct from old.restaurant_id then
    raise exception 'Staff cannot be moved between restaurants';
  end if;

  if new.role = 'super_admin' then
    raise exception 'Only the platform can grant super admin';
  end if;

  return new;
end $$;

drop trigger if exists guard_profile_role_trg on public.profiles;
create trigger guard_profile_role_trg
  before update on public.profiles
  for each row execute function public.guard_profile_role();

-- ===========================================================================
-- MENU: categories, items, modifiers
-- Guests see only active rows of live restaurants. Staff see everything of
-- their own restaurant (including hidden/unavailable rows).
-- ===========================================================================
drop policy if exists categories_public_read on public.categories;
create policy categories_public_read on public.categories
  for select to anon, authenticated
  using (is_active and public.restaurant_is_live(restaurant_id));

drop policy if exists categories_staff_read on public.categories;
create policy categories_staff_read on public.categories
  for select to authenticated
  using (public.is_staff(restaurant_id) or public.is_super_admin());

drop policy if exists categories_write on public.categories;
create policy categories_write on public.categories
  for all to authenticated
  using (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin())
  with check (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin());

drop policy if exists menu_items_public_read on public.menu_items;
create policy menu_items_public_read on public.menu_items
  for select to anon, authenticated
  using (public.restaurant_is_live(restaurant_id));

drop policy if exists menu_items_staff_read on public.menu_items;
create policy menu_items_staff_read on public.menu_items
  for select to authenticated
  using (public.is_staff(restaurant_id) or public.is_super_admin());

drop policy if exists menu_items_write on public.menu_items;
create policy menu_items_write on public.menu_items
  for all to authenticated
  using (public.has_role(restaurant_id, array['restaurant_admin','manager','kitchen']::app_role[]) or public.is_super_admin())
  with check (public.has_role(restaurant_id, array['restaurant_admin','manager','kitchen']::app_role[]) or public.is_super_admin());

drop policy if exists modifier_groups_read on public.modifier_groups;
create policy modifier_groups_read on public.modifier_groups
  for select to anon, authenticated
  using (public.restaurant_is_live(restaurant_id)
         or public.is_staff(restaurant_id) or public.is_super_admin());

drop policy if exists modifier_groups_write on public.modifier_groups;
create policy modifier_groups_write on public.modifier_groups
  for all to authenticated
  using (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin())
  with check (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin());

drop policy if exists modifier_options_read on public.modifier_options;
create policy modifier_options_read on public.modifier_options
  for select to anon, authenticated
  using (public.restaurant_is_live(restaurant_id)
         or public.is_staff(restaurant_id) or public.is_super_admin());

drop policy if exists modifier_options_write on public.modifier_options;
create policy modifier_options_write on public.modifier_options
  for all to authenticated
  using (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin())
  with check (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin());

-- ===========================================================================
-- TABLES
-- The qr_token is a secret: guests must not be able to enumerate tokens for
-- other tables, so anon gets no table-level SELECT at all. Table resolution
-- happens inside resolve_table() in 0003.
-- ===========================================================================
drop policy if exists tables_staff_read on public.restaurant_tables;
create policy tables_staff_read on public.restaurant_tables
  for select to authenticated
  using (public.is_staff(restaurant_id) or public.is_super_admin());

drop policy if exists tables_write on public.restaurant_tables;
create policy tables_write on public.restaurant_tables
  for all to authenticated
  using (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin())
  with check (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin());

-- the qr_token lives here, so anon gets no read at all
revoke all on public.restaurant_tables from anon;

-- ===========================================================================
-- COUPONS — codes are never listed to guests; validation goes through an RPC
-- ===========================================================================
drop policy if exists coupons_staff on public.coupons;
create policy coupons_staff on public.coupons
  for all to authenticated
  using (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin())
  with check (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin());

revoke all on public.coupons from anon;

-- ===========================================================================
-- PROMOTIONS — the offers strip on the customer menu
-- ===========================================================================
drop policy if exists promotions_public_read on public.promotions;
create policy promotions_public_read on public.promotions
  for select to anon, authenticated
  using (
    is_active and public.restaurant_is_live(restaurant_id)
    and starts_at <= now() and (ends_at is null or ends_at > now())
  );

drop policy if exists promotions_staff on public.promotions;
create policy promotions_staff on public.promotions
  for all to authenticated
  using (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin())
  with check (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin());

-- ===========================================================================
-- ORDERS
-- Guests read recent orders so the live status screen can subscribe to
-- realtime, but only through a narrow column grant — name and phone are not
-- in it, so a guest cannot harvest other diners' contact details. Writes are
-- RPC-only. See README "Security model" for the hardening path.
-- ===========================================================================
drop policy if exists orders_guest_read on public.orders;
create policy orders_guest_read on public.orders
  for select to anon
  using (placed_at > now() - interval '12 hours'
         and public.restaurant_is_live(restaurant_id));

drop policy if exists orders_staff_read on public.orders;
create policy orders_staff_read on public.orders
  for select to authenticated
  using (public.is_staff(restaurant_id) or public.is_super_admin());

-- Waiters confirm, kitchen advances status, admins can do either; all of it
-- is scoped to their own restaurant.
drop policy if exists orders_staff_update on public.orders;
create policy orders_staff_update on public.orders
  for update to authenticated
  using (public.has_role(restaurant_id,
          array['restaurant_admin','manager','waiter','kitchen','cashier']::app_role[])
         or public.is_super_admin())
  with check (public.has_role(restaurant_id,
          array['restaurant_admin','manager','waiter','kitchen','cashier']::app_role[])
         or public.is_super_admin());

drop policy if exists orders_admin_write on public.orders;
create policy orders_admin_write on public.orders
  for all to authenticated
  using (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin())
  with check (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin());

revoke all on public.orders from anon;
grant select (
  id, restaurant_id, branch_id, table_id, order_number, status, session_id,
  subtotal, discount_total, service_charge, vat_total, total, coupon_code,
  notes, loyalty_points_earned, placed_at, confirmed_at, prepared_at,
  ready_at, served_at, paid_at, cancelled_at, updated_at
) on public.orders to anon;

drop policy if exists order_items_guest_read on public.order_items;
create policy order_items_guest_read on public.order_items
  for select to anon
  using (exists (
    select 1 from public.orders o
    where o.id = order_items.order_id
      and o.placed_at > now() - interval '12 hours'
  ));

drop policy if exists order_items_staff_read on public.order_items;
create policy order_items_staff_read on public.order_items
  for select to authenticated
  using (public.is_staff(restaurant_id) or public.is_super_admin());

drop policy if exists order_items_staff_write on public.order_items;
create policy order_items_staff_write on public.order_items
  for all to authenticated
  using (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin())
  with check (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin());

revoke insert, update, delete on public.order_items from anon;
revoke all on public.order_counters from anon, authenticated;

-- ===========================================================================
-- SERVICE REQUESTS — guest raises via RPC, staff resolves
-- ===========================================================================
drop policy if exists service_guest_read on public.service_requests;
create policy service_guest_read on public.service_requests
  for select to anon
  using (created_at > now() - interval '6 hours');

drop policy if exists service_staff_all on public.service_requests;
create policy service_staff_all on public.service_requests
  for all to authenticated
  using (public.is_staff(restaurant_id) or public.is_super_admin())
  with check (public.is_staff(restaurant_id) or public.is_super_admin());

revoke insert, update, delete on public.service_requests from anon;

-- ===========================================================================
-- REVIEWS — published ones are public, submission is RPC-gated
-- ===========================================================================
drop policy if exists reviews_public_read on public.reviews;
create policy reviews_public_read on public.reviews
  for select to anon, authenticated
  using (is_published and public.restaurant_is_live(restaurant_id));

drop policy if exists reviews_staff_all on public.reviews;
create policy reviews_staff_all on public.reviews
  for all to authenticated
  using (public.is_staff(restaurant_id) or public.is_super_admin())
  with check (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin());

revoke insert, update, delete on public.reviews from anon;

-- ===========================================================================
-- LOYALTY — a guest reaches their own balance by phone lookup through an RPC,
-- so balances are never enumerable over the REST API
-- ===========================================================================
drop policy if exists loyalty_staff on public.loyalty_accounts;
create policy loyalty_staff on public.loyalty_accounts
  for all to authenticated
  using (public.is_staff(restaurant_id) or public.is_super_admin())
  with check (public.is_staff(restaurant_id) or public.is_super_admin());

revoke all on public.loyalty_accounts from anon;

drop policy if exists loyalty_txn_staff on public.loyalty_transactions;
create policy loyalty_txn_staff on public.loyalty_transactions
  for all to authenticated
  using (public.is_staff(restaurant_id) or public.is_super_admin())
  with check (public.is_staff(restaurant_id) or public.is_super_admin());

revoke all on public.loyalty_transactions from anon;

drop policy if exists rewards_public_read on public.rewards;
create policy rewards_public_read on public.rewards
  for select to anon, authenticated
  using (is_active and public.restaurant_is_live(restaurant_id));

drop policy if exists rewards_staff on public.rewards;
create policy rewards_staff on public.rewards
  for all to authenticated
  using (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin())
  with check (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin());

-- ===========================================================================
-- GAMES — prize weights stay server-side so the wheel cannot be reverse
-- engineered or predicted from the client bundle
-- ===========================================================================
drop policy if exists games_public_read on public.games;
create policy games_public_read on public.games
  for select to anon, authenticated
  using (is_active and public.restaurant_is_live(restaurant_id));

drop policy if exists games_staff on public.games;
create policy games_staff on public.games
  for all to authenticated
  using (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin())
  with check (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin());

drop policy if exists prizes_staff on public.game_prizes;
create policy prizes_staff on public.game_prizes
  for all to authenticated
  using (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin())
  with check (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin());

revoke all on public.game_prizes from anon;

drop policy if exists plays_staff_read on public.game_plays;
create policy plays_staff_read on public.game_plays
  for select to authenticated
  using (public.is_staff(restaurant_id) or public.is_super_admin());

revoke all on public.game_plays from anon;

drop policy if exists trivia_public_read on public.trivia_questions;
create policy trivia_public_read on public.trivia_questions
  for select to anon, authenticated
  using (is_active and public.restaurant_is_live(restaurant_id));

drop policy if exists trivia_staff on public.trivia_questions;
create policy trivia_staff on public.trivia_questions
  for all to authenticated
  using (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin())
  with check (public.has_role(restaurant_id, array['restaurant_admin','manager']::app_role[]) or public.is_super_admin());

-- correct_index must not be readable by the client or trivia is trivial
revoke select on public.trivia_questions from anon;
grant select (id, restaurant_id, game_id, question, question_ar, options, points, is_active)
  on public.trivia_questions to anon;

-- ===========================================================================
-- FAVORITES — the one table a guest writes directly, keyed to their own
-- browser session id and nothing else
-- ===========================================================================
drop policy if exists favorites_session_all on public.favorites;
create policy favorites_session_all on public.favorites
  for all to anon, authenticated
  using (public.restaurant_is_live(restaurant_id))
  with check (public.restaurant_is_live(restaurant_id) and length(session_id) between 16 and 64);

-- ===========================================================================
-- SUBSCRIPTIONS — platform billing ledger
-- ===========================================================================
drop policy if exists subscriptions_read on public.subscriptions;
create policy subscriptions_read on public.subscriptions
  for select to authenticated
  using (public.has_role(restaurant_id, array['restaurant_admin']::app_role[]) or public.is_super_admin());

drop policy if exists subscriptions_super on public.subscriptions;
create policy subscriptions_super on public.subscriptions
  for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

revoke all on public.subscriptions from anon;

-- ===========================================================================
-- STORAGE — menu photos are world-readable, writable only by the owning
-- restaurant's managers, who are fenced into a folder named after their id
-- ===========================================================================
drop policy if exists "menu images public read" on storage.objects;
create policy "menu images public read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'menu');

drop policy if exists "menu images tenant write" on storage.objects;
create policy "menu images tenant write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'menu'
    and (storage.foldername(name))[1] = coalesce(public.auth_restaurant()::text, '-')
  );

drop policy if exists "menu images tenant update" on storage.objects;
create policy "menu images tenant update" on storage.objects
  for update to authenticated
  using (bucket_id = 'menu'
         and (storage.foldername(name))[1] = coalesce(public.auth_restaurant()::text, '-'));

drop policy if exists "menu images tenant delete" on storage.objects;
create policy "menu images tenant delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'menu'
         and (storage.foldername(name))[1] = coalesce(public.auth_restaurant()::text, '-'));
