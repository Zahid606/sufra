import { useEffect, useMemo, useState } from 'react';
import { useLocale } from '@/lib/useLocale';
import { useRows } from '@/lib/useRows';
import { supabase, errorMessage, publicBaseUrl } from '@/lib/supabase';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Segmented,
  Select,
  Skeleton,
  cx,
  useConfirm,
  useToast,
} from '@/components/ui';
import type { Plan, Restaurant, SubscriptionStatus } from '@/lib/types';

const STATUSES: SubscriptionStatus[] = ['trialing', 'active', 'past_due', 'suspended', 'cancelled'];

const STATUS_TONE: Record<SubscriptionStatus, 'info' | 'success' | 'warn' | 'danger' | 'neutral'> = {
  trialing: 'info',
  active: 'success',
  past_due: 'warn',
  suspended: 'danger',
  cancelled: 'neutral',
};

function statusKey(s: SubscriptionStatus): string {
  const camel = s.replace(/(^|_)(\w)/g, (_m, _p, c: string) => c.toUpperCase());
  return `superAdmin.status${camel}`;
}

export function RestaurantsPage() {
  const { t, num, locale, dateOnly } = useLocale();
  const { push } = useToast();
  const { confirm, confirmNode } = useConfirm();

  const restaurants = useRows<Restaurant>('restaurants', null, {
    global: true,
    orderBy: 'created_at',
    ascending: false,
  });
  const plans = useRows<Plan>('plans', null, { global: true, orderBy: 'sort_order' });

  const [filter, setFilter] = useState<'all' | 'active' | 'trialing' | 'suspended'>('all');
  const [query, setQuery] = useState('');

  const [creating, setCreating] = useState(false);
  const [cForm, setCForm] = useState({
    slug: '',
    name: '',
    name_ar: '',
    plan_code: 'starter',
    phone: '',
    table_count: 10,
  });

  const [managing, setManaging] = useState<Restaurant | null>(null);
  const [mPlan, setMPlan] = useState('');
  const [mStatus, setMStatus] = useState<SubscriptionStatus>('trialing');
  const [extendDays, setExtendDays] = useState('14');

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (plans.rows.length && !cForm.plan_code) {
      setCForm((f) => ({ ...f, plan_code: plans.rows[0].code }));
    }
  }, [plans.rows, cForm.plan_code]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return restaurants.rows.filter((r) => {
      if (filter === 'active' && r.subscription_status !== 'active') return false;
      if (filter === 'trialing' && r.subscription_status !== 'trialing') return false;
      if (filter === 'suspended' && !['suspended', 'cancelled'].includes(r.subscription_status ?? ''))
        return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.name_ar.includes(query.trim()) ||
        r.slug.includes(q)
      );
    });
  }, [restaurants.rows, filter, query]);

  /** Provisioning goes through the RPC so a tenant arrives with a default
   *  branch, a starter menu skeleton, tables and a prize wheel already set up. */
  async function provision() {
    const slug = cForm.slug.trim().toLowerCase();
    if (!/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$/.test(slug)) {
      push(t('superAdmin.slugHint'), 'error');
      return;
    }
    if (!cForm.name.trim() || !cForm.name_ar.trim()) {
      push(t('errors.saveFailed'), 'error');
      return;
    }
    setSaving(true);

    const { data, error } = await supabase.rpc('provision_restaurant', {
      p_slug: slug,
      p_name: cForm.name.trim(),
      p_name_ar: cForm.name_ar.trim(),
      p_plan_code: cForm.plan_code,
      p_phone: cForm.phone.trim() || null,
      p_table_count: Number(cForm.table_count) || 10,
    });

    setSaving(false);

    if (error) {
      push(
        error.message.includes('duplicate') || error.message.includes('unique')
          ? t('superAdmin.slugTaken')
          : errorMessage(error),
        'error',
      );
      return;
    }

    const res = data as { ok: boolean };
    if (!res?.ok) {
      push(t('errors.saveFailed'), 'error');
      return;
    }

    push(t('superAdmin.provisioned', { count: num(Number(cForm.table_count) || 10) }), 'success');
    setCreating(false);
    setCForm({ slug: '', name: '', name_ar: '', plan_code: plans.rows[0]?.code ?? 'starter', phone: '', table_count: 10 });
    await restaurants.reload();
  }

  async function applyChanges() {
    if (!managing) return;
    setSaving(true);

    const patch: Record<string, unknown> = {
      subscription_status: mStatus,
      is_active: !['suspended', 'cancelled'].includes(mStatus),
    };
    if (mPlan) patch.plan_id = mPlan;

    const { error } = await supabase.from('restaurants').update(patch).eq('id', managing.id);
    setSaving(false);

    if (error) {
      push(errorMessage(error), 'error');
      return;
    }
    push(t('common.saved'), 'success');
    setManaging(null);
    await restaurants.reload();
  }

  async function extendTrial() {
    if (!managing) return;
    const days = Number(extendDays) || 0;
    if (days <= 0) return;

    const base =
      managing.trial_ends_at && new Date(managing.trial_ends_at) > new Date()
        ? new Date(managing.trial_ends_at)
        : new Date();
    const next = new Date(base.getTime() + days * 86400000);

    setSaving(true);
    const { error } = await supabase
      .from('restaurants')
      .update({ trial_ends_at: next.toISOString(), subscription_status: 'trialing', is_active: true })
      .eq('id', managing.id);
    setSaving(false);

    if (error) {
      push(errorMessage(error), 'error');
      return;
    }
    push(t('common.saved'), 'success');
    setManaging(null);
    await restaurants.reload();
  }

  async function suspend(r: Restaurant) {
    if (!(await confirm(t('superAdmin.suspendConfirm', { name: r.name }), true))) return;

    const { error } = await supabase
      .from('restaurants')
      .update({ subscription_status: 'suspended', is_active: false })
      .eq('id', r.id);

    if (error) {
      push(errorMessage(error), 'error');
      return;
    }
    push(t('common.saved'), 'success');
    await restaurants.reload();
  }

  if (restaurants.loading && !restaurants.rows.length) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-40" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {confirmNode}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold text-ink-900">{t('superAdmin.restaurantsTitle')}</h1>
        <Button onClick={() => setCreating(true)}>{t('superAdmin.newRestaurant')}</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('common.all'), count: restaurants.rows.length },
            { value: 'active', label: t('superAdmin.statusActive') },
            { value: 'trialing', label: t('superAdmin.trialing') },
            { value: 'suspended', label: t('superAdmin.suspended') },
          ]}
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('common.search')}
          className="max-w-[220px]"
        />
      </div>

      {visible.length === 0 ? (
        <Card>
          <EmptyState title={t('common.noResults')} />
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => {
            const plan = plans.rows.find((p) => p.id === r.plan_id);
            const status = (r.subscription_status ?? 'trialing') as SubscriptionStatus;
            const trialLeft =
              status === 'trialing' && r.trial_ends_at
                ? Math.ceil((new Date(r.trial_ends_at).getTime() - Date.now()) / 86400000)
                : null;

            return (
              <Card
                key={r.id}
                className={cx('p-4', ['suspended', 'cancelled'].includes(status) && 'opacity-65')}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    {r.logo_url ? (
                      <img src={r.logo_url} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover bg-ink-100" />
                    ) : (
                      <div
                        className="h-11 w-11 shrink-0 rounded-xl grid place-items-center font-display text-[14px] font-bold text-white"
                        style={{ background: r.primary_color }}
                      >
                        {(locale === 'ar' ? r.name_ar : r.name).charAt(0)}
                      </div>
                    )}

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[15px] font-semibold text-ink-900">
                          {locale === 'ar' ? r.name_ar : r.name}
                        </p>
                        <Badge tone={STATUS_TONE[status]} dot>
                          {t(statusKey(status))}
                        </Badge>
                        {plan ? <Badge tone="neutral">{locale === 'ar' ? plan.name_ar : plan.name}</Badge> : null}
                      </div>
                      <p className="mt-0.5 text-[12px] text-ink-400" dir="ltr">
                        /r/{r.slug}
                        {r.phone ? ` · ${r.phone}` : ''}
                      </p>
                      {status === 'trialing' && r.trial_ends_at ? (
                        <p className={cx('mt-0.5 text-[12px] tnum', (trialLeft ?? 0) <= 3 ? 'text-red-600' : 'text-ink-400')}>
                          {t('superAdmin.trialEnds')}: {dateOnly(r.trial_ends_at)}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => window.open(`${publicBaseUrl}/r/${r.slug}/t/1`, '_blank')}
                    >
                      {t('superAdmin.openOrderingPage')}
                    </Button>
                    {!['suspended', 'cancelled'].includes(status) ? (
                      <Button size="sm" variant="ghost" onClick={() => void suspend(r)}>
                        {t('superAdmin.suspend')}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setManaging(r);
                        setMPlan(r.plan_id ?? '');
                        setMStatus(status);
                        setExtendDays('14');
                      }}
                    >
                      {t('common.edit')}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ---------- provision ---------- */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={t('superAdmin.newRestaurant')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreating(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={saving} onClick={() => void provision()}>
              {saving ? t('superAdmin.provisioning') : t('common.create')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label={t('superAdmin.restaurantSlug')} hint={t('superAdmin.slugHint')} required>
            <Input
              value={cForm.slug}
              onChange={(e) =>
                setCForm((f) => ({
                  ...f,
                  slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                }))
              }
              placeholder="najd-grill"
              dir="ltr"
              maxLength={50}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.restaurantName')} required>
              <Input
                value={cForm.name}
                onChange={(e) => setCForm((f) => ({ ...f, name: e.target.value }))}
                dir="ltr"
              />
            </Field>
            <Field label={t('admin.restaurantNameAr')} required>
              <Input
                value={cForm.name_ar}
                onChange={(e) => setCForm((f) => ({ ...f, name_ar: e.target.value }))}
                dir="rtl"
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('superAdmin.plan')}>
              <Select
                value={cForm.plan_code}
                onChange={(e) => setCForm((f) => ({ ...f, plan_code: e.target.value }))}
              >
                {plans.rows.map((p) => (
                  <option key={p.id} value={p.code}>
                    {locale === 'ar' ? p.name_ar : p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('admin.phone')}>
              <Input
                value={cForm.phone}
                onChange={(e) => setCForm((f) => ({ ...f, phone: e.target.value }))}
                dir="ltr"
              />
            </Field>
            <Field label={t('superAdmin.tableCount')}>
              <Input
                type="number"
                min={1}
                max={100}
                value={cForm.table_count}
                onChange={(e) => setCForm((f) => ({ ...f, table_count: Number(e.target.value) }))}
                dir="ltr"
              />
            </Field>
          </div>

          <p className="hint">
            {t('superAdmin.provisioned', { count: num(Number(cForm.table_count) || 10) })}
          </p>
        </div>
      </Modal>

      {/* ---------- manage ---------- */}
      <Modal
        open={Boolean(managing)}
        onClose={() => setManaging(null)}
        title={managing ? (locale === 'ar' ? managing.name_ar : managing.name) : ''}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setManaging(null)}>
              {t('common.cancel')}
            </Button>
            <Button loading={saving} onClick={() => void applyChanges()}>
              {t('common.save')}
            </Button>
          </div>
        }
      >
        {managing ? (
          <div className="space-y-4">
            <Field label={t('superAdmin.changePlan')}>
              <Select value={mPlan} onChange={(e) => setMPlan(e.target.value)}>
                <option value="">—</option>
                {plans.rows.map((p) => (
                  <option key={p.id} value={p.id}>
                    {locale === 'ar' ? p.name_ar : p.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('superAdmin.setStatus')}>
              <Select
                value={mStatus}
                onChange={(e) => setMStatus(e.target.value as SubscriptionStatus)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(statusKey(s))}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="rounded-xl border border-ink-200 p-3.5">
              <p className="text-[13px] font-medium text-ink-800">{t('superAdmin.extendTrial')}</p>
              <p className="mt-1 text-[12px] text-ink-400">
                {t('superAdmin.trialEnds')}: {dateOnly(managing.trial_ends_at)}
              </p>
              <div className="mt-2.5 flex gap-2">
                <Input
                  type="number"
                  min={1}
                  value={extendDays}
                  onChange={(e) => setExtendDays(e.target.value)}
                  className="max-w-[120px]"
                  dir="ltr"
                />
                <Button variant="outline" loading={saving} onClick={() => void extendTrial()}>
                  {t('superAdmin.extendTrial')}
                </Button>
              </div>
            </div>

            <div className="rounded-xl bg-ink-50 p-3.5">
              <p className="text-[12px] text-ink-400" dir="ltr">
                {publicBaseUrl}/r/{managing.slug}/t/1
              </p>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
