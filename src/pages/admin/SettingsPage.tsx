import { useEffect, useState } from 'react';
import { useLocale } from '@/lib/useLocale';
import { useAuth } from '@/store/auth';
import { supabase, errorMessage } from '@/lib/supabase';
import { ImageUpload } from '@/components/ImageUpload';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Select,
  Skeleton,
  Textarea,
  Toggle,
  useToast,
} from '@/components/ui';
import type { Plan, Restaurant } from '@/lib/types';

/** Columns a tenant is allowed to send. Billing columns are deliberately
 *  absent: the guard_restaurant_billing trigger would revert them anyway, and
 *  not sending them keeps the intent of this form unambiguous. */
type Editable = Pick<
  Restaurant,
  | 'name'
  | 'name_ar'
  | 'tagline'
  | 'tagline_ar'
  | 'description'
  | 'description_ar'
  | 'logo_url'
  | 'cover_url'
  | 'primary_color'
  | 'phone'
  | 'whatsapp'
  | 'instagram_url'
  | 'tiktok_url'
  | 'snapchat_url'
  | 'x_url'
  | 'google_maps_url'
  | 'google_reviews_url'
  | 'address'
  | 'address_ar'
  | 'vat_rate'
  | 'prices_include_vat'
  | 'service_charge_rate'
  | 'default_locale'
  | 'requires_waiter_confirmation'
  | 'allow_customer_notes'
  | 'loyalty_enabled'
  | 'loyalty_points_per_sar'
  | 'games_enabled'
  | 'reviews_enabled'
> & { vat_number: string | null; cr_number: string | null };

export function SettingsPage() {
  const { t, num, dateOnly, money } = useLocale();
  const { restaurant, refresh } = useAuth();
  const { push } = useToast();

  const [form, setForm] = useState<Partial<Editable>>({});
  const [plan, setPlan] = useState<Plan | null>(null);
  const [saving, setSaving] = useState(false);
  const [counts, setCounts] = useState<{ tables: number; items: number; staff: number } | null>(null);

  useEffect(() => {
    if (!restaurant) return;
    setForm({
      name: restaurant.name,
      name_ar: restaurant.name_ar,
      tagline: restaurant.tagline,
      tagline_ar: restaurant.tagline_ar,
      description: restaurant.description,
      description_ar: restaurant.description_ar,
      logo_url: restaurant.logo_url,
      cover_url: restaurant.cover_url,
      primary_color: restaurant.primary_color,
      phone: restaurant.phone,
      whatsapp: restaurant.whatsapp,
      instagram_url: restaurant.instagram_url,
      tiktok_url: restaurant.tiktok_url,
      snapchat_url: restaurant.snapchat_url,
      x_url: restaurant.x_url,
      google_maps_url: restaurant.google_maps_url,
      google_reviews_url: restaurant.google_reviews_url,
      address: restaurant.address,
      address_ar: restaurant.address_ar,
      vat_rate: restaurant.vat_rate,
      prices_include_vat: restaurant.prices_include_vat,
      service_charge_rate: restaurant.service_charge_rate,
      default_locale: restaurant.default_locale,
      requires_waiter_confirmation: restaurant.requires_waiter_confirmation,
      allow_customer_notes: restaurant.allow_customer_notes,
      loyalty_enabled: restaurant.loyalty_enabled,
      loyalty_points_per_sar: restaurant.loyalty_points_per_sar,
      games_enabled: restaurant.games_enabled,
      reviews_enabled: restaurant.reviews_enabled,
      vat_number: restaurant.vat_number ?? null,
      cr_number: restaurant.cr_number ?? null,
    });
  }, [restaurant]);

  useEffect(() => {
    if (!restaurant) return;
    void (async () => {
      const [p, tbl, itm, stf] = await Promise.all([
        restaurant.plan_id
          ? supabase.from('plans').select('*').eq('id', restaurant.plan_id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from('restaurant_tables')
          .select('id', { count: 'exact', head: true })
          .eq('restaurant_id', restaurant.id),
        supabase
          .from('menu_items')
          .select('id', { count: 'exact', head: true })
          .eq('restaurant_id', restaurant.id),
        supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('restaurant_id', restaurant.id),
      ]);

      setPlan((p.data as Plan) ?? null);
      setCounts({ tables: tbl.count ?? 0, items: itm.count ?? 0, staff: stf.count ?? 0 });
    })();
  }, [restaurant]);

  function set<K extends keyof Editable>(key: K, value: Editable[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    if (!restaurant) return;
    if (!form.name?.trim() || !form.name_ar?.trim()) {
      push(t('errors.saveFailed'), 'error');
      return;
    }
    setSaving(true);

    const { error } = await supabase
      .from('restaurants')
      .update({
        ...form,
        name: form.name.trim(),
        name_ar: form.name_ar.trim(),
        vat_rate: Number(form.vat_rate ?? 0.15),
        service_charge_rate: Number(form.service_charge_rate ?? 0),
        loyalty_points_per_sar: Number(form.loyalty_points_per_sar ?? 1),
      })
      .eq('id', restaurant.id);

    setSaving(false);

    if (error) {
      push(errorMessage(error), 'error');
      return;
    }
    await refresh();
    push(t('common.saved'), 'success');
  }

  if (!restaurant) return <Skeleton className="h-64" />;

  const statusTone =
    restaurant.subscription_status === 'active'
      ? 'success'
      : restaurant.subscription_status === 'trialing'
        ? 'info'
        : 'danger';

  return (
    <div className="space-y-4 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold text-ink-900">{t('admin.settingsTitle')}</h1>
        <Button loading={saving} onClick={() => void save()}>
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </div>

      {/* plan */}
      <Card>
        <CardHeader
          title={t('admin.planTitle')}
          subtitle={t('admin.contactPlatform')}
          action={
            <Badge tone={statusTone}>
              {t(`superAdmin.status${restaurant.subscription_status.replace(/(^|_)(\w)/g, (_, __, c) => c.toUpperCase())}`)}
            </Badge>
          }
        />
        <div className="grid gap-3 border-t border-ink-100 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-[11.5px] text-ink-400">{t('admin.planName')}</p>
            <p className="mt-0.5 text-[14px] font-medium text-ink-800">{plan?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-[11.5px] text-ink-400">
              {restaurant.subscription_status === 'trialing' ? t('admin.trialEnds') : t('admin.renewsOn')}
            </p>
            <p className="mt-0.5 text-[14px] font-medium text-ink-800">
              {dateOnly(
                restaurant.subscription_status === 'trialing'
                  ? restaurant.trial_ends_at
                  : restaurant.current_period_end,
              )}
            </p>
          </div>
          {plan && counts ? (
            <>
              <div>
                <p className="text-[11.5px] text-ink-400">{t('nav.tables')}</p>
                <p className="mt-0.5 text-[14px] font-medium text-ink-800 tnum">
                  {t('admin.usageTables', { used: num(counts.tables), limit: num(plan.max_tables) })}
                </p>
              </div>
              <div>
                <p className="text-[11.5px] text-ink-400">{t('nav.menu')}</p>
                <p className="mt-0.5 text-[14px] font-medium text-ink-800 tnum">
                  {t('admin.usageItems', { used: num(counts.items), limit: num(plan.max_menu_items) })}
                </p>
              </div>
            </>
          ) : null}
        </div>
      </Card>

      {/* brand */}
      <Card>
        <CardHeader title={t('admin.brandTitle')} />
        <div className="space-y-4 border-t border-ink-100 p-4">
          <div className="flex flex-wrap gap-6">
            <ImageUpload
              label={t('admin.logo')}
              value={form.logo_url ?? null}
              onChange={(url) => set('logo_url', url)}
              restaurantId={restaurant.id}
              folder="brand"
            />
            <ImageUpload
              label={t('admin.cover')}
              value={form.cover_url ?? null}
              onChange={(url) => set('cover_url', url)}
              restaurantId={restaurant.id}
              folder="brand"
              aspect="wide"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.restaurantName')} required>
              <Input value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} dir="ltr" />
            </Field>
            <Field label={t('admin.restaurantNameAr')} required>
              <Input value={form.name_ar ?? ''} onChange={(e) => set('name_ar', e.target.value)} dir="rtl" />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.tagline')}>
              <Input value={form.tagline ?? ''} onChange={(e) => set('tagline', e.target.value)} dir="ltr" />
            </Field>
            <Field label={t('admin.taglineAr')}>
              <Input value={form.tagline_ar ?? ''} onChange={(e) => set('tagline_ar', e.target.value)} dir="rtl" />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.about')}>
              <Textarea
                value={form.description ?? ''}
                onChange={(e) => set('description', e.target.value)}
                dir="ltr"
              />
            </Field>
            <Field label={t('admin.aboutAr')}>
              <Textarea
                value={form.description_ar ?? ''}
                onChange={(e) => set('description_ar', e.target.value)}
                dir="rtl"
              />
            </Field>
          </div>

          <Field label={t('admin.primaryColor')}>
            <div className="flex items-center gap-3">
              <Input
                type="color"
                value={form.primary_color ?? '#4b8061'}
                onChange={(e) => set('primary_color', e.target.value)}
                className="h-11 w-20 !p-1"
              />
              <Input
                value={form.primary_color ?? ''}
                onChange={(e) => set('primary_color', e.target.value)}
                className="max-w-[140px] font-mono !text-[13px]"
                dir="ltr"
              />
            </div>
          </Field>

          <Field label={t('superAdmin.restaurantSlug')} hint={t('superAdmin.slugHint')}>
            <Input value={restaurant.slug} readOnly disabled dir="ltr" className="max-w-xs" />
          </Field>
        </div>
      </Card>

      {/* contact */}
      <Card>
        <CardHeader title={t('admin.contactTitle')} />
        <div className="grid gap-3 border-t border-ink-100 p-4 sm:grid-cols-2">
          <Field label={t('admin.phone')}>
            <Input value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} dir="ltr" />
          </Field>
          <Field label={t('admin.whatsapp')}>
            <Input value={form.whatsapp ?? ''} onChange={(e) => set('whatsapp', e.target.value)} dir="ltr" />
          </Field>
          <Field label={t('admin.instagram')}>
            <Input value={form.instagram_url ?? ''} onChange={(e) => set('instagram_url', e.target.value)} dir="ltr" />
          </Field>
          <Field label={t('admin.tiktok')}>
            <Input value={form.tiktok_url ?? ''} onChange={(e) => set('tiktok_url', e.target.value)} dir="ltr" />
          </Field>
          <Field label={t('admin.snapchat')}>
            <Input value={form.snapchat_url ?? ''} onChange={(e) => set('snapchat_url', e.target.value)} dir="ltr" />
          </Field>
          <Field label={t('admin.x')}>
            <Input value={form.x_url ?? ''} onChange={(e) => set('x_url', e.target.value)} dir="ltr" />
          </Field>
          <Field label={t('admin.mapsUrl')}>
            <Input
              value={form.google_maps_url ?? ''}
              onChange={(e) => set('google_maps_url', e.target.value)}
              dir="ltr"
            />
          </Field>
          <Field label={t('admin.googleLinkLabel')} hint={t('admin.googleLinkHint')}>
            <Input
              value={form.google_reviews_url ?? ''}
              onChange={(e) => set('google_reviews_url', e.target.value)}
              dir="ltr"
            />
          </Field>
          <Field label={t('admin.address')}>
            <Input value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} dir="ltr" />
          </Field>
          <Field label={t('admin.addressAr')}>
            <Input value={form.address_ar ?? ''} onChange={(e) => set('address_ar', e.target.value)} dir="rtl" />
          </Field>
        </div>
      </Card>

      {/* tax */}
      <Card>
        <CardHeader title={t('admin.commerceTitle')} />
        <div className="space-y-4 border-t border-ink-100 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={`${t('admin.vatRate')} (0–1)`}>
              <Input
                type="number"
                step="0.01"
                min={0}
                max={1}
                value={form.vat_rate ?? 0.15}
                onChange={(e) => set('vat_rate', Number(e.target.value))}
                dir="ltr"
              />
            </Field>
            <Field label={`${t('admin.serviceChargeRate')} (0–1)`}>
              <Input
                type="number"
                step="0.01"
                min={0}
                max={1}
                value={form.service_charge_rate ?? 0}
                onChange={(e) => set('service_charge_rate', Number(e.target.value))}
                dir="ltr"
              />
            </Field>
            <Field label={t('admin.vatNumber')}>
              <Input
                value={form.vat_number ?? ''}
                onChange={(e) => set('vat_number', e.target.value)}
                dir="ltr"
                maxLength={15}
              />
            </Field>
          </div>

          <Field label={t('admin.crNumber')}>
            <Input
              value={form.cr_number ?? ''}
              onChange={(e) => set('cr_number', e.target.value)}
              dir="ltr"
              className="max-w-xs"
            />
          </Field>

          <Toggle
            checked={form.prices_include_vat ?? true}
            onChange={(v) => set('prices_include_vat', v)}
            label={t('admin.pricesIncludeVat')}
            hint={t('admin.pricesIncludeVatHint')}
          />
        </div>
      </Card>

      {/* ordering */}
      <Card>
        <CardHeader title={t('admin.experienceTitle')} />
        <div className="space-y-4 border-t border-ink-100 p-4">
          <Toggle
            checked={form.requires_waiter_confirmation ?? true}
            onChange={(v) => set('requires_waiter_confirmation', v)}
            label={t('admin.requiresConfirmation')}
            hint={t('admin.requiresConfirmationHint')}
          />
          <Toggle
            checked={form.allow_customer_notes ?? true}
            onChange={(v) => set('allow_customer_notes', v)}
            label={t('admin.allowNotes')}
          />
          <Field label={t('admin.defaultLocale')}>
            <Select
              value={form.default_locale ?? 'ar'}
              onChange={(e) => set('default_locale', e.target.value as 'ar' | 'en')}
              className="max-w-[200px]"
            >
              <option value="ar">{t('common.arabic')}</option>
              <option value="en">{t('common.english')}</option>
            </Select>
          </Field>
        </div>
      </Card>

      {/* features */}
      <Card>
        <CardHeader title={t('admin.featuresTitle')} />
        <div className="space-y-4 border-t border-ink-100 p-4">
          <Toggle
            checked={form.games_enabled ?? true}
            onChange={(v) => set('games_enabled', v)}
            label={t('admin.gamesToggle')}
          />
          <Toggle
            checked={form.reviews_enabled ?? true}
            onChange={(v) => set('reviews_enabled', v)}
            label={t('admin.reviewsToggle')}
          />
          <Toggle
            checked={form.loyalty_enabled ?? true}
            onChange={(v) => set('loyalty_enabled', v)}
            label={t('admin.loyaltyToggle')}
          />
          <Field label={t('admin.pointsRate')}>
            <Input
              type="number"
              min={0}
              step="0.1"
              value={form.loyalty_points_per_sar ?? 1}
              onChange={(e) => set('loyalty_points_per_sar', Number(e.target.value))}
              className="max-w-[140px]"
              dir="ltr"
            />
          </Field>
        </div>
      </Card>

      <div className="sticky bottom-4 flex justify-end">
        <Button loading={saving} onClick={() => void save()} className="shadow-lift">
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}
