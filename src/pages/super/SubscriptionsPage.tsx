import { useMemo, useState } from 'react';
import { useLocale } from '@/lib/useLocale';
import { useRows } from '@/lib/useRows';
import { supabase } from '@/lib/supabase';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  Stat,
  Textarea,
  useToast,
} from '@/components/ui';
import { toCsv, downloadFile } from '@/lib/format';
import type { Plan, Restaurant, SubscriptionStatus } from '@/lib/types';

interface SubscriptionRow {
  id: string;
  restaurant_id: string;
  plan_id: string | null;
  status: SubscriptionStatus;
  period_start: string;
  period_end: string | null;
  amount: number;
  currency: string;
  provider: string | null;
  provider_ref: string | null;
  note: string | null;
  created_at: string;
}

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

export function SubscriptionsPage() {
  const { t, money, num, locale, dateOnly } = useLocale();
  const { push } = useToast();

  const subs = useRows<SubscriptionRow>('subscriptions', null, {
    global: true,
    orderBy: 'created_at',
    ascending: false,
    limit: 300,
  });
  const restaurants = useRows<Restaurant>('restaurants', null, {
    global: true,
    select: 'id,name,name_ar,slug,subscription_status',
    orderBy: 'name',
  });
  const plans = useRows<Plan>('plans', null, { global: true, orderBy: 'sort_order' });

  const [recording, setRecording] = useState(false);
  const [form, setForm] = useState({
    restaurant_id: '',
    plan_id: '',
    status: 'active' as SubscriptionStatus,
    amount: '',
    period_start: new Date().toISOString().slice(0, 10),
    period_end: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    provider: '',
    provider_ref: '',
    note: '',
  });
  const [saving, setSaving] = useState(false);

  const collected = useMemo(
    () => subs.rows.reduce((s, r) => s + Number(r.amount || 0), 0),
    [subs.rows],
  );

  const thisMonth = useMemo(() => {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return subs.rows
      .filter((r) => new Date(r.created_at) >= start)
      .reduce((s, r) => s + Number(r.amount || 0), 0);
  }, [subs.rows]);

  function nameOf(id: string): string {
    const r = restaurants.rows.find((x) => x.id === id);
    if (!r) return '—';
    return locale === 'ar' ? r.name_ar : r.name;
  }

  /**
   * Records a payment against a restaurant and moves its subscription window
   * forward. The restaurant row is updated too, because that is what the
   * restaurant_is_live() gate actually reads when a guest scans a code.
   */
  async function record() {
    if (!form.restaurant_id) {
      push(t('errors.saveFailed'), 'error');
      return;
    }
    setSaving(true);

    const res = await subs.insert({
      restaurant_id: form.restaurant_id,
      plan_id: form.plan_id || null,
      status: form.status,
      amount: Number(form.amount) || 0,
      period_start: new Date(form.period_start).toISOString(),
      period_end: form.period_end ? new Date(form.period_end).toISOString() : null,
      provider: form.provider.trim() || null,
      provider_ref: form.provider_ref.trim() || null,
      note: form.note.trim() || null,
    } as Partial<SubscriptionRow>);

    if (res.error) {
      setSaving(false);
      push(res.error, 'error');
      return;
    }

    const patch: Record<string, unknown> = {
      subscription_status: form.status,
      is_active: !['suspended', 'cancelled'].includes(form.status),
    };
    if (form.plan_id) patch.plan_id = form.plan_id;
    if (form.period_end) patch.current_period_end = new Date(form.period_end).toISOString();

    const { error } = await supabase
      .from('restaurants')
      .update(patch)
      .eq('id', form.restaurant_id);

    setSaving(false);

    if (error) {
      push(error.message, 'error');
      return;
    }

    push(t('common.saved'), 'success');
    setRecording(false);
    await restaurants.reload();
  }

  function exportCsv() {
    if (!subs.rows.length) return;
    downloadFile(
      `subscriptions-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        ['restaurant', 'status', 'amount', 'currency', 'period_start', 'period_end', 'provider', 'ref', 'created_at'],
        subs.rows.map((s) => [
          nameOf(s.restaurant_id),
          s.status,
          s.amount,
          s.currency,
          s.period_start,
          s.period_end ?? '',
          s.provider ?? '',
          s.provider_ref ?? '',
          s.created_at,
        ]),
      ),
      'text/csv',
    );
  }

  if (subs.loading && !subs.rows.length) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold text-ink-900">{t('superAdmin.subscriptionsTitle')}</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={!subs.rows.length}>
            {t('admin.exportCsv')}
          </Button>
          <Button onClick={() => setRecording(true)}>{t('superAdmin.recordPayment')}</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t('admin.revenue')} value={money(collected)} />
        <Stat label={t('common.month')} value={money(thisMonth)} />
        <Stat label={t('superAdmin.subscriptionsTitle')} value={num(subs.rows.length)} />
      </div>

      {subs.rows.length === 0 ? (
        <Card>
          <EmptyState title={t('common.noResults')} />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13.5px]">
            <thead>
              <tr className="border-b border-ink-100 text-[12px] text-ink-400">
                <th className="px-4 py-3 text-start font-medium">{t('nav.restaurants')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('superAdmin.status')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('superAdmin.amount')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('superAdmin.periodStart')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('superAdmin.periodEnd')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('superAdmin.provider')}</th>
              </tr>
            </thead>
            <tbody>
              {subs.rows.map((s) => (
                <tr key={s.id} className="border-b border-ink-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-ink-900">{nameOf(s.restaurant_id)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[s.status]}>{t(statusKey(s.status))}</Badge>
                  </td>
                  <td className="px-4 py-3 text-end tnum">{money(s.amount)}</td>
                  <td className="px-4 py-3 text-ink-600">{dateOnly(s.period_start)}</td>
                  <td className="px-4 py-3 text-ink-600">{dateOnly(s.period_end)}</td>
                  <td className="px-4 py-3 text-ink-500">
                    {s.provider ?? '—'}
                    {s.provider_ref ? (
                      <span className="block text-[11.5px] text-ink-400" dir="ltr">
                        {s.provider_ref}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal
        open={recording}
        onClose={() => setRecording(false)}
        title={t('superAdmin.recordPayment')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRecording(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={saving} onClick={() => void record()}>
              {t('common.save')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label={t('nav.restaurants')} required>
            <Select
              value={form.restaurant_id}
              onChange={(e) => setForm((f) => ({ ...f, restaurant_id: e.target.value }))}
            >
              <option value="">—</option>
              {restaurants.rows.map((r) => (
                <option key={r.id} value={r.id}>
                  {locale === 'ar' ? r.name_ar : r.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('superAdmin.plan')}>
              <Select
                value={form.plan_id}
                onChange={(e) => setForm((f) => ({ ...f, plan_id: e.target.value }))}
              >
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
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as SubscriptionStatus }))}
              >
                {(['trialing', 'active', 'past_due', 'suspended', 'cancelled'] as SubscriptionStatus[]).map(
                  (s) => (
                    <option key={s} value={s}>
                      {t(statusKey(s))}
                    </option>
                  ),
                )}
              </Select>
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={`${t('superAdmin.amount')} (${t('common.sar')})`}>
              <Input
                type="number"
                min={0}
                step="1"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                dir="ltr"
              />
            </Field>
            <Field label={t('superAdmin.periodStart')}>
              <Input
                type="date"
                value={form.period_start}
                onChange={(e) => setForm((f) => ({ ...f, period_start: e.target.value }))}
                dir="ltr"
              />
            </Field>
            <Field label={t('superAdmin.periodEnd')}>
              <Input
                type="date"
                value={form.period_end}
                onChange={(e) => setForm((f) => ({ ...f, period_end: e.target.value }))}
                dir="ltr"
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('superAdmin.provider')}>
              <Input
                value={form.provider}
                onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
                placeholder="Mada / STC Pay / bank transfer"
              />
            </Field>
            <Field label={t('superAdmin.providerRef')}>
              <Input
                value={form.provider_ref}
                onChange={(e) => setForm((f) => ({ ...f, provider_ref: e.target.value }))}
                dir="ltr"
              />
            </Field>
          </div>

          <Field label={t('superAdmin.note')}>
            <Textarea
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              className="min-h-[60px]"
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
