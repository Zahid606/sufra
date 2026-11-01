export type AppRole =
  | 'super_admin'
  | 'restaurant_admin'
  | 'manager'
  | 'waiter'
  | 'kitchen'
  | 'cashier';

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'served'
  | 'paid'
  | 'cancelled';

export type ServiceRequestType = 'waiter' | 'bill' | 'water' | 'cleaning' | 'cutlery';
export type ServiceRequestStatus = 'open' | 'acknowledged' | 'resolved';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled';
export type CouponType = 'percent' | 'fixed';
export type GameType = 'spin_wheel' | 'trivia';
export type RewardType = 'discount_percent' | 'discount_fixed' | 'free_item';

export interface Plan {
  id: string;
  code: string;
  name: string;
  name_ar: string;
  price_monthly: number;
  price_yearly: number;
  currency: string;
  max_branches: number;
  max_tables: number;
  max_menu_items: number;
  max_staff: number;
  trial_days: number;
  features: Record<string, unknown>;
  sort_order: number;
  is_active: boolean;
}

export interface Restaurant {
  id: string;
  slug: string;
  name: string;
  name_ar: string;
  tagline: string | null;
  tagline_ar: string | null;
  description: string | null;
  description_ar: string | null;
  logo_url: string | null;
  cover_url: string | null;
  phone: string | null;
  whatsapp: string | null;
  email?: string | null;
  instagram_url: string | null;
  tiktok_url: string | null;
  snapchat_url: string | null;
  x_url: string | null;
  google_maps_url: string | null;
  google_reviews_url: string | null;
  address: string | null;
  address_ar: string | null;
  currency: string;
  vat_rate: number;
  prices_include_vat: boolean;
  vat_number?: string | null;
  cr_number?: string | null;
  service_charge_rate: number;
  default_locale: 'ar' | 'en';
  primary_color: string;
  requires_waiter_confirmation: boolean;
  allow_customer_notes: boolean;
  loyalty_enabled: boolean;
  loyalty_points_per_sar: number;
  games_enabled: boolean;
  reviews_enabled: boolean;
  plan_id?: string | null;
  subscription_status?: SubscriptionStatus;
  trial_ends_at?: string;
  current_period_end?: string | null;
  is_active?: boolean;
  created_at?: string;
}

export interface Branch {
  id: string;
  restaurant_id: string;
  name: string;
  name_ar: string;
  address: string | null;
  address_ar: string | null;
  phone: string | null;
  opens_at: string | null;
  closes_at: string | null;
  is_default: boolean;
  is_active: boolean;
}

export interface Profile {
  id: string;
  restaurant_id: string | null;
  branch_id: string | null;
  full_name: string;
  phone: string | null;
  role: AppRole;
  avatar_url: string | null;
  is_active: boolean;
  last_seen_at: string | null;
  created_at?: string;
}

export interface Category {
  id: string;
  restaurant_id: string;
  name: string;
  name_ar: string;
  description: string | null;
  description_ar: string | null;
  image_url: string | null;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface MenuItem {
  id: string;
  restaurant_id: string;
  category_id: string | null;
  name: string;
  name_ar: string;
  description: string | null;
  description_ar: string | null;
  price: number;
  compare_at_price: number | null;
  image_url: string | null;
  calories: number | null;
  prep_minutes: number | null;
  spice_level: number | null;
  allergens: string[];
  tags: string[];
  is_available: boolean;
  is_popular: boolean;
  is_featured: boolean;
  sort_order: number;
}

export interface ModifierOption {
  id: string;
  group_id: string;
  name: string;
  name_ar: string;
  price_delta: number;
  is_available: boolean;
  is_default: boolean;
  sort_order: number;
}

export interface ModifierGroup {
  id: string;
  menu_item_id: string;
  name: string;
  name_ar: string;
  min_select: number;
  max_select: number;
  is_required: boolean;
  sort_order: number;
  modifier_options?: ModifierOption[];
}

export interface RestaurantTable {
  id: string;
  restaurant_id: string;
  branch_id: string | null;
  code: string;
  label: string;
  label_ar: string | null;
  zone: string | null;
  seats: number;
  qr_token: string;
  is_active: boolean;
}

export interface Promotion {
  id: string;
  restaurant_id: string;
  title: string;
  title_ar: string;
  subtitle: string | null;
  subtitle_ar: string | null;
  image_url: string | null;
  menu_item_id: string | null;
  starts_at: string;
  ends_at: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface Coupon {
  id: string;
  restaurant_id: string;
  code: string;
  type: CouponType;
  value: number;
  min_order: number;
  max_discount: number | null;
  usage_limit: number | null;
  used_count: number;
  per_session_limit: number;
  starts_at: string;
  ends_at: string | null;
  source: string;
  is_active: boolean;
}

export interface OrderItemModifier {
  option_id: string;
  group_id: string;
  name: string;
  name_ar: string;
  price_delta: number;
}

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  name_snapshot: string;
  name_ar_snapshot: string;
  unit_price: number;
  quantity: number;
  modifiers: OrderItemModifier[];
  modifiers_total: number;
  line_total: number;
  notes: string | null;
  created_at: string;
}

export interface Order {
  id: string;
  restaurant_id: string;
  branch_id: string | null;
  table_id: string | null;
  order_number: number;
  status: OrderStatus;
  session_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  guest_count: number | null;
  notes: string | null;
  subtotal: number;
  discount_total: number;
  service_charge: number;
  vat_total: number;
  total: number;
  coupon_code: string | null;
  loyalty_points_earned: number;
  confirmed_by: string | null;
  confirmed_at: string | null;
  prepared_at: string | null;
  ready_at: string | null;
  served_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  placed_at: string;
  order_items?: OrderItem[];
  restaurant_tables?: { label: string; code: string } | null;
}

export interface ServiceRequest {
  id: string;
  restaurant_id: string;
  table_id: string | null;
  order_id: string | null;
  session_id: string;
  type: ServiceRequestType;
  status: ServiceRequestStatus;
  note: string | null;
  handled_by: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  created_at: string;
  restaurant_tables?: { label: string; code: string } | null;
}

export interface Review {
  id: string;
  restaurant_id: string;
  order_id: string | null;
  rating: number;
  food_rating: number | null;
  service_rating: number | null;
  comment: string | null;
  customer_name: string | null;
  is_published: boolean;
  reply: string | null;
  replied_at: string | null;
  created_at: string;
}

export interface Reward {
  id: string;
  restaurant_id: string;
  name: string;
  name_ar: string;
  description: string | null;
  description_ar: string | null;
  image_url: string | null;
  points_cost: number;
  type: RewardType;
  value: number;
  menu_item_id: string | null;
  stock: number | null;
  sort_order: number;
  is_active: boolean;
}

export interface Game {
  id: string;
  restaurant_id: string;
  type: GameType;
  name: string;
  name_ar: string;
  description: string | null;
  description_ar: string | null;
  cooldown_hours: number;
  is_active: boolean;
}

export interface GamePrize {
  id: string;
  game_id: string;
  label: string;
  label_ar: string;
  weight: number;
  coupon_type: CouponType | null;
  coupon_value: number | null;
  coupon_min_order: number;
  is_jackpot: boolean;
  color: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface TriviaQuestion {
  id: string;
  question: string;
  question_ar: string;
  options: { en: string; ar: string }[];
  points: number;
}

/* ---------- RPC payloads ---------- */

export interface ResolveTableOk {
  ok: true;
  restaurant: Restaurant;
  table: {
    id: string;
    code: string;
    label: string;
    label_ar: string | null;
    zone: string | null;
    seats: number;
    branch_id: string | null;
  };
}

export interface RpcError {
  ok: false;
  error: string;
  [key: string]: unknown;
}

export type ResolveTableResult = ResolveTableOk | RpcError;

export interface PlaceOrderOk {
  ok: true;
  duplicate: boolean;
  order_id: string;
  order_number: number;
  status: OrderStatus;
  subtotal?: number;
  discount_total?: number;
  service_charge?: number;
  vat_total?: number;
  total: number;
  item_count?: number;
  requires_confirmation?: boolean;
}

export type PlaceOrderResult = PlaceOrderOk | RpcError;

export interface CouponQuoteOk {
  ok: true;
  coupon_id: string;
  code: string;
  type: CouponType;
  value: number;
  discount: number;
}

export type CouponQuote = CouponQuoteOk | RpcError;

export interface SpinResultOk {
  ok: true;
  prize_id: string;
  segment_index: number;
  label: string;
  label_ar: string;
  is_jackpot: boolean;
  coupon_code: string | null;
  coupon_type: CouponType | null;
  coupon_value: number | null;
  coupon_min_order: number;
  next_play_at: string;
}

export type SpinResult = SpinResultOk | RpcError;

export interface LoyaltyInfo {
  ok: true;
  exists: boolean;
  account_id?: string;
  points: number;
  lifetime_points?: number;
  tier: string;
  visits: number;
  total_spent?: number;
  name?: string | null;
}

export interface GuestOrder {
  id: string;
  order_number: number;
  status: OrderStatus;
  table_id: string | null;
  restaurant_id: string;
  subtotal: number;
  discount_total: number;
  service_charge: number;
  vat_total: number;
  total: number;
  coupon_code: string | null;
  notes: string | null;
  placed_at: string;
  confirmed_at: string | null;
  ready_at: string | null;
  served_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  loyalty_points_earned: number;
  table_label: string | null;
  table_code: string | null;
  items: {
    id: string;
    name: string;
    name_ar: string;
    quantity: number;
    unit_price: number;
    modifiers: OrderItemModifier[];
    line_total: number;
    notes: string | null;
  }[];
}

export interface SalesReport {
  range: { from: string; to: string };
  totals: {
    orders: number;
    revenue: number;
    pending_revenue: number;
    avg_ticket: number;
    cancelled: number;
    guests: number;
    discounts: number;
    vat: number;
  };
  by_day: { day: string; orders: number; revenue: number }[];
  by_hour: { hour: number; orders: number }[];
  top_items: {
    menu_item_id: string | null;
    name: string;
    name_ar: string;
    qty: number;
    revenue: number;
  }[];
  by_table: { table_id: string | null; label: string; orders: number; revenue: number }[];
  reviews: { count: number; average: number; five_star: number; low: number };
  status_breakdown: Partial<Record<OrderStatus, number>>;
}

export interface PlatformStats {
  restaurants: number;
  active: number;
  trialing: number;
  suspended: number;
  mrr: number;
  orders_30d: number;
  gmv_30d: number;
  tables: number;
  staff: number;
  expiring_trials: {
    id: string;
    name: string;
    name_ar: string;
    slug: string;
    trial_ends_at: string;
  }[];
  by_day: { day: string; orders: number; gmv: number }[];
}

/* ---------- client-side cart ---------- */

export interface CartLine {
  /** stable key for this exact configuration of item + options */
  key: string;
  menuItemId: string;
  name: string;
  nameAr: string;
  imageUrl: string | null;
  basePrice: number;
  quantity: number;
  options: { id: string; groupId: string; name: string; nameAr: string; priceDelta: number }[];
  notes: string | null;
}
