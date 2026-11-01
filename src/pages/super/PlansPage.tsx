import { useState } from 'react';
import { useLocale } from '@/lib/useLocale';
import { useRows } from '@/lib/useRows';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Skeleton,
  Toggle,
  cx,
  useConfirm,
  useToast,
} from '@/components/ui';
import type { Plan, Restaurant } from '@/lib/types';

export function PlansPage() {
  const { t, money, num, locale } = useLocale();
  const { push } = useToast();
  const { confirm, confirmNode } = useConfirm();

  const plans = useRows<Plan>('plans', null, { global: true, orderBy: 'sort_order' });
  const restaurants = useRows<Restaurant>('restaurants', null, {
    global: true,
    select: 'id,plan_id',
    orderBy: 'created_at',
  });

  const [editing, setEditing] = useState<Plan | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Partial<Plan>>({});
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setForm({
      code: '',
      name: '',
      name_ar: '',
      price_monthly: 0,
      price_yearly: 0,
      max_branches: 1,
      max_tables: 20,
      max_menu_items: 100,
      max_staff: 10,
      trial_days: 14,
      sort_order: plans.rows.length + 1,
      is_active: true,
    });
    setEditing(null);
    setCreating(true);
  }

  async function save() {
    const code = (form.code ?? '').trim().toLowerCase();
    if (!code || !form.name?.trim() || !form.name_ar?.trim()) {
      push(t('errors.saveFailed'), 'error');
      return;
    }
    setSaving(true);

    const payload: Partial<Plan> = {
      code,
      name: form.name.trim(),
      name_ar: form.name_ar.trim(),
      price_monthly: Number(form.price_monthly) || 0,
      price_yearly: Number(form.price_yearly) || 0,
      max_branches: Number(form.max_branches) || 1,
      max_tables: Number(form.max_tables) || 10,
      max_menu_items: Number(form.max_menu_items) || 50,
      max_staff: Number(form.max_staff) || 5,
      trial_days: Number(form.trial_days) || 0,
      sort_order: Number(form.sort_order) || 0,
      is_active: form.is_active ?? true,
    };

    const res = editing ? await plans.update(editing.id, payload) : await plans.insert(payload);
    setSaving(false);

    if (res.error) {
      push(
        res.error.includes('duplicate') || res.error.includes('unique')
          ? t('superAdmin.slugTaken')
          : res.error,
        'error',
      );
      return;
    }
    push(t('common.saved'), 'success');
    setEditing(null);
    setCreating(false);
  }

  async function destroy(p: Plan) {
    const inUse = restaurants.rows.filter((r) => r.plan_id === p.id).length;
    if (inUse > 0) {
      // the FK is ON DELETE SET NULL, so deleting would silently orphan tenants
      push(`${p.name}: ${num(inUse)} ${t('nav.restaurants')}`, 'error');
      return;
    }
    if (!(await confirm(`${t('common.delete')} ${p.name}?`, true))) return;

    const res = await plans.remove(p.id);
    if (res.error) push(res.error, 'error');
    else setEditing(null);
  }

  if (plans.loading && !plans.rows.length) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-32" />
        <div className="grid gap-3 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {confirmNode}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold text-ink-900">{t('superAdmin.plansTitle')}</h1>
        <Button onClick={openCreate}>{t('superAdmin.newPlan')}</Button>
      </div>

      {plans.rows.length === 0 ? (
        <Card>
          <EmptyState title={t('common.noResults')} />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          {plans.rows.map((p) => {
            const inUse = restaurants.rows.filter((r) => r.plan_id === p.id).length;
            return (
              <Card key={p.id} className={cx('flex flex-col p-5', !p.is_active && 'opacity-60')}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[15px] font-semibold text-ink-900">
                      {locale === 'ar' ? p.name_ar : p.name}
                    </p>
                    <p className="mt-0.5 font-mono text-[11.5px] text-ink-400" dir="ltr">
                      {p.code}
                    </p>
                  </div>
                  <Badge tone={inUse > 0 ? 'brand' : 'neutral'}>
                    {num(inUse)}
                  </Badge>
                </div>

                <p className="mt-4 text-[26px] font-semibold text-ink-900 tnum">
                  {money(p.price_monthly)}
                </p>
                <p className="text-[12px] text-ink-400 tnum">
                  {money(p.price_yearly)} / {locale === 'ar' ? 'سنوياً' : 'year'}
                </p>

                <dl className="mt-4 grow space-y-1.5 text-[13px]">
                  {[
                    [t('superAdmin.maxTables'), p.max_tables],
                    [t('superAdmin.maxItems'), p.max_menu_items],
                    [t('superAdmin.maxStaff'), p.max_staff],
                    [t('superAdmin.maxBranches'), p.max_branches],
                    [t('superAdmin.trialDays'), p.trial_days],
                  ].map(([k, v]) => (
                    <div key={String(k)} className="flex justify-between">
                      <dt className="text-ink-500">{k}</dt>
                      <dd className="font-medium text-ink-800 tnum">{num(Number(v))}</dd>
                    </div>
                  ))}
                </dl>

                <Button
                  size="sm"
                  variant="outline"
                  className="mt-4"
                  onClick={() => {
                    setForm({ ...p });
                    setEditing(p);
                    setCreating(false);
                  }}
                >
                  {t('common.edit')}
                </Button>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={creating || Boolean(editing)}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        title={editing ? (locale === 'ar' ? editing.name_ar : editing.name) : t('superAdmin.newPlan')}
        footer={
          <div className="flex items-center justify-between gap-2">
            {editing ? (
              <Button variant="ghost" onClick={() => void destroy(editing)}>
                {t('common.delete')}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setCreating(false);
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button loading={saving} onClick={() => void save()}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label={t('superAdmin.planCode')} required>
            <Input
              value={form.code ?? ''}
              onChange={(e) =>
                setForm((f) => ({ ...f, code: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') }))
              }
              dir="ltr"
              className="font-mono max-w-[200px]"
              disabled={Boolean(editing)}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.restaurantName')} required>
              <Input
                value={form.name ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                dir="ltr"
              />
            </Field>
            <Field label={t('admin.restaurantNameAr')} required>
              <Input
                value={form.name_ar ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, name_ar: e.target.value }))}
                dir="rtl"
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`${t('superAdmin.priceMonthly')} (${t('common.sar')})`}>
              <Input
                type="number"
                min={0}
                step="1"
                value={form.price_monthly ?? 0}
                onChange={(e) => setForm((f) => ({ ...f, price_monthly: Number(e.target.value) }))}
                dir="ltr"
              />
            </Field>
            <Field label={`${t('superAdmin.priceYearly')} (${t('common.sar')})`}>
              <Input
                type="number"
                min={0}
                step="1"
                value={form.price_yearly ?? 0}
                onChange={(e) => setForm((f) => ({ ...f, price_yearly: Number(e.target.value) }))}
                dir="ltr"
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ['max_tables', t('superAdmin.maxTables')],
                ['max_menu_items', t('superAdmin.maxItems')],
                ['max_staff', t('superAdmin.maxStaff')],
                ['max_branches', t('superAdmin.maxBranches')],
                ['trial_days', t('superAdmin.trialDays')],
                ['sort_order', t('admin.sortOrder')],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <Input
                  type="number"
                  min={0}
                  value={(form[key] as number) ?? 0}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: Number(e.target.value) }))}
                  dir="ltr"
                />
              </Field>
            ))}
          </div>

          <Toggle
            checked={form.is_active ?? true}
            onChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
            label={t('common.active')}
          />
        </div>
      </Modal>
    </div>
  );
}
