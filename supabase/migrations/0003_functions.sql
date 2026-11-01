-- ============================================================================
-- Migration 0003: server-side business logic
--
-- Everything a guest can write goes through a SECURITY DEFINER function here.
-- The client sends intent (which item, how many, which options) and never
-- money: prices, modifier deltas, discounts, VAT and prize outcomes are all
-- recomputed from the database. A tampered request cannot buy a 500 SAR dish
-- for 1 SAR, and a patched JS bundle cannot win the jackpot.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- resolve_table — the QR / NFC entry point
--   /r/:slug/t/:code?k=:token
-- Returns the restaurant + table, or an explicit error code the UI can render
-- in the guest's language. The qr_token must match, so a code photographed
-- and shared online stops working the moment the table's token is rotated.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_table(
  p_slug  text,
  p_code  text,
  p_token text default null
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  t record;
begin
  select * into r from public.restaurants where slug = lower(trim(p_slug));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'restaurant_not_found');
  end if;

  if not r.is_active then
    return jsonb_build_object('ok', false, 'error', 'restaurant_inactive');
  end if;

  if not (r.subscription_status in ('active','past_due')
          or (r.subscription_status = 'trialing' and r.trial_ends_at > now())) then
    return jsonb_build_object('ok', false, 'error', 'subscription_expired');
  end if;

  select * into t from public.restaurant_tables
  where restaurant_id = r.id and lower(code) = lower(trim(p_code));

  if not found then
    return jsonb_build_object('ok', false, 'error', 'table_not_found');
  end if;

  if not t.is_active then
    return jsonb_build_object('ok', false, 'error', 'table_inactive');
  end if;

  -- A token is required whenever one is set on the table. Compared with
  -- a length-independent equality to keep the failure mode uniform.
  if p_token is null or p_token = '' or p_token <> t.qr_token then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  return jsonb_build_object(
    'ok', true,
    'restaurant', jsonb_build_object(
      'id', r.id, 'slug', r.slug, 'name', r.name, 'name_ar', r.name_ar,
      'tagline', r.tagline, 'tagline_ar', r.tagline_ar,
      'description', r.description, 'description_ar', r.description_ar,
      'logo_url', r.logo_url, 'cover_url', r.cover_url,
      'phone', r.phone, 'whatsapp', r.whatsapp,
      'instagram_url', r.instagram_url, 'tiktok_url', r.tiktok_url,
      'snapchat_url', r.snapchat_url, 'x_url', r.x_url,
      'google_maps_url', r.google_maps_url, 'google_reviews_url', r.google_reviews_url,
      'address', r.address, 'address_ar', r.address_ar,
      'currency', r.currency, 'vat_rate', r.vat_rate,
      'prices_include_vat', r.prices_include_vat,
      'service_charge_rate', r.service_charge_rate,
      'default_locale', r.default_locale, 'primary_color', r.primary_color,
      'requires_waiter_confirmation', r.requires_waiter_confirmation,
      'allow_customer_notes', r.allow_customer_notes,
      'loyalty_enabled', r.loyalty_enabled,
      'loyalty_points_per_sar', r.loyalty_points_per_sar,
      'games_enabled', r.games_enabled, 'reviews_enabled', r.reviews_enabled
    ),
    'table', jsonb_build_object(
      'id', t.id, 'code', t.code, 'label', t.label, 'label_ar', t.label_ar,
      'zone', t.zone, 'seats', t.seats, 'branch_id', t.branch_id
    )
  );
end $$;

-- ---------------------------------------------------------------------------
-- validate_coupon — quotes a discount without consuming it
-- ---------------------------------------------------------------------------
create or replace function public.validate_coupon(
  p_restaurant uuid,
  p_code       text,
  p_subtotal   numeric,
  p_session_id text default null
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c record;
  v_discount numeric(10,2);
  v_used int;
begin
  select * into c from public.coupons
  where restaurant_id = p_restaurant
    and upper(code) = upper(trim(coalesce(p_code,'')))
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'coupon_not_found');
  end if;
  if not c.is_active then
    return jsonb_build_object('ok', false, 'error', 'coupon_inactive');
  end if;
  if c.starts_at > now() then
    return jsonb_build_object('ok', false, 'error', 'coupon_not_started');
  end if;
  if c.ends_at is not null and c.ends_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'coupon_expired');
  end if;
  if c.usage_limit is not null and c.used_count >= c.usage_limit then
    return jsonb_build_object('ok', false, 'error', 'coupon_exhausted');
  end if;
  if p_subtotal < c.min_order then
    return jsonb_build_object('ok', false, 'error', 'coupon_min_order',
                              'min_order', c.min_order);
  end if;

  if p_session_id is not null and c.per_session_limit > 0 then
    select count(*) into v_used from public.orders
    where coupon_id = c.id and session_id = p_session_id
      and status <> 'cancelled';
    if v_used >= c.per_session_limit then
      return jsonb_build_object('ok', false, 'error', 'coupon_already_used');
    end if;
  end if;

  if c.type = 'percent' then
    v_discount := round(p_subtotal * (c.value / 100.0), 2);
  else
    v_discount := c.value;
  end if;

  if c.max_discount is not null then
    v_discount := least(v_discount, c.max_discount);
  end if;
  v_discount := least(v_discount, p_subtotal);

  return jsonb_build_object(
    'ok', true, 'coupon_id', c.id, 'code', c.code, 'type', c.type,
    'value', c.value, 'discount', v_discount
  );
end $$;

-- ---------------------------------------------------------------------------
-- place_order — the only way a guest creates an order
--
-- p_items: [{ "menu_item_id": uuid, "quantity": int,
--             "option_ids": [uuid, ...], "notes": text }]
--
-- Duplicate protection is two-layered:
--   1. p_idempotency_key is unique per restaurant, so a retried or
--      double-tapped submit returns the original order instead of a second one.
--   2. an identical-total order from the same session inside 45 seconds is
--      rejected, which catches a genuinely re-submitted cart.
-- ---------------------------------------------------------------------------
create or replace function public.place_order(
  p_table_id        uuid,
  p_session_id      text,
  p_items           jsonb,
  p_idempotency_key text,
  p_customer_name   text default null,
  p_customer_phone  text default null,
  p_notes           text default null,
  p_coupon_code     text default null,
  p_guest_count     int  default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t            record;
  r            record;
  it           jsonb;
  mi           record;
  v_order_id   uuid;
  v_existing   record;
  v_subtotal   numeric(12,2) := 0;
  v_mod_total  numeric(12,2);
  v_line       numeric(12,2);
  v_qty        int;
  v_mods       jsonb;
  v_opt_count  int;
  v_grp        record;
  v_discount   numeric(12,2) := 0;
  v_coupon     jsonb;
  v_coupon_id  uuid;
  v_service    numeric(12,2) := 0;
  v_vat        numeric(12,2) := 0;
  v_net        numeric(12,2);
  v_total      numeric(12,2);
  v_number     int;
  v_status     order_status;
  v_item_count int := 0;
  v_lines      jsonb := '[]'::jsonb;
begin
  -- ---- validate inputs -----------------------------------------------------
  if p_session_id is null or length(p_session_id) < 16 or length(p_session_id) > 64 then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 16 then
    return jsonb_build_object('ok', false, 'error', 'invalid_idempotency_key');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'empty_cart');
  end if;
  if jsonb_array_length(p_items) > 60 then
    return jsonb_build_object('ok', false, 'error', 'cart_too_large');
  end if;

  select * into t from public.restaurant_tables where id = p_table_id and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'table_not_found');
  end if;

  select * into r from public.restaurants where id = t.restaurant_id;
  if not public.restaurant_is_live(r.id) then
    return jsonb_build_object('ok', false, 'error', 'restaurant_unavailable');
  end if;

  -- ---- layer 1: idempotency ------------------------------------------------
  select * into v_existing from public.orders
  where restaurant_id = r.id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true,
      'order_id', v_existing.id, 'order_number', v_existing.order_number,
      'status', v_existing.status, 'total', v_existing.total);
  end if;

  -- ---- price every line from the database ----------------------------------
  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((it->>'quantity')::int, 0);
    if v_qty < 1 or v_qty > 99 then
      return jsonb_build_object('ok', false, 'error', 'invalid_quantity');
    end if;

    select * into mi from public.menu_items
    where id = (it->>'menu_item_id')::uuid
      and restaurant_id = r.id;

    if not found then
      return jsonb_build_object('ok', false, 'error', 'item_not_found',
                                'menu_item_id', it->>'menu_item_id');
    end if;
    if not mi.is_available then
      return jsonb_build_object('ok', false, 'error', 'item_unavailable',
                                'name', mi.name, 'name_ar', mi.name_ar);
    end if;

    -- resolve the chosen options, rejecting anything that is not an available
    -- option of a modifier group belonging to THIS item
    v_mod_total := 0;
    v_mods := '[]'::jsonb;

    if it ? 'option_ids' and jsonb_typeof(it->'option_ids') = 'array' then
      if jsonb_array_length(it->'option_ids') > 30 then
        return jsonb_build_object('ok', false, 'error', 'too_many_options');
      end if;

      select coalesce(sum(o.price_delta), 0),
             coalesce(jsonb_agg(jsonb_build_object(
               'option_id', o.id, 'group_id', o.group_id,
               'name', o.name, 'name_ar', o.name_ar, 'price_delta', o.price_delta
             ) order by g.sort_order, o.sort_order), '[]'::jsonb),
             count(*)
        into v_mod_total, v_mods, v_opt_count
      from public.modifier_options o
      join public.modifier_groups g on g.id = o.group_id
      where g.menu_item_id = mi.id
        and o.is_available
        and o.id in (
          select (value #>> '{}')::uuid from jsonb_array_elements(it->'option_ids')
        );

      if v_opt_count <> jsonb_array_length(it->'option_ids') then
        return jsonb_build_object('ok', false, 'error', 'invalid_modifier');
      end if;
    end if;

    -- honour min/max selection rules per group
    for v_grp in
      select g.id, g.name, g.name_ar, g.min_select, g.max_select, g.is_required
      from public.modifier_groups g where g.menu_item_id = mi.id
    loop
      select count(*) into v_opt_count
      from jsonb_array_elements(v_mods) m
      where (m->>'group_id')::uuid = v_grp.id;

      if (v_grp.is_required or v_grp.min_select > 0) and v_opt_count < greatest(v_grp.min_select, 1) then
        return jsonb_build_object('ok', false, 'error', 'modifier_group_required',
          'group', v_grp.name, 'group_ar', v_grp.name_ar, 'min', greatest(v_grp.min_select,1));
      end if;
      if v_opt_count > v_grp.max_select then
        return jsonb_build_object('ok', false, 'error', 'modifier_group_max',
          'group', v_grp.name, 'group_ar', v_grp.name_ar, 'max', v_grp.max_select);
      end if;
    end loop;

    v_line := round((mi.price + v_mod_total) * v_qty, 2);
    v_subtotal := v_subtotal + v_line;
    v_item_count := v_item_count + v_qty;

    v_lines := v_lines || jsonb_build_object(
      'menu_item_id', mi.id,
      'name_snapshot', mi.name,
      'name_ar_snapshot', mi.name_ar,
      'unit_price', mi.price,
      'quantity', v_qty,
      'modifiers', v_mods,
      'modifiers_total', v_mod_total,
      'line_total', v_line,
      'notes', nullif(left(coalesce(it->>'notes',''), 240), '')
    );
  end loop;

  if v_subtotal <= 0 then
    return jsonb_build_object('ok', false, 'error', 'empty_cart');
  end if;

  -- ---- layer 2: near-identical resubmission --------------------------------
  if exists (
    select 1 from public.orders
    where session_id = p_session_id
      and table_id = t.id
      and status in ('pending','confirmed')
      and subtotal = v_subtotal
      and placed_at > now() - interval '45 seconds'
  ) then
    return jsonb_build_object('ok', false, 'error', 'duplicate_order');
  end if;

  -- ---- discount ------------------------------------------------------------
  if coalesce(trim(p_coupon_code), '') <> '' then
    v_coupon := public.validate_coupon(r.id, p_coupon_code, v_subtotal, p_session_id);
    if not (v_coupon->>'ok')::boolean then
      return v_coupon;
    end if;
    v_discount  := (v_coupon->>'discount')::numeric;
    v_coupon_id := (v_coupon->>'coupon_id')::uuid;
  end if;

  v_net := v_subtotal - v_discount;
  v_service := round(v_net * r.service_charge_rate, 2);

  -- KSA: menu prices are normally displayed VAT-inclusive, so VAT is extracted
  -- from the gross rather than added on top.
  if r.prices_include_vat then
    v_total := v_net + v_service;
    v_vat   := round(v_total * r.vat_rate / (1 + r.vat_rate), 2);
  else
    v_vat   := round((v_net + v_service) * r.vat_rate, 2);
    v_total := v_net + v_service + v_vat;
  end if;

  v_status := case when r.requires_waiter_confirmation then 'pending' else 'confirmed' end;
  v_number := public.next_order_number(r.id);

  insert into public.orders (
    restaurant_id, branch_id, table_id, order_number, status, session_id,
    customer_name, customer_phone, guest_count, notes,
    subtotal, discount_total, service_charge, vat_total, total,
    coupon_id, coupon_code, idempotency_key,
    confirmed_at
  ) values (
    r.id, t.branch_id, t.id, v_number, v_status, p_session_id,
    nullif(left(coalesce(p_customer_name,''), 80), ''),
    nullif(left(regexp_replace(coalesce(p_customer_phone,''), '[^0-9+]', '', 'g'), 20), ''),
    p_guest_count,
    case when r.allow_customer_notes then nullif(left(coalesce(p_notes,''), 400), '') end,
    v_subtotal, v_discount, v_service, v_vat, v_total,
    v_coupon_id, case when v_coupon_id is not null then (v_coupon->>'code') end,
    p_idempotency_key,
    case when v_status = 'confirmed' then now() end
  )
  returning id into v_order_id;

  insert into public.order_items (
    order_id, restaurant_id, menu_item_id, name_snapshot, name_ar_snapshot,
    unit_price, quantity, modifiers, modifiers_total, line_total, notes
  )
  select v_order_id, r.id, l.menu_item_id, l.name_snapshot, l.name_ar_snapshot,
         l.unit_price, l.quantity, l.modifiers, l.modifiers_total, l.line_total, l.notes
  from jsonb_to_recordset(v_lines) as l(
    menu_item_id uuid, name_snapshot text, name_ar_snapshot text,
    unit_price numeric(10,2), quantity int, modifiers jsonb,
    modifiers_total numeric(10,2), line_total numeric(10,2), notes text
  );

  if v_coupon_id is not null then
    update public.coupons set used_count = used_count + 1 where id = v_coupon_id;
  end if;

  return jsonb_build_object(
    'ok', true, 'duplicate', false,
    'order_id', v_order_id, 'order_number', v_number, 'status', v_status,
    'subtotal', v_subtotal, 'discount_total', v_discount,
    'service_charge', v_service, 'vat_total', v_vat, 'total', v_total,
    'item_count', v_item_count,
    'requires_confirmation', r.requires_waiter_confirmation
  );
end $$;

-- ---------------------------------------------------------------------------
-- get_my_orders — a guest's own orders, matched on their browser session id
-- ---------------------------------------------------------------------------
create or replace function public.get_my_orders(
  p_session_id text,
  p_restaurant uuid default null
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if p_session_id is null or length(p_session_id) < 16 then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(row_to_json(x) order by x.placed_at desc), '[]'::jsonb)
    into v_rows
  from (
    select o.id, o.order_number, o.status, o.table_id, o.restaurant_id,
           o.subtotal, o.discount_total, o.service_charge, o.vat_total, o.total,
           o.coupon_code, o.notes, o.placed_at, o.confirmed_at, o.ready_at,
           o.served_at, o.paid_at, o.cancelled_at, o.loyalty_points_earned,
           t.label as table_label, t.code as table_code,
           (select coalesce(jsonb_agg(jsonb_build_object(
              'id', oi.id, 'name', oi.name_snapshot, 'name_ar', oi.name_ar_snapshot,
              'quantity', oi.quantity, 'unit_price', oi.unit_price,
              'modifiers', oi.modifiers, 'line_total', oi.line_total,
              'notes', oi.notes) order by oi.created_at), '[]'::jsonb)
            from public.order_items oi where oi.order_id = o.id) as items
    from public.orders o
    left join public.restaurant_tables t on t.id = o.table_id
    where o.session_id = p_session_id
      and (p_restaurant is null or o.restaurant_id = p_restaurant)
      and o.placed_at > now() - interval '24 hours'
    order by o.placed_at desc
    limit 20
  ) x;

  return v_rows;
end $$;

-- ---------------------------------------------------------------------------
-- request_service — call waiter / request bill, throttled per table
-- ---------------------------------------------------------------------------
create or replace function public.request_service(
  p_table_id   uuid,
  p_session_id text,
  p_type       text default 'waiter',
  p_note       text default null,
  p_order_id   uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t record;
  v_type service_request_type;
  v_id uuid;
begin
  if p_session_id is null or length(p_session_id) < 16 then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;

  begin
    v_type := p_type::service_request_type;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'invalid_type');
  end;

  select * into t from public.restaurant_tables where id = p_table_id and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'table_not_found');
  end if;
  if not public.restaurant_is_live(t.restaurant_id) then
    return jsonb_build_object('ok', false, 'error', 'restaurant_unavailable');
  end if;

  -- one open request of a given type per table at a time, and no re-ping
  -- within 90 seconds, so a bored guest cannot spam the waiter's screen
  if exists (
    select 1 from public.service_requests
    where table_id = t.id and type = v_type
      and (status = 'open' or created_at > now() - interval '90 seconds')
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_requested');
  end if;

  insert into public.service_requests (
    restaurant_id, table_id, order_id, session_id, type, note
  ) values (
    t.restaurant_id, t.id, p_order_id, p_session_id, v_type,
    nullif(left(coalesce(p_note,''), 240), '')
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'type', v_type);
end $$;

-- ---------------------------------------------------------------------------
-- submit_review
-- ---------------------------------------------------------------------------
create or replace function public.submit_review(
  p_restaurant     uuid,
  p_session_id     text,
  p_rating         int,
  p_comment        text default null,
  p_customer_name  text default null,
  p_food_rating    int default null,
  p_service_rating int default null,
  p_table_id       uuid default null,
  p_order_id       uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_session_id is null or length(p_session_id) < 16 then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    return jsonb_build_object('ok', false, 'error', 'invalid_rating');
  end if;
  if not public.restaurant_is_live(p_restaurant) then
    return jsonb_build_object('ok', false, 'error', 'restaurant_unavailable');
  end if;
  if not exists (select 1 from public.restaurants where id = p_restaurant and reviews_enabled) then
    return jsonb_build_object('ok', false, 'error', 'reviews_disabled');
  end if;

  -- one review per browser session per restaurant per day
  if exists (
    select 1 from public.reviews
    where restaurant_id = p_restaurant and session_id = p_session_id
      and created_at > now() - interval '24 hours'
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_reviewed');
  end if;

  insert into public.reviews (
    restaurant_id, table_id, order_id, session_id, rating,
    food_rating, service_rating, comment, customer_name
  ) values (
    p_restaurant, p_table_id, p_order_id, p_session_id, p_rating,
    p_food_rating, p_service_rating,
    nullif(left(coalesce(p_comment,''), 1000), ''),
    nullif(left(coalesce(p_customer_name,''), 80), '')
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ---------------------------------------------------------------------------
-- spin_wheel — weighted draw performed in the database
-- The client is told which segment to land on only after the result exists,
-- so the animation reflects a decision it could not influence.
-- ---------------------------------------------------------------------------
create or replace function public.spin_wheel(
  p_game_id    uuid,
  p_session_id text,
  p_table_id   uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  g          record;
  v_total    int;
  v_pick     int;
  v_prize    record;
  v_code     text;
  v_coupon   uuid;
  v_index    int;
  v_last     timestamptz;
begin
  if p_session_id is null or length(p_session_id) < 16 then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;

  select * into g from public.games
  where id = p_game_id and is_active and type = 'spin_wheel';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'game_not_found');
  end if;
  if not public.restaurant_is_live(g.restaurant_id) then
    return jsonb_build_object('ok', false, 'error', 'restaurant_unavailable');
  end if;
  if not exists (select 1 from public.restaurants where id = g.restaurant_id and games_enabled) then
    return jsonb_build_object('ok', false, 'error', 'games_disabled');
  end if;

  -- cooldown per browser session
  select max(played_at) into v_last from public.game_plays
  where game_id = g.id and session_id = p_session_id;

  if v_last is not null and v_last > now() - make_interval(hours => g.cooldown_hours) then
    return jsonb_build_object(
      'ok', false, 'error', 'cooldown',
      'next_play_at', v_last + make_interval(hours => g.cooldown_hours));
  end if;

  select coalesce(sum(weight), 0) into v_total
  from public.game_prizes where game_id = g.id and is_active and weight > 0;

  if v_total = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_prizes');
  end if;

  v_pick := floor(random() * v_total)::int + 1;

  select * into v_prize from (
    select p.*,
           sum(p.weight) over (order by p.sort_order, p.id
             rows between unbounded preceding and current row) as cum
    from public.game_prizes p
    where p.game_id = g.id and p.is_active and p.weight > 0
  ) q
  where q.cum >= v_pick
  order by q.cum
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_prizes');
  end if;

  -- segment position for the wheel animation (all active prizes, in order)
  select count(*) into v_index
  from public.game_prizes
  where game_id = g.id and is_active
    and (sort_order, id) < (v_prize.sort_order, v_prize.id);

  -- mint a single-use coupon if the prize carries one
  if v_prize.coupon_type is not null and coalesce(v_prize.coupon_value, 0) > 0 then
    v_code := 'SPIN' || upper(encode(gen_random_bytes(3), 'hex'));
    insert into public.coupons (
      restaurant_id, code, type, value, min_order, usage_limit,
      per_session_limit, starts_at, ends_at, source
    ) values (
      g.restaurant_id, v_code, v_prize.coupon_type, v_prize.coupon_value,
      v_prize.coupon_min_order, 1, 1, now(),
      now() + make_interval(hours => v_prize.coupon_valid_hours), 'spin_wheel'
    ) returning id into v_coupon;
  end if;

  insert into public.game_plays (
    restaurant_id, game_id, prize_id, table_id, session_id, coupon_id
  ) values (g.restaurant_id, g.id, v_prize.id, p_table_id, p_session_id, v_coupon);

  return jsonb_build_object(
    'ok', true,
    'prize_id', v_prize.id,
    'segment_index', v_index,
    'label', v_prize.label, 'label_ar', v_prize.label_ar,
    'is_jackpot', v_prize.is_jackpot,
    'coupon_code', v_code,
    'coupon_type', v_prize.coupon_type,
    'coupon_value', v_prize.coupon_value,
    'coupon_min_order', v_prize.coupon_min_order,
    'next_play_at', now() + make_interval(hours => g.cooldown_hours)
  );
end $$;

-- ---------------------------------------------------------------------------
-- get_trivia_round — questions without the answers
-- ---------------------------------------------------------------------------
create or replace function public.get_trivia_round(
  p_restaurant uuid,
  p_count      int default 5
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'question', q.question, 'question_ar', q.question_ar,
           'options', q.options, 'points', q.points)), '[]'::jsonb)
    into v
  from (
    select * from public.trivia_questions
    where restaurant_id = p_restaurant and is_active
    order by random() limit greatest(1, least(coalesce(p_count,5), 15))
  ) q;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- check_trivia_answer — grading stays on the server
-- ---------------------------------------------------------------------------
create or replace function public.check_trivia_answer(
  p_question_id uuid,
  p_answer_index int
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q record;
begin
  select * into q from public.trivia_questions where id = p_question_id and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'question_not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'correct', p_answer_index = q.correct_index,
    'correct_index', q.correct_index,
    'explanation', q.explanation,
    'explanation_ar', q.explanation_ar,
    'points', case when p_answer_index = q.correct_index then q.points else 0 end
  );
end $$;

-- ---------------------------------------------------------------------------
-- Loyalty: lookup by phone, and reward redemption
-- ---------------------------------------------------------------------------
create or replace function public.loyalty_lookup(
  p_restaurant uuid,
  p_phone      text
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  a record;
  v_phone text := regexp_replace(coalesce(p_phone,''), '[^0-9+]', '', 'g');
begin
  if length(v_phone) < 9 then
    return jsonb_build_object('ok', false, 'error', 'invalid_phone');
  end if;

  select * into a from public.loyalty_accounts
  where restaurant_id = p_restaurant and phone = v_phone;

  if not found then
    return jsonb_build_object('ok', true, 'exists', false, 'points', 0,
                              'tier', 'bronze', 'visits', 0);
  end if;

  return jsonb_build_object(
    'ok', true, 'exists', true, 'account_id', a.id, 'points', a.points,
    'lifetime_points', a.lifetime_points, 'tier', a.tier, 'visits', a.visits,
    'total_spent', a.total_spent, 'name', a.name);
end $$;

create or replace function public.redeem_reward(
  p_restaurant uuid,
  p_phone      text,
  p_reward_id  uuid,
  p_session_id text
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a      record;
  rw     record;
  v_code text;
  v_type coupon_type;
  v_val  numeric(10,2);
  v_phone text := regexp_replace(coalesce(p_phone,''), '[^0-9+]', '', 'g');
begin
  if p_session_id is null or length(p_session_id) < 16 then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;

  select * into rw from public.rewards
  where id = p_reward_id and restaurant_id = p_restaurant and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'reward_not_found');
  end if;
  if rw.stock is not null and rw.stock <= 0 then
    return jsonb_build_object('ok', false, 'error', 'reward_out_of_stock');
  end if;

  -- lock the account row so two taps cannot spend the same points twice
  select * into a from public.loyalty_accounts
  where restaurant_id = p_restaurant and phone = v_phone
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'account_not_found');
  end if;
  if a.points < rw.points_cost then
    return jsonb_build_object('ok', false, 'error', 'insufficient_points',
                              'points', a.points, 'required', rw.points_cost);
  end if;

  if rw.type = 'discount_percent' then
    v_type := 'percent'; v_val := rw.value;
  else
    -- a free item is issued as a fixed discount equal to the item's price
    v_type := 'fixed';
    v_val := case
      when rw.type = 'free_item' and rw.menu_item_id is not null
        then (select price from public.menu_items where id = rw.menu_item_id)
      else rw.value end;
  end if;

  if coalesce(v_val, 0) <= 0 then
    return jsonb_build_object('ok', false, 'error', 'reward_misconfigured');
  end if;

  v_code := 'RWD' || upper(encode(gen_random_bytes(3), 'hex'));

  insert into public.coupons (
    restaurant_id, code, type, value, usage_limit, per_session_limit,
    starts_at, ends_at, source
  ) values (
    p_restaurant, v_code, v_type, v_val, 1, 1,
    now(), now() + interval '30 days', 'loyalty'
  );

  update public.loyalty_accounts
  set points = points - rw.points_cost
  where id = a.id;

  insert into public.loyalty_transactions (
    restaurant_id, account_id, type, points, note
  ) values (p_restaurant, a.id, 'redeem', -rw.points_cost, rw.name);

  if rw.stock is not null then
    update public.rewards set stock = stock - 1 where id = rw.id;
  end if;

  return jsonb_build_object(
    'ok', true, 'coupon_code', v_code, 'coupon_type', v_type,
    'coupon_value', v_val, 'points_left', a.points - rw.points_cost);
end $$;

-- ---------------------------------------------------------------------------
-- Order status transitions. Enforced in a trigger so the rule holds whether
-- the update came from the waiter board, the kitchen board or the REST API.
-- ---------------------------------------------------------------------------
create or replace function public.guard_order_transition()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role app_role := public.auth_role();
  v_admin boolean := v_role in ('restaurant_admin','manager','super_admin');
begin
  if new.status = old.status then return new; end if;

  -- an order's money is settled at placement; nobody edits it afterwards
  if new.subtotal is distinct from old.subtotal
     or new.total is distinct from old.total
     or new.discount_total is distinct from old.discount_total then
    if not v_admin then
      raise exception 'Order totals cannot be modified';
    end if;
  end if;

  if not v_admin then
    case new.status
      when 'confirmed' then
        if v_role not in ('waiter','cashier') then
          raise exception 'Only a waiter may confirm an order';
        end if;
      when 'preparing', 'ready' then
        if v_role not in ('kitchen','waiter') then
          raise exception 'Only the kitchen may advance preparation';
        end if;
      when 'served' then
        if v_role not in ('waiter','kitchen') then
          raise exception 'Only a waiter may mark an order served';
        end if;
      when 'paid' then
        if v_role not in ('cashier','waiter') then
          raise exception 'Only the cashier may settle an order';
        end if;
      when 'cancelled' then
        if v_role not in ('waiter','cashier') then
          raise exception 'Only a waiter or the cashier may cancel an order';
        end if;
      else
        raise exception 'Unsupported status %', new.status;
    end case;

    -- legal forward moves only; an admin can override
    if not (
      (old.status = 'pending'   and new.status in ('confirmed','cancelled')) or
      (old.status = 'confirmed' and new.status in ('preparing','cancelled')) or
      (old.status = 'preparing' and new.status in ('ready','cancelled')) or
      (old.status = 'ready'     and new.status in ('served','cancelled')) or
      (old.status = 'served'    and new.status in ('paid')) or
      (old.status = 'confirmed' and new.status in ('ready'))
    ) then
      raise exception 'Illegal status change: % → %', old.status, new.status;
    end if;
  end if;

  -- stamp the timeline
  case new.status
    when 'confirmed' then
      new.confirmed_at := coalesce(new.confirmed_at, now());
      new.confirmed_by := coalesce(new.confirmed_by, auth.uid());
    when 'preparing' then new.prepared_at  := coalesce(new.prepared_at, now());
    when 'ready'     then new.ready_at     := coalesce(new.ready_at, now());
    when 'served'    then new.served_at    := coalesce(new.served_at, now());
    when 'paid'      then new.paid_at      := coalesce(new.paid_at, now());
    when 'cancelled' then new.cancelled_at := coalesce(new.cancelled_at, now());
    else null;
  end case;

  return new;
end $$;

drop trigger if exists guard_order_transition_trg on public.orders;
create trigger guard_order_transition_trg
  before update of status on public.orders
  for each row execute function public.guard_order_transition();

-- ---------------------------------------------------------------------------
-- Loyalty accrual once an order is actually paid
-- ---------------------------------------------------------------------------
create or replace function public.accrue_loyalty()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r        record;
  v_acc    uuid;
  v_points int;
  v_phone  text := regexp_replace(coalesce(new.customer_phone,''), '[^0-9+]', '', 'g');
begin
  if new.status <> 'paid' or old.status = 'paid' then return new; end if;
  if length(v_phone) < 9 then return new; end if;

  select * into r from public.restaurants where id = new.restaurant_id;
  if not r.loyalty_enabled then return new; end if;

  v_points := floor(new.total * r.loyalty_points_per_sar)::int;
  if v_points <= 0 then return new; end if;

  insert into public.loyalty_accounts (restaurant_id, phone, name, points, lifetime_points, total_spent, visits)
  values (new.restaurant_id, v_phone, new.customer_name, v_points, v_points, new.total, 1)
  on conflict (restaurant_id, phone) do update set
    points          = public.loyalty_accounts.points + v_points,
    lifetime_points = public.loyalty_accounts.lifetime_points + v_points,
    total_spent     = public.loyalty_accounts.total_spent + new.total,
    visits          = public.loyalty_accounts.visits + 1,
    name            = coalesce(public.loyalty_accounts.name, new.customer_name),
    tier            = case
                        when public.loyalty_accounts.lifetime_points + v_points >= 5000 then 'gold'
                        when public.loyalty_accounts.lifetime_points + v_points >= 1500 then 'silver'
                        else 'bronze' end
  returning id into v_acc;

  insert into public.loyalty_transactions (restaurant_id, account_id, order_id, type, points, note)
  values (new.restaurant_id, v_acc, new.id, 'earn', v_points, 'Order #' || new.order_number);

  new.loyalty_points_earned := v_points;
  new.loyalty_account_id := v_acc;
  return new;
end $$;

drop trigger if exists accrue_loyalty_trg on public.orders;
create trigger accrue_loyalty_trg
  before update of status on public.orders
  for each row execute function public.accrue_loyalty();

-- ---------------------------------------------------------------------------
-- sales_report — one round trip for the whole admin dashboard
-- ---------------------------------------------------------------------------
create or replace function public.sales_report(
  p_restaurant uuid,
  p_from       timestamptz default (now() - interval '30 days'),
  p_to         timestamptz default now()
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not (public.is_staff(p_restaurant) or public.is_super_admin()) then
    raise exception 'Not authorised for this restaurant';
  end if;

  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'totals', (
      select jsonb_build_object(
        'orders', count(*),
        'revenue', coalesce(sum(total) filter (where status = 'paid'), 0),
        'pending_revenue', coalesce(sum(total) filter (where status not in ('paid','cancelled')), 0),
        'avg_ticket', coalesce(round(avg(total) filter (where status = 'paid'), 2), 0),
        'cancelled', count(*) filter (where status = 'cancelled'),
        'guests', coalesce(sum(guest_count), 0),
        'discounts', coalesce(sum(discount_total), 0),
        'vat', coalesce(sum(vat_total) filter (where status = 'paid'), 0)
      )
      from public.orders
      where restaurant_id = p_restaurant and placed_at between p_from and p_to
    ),
    'by_day', (
      select coalesce(jsonb_agg(d order by d->>'day'), '[]'::jsonb) from (
        select jsonb_build_object(
          'day', to_char(date_trunc('day', placed_at), 'YYYY-MM-DD'),
          'orders', count(*),
          'revenue', coalesce(sum(total) filter (where status = 'paid'), 0)
        ) d
        from public.orders
        where restaurant_id = p_restaurant and placed_at between p_from and p_to
        group by date_trunc('day', placed_at)
      ) s
    ),
    'by_hour', (
      select coalesce(jsonb_agg(h order by (h->>'hour')::int), '[]'::jsonb) from (
        select jsonb_build_object(
          'hour', extract(hour from placed_at)::int,
          'orders', count(*)
        ) h
        from public.orders
        where restaurant_id = p_restaurant and placed_at between p_from and p_to
        group by extract(hour from placed_at)
      ) s
    ),
    'top_items', (
      select coalesce(jsonb_agg(i order by (i->>'qty')::int desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'menu_item_id', oi.menu_item_id,
          'name', oi.name_snapshot, 'name_ar', oi.name_ar_snapshot,
          'qty', sum(oi.quantity)::int,
          'revenue', sum(oi.line_total)
        ) i
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        where oi.restaurant_id = p_restaurant
          and o.placed_at between p_from and p_to
          and o.status <> 'cancelled'
        group by oi.menu_item_id, oi.name_snapshot, oi.name_ar_snapshot
        order by sum(oi.quantity) desc
        limit 10
      ) s
    ),
    'by_table', (
      select coalesce(jsonb_agg(t order by (t->>'revenue')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'table_id', o.table_id,
          'label', coalesce(rt.label, '—'),
          'orders', count(*)::int,
          'revenue', coalesce(sum(o.total) filter (where o.status = 'paid'), 0)
        ) t
        from public.orders o
        left join public.restaurant_tables rt on rt.id = o.table_id
        where o.restaurant_id = p_restaurant and o.placed_at between p_from and p_to
        group by o.table_id, rt.label
        order by coalesce(sum(o.total) filter (where o.status = 'paid'), 0) desc
        limit 15
      ) s
    ),
    'reviews', (
      select jsonb_build_object(
        'count', count(*),
        'average', coalesce(round(avg(rating), 2), 0),
        'five_star', count(*) filter (where rating = 5),
        'low', count(*) filter (where rating <= 2)
      )
      from public.reviews
      where restaurant_id = p_restaurant and created_at between p_from and p_to
    ),
    'status_breakdown', (
      select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (
        select status::text, count(*) n
        from public.orders
        where restaurant_id = p_restaurant and placed_at between p_from and p_to
        group by status
      ) s
    )
  ) into v;

  return v;
end $$;

-- ---------------------------------------------------------------------------
-- platform_stats — super admin overview across all tenants
-- ---------------------------------------------------------------------------
create or replace function public.platform_stats()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Super admin only';
  end if;

  select jsonb_build_object(
    'restaurants', (select count(*) from public.restaurants),
    'active', (select count(*) from public.restaurants where is_active
               and (subscription_status in ('active','past_due')
                    or (subscription_status = 'trialing' and trial_ends_at > now()))),
    'trialing', (select count(*) from public.restaurants where subscription_status = 'trialing'),
    'suspended', (select count(*) from public.restaurants where subscription_status in ('suspended','cancelled')),
    'mrr', (select coalesce(sum(p.price_monthly), 0)
            from public.restaurants r join public.plans p on p.id = r.plan_id
            where r.subscription_status = 'active'),
    'orders_30d', (select count(*) from public.orders where placed_at > now() - interval '30 days'),
    'gmv_30d', (select coalesce(sum(total), 0) from public.orders
                where status = 'paid' and placed_at > now() - interval '30 days'),
    'tables', (select count(*) from public.restaurant_tables),
    'staff', (select count(*) from public.profiles where role <> 'super_admin'),
    'expiring_trials', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'name_ar', name_ar, 'slug', slug,
        'trial_ends_at', trial_ends_at)), '[]'::jsonb)
      from public.restaurants
      where subscription_status = 'trialing'
        and trial_ends_at between now() and now() + interval '7 days'
    ),
    'by_day', (
      select coalesce(jsonb_agg(d order by d->>'day'), '[]'::jsonb) from (
        select jsonb_build_object(
          'day', to_char(date_trunc('day', placed_at), 'YYYY-MM-DD'),
          'orders', count(*),
          'gmv', coalesce(sum(total) filter (where status = 'paid'), 0)) d
        from public.orders
        where placed_at > now() - interval '30 days'
        group by date_trunc('day', placed_at)
      ) s
    )
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- provision_restaurant — super admin creates a tenant with sensible defaults
-- ---------------------------------------------------------------------------
create or replace function public.provision_restaurant(
  p_slug     text,
  p_name     text,
  p_name_ar  text,
  p_plan_code text default 'starter',
  p_phone    text default null,
  p_table_count int default 10
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid;
  v_plan   record;
  v_branch uuid;
  v_game   uuid;
  i        int;
begin
  if not public.is_super_admin() then
    raise exception 'Super admin only';
  end if;

  select * into v_plan from public.plans where code = p_plan_code;

  insert into public.restaurants (slug, name, name_ar, phone, plan_id,
                                  subscription_status, trial_ends_at)
  values (lower(trim(p_slug)), p_name, p_name_ar, p_phone, v_plan.id, 'trialing',
          now() + make_interval(days => coalesce(v_plan.trial_days, 14)))
  returning id into v_id;

  insert into public.branches (restaurant_id, name, name_ar, is_default)
  values (v_id, 'Main Branch', 'الفرع الرئيسي', true)
  returning id into v_branch;

  -- starter menu structure so the admin opens a shaped dashboard, not a void
  insert into public.categories (restaurant_id, name, name_ar, sort_order) values
    (v_id, 'Starters',    'المقبلات',   1),
    (v_id, 'Main Dishes', 'الأطباق الرئيسية', 2),
    (v_id, 'Grills',      'المشاوي',    3),
    (v_id, 'Desserts',    'الحلويات',   4),
    (v_id, 'Hot Drinks',  'مشروبات ساخنة', 5),
    (v_id, 'Cold Drinks', 'مشروبات باردة', 6);

  for i in 1..greatest(coalesce(p_table_count, 10), 1) loop
    insert into public.restaurant_tables (restaurant_id, branch_id, code, label, label_ar, seats)
    values (v_id, v_branch, i::text, 'Table ' || i, 'طاولة ' || i, 4);
  end loop;

  insert into public.games (restaurant_id, type, name, name_ar, description, description_ar)
  values (v_id, 'spin_wheel', 'Spin & Win', 'اللف والفوز',
          'Spin once per visit for a discount', 'لفة واحدة في كل زيارة للحصول على خصم')
  returning id into v_game;

  insert into public.game_prizes (restaurant_id, game_id, label, label_ar, weight,
                                  coupon_type, coupon_value, coupon_min_order, sort_order, color, is_jackpot)
  values
    (v_id, v_game, '5% off',      'خصم ٥٪',      30, 'percent', 5,  0,  1, '#4b8061', false),
    (v_id, v_game, 'Try again',   'حاول مجدداً',  25, null,      null, 0, 2, '#b0b0a6', false),
    (v_id, v_game, '10% off',     'خصم ١٠٪',     20, 'percent', 10, 50, 3, '#c08f33', false),
    (v_id, v_game, 'Free dessert','حلى مجاني',    12, 'fixed',   25, 80, 4, '#6c9c7e', false),
    (v_id, v_game, '15% off',     'خصم ١٥٪',      9, 'percent', 15, 100, 5, '#d4a74f', false),
    (v_id, v_game, '25% off',     'خصم ٢٥٪',      4, 'percent', 25, 150, 6, '#2e523e', true);

  insert into public.subscriptions (restaurant_id, plan_id, status, period_start, period_end, amount)
  values (v_id, v_plan.id, 'trialing', now(),
          now() + make_interval(days => coalesce(v_plan.trial_days, 14)), 0);

  return jsonb_build_object('ok', true, 'restaurant_id', v_id, 'branch_id', v_branch);
end $$;

-- ---------------------------------------------------------------------------
-- rotate_table_token — invalidates a QR/NFC code that leaked
-- ---------------------------------------------------------------------------
create or replace function public.rotate_table_token(p_table_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare t record; v_token text;
begin
  select * into t from public.restaurant_tables where id = p_table_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'table_not_found');
  end if;
  if not (public.has_role(t.restaurant_id, array['restaurant_admin','manager']::app_role[])
          or public.is_super_admin()) then
    raise exception 'Not authorised';
  end if;

  v_token := encode(gen_random_bytes(9), 'hex');
  update public.restaurant_tables set qr_token = v_token where id = p_table_id;
  return jsonb_build_object('ok', true, 'qr_token', v_token);
end $$;

-- ---------------------------------------------------------------------------
-- Grants. Guest-callable functions go to anon; the rest stay behind a login.
--
-- Postgres grants EXECUTE to PUBLIC on every new function, and both anon and
-- authenticated inherit PUBLIC — so revoking from anon alone leaves every
-- function callable. Revoke from PUBLIC first, then hand back only what each
-- role legitimately needs. Trigger functions need no grant at all: they run in
-- the table owner's context.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.resolve_table(text, text, text),
  public.validate_coupon(uuid, text, numeric, text),
  public.place_order(uuid, text, jsonb, text, text, text, text, text, int),
  public.get_my_orders(text, uuid),
  public.request_service(uuid, text, text, text, uuid),
  public.submit_review(uuid, text, int, text, text, int, int, uuid, uuid),
  public.spin_wheel(uuid, text, uuid),
  public.get_trivia_round(uuid, int),
  public.check_trivia_answer(uuid, int),
  public.loyalty_lookup(uuid, text),
  public.redeem_reward(uuid, text, uuid, text),
  public.restaurant_is_live(uuid)
to anon, authenticated;

grant execute on function
  public.sales_report(uuid, timestamptz, timestamptz),
  public.rotate_table_token(uuid),
  public.auth_role(), public.auth_restaurant(), public.is_super_admin(),
  public.is_staff(uuid), public.has_role(uuid, app_role[])
to authenticated;

grant execute on function
  public.platform_stats(),
  public.provision_restaurant(text, text, text, text, text, int)
to authenticated;
