-- ============================================================================
-- Migration 0004: platform data + one demo tenant
--
-- The `plans` rows are real platform configuration — keep them and edit the
-- pricing to match what you actually sell.
--
-- Everything below the DEMO TENANT banner exists so you can click through the
-- whole system before onboarding a paying restaurant. It is not wired into any
-- code path: delete the demo restaurant and every row cascades away.
--     delete from public.restaurants where slug = 'najd-grill';
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Pricing plans
-- ---------------------------------------------------------------------------
insert into public.plans (code, name, name_ar, price_monthly, price_yearly,
                          max_branches, max_tables, max_menu_items, max_staff,
                          trial_days, sort_order, features)
values
  ('starter', 'Starter', 'الأساسية', 199, 1990, 1, 15, 80, 6, 14, 1,
   '{"qr":true,"nfc":true,"orders":true,"loyalty":false,"games":false,"analytics":"basic","branches":1}'),
  ('growth', 'Growth', 'النمو', 399, 3990, 2, 50, 300, 20, 14, 2,
   '{"qr":true,"nfc":true,"orders":true,"loyalty":true,"games":true,"analytics":"full","branches":2}'),
  ('pro', 'Pro', 'الاحترافية', 749, 7490, 10, 200, 1000, 100, 30, 3,
   '{"qr":true,"nfc":true,"orders":true,"loyalty":true,"games":true,"analytics":"full","api":true,"priority_support":true,"branches":10}')
on conflict (code) do update set
  name = excluded.name, name_ar = excluded.name_ar,
  price_monthly = excluded.price_monthly, price_yearly = excluded.price_yearly,
  max_branches = excluded.max_branches, max_tables = excluded.max_tables,
  max_menu_items = excluded.max_menu_items, max_staff = excluded.max_staff,
  features = excluded.features;

-- ===========================================================================
-- DEMO TENANT — safe to delete
-- ===========================================================================
do $$
declare
  v_r      uuid;
  v_branch uuid;
  v_plan   uuid;
  v_cat_mezze uuid; v_cat_grill uuid; v_cat_rice uuid;
  v_cat_dessert uuid; v_cat_hot uuid; v_cat_cold uuid;
  v_item   uuid;
  v_grp    uuid;
  v_game   uuid;
  i int;
begin
  if exists (select 1 from public.restaurants where slug = 'najd-grill') then
    raise notice 'Demo tenant already present, skipping.';
    return;
  end if;

  select id into v_plan from public.plans where code = 'growth';

  insert into public.restaurants (
    slug, name, name_ar, tagline, tagline_ar, description, description_ar,
    phone, whatsapp, instagram_url, tiktok_url, snapchat_url,
    google_maps_url, google_reviews_url, address, address_ar,
    vat_number, cr_number, plan_id, subscription_status, trial_ends_at,
    default_locale, primary_color, loyalty_points_per_sar
  ) values (
    'najd-grill', 'Najd Grill', 'مشاوي نجد',
    'Charcoal grills & Najdi classics', 'مشاوي الفحم والأطباق النجدية',
    'A family grill house in Riyadh serving charcoal-fired meats and Najdi home cooking since 2009.',
    'بيت مشاوي عائلي في الرياض يقدم اللحوم على الفحم والأكل النجدي البيتي منذ ٢٠٠٩.',
    '+966112345678', '+966501234567',
    'https://instagram.com/najdgrill', 'https://tiktok.com/@najdgrill',
    'https://snapchat.com/add/najdgrill',
    'https://maps.google.com/?q=24.7136,46.6753',
    'https://search.google.com/local/writereview?placeid=DEMO_PLACE_ID',
    'King Fahd Road, Al Olaya, Riyadh 12211',
    'طريق الملك فهد، العليا، الرياض ١٢٢١١',
    '300123456700003', '1010123456', v_plan, 'active', now() + interval '365 days',
    'ar', '#2e523e', 1
  ) returning id into v_r;

  insert into public.branches (restaurant_id, name, name_ar, address, address_ar,
                               phone, opens_at, closes_at, is_default)
  values (v_r, 'Al Olaya', 'العليا', 'King Fahd Road, Al Olaya, Riyadh',
          'طريق الملك فهد، العليا، الرياض', '+966112345678', '12:00', '02:00', true)
  returning id into v_branch;

  -- ---- categories --------------------------------------------------------
  insert into public.categories (restaurant_id, name, name_ar, sort_order) values
    (v_r, 'Mezze & Starters', 'المقبلات', 1) returning id into v_cat_mezze;
  insert into public.categories (restaurant_id, name, name_ar, sort_order) values
    (v_r, 'From the Charcoal', 'من الفحم', 2) returning id into v_cat_grill;
  insert into public.categories (restaurant_id, name, name_ar, sort_order) values
    (v_r, 'Rice & Mains', 'الأرز والأطباق الرئيسية', 3) returning id into v_cat_rice;
  insert into public.categories (restaurant_id, name, name_ar, sort_order) values
    (v_r, 'Desserts', 'الحلويات', 4) returning id into v_cat_dessert;
  insert into public.categories (restaurant_id, name, name_ar, sort_order) values
    (v_r, 'Hot Drinks', 'مشروبات ساخنة', 5) returning id into v_cat_hot;
  insert into public.categories (restaurant_id, name, name_ar, sort_order) values
    (v_r, 'Cold Drinks', 'مشروبات باردة', 6) returning id into v_cat_cold;

  -- ---- menu items --------------------------------------------------------
  insert into public.menu_items (restaurant_id, category_id, name, name_ar,
      description, description_ar, price, compare_at_price, prep_minutes,
      calories, spice_level, tags, is_popular, is_featured, sort_order) values
    (v_r, v_cat_mezze, 'Hummus Beiruti', 'حمص بيروتي',
     'Chickpeas whipped with tahini, lemon and chilli, finished with olive oil',
     'حمص مخفوق مع الطحينة والليمون والفلفل، ويُقدم بزيت الزيتون', 19, null, 7, 320, 1,
     array['vegetarian'], true, false, 1),
    (v_r, v_cat_mezze, 'Mutabbal', 'متبل',
     'Smoked aubergine with tahini and garlic',
     'باذنجان مشوي على الفحم مع الطحينة والثوم', 21, null, 8, 280, 0,
     array['vegetarian','smoky'], false, false, 2),
    (v_r, v_cat_mezze, 'Fattoush', 'فتوش',
     'Garden greens, sumac dressing, crisp bread',
     'خضار طازجة مع دبس الرمان والسماق وخبز مقرمش', 24, null, 6, 210, 0,
     array['vegetarian','fresh'], false, false, 3),
    (v_r, v_cat_mezze, 'Grilled Halloumi', 'حلوم مشوي',
     'Cypriot halloumi off the charcoal with tomato and mint',
     'حلوم قبرصي على الفحم مع الطماطم والنعنع', 29, 34, 9, 390, 0,
     array['vegetarian'], true, false, 4),
    (v_r, v_cat_grill, 'Lamb Kebab', 'كباب لحم',
     'Hand-minced lamb, onion and parsley, charcoal grilled',
     'لحم غنم مفروم يدوياً مع البصل والبقدونس على الفحم', 62, null, 18, 640, 1,
     array['signature'], true, true, 1),
    (v_r, v_cat_grill, 'Shish Tawook', 'شيش طاووق',
     'Yoghurt and garlic marinated chicken skewers',
     'أسياخ دجاج متبلة بالزبادي والثوم', 54, null, 16, 520, 0,
     array['signature'], true, false, 2),
    (v_r, v_cat_grill, 'Mixed Grill Platter', 'مشاوي مشكلة',
     'Kebab, tawook and lamb chops for two, with grilled vegetables',
     'كباب وطاووق وريش غنم لشخصين مع خضار مشوية', 169, 195, 28, 1480, 1,
     array['sharing','signature'], true, true, 3),
    (v_r, v_cat_grill, 'Lamb Chops', 'ريش غنم',
     'Four chops, rosemary and sea salt',
     'أربع قطع ريش مع إكليل الجبل وملح البحر', 98, null, 22, 780, 0,
     array['premium'], false, true, 4),
    (v_r, v_cat_rice, 'Chicken Kabsa', 'كبسة دجاج',
     'Half chicken on spiced rice with raisins and almonds',
     'نصف دجاجة على أرز بالبهارات مع الزبيب واللوز', 58, null, 20, 920, 1,
     array['saudi','signature'], true, true, 1),
    (v_r, v_cat_rice, 'Lamb Mandi', 'مندي لحم',
     'Slow-cooked lamb shoulder, smoked rice',
     'كتف غنم مطهو ببطء مع الأرز المدخن', 89, null, 25, 1100, 0,
     array['saudi','signature'], true, false, 2),
    (v_r, v_cat_rice, 'Jareesh', 'جريش',
     'Crushed wheat simmered with laban and caramelised onion',
     'جريش مطهو باللبن والبصل المحمر', 42, null, 15, 560, 0,
     array['saudi','comfort'], false, false, 3),
    (v_r, v_cat_dessert, 'Kunafa Nabulsia', 'كنافة نابلسية',
     'Shredded pastry, sweet cheese, pistachio',
     'كنافة بالجبنة الحلوة والفستق', 32, null, 10, 610, 0,
     array['hot'], true, false, 1),
    (v_r, v_cat_dessert, 'Date Pudding', 'حلى التمر',
     'Sukkari dates, cream, toasted sesame',
     'تمر سكري مع الكريمة والسمسم المحمص', 28, null, 5, 480, 0,
     array['saudi'], false, false, 2),
    (v_r, v_cat_hot, 'Saudi Coffee', 'قهوة سعودية',
     'Cardamom and saffron, served with dates',
     'بالهيل والزعفران وتُقدم مع التمر', 16, null, 4, 15, 0,
     array['saudi'], true, false, 1),
    (v_r, v_cat_hot, 'Mint Tea', 'شاي بالنعناع',
     'Loose leaf tea with fresh mint', 'شاي ورق مع النعناع الطازج', 12, null, 4, 25, 0,
     array[]::text[], false, false, 2),
    (v_r, v_cat_cold, 'Fresh Lemon & Mint', 'ليمون بالنعناع',
     'Blended fresh', 'مخفوق طازج', 18, null, 4, 120, 0, array[]::text[], true, false, 1),
    (v_r, v_cat_cold, 'Laban', 'لبن',
     'Chilled salted yoghurt drink', 'لبن مملح مبرد', 10, null, 2, 90, 0,
     array['saudi'], false, false, 2),
    (v_r, v_cat_cold, 'Soft Drink', 'مشروب غازي',
     'Choice of can', 'حسب الاختيار', 8, null, 1, 140, 0, array[]::text[], false, false, 3);

  -- ---- modifiers on the mixed grill and the kabsa ------------------------
  select id into v_item from public.menu_items
  where restaurant_id = v_r and name = 'Mixed Grill Platter';

  insert into public.modifier_groups (restaurant_id, menu_item_id, name, name_ar,
      min_select, max_select, is_required, sort_order)
  values (v_r, v_item, 'Choose your side', 'اختر الطبق الجانبي', 1, 1, true, 1)
  returning id into v_grp;
  insert into public.modifier_options (restaurant_id, group_id, name, name_ar, price_delta, is_default, sort_order) values
    (v_r, v_grp, 'Saffron rice', 'أرز بالزعفران', 0, true, 1),
    (v_r, v_grp, 'Grilled vegetables', 'خضار مشوية', 0, false, 2),
    (v_r, v_grp, 'French fries', 'بطاطس مقلية', 5, false, 3),
    (v_r, v_grp, 'Arabic bread', 'خبز عربي', 0, false, 4);

  insert into public.modifier_groups (restaurant_id, menu_item_id, name, name_ar,
      min_select, max_select, is_required, sort_order)
  values (v_r, v_item, 'Extras', 'إضافات', 0, 4, false, 2)
  returning id into v_grp;
  insert into public.modifier_options (restaurant_id, group_id, name, name_ar, price_delta, sort_order) values
    (v_r, v_grp, 'Extra kebab skewer', 'سيخ كباب إضافي', 28, 1),
    (v_r, v_grp, 'Garlic sauce', 'صلصة ثوم', 4, 2),
    (v_r, v_grp, 'Chilli sauce', 'صلصة حارة', 4, 3),
    (v_r, v_grp, 'Extra bread basket', 'سلة خبز إضافية', 6, 4);

  select id into v_item from public.menu_items
  where restaurant_id = v_r and name = 'Chicken Kabsa';

  insert into public.modifier_groups (restaurant_id, menu_item_id, name, name_ar,
      min_select, max_select, is_required, sort_order)
  values (v_r, v_item, 'Spice level', 'درجة الحرارة', 1, 1, true, 1)
  returning id into v_grp;
  insert into public.modifier_options (restaurant_id, group_id, name, name_ar, price_delta, is_default, sort_order) values
    (v_r, v_grp, 'Mild', 'خفيف', 0, true, 1),
    (v_r, v_grp, 'Medium', 'وسط', 0, false, 2),
    (v_r, v_grp, 'Hot', 'حار', 0, false, 3);

  insert into public.modifier_groups (restaurant_id, menu_item_id, name, name_ar,
      min_select, max_select, is_required, sort_order)
  values (v_r, v_item, 'Add on', 'إضافات', 0, 3, false, 2)
  returning id into v_grp;
  insert into public.modifier_options (restaurant_id, group_id, name, name_ar, price_delta, sort_order) values
    (v_r, v_grp, 'Extra rice', 'أرز إضافي', 12, 1),
    (v_r, v_grp, 'Grilled tomato salsa', 'صلصة طماطم مشوية', 6, 2),
    (v_r, v_grp, 'Boiled egg', 'بيض مسلوق', 5, 3);

  -- ---- tables -------------------------------------------------------------
  for i in 1..12 loop
    insert into public.restaurant_tables (restaurant_id, branch_id, code, label, label_ar, seats, zone)
    values (v_r, v_branch, i::text, 'Table ' || i, 'طاولة ' || i,
            case when i <= 8 then 4 else 6 end,
            case when i <= 6 then 'Indoor' when i <= 10 then 'Terrace' else 'Family' end);
  end loop;

  -- ---- coupons + promotions ----------------------------------------------
  insert into public.coupons (restaurant_id, code, type, value, min_order, usage_limit, ends_at)
  values
    (v_r, 'WELCOME10', 'percent', 10, 50, 500, now() + interval '90 days'),
    (v_r, 'FAMILY25', 'fixed', 25, 200, 200, now() + interval '60 days');

  insert into public.promotions (restaurant_id, title, title_ar, subtitle, subtitle_ar, sort_order)
  values
    (v_r, 'Mixed Grill for two — 169 SAR', 'مشاوي مشكلة لشخصين — ١٦٩ ريال',
     'Kebab, tawook and lamb chops with grilled vegetables',
     'كباب وطاووق وريش مع خضار مشوية', 1),
    (v_r, '10% off your first order', 'خصم ١٠٪ على أول طلب',
     'Use code WELCOME10 at checkout', 'استخدم كود WELCOME10 عند الطلب', 2);

  -- ---- loyalty rewards ----------------------------------------------------
  insert into public.rewards (restaurant_id, name, name_ar, description, description_ar,
                              points_cost, type, value, sort_order) values
    (v_r, 'Free Saudi coffee', 'قهوة سعودية مجاناً', 'Redeem with any order',
     'استبدلها مع أي طلب', 150, 'discount_fixed', 16, 1),
    (v_r, '10% off', 'خصم ١٠٪', 'On your next visit', 'في زيارتك القادمة',
     400, 'discount_percent', 10, 2),
    (v_r, 'Free dessert', 'حلى مجاني', 'Kunafa or date pudding',
     'كنافة أو حلى تمر', 700, 'discount_fixed', 32, 3),
    (v_r, '25% off the bill', 'خصم ٢٥٪ على الفاتورة', 'Gold members',
     'لأعضاء الفئة الذهبية', 1800, 'discount_percent', 25, 4);

  -- ---- games --------------------------------------------------------------
  insert into public.games (restaurant_id, type, name, name_ar, description, description_ar, cooldown_hours)
  values (v_r, 'spin_wheel', 'Spin & Win', 'اللف والفوز',
          'One spin per visit — win a discount on today''s bill',
          'لفة واحدة في كل زيارة — اربح خصماً على فاتورة اليوم', 12)
  returning id into v_game;

  insert into public.game_prizes (restaurant_id, game_id, label, label_ar, weight,
      coupon_type, coupon_value, coupon_min_order, coupon_valid_hours, sort_order, color, is_jackpot) values
    (v_r, v_game, '5% off', 'خصم ٥٪', 30, 'percent', 5, 0, 6, 1, '#4b8061', false),
    (v_r, v_game, 'Try again', 'حاول مجدداً', 24, null, null, 0, 6, 2, '#b0b0a6', false),
    (v_r, v_game, 'Free Saudi coffee', 'قهوة سعودية مجاناً', 16, 'fixed', 16, 60, 6, 3, '#6c9c7e', false),
    (v_r, v_game, '10% off', 'خصم ١٠٪', 15, 'percent', 10, 80, 6, 4, '#c08f33', false),
    (v_r, v_game, 'Free dessert', 'حلى مجاني', 10, 'fixed', 32, 120, 6, 5, '#d4a74f', false),
    (v_r, v_game, '25% off', 'خصم ٢٥٪', 5, 'percent', 25, 200, 6, 6, '#2e523e', true);

  insert into public.games (restaurant_id, type, name, name_ar, description, description_ar, cooldown_hours)
  values (v_r, 'trivia', 'Food Trivia', 'تحدي الطعام',
          'Five questions while your order is cooking',
          'خمسة أسئلة أثناء تحضير طلبك', 2)
  returning id into v_game;

  insert into public.trivia_questions (restaurant_id, game_id, question, question_ar,
      options, correct_index, explanation, explanation_ar, points) values
    (v_r, v_game,
     'Which spice gives kabsa its golden colour?', 'أي بهار يعطي الكبسة لونها الذهبي؟',
     '[{"en":"Saffron","ar":"الزعفران"},{"en":"Paprika","ar":"البابريكا"},{"en":"Turmeric","ar":"الكركم"},{"en":"Cumin","ar":"الكمون"}]',
     0, 'Saffron threads are steeped in the cooking liquid.',
     'خيوط الزعفران تُنقع في ماء الطهي.', 10),
    (v_r, v_game,
     'Mandi rice gets its flavour from what cooking method?', 'من أي طريقة طهي يستمد المندي طعمه؟',
     '[{"en":"Steaming","ar":"البخار"},{"en":"An underground oven","ar":"التنور الأرضي"},{"en":"Deep frying","ar":"القلي العميق"},{"en":"Grilling","ar":"الشوي"}]',
     1, 'Mandi is traditionally cooked in a pit oven called a taboon.',
     'يُطهى المندي تقليدياً في حفرة تُسمى التنور.', 10),
    (v_r, v_game,
     'Which date variety is prized for its soft caramel sweetness?', 'أي نوع من التمر يشتهر بحلاوته الكرميلية الطرية؟',
     '[{"en":"Khalas","ar":"الخلاص"},{"en":"Sukkari","ar":"السكري"},{"en":"Ajwa","ar":"العجوة"},{"en":"Safawi","ar":"الصفاوي"}]',
     1, 'Sukkari means "sugary" — it is grown mainly around Al Qassim.',
     'السكري يعني الحلو، ويُزرع أساساً في منطقة القصيم.', 10),
    (v_r, v_game,
     'What is jareesh made from?', 'من أي شيء يُصنع الجريش؟',
     '[{"en":"Crushed wheat","ar":"الحنطة المجروشة"},{"en":"Rice","ar":"الأرز"},{"en":"Lentils","ar":"العدس"},{"en":"Barley flour","ar":"دقيق الشعير"}]',
     0, 'Coarsely crushed wheat, simmered slowly with laban.',
     'حنطة مجروشة تُطهى ببطء مع اللبن.', 10),
    (v_r, v_game,
     'Saudi coffee is traditionally flavoured with which spice?', 'بأي بهار تُطيب القهوة السعودية تقليدياً؟',
     '[{"en":"Cinnamon","ar":"القرفة"},{"en":"Cardamom","ar":"الهيل"},{"en":"Clove","ar":"القرنفل"},{"en":"Anise","ar":"اليانسون"}]',
     1, 'Cardamom, often with a thread of saffron.',
     'الهيل، وغالباً مع خيط من الزعفران.', 10);

  -- ---- a couple of published reviews so the reviews screen is not empty ---
  insert into public.reviews (restaurant_id, session_id, rating, food_rating,
                              service_rating, comment, customer_name) values
    (v_r, 'seed-review-session-0001', 5, 5, 5,
     'The mixed grill was excellent and the kabsa rice was perfectly spiced.', 'Abdullah'),
    (v_r, 'seed-review-session-0002', 4, 5, 4,
     'Great food, the terrace gets busy on weekends.', 'Sara');

  raise notice 'Demo tenant ready: /r/najd-grill — tables 1..12';
end $$;

-- ---------------------------------------------------------------------------
-- After running these migrations, create your accounts:
--
-- 1. Super admin — in Supabase Dashboard → Authentication → Users → Add user,
--    then run:
--      insert into public.profiles (id, restaurant_id, full_name, role)
--      values ('<auth-user-uuid>', null, 'Platform Owner', 'super_admin')
--      on conflict (id) do update
--        set role = 'super_admin', restaurant_id = null;
--
-- 2. Demo restaurant admin — add another auth user, then:
--      insert into public.profiles (id, restaurant_id, full_name, role)
--      select '<auth-user-uuid>', id, 'Najd Grill Owner', 'restaurant_admin'
--      from public.restaurants where slug = 'najd-grill'
--      on conflict (id) do update
--        set role = 'restaurant_admin',
--            restaurant_id = excluded.restaurant_id;
--
--    Thereafter staff are invited from the admin dashboard's Staff screen,
--    which sets role and restaurant_id in the invite metadata so the
--    handle_new_user trigger provisions the profile automatically.
-- ---------------------------------------------------------------------------
