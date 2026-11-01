-- ============================================================================
-- Sufra — NFC + QR Restaurant Ordering SaaS
-- Migration 0001: extensions, enums, tables, indexes, triggers
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type app_role as enum ('super_admin','restaurant_admin','manager','waiter','kitchen','cashier');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum ('pending','confirmed','preparing','ready','served','paid','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type service_request_type as enum ('waiter','bill','water','cleaning','cutlery');
exception when duplicate_object then null; end $$;

do $$ begin
  create type service_request_status as enum ('open','acknowledged','resolved');
exception when duplicate_object then null; end $$;

do $$ begin
  create type subscription_status as enum ('trialing','active','past_due','suspended','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type coupon_type as enum ('percent','fixed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type loyalty_txn_type as enum ('earn','redeem','adjust','expire');
exception when duplicate_object then null; end $$;

do $$ begin
  create type game_type as enum ('spin_wheel','trivia');
exception when duplicate_object then null; end $$;

do $$ begin
  create type reward_type as enum ('discount_percent','discount_fixed','free_item');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Plans (SaaS pricing tiers, managed by super admin)
-- ---------------------------------------------------------------------------
create table if not exists public.plans (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  name            text not null,
  name_ar         text not null,
  price_monthly   numeric(10,2) not null default 0,
  price_yearly    numeric(10,2) not null default 0,
  currency        text not null default 'SAR',
  max_branches    int not null default 1,
  max_tables      int not null default 20,
  max_menu_items  int not null default 100,
  max_staff       int not null default 10,
  trial_days      int not null default 14,
  features        jsonb not null default '{}'::jsonb,
  sort_order      int not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Restaurants (tenants)
-- ---------------------------------------------------------------------------
create table if not exists public.restaurants (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique
                      check (slug ~ '^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$'),
  name                text not null,
  name_ar             text not null,
  tagline             text,
  tagline_ar          text,
  description         text,
  description_ar      text,
  logo_url            text,
  cover_url           text,
  -- contact + social
  phone               text,
  whatsapp            text,
  email               text,
  instagram_url       text,
  tiktok_url          text,
  snapchat_url        text,
  x_url               text,
  google_maps_url     text,
  google_reviews_url  text,
  address             text,
  address_ar          text,
  -- commerce settings
  currency            text not null default 'SAR',
  vat_rate            numeric(5,4) not null default 0.15,   -- KSA standard VAT
  prices_include_vat  boolean not null default true,
  vat_number          text,                                  -- 15-digit KSA TRN
  cr_number           text,                                  -- commercial registration
  service_charge_rate numeric(5,4) not null default 0,
  -- experience settings
  default_locale      text not null default 'ar' check (default_locale in ('ar','en')),
  primary_color       text not null default '#4b8061',
  requires_waiter_confirmation boolean not null default true,
  allow_customer_notes boolean not null default true,
  loyalty_enabled     boolean not null default true,
  loyalty_points_per_sar numeric(6,2) not null default 1,
  games_enabled       boolean not null default true,
  reviews_enabled     boolean not null default true,
  -- subscription
  plan_id             uuid references public.plans(id) on delete set null,
  subscription_status subscription_status not null default 'trialing',
  trial_ends_at       timestamptz not null default (now() + interval '14 days'),
  current_period_end  timestamptz,
  is_active           boolean not null default true,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists restaurants_slug_idx on public.restaurants (slug);
create index if not exists restaurants_active_idx on public.restaurants (is_active) where is_active;

-- ---------------------------------------------------------------------------
-- Branches (future multi-location; every restaurant gets a default branch)
-- ---------------------------------------------------------------------------
create table if not exists public.branches (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name          text not null,
  name_ar       text not null,
  address       text,
  address_ar    text,
  phone         text,
  google_maps_url text,
  opens_at      time,
  closes_at     time,
  is_default    boolean not null default false,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists branches_restaurant_idx on public.branches (restaurant_id);
create unique index if not exists branches_one_default_idx
  on public.branches (restaurant_id) where is_default;

-- ---------------------------------------------------------------------------
-- Profiles (staff accounts; 1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  restaurant_id uuid references public.restaurants(id) on delete cascade,
  branch_id     uuid references public.branches(id) on delete set null,
  full_name     text not null default '',
  phone         text,
  role          app_role not null default 'waiter',
  avatar_url    text,
  is_active     boolean not null default true,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- a super admin belongs to no restaurant; everyone else must belong to one
  constraint profiles_tenant_scope check (
    (role = 'super_admin' and restaurant_id is null)
    or (role <> 'super_admin' and restaurant_id is not null)
  )
);
create index if not exists profiles_restaurant_idx on public.profiles (restaurant_id);
create index if not exists profiles_role_idx on public.profiles (role);

-- Auto-create a profile row when a user signs up. Role/restaurant are taken
-- from the invite metadata the admin set, defaulting to an inactive waiter so
-- a self-signed-up stranger lands with no access to anything.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_restaurant uuid := nullif(new.raw_user_meta_data->>'restaurant_id','')::uuid;
  v_role       text := coalesce(nullif(new.raw_user_meta_data->>'role',''), 'waiter');
begin
  if v_restaurant is null and v_role <> 'super_admin' then
    -- no tenant assigned: park the user without a profile, admin links later
    return new;
  end if;

  insert into public.profiles (id, restaurant_id, full_name, phone, role, is_active)
  values (
    new.id,
    case when v_role = 'super_admin' then null else v_restaurant end,
    coalesce(new.raw_user_meta_data->>'full_name',''),
    new.raw_user_meta_data->>'phone',
    v_role::app_role,
    coalesce((new.raw_user_meta_data->>'is_active')::boolean, true)
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Menu: categories, items, modifier groups + options
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name          text not null,
  name_ar       text not null,
  description   text,
  description_ar text,
  image_url     text,
  icon          text,
  sort_order    int not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists categories_restaurant_idx on public.categories (restaurant_id, sort_order);

create table if not exists public.menu_items (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  category_id     uuid references public.categories(id) on delete set null,
  name            text not null,
  name_ar         text not null,
  description     text,
  description_ar  text,
  price           numeric(10,2) not null check (price >= 0),
  compare_at_price numeric(10,2) check (compare_at_price is null or compare_at_price >= 0),
  image_url       text,
  calories        int,
  prep_minutes    int,
  spice_level     int check (spice_level is null or spice_level between 0 and 3),
  allergens       text[] not null default '{}',
  tags            text[] not null default '{}',
  is_available    boolean not null default true,
  is_popular      boolean not null default false,
  is_featured     boolean not null default false,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists menu_items_restaurant_idx on public.menu_items (restaurant_id, sort_order);
create index if not exists menu_items_category_idx on public.menu_items (category_id);
create index if not exists menu_items_search_idx on public.menu_items using gin (name gin_trgm_ops);

create table if not exists public.modifier_groups (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  menu_item_id  uuid not null references public.menu_items(id) on delete cascade,
  name          text not null,
  name_ar       text not null,
  min_select    int not null default 0 check (min_select >= 0),
  max_select    int not null default 1 check (max_select >= 1),
  is_required   boolean not null default false,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists modifier_groups_item_idx on public.modifier_groups (menu_item_id, sort_order);

create table if not exists public.modifier_options (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  group_id      uuid not null references public.modifier_groups(id) on delete cascade,
  name          text not null,
  name_ar       text not null,
  price_delta   numeric(10,2) not null default 0,
  is_available  boolean not null default true,
  is_default    boolean not null default false,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists modifier_options_group_idx on public.modifier_options (group_id, sort_order);

-- ---------------------------------------------------------------------------
-- Tables (physical tables, each with a QR token + NFC payload)
-- ---------------------------------------------------------------------------
create table if not exists public.restaurant_tables (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  branch_id     uuid references public.branches(id) on delete set null,
  code          text not null check (code ~ '^[A-Za-z0-9_-]{1,16}$'),
  label         text not null,
  label_ar      text,
  zone          text,
  seats         int not null default 4 check (seats > 0),
  -- rotating secret embedded in the QR/NFC URL so a photographed code can be
  -- revoked by regenerating the token, without reprinting the table number
  qr_token      text not null default encode(gen_random_bytes(9), 'hex'),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, code)
);
create index if not exists tables_restaurant_idx on public.restaurant_tables (restaurant_id);
create index if not exists tables_token_idx on public.restaurant_tables (qr_token);

-- ---------------------------------------------------------------------------
-- Coupons + promotions
-- ---------------------------------------------------------------------------
create table if not exists public.coupons (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  code          text not null,
  type          coupon_type not null default 'percent',
  value         numeric(10,2) not null check (value > 0),
  min_order     numeric(10,2) not null default 0,
  max_discount  numeric(10,2),
  usage_limit   int,                       -- null = unlimited
  used_count    int not null default 0,
  per_session_limit int not null default 1,
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz,
  source        text not null default 'manual',  -- manual | spin_wheel | trivia | loyalty
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, code)
);
create index if not exists coupons_lookup_idx on public.coupons (restaurant_id, upper(code));

create table if not exists public.promotions (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  title         text not null,
  title_ar      text not null,
  subtitle      text,
  subtitle_ar   text,
  image_url     text,
  menu_item_id  uuid references public.menu_items(id) on delete set null,
  coupon_id     uuid references public.coupons(id) on delete set null,
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz,
  sort_order    int not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists promotions_restaurant_idx on public.promotions (restaurant_id, sort_order);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  branch_id       uuid references public.branches(id) on delete set null,
  table_id        uuid references public.restaurant_tables(id) on delete set null,
  order_number    int not null,
  status          order_status not null default 'pending',
  -- browser-generated id kept in localStorage; lets a guest see their own order
  session_id      text not null,
  customer_name   text,
  customer_phone  text,
  guest_count     int,
  notes           text,
  subtotal        numeric(10,2) not null default 0,
  discount_total  numeric(10,2) not null default 0,
  service_charge  numeric(10,2) not null default 0,
  vat_total       numeric(10,2) not null default 0,
  total           numeric(10,2) not null default 0,
  coupon_id       uuid references public.coupons(id) on delete set null,
  coupon_code     text,
  loyalty_points_earned int not null default 0,
  loyalty_account_id uuid,
  -- de-duplicates double taps / retried submissions
  idempotency_key text not null,
  confirmed_by    uuid references public.profiles(id) on delete set null,
  confirmed_at    timestamptz,
  prepared_at     timestamptz,
  ready_at        timestamptz,
  served_at       timestamptz,
  paid_at         timestamptz,
  cancelled_at    timestamptz,
  cancel_reason   text,
  placed_at       timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (restaurant_id, idempotency_key),
  unique (restaurant_id, order_number)
);
create index if not exists orders_restaurant_status_idx on public.orders (restaurant_id, status, placed_at desc);
create index if not exists orders_session_idx on public.orders (session_id, placed_at desc);
create index if not exists orders_table_idx on public.orders (table_id, placed_at desc);
create index if not exists orders_placed_idx on public.orders (placed_at desc);

-- Per-restaurant daily order numbers
create table if not exists public.order_counters (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  last_number   int not null default 0
);

create or replace function public.next_order_number(p_restaurant uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_num int;
begin
  insert into public.order_counters (restaurant_id, last_number)
  values (p_restaurant, 1)
  on conflict (restaurant_id)
    do update set last_number = public.order_counters.last_number + 1
  returning last_number into v_num;
  return v_num;
end $$;

create table if not exists public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  menu_item_id    uuid references public.menu_items(id) on delete set null,
  -- snapshots so a later price/name edit never rewrites history
  name_snapshot   text not null,
  name_ar_snapshot text not null,
  unit_price      numeric(10,2) not null,
  quantity        int not null check (quantity > 0 and quantity <= 99),
  modifiers       jsonb not null default '[]'::jsonb,
  modifiers_total numeric(10,2) not null default 0,
  line_total      numeric(10,2) not null,
  notes           text,
  created_at      timestamptz not null default now()
);
create index if not exists order_items_order_idx on public.order_items (order_id);

-- ---------------------------------------------------------------------------
-- Service requests (call waiter / request bill)
-- ---------------------------------------------------------------------------
create table if not exists public.service_requests (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id      uuid references public.restaurant_tables(id) on delete set null,
  order_id      uuid references public.orders(id) on delete set null,
  session_id    text not null,
  type          service_request_type not null default 'waiter',
  status        service_request_status not null default 'open',
  note          text,
  handled_by    uuid references public.profiles(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists service_requests_open_idx
  on public.service_requests (restaurant_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------------
create table if not exists public.reviews (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id      uuid references public.restaurant_tables(id) on delete set null,
  order_id      uuid references public.orders(id) on delete set null,
  session_id    text not null,
  rating        int not null check (rating between 1 and 5),
  food_rating   int check (food_rating between 1 and 5),
  service_rating int check (service_rating between 1 and 5),
  comment       text,
  customer_name text,
  is_published  boolean not null default true,
  reply         text,
  replied_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists reviews_restaurant_idx on public.reviews (restaurant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Loyalty
-- ---------------------------------------------------------------------------
create table if not exists public.loyalty_accounts (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  phone         text not null,
  name          text,
  points        int not null default 0 check (points >= 0),
  lifetime_points int not null default 0,
  total_spent   numeric(12,2) not null default 0,
  visits        int not null default 0,
  tier          text not null default 'bronze',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, phone)
);

create table if not exists public.loyalty_transactions (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  account_id    uuid not null references public.loyalty_accounts(id) on delete cascade,
  order_id      uuid references public.orders(id) on delete set null,
  type          loyalty_txn_type not null,
  points        int not null,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists loyalty_txn_account_idx on public.loyalty_transactions (account_id, created_at desc);

create table if not exists public.rewards (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name          text not null,
  name_ar       text not null,
  description   text,
  description_ar text,
  image_url     text,
  points_cost   int not null check (points_cost > 0),
  type          reward_type not null default 'discount_percent',
  value         numeric(10,2) not null default 0,
  menu_item_id  uuid references public.menu_items(id) on delete set null,
  stock         int,
  sort_order    int not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Games
-- ---------------------------------------------------------------------------
create table if not exists public.games (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  type          game_type not null,
  name          text not null,
  name_ar       text not null,
  description   text,
  description_ar text,
  -- one play per browser session per cooldown window
  cooldown_hours int not null default 24,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.game_prizes (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  game_id       uuid not null references public.games(id) on delete cascade,
  label         text not null,
  label_ar      text not null,
  -- relative probability weight; 0 weight never wins
  weight        int not null default 1 check (weight >= 0),
  coupon_type   coupon_type,
  coupon_value  numeric(10,2),
  coupon_min_order numeric(10,2) not null default 0,
  coupon_valid_hours int not null default 24,
  is_jackpot    boolean not null default false,
  color         text,
  sort_order    int not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists game_prizes_game_idx on public.game_prizes (game_id, sort_order);

create table if not exists public.game_plays (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  game_id       uuid not null references public.games(id) on delete cascade,
  prize_id      uuid references public.game_prizes(id) on delete set null,
  table_id      uuid references public.restaurant_tables(id) on delete set null,
  session_id    text not null,
  coupon_id     uuid references public.coupons(id) on delete set null,
  score         int,
  played_at     timestamptz not null default now()
);
create index if not exists game_plays_session_idx on public.game_plays (game_id, session_id, played_at desc);

create table if not exists public.trivia_questions (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  game_id       uuid references public.games(id) on delete cascade,
  question      text not null,
  question_ar   text not null,
  options       jsonb not null,          -- [{"en":"...","ar":"..."}, ...]
  correct_index int not null check (correct_index >= 0),
  explanation   text,
  explanation_ar text,
  points        int not null default 10,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists trivia_restaurant_idx on public.trivia_questions (restaurant_id);

-- ---------------------------------------------------------------------------
-- Favorites (per browser session, no account required)
-- ---------------------------------------------------------------------------
create table if not exists public.favorites (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  menu_item_id  uuid not null references public.menu_items(id) on delete cascade,
  session_id    text not null,
  created_at    timestamptz not null default now(),
  unique (session_id, menu_item_id)
);
create index if not exists favorites_item_idx on public.favorites (menu_item_id);

-- ---------------------------------------------------------------------------
-- Subscriptions ledger (super admin)
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  plan_id       uuid references public.plans(id) on delete set null,
  status        subscription_status not null default 'trialing',
  period_start  timestamptz not null default now(),
  period_end    timestamptz,
  amount        numeric(10,2) not null default 0,
  currency      text not null default 'SAR',
  provider      text,
  provider_ref  text,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists subscriptions_restaurant_idx on public.subscriptions (restaurant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'plans','restaurants','branches','profiles','categories','menu_items',
    'restaurant_tables','promotions','orders','loyalty_accounts','rewards','games'
  ] loop
    execute format(
      'drop trigger if exists touch_%1$s on public.%1$s;
       create trigger touch_%1$s before update on public.%1$s
       for each row execute function public.touch_updated_at();', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Realtime: push order + service-request changes to subscribed clients
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.orders; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.order_items; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.service_requests; exception when duplicate_object then null; end;
  end if;
end $$;

alter table public.orders replica identity full;
alter table public.service_requests replica identity full;

-- ---------------------------------------------------------------------------
-- Storage bucket for menu photos / logos
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu', 'menu', true, 5242880,
        array['image/jpeg','image/png','image/webp','image/avif','image/svg+xml'])
on conflict (id) do nothing;
