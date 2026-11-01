import { useState } from 'react';
import { useLocale } from '@/lib/useLocale';
import { useAuth } from '@/store/auth';
import { useRows } from '@/lib/useRows';
import { ImageUpload } from '@/components/ImageUpload';
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
  Textarea,
  Toggle,
  cx,
  useConfirm,
  useToast,
} from '@/components/ui';
import type { Coupon, CouponType, Promotion } from '@/lib/types';

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MarketingPage() {
  const { t, money, num, dateOnly } = useLocale();
  const { restaurant } = useAuth();
  const { push } = useToast();
  const { confirm, confirmNode } = useConfirm();

  const [tab, setTab] = useState<'promos' | 'coupons'>('promos');

  const promos = useRows<Promotion>('promotions', restaurant?.id, { orderBy: 'sort_order' });
  const coupons = useRows<Coupon>('coupons', restaurant?.id, {
    orderBy: 'created_at',
    ascending: false,
  });

  const [promoEdit, setPromoEdit] = useState<Promotion | null>(null);
  const [promoNew, setPromoNew] = useState(false);
  const [pForm, setPForm] = useState<Partial<Promotion>>({});

  const [couponEdit, setCouponEdit] = useState<Coupon | null>(null);
  const [couponNew, setCouponNew] = useState(false);
  const [cForm, setCForm] = useState<Partial<Coupon>>({});

  const [saving, setSaving] = useState(false);

  /* ---------- promotions ---------- */

  async function savePromo() {
    if (!pForm.title?.trim() || !pForm.title_ar?.trim()) {
      push(t('errors.saveFailed'), 'error');
      return;
    }
    setSaving(true);

    const payload: Partial<Promotion> = {
      title: pForm.title.trim(),
      title_ar: pForm.title_ar.trim(),
      subtitle: pForm.subtitle?.trim() || null,
      subtitle_ar: pForm.subtitle_ar?.trim() || null,
      image_url: pForm.image_url || null,
      starts_at: pForm.starts_at ? new Date(pForm.starts_at).toISOString() : new Date().toISOString(),
      ends_at: pForm.ends_at ? new Date(pForm.ends_at).toISOString() : null,
      sort_order: Number(pForm.sort_order) || 0,
      is_active: pForm.is_active ?? true,
    };

    const res = promoEdit ? await promos.update(promoEdit.id, payload) : await promos.insert(payload);
    setSaving(false);

    if (res.error) {
      push(res.error, 'error');
      return;
    }
    push(t('common.saved'), 'success');
    setPromoEdit(null);
    setPromoNew(false);
  }

  async function destroyPromo(p: Promotion) {
    if (!(await confirm(`${t('common.delete')} “${p.title}”?`, true))) return;
    const res = await promos.remove(p.id);
    if (res.error) push(res.error, 'error');
    else setPromoEdit(null);
  }

  /* ---------- coupons ---------- */

  async function saveCoupon() {
    const code = (cForm.code ?? '').trim().toUpperCase();
    if (!code || !cForm.value || Number(cForm.value) <= 0) {
      push(t('errors.saveFailed'), 'error');
      return;
    }
    setSaving(true);

    const payload: Partial<Coupon> = {
      code,
      type: (cForm.type ?? 'percent') as CouponType,
      value: Number(cForm.value),
      min_order: Number(cForm.min_order) || 0,
      max_discount: cForm.max_discount ? Number(cForm.max_discount) : null,
      usage_limit: cForm.usage_limit ? Number(cForm.usage_limit) : null,
      per_session_limit: Number(cForm.per_session_limit ?? 1),
      starts_at: cForm.starts_at ? new Date(cForm.starts_at).toISOString() : new Date().toISOString(),
      ends_at: cForm.ends_at ? new Date(cForm.ends_at).toISOString() : null,
      is_active: cForm.is_active ?? true,
    };

    const res = couponEdit ? await coupons.update(couponEdit.id, payload) : await coupons.insert(payload);
    setSaving(false);

    if (res.error) {
      push(
        res.error.includes('duplicate') || res.error.includes('unique')
          ? `${code} — ${t('superAdmin.slugTaken')}`
          : res.error,
        'error',
      );
      return;
    }
    push(t('common.saved'), 'success');
    setCouponEdit(null);
    setCouponNew(false);
  }

  async function destroyCoupon(c: Coupon) {
    if (!(await confirm(`${t('common.delete')} ${c.code}?`, true))) return;
    const res = await coupons.remove(c.id);
    if (res.error) push(res.error, 'error');
    else setCouponEdit(null);
  }

  const loading = (tab === 'promos' ? promos.loading : coupons.loading);

  return (
    <div className="space-y-4">
      {confirmNode}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold text-ink-900">
            {tab === 'promos' ? t('admin.promotionsTitle') : t('admin.couponsTitle')}
          </h1>
          {tab === 'promos' ? (
            <p className="mt-0.5 text-[13px] text-ink-500">{t('admin.promotionsSubtitle')}</p>
          ) : null}
        </div>
        <Button
          onClick={() => {
            if (tab === 'promos') {
              setPForm({ sort_order: promos.rows.length + 1, is_active: true });
              setPromoEdit(null);
              setPromoNew(true);
            } else {
              setCForm({ type: 'percent', value: 10, min_order: 0, per_session_limit: 1, is_active: true });
              setCouponEdit(null);
              setCouponNew(true);
            }
          }}
        >
          {tab === 'promos' ? t('admin.newPromotion') : t('admin.newCoupon')}
        </Button>
      </div>

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'promos', label: t('nav.promotions'), count: promos.rows.length },
          { value: 'coupons', label: t('nav.coupons'), count: coupons.rows.length },
        ]}
      />

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : tab === 'promos' ? (
        promos.rows.length === 0 ? (
          <Card>
            <EmptyState title={t('common.noResults')} />
          </Card>
        ) : (
          <Card className="divide-y divide-ink-100 overflow-hidden">
            {promos.rows.map((p) => {
              const expired = p.ends_at && new Date(p.ends_at) < new Date();
              return (
                <div
                  key={p.id}
                  className={cx('flex items-center gap-3 p-3.5', (!p.is_active || expired) && 'opacity-60')}
                >
                  {p.image_url ? (
                    <img src={p.image_url} alt="" className="h-12 w-20 shrink-0 rounded-lg object-cover bg-ink-100" />
                  ) : null}
                  <div className="min-w-0 grow">
                    <p className="text-[14.5px] font-medium text-ink-900">{p.title}</p>
                    <p className="text-[13px] text-ink-400" dir="rtl">
                      {p.title_ar}
                    </p>
                    <p className="mt-0.5 text-[12px] text-ink-400">
                      {dateOnly(p.starts_at)}
                      {p.ends_at ? ` → ${dateOnly(p.ends_at)}` : ''}
                    </p>
                  </div>
                  {expired ? <Badge tone="danger">{t('cart.coupon_expired')}</Badge> : null}
                  {!p.is_active ? <Badge tone="neutral">{t('common.inactive')}</Badge> : null}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPForm({
                        ...p,
                        starts_at: toLocalInput(p.starts_at),
                        ends_at: toLocalInput(p.ends_at),
                      });
                      setPromoEdit(p);
                      setPromoNew(false);
                    }}
                  >
                    {t('common.edit')}
                  </Button>
                </div>
              );
            })}
          </Card>
        )
      ) : coupons.rows.length === 0 ? (
        <Card>
          <EmptyState title={t('common.noResults')} />
        </Card>
      ) : (
        <Card className="divide-y divide-ink-100 overflow-hidden">
          {coupons.rows.map((c) => {
            const expired = c.ends_at && new Date(c.ends_at) < new Date();
            const exhausted = c.usage_limit !== null && c.used_count >= c.usage_limit;
            return (
              <div
                key={c.id}
                className={cx(
                  'flex flex-wrap items-center gap-3 p-3.5',
                  (!c.is_active || expired || exhausted) && 'opacity-60',
                )}
              >
                <div className="min-w-0 grow">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-[14px] font-semibold text-ink-900" dir="ltr">
                      {c.code}
                    </p>
                    <Badge tone={c.type === 'percent' ? 'brand' : 'gold'}>
                      {c.type === 'percent' ? `${num(c.value)}%` : money(c.value)}
                    </Badge>
                    {c.source !== 'manual' ? <Badge tone="neutral">{c.source}</Badge> : null}
                  </div>
                  <p className="mt-0.5 text-[12px] text-ink-400 tnum">
                    {t('admin.usedCount')}: {num(c.used_count)}
                    {c.usage_limit !== null ? ` / ${num(c.usage_limit)}` : ''}
                    {Number(c.min_order) > 0 ? ` · ${t('admin.minOrder')} ${money(c.min_order)}` : ''}
                    {c.ends_at ? ` · ${dateOnly(c.ends_at)}` : ''}
                  </p>
                </div>

                {expired ? <Badge tone="danger">{t('cart.coupon_expired')}</Badge> : null}
                {exhausted ? <Badge tone="warn">{t('cart.coupon_exhausted')}</Badge> : null}

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setCForm({
                      ...c,
                      starts_at: toLocalInput(c.starts_at),
                      ends_at: toLocalInput(c.ends_at),
                    });
                    setCouponEdit(c);
                    setCouponNew(false);
                  }}
                >
                  {t('common.edit')}
                </Button>
              </div>
            );
          })}
        </Card>
      )}

      {/* promo editor */}
      <Modal
        open={promoNew || Boolean(promoEdit)}
        onClose={() => {
          setPromoEdit(null);
          setPromoNew(false);
        }}
        title={promoEdit ? t('common.edit') : t('admin.newPromotion')}
        footer={
          <div className="flex items-center justify-between gap-2">
            {promoEdit ? (
              <Button variant="ghost" onClick={() => void destroyPromo(promoEdit)}>
                {t('common.delete')}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setPromoEdit(null);
                  setPromoNew(false);
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button loading={saving} onClick={() => void savePromo()}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {restaurant ? (
            <ImageUpload
              label={t('admin.photo')}
              value={pForm.image_url ?? null}
              onChange={(url) => setPForm((f) => ({ ...f, image_url: url }))}
              restaurantId={restaurant.id}
              folder="promotions"
              aspect="wide"
            />
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.promoTitle')} required>
              <Input
                value={pForm.title ?? ''}
                onChange={(e) => setPForm((f) => ({ ...f, title: e.target.value }))}
                dir="ltr"
              />
            </Field>
            <Field label={t('admin.promoTitleAr')} required>
              <Input
                value={pForm.title_ar ?? ''}
                onChange={(e) => setPForm((f) => ({ ...f, title_ar: e.target.value }))}
                dir="rtl"
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.promoSubtitle')}>
              <Textarea
                value={pForm.subtitle ?? ''}
                onChange={(e) => setPForm((f) => ({ ...f, subtitle: e.target.value }))}
                className="min-h-[60px]"
                dir="ltr"
              />
            </Field>
            <Field label={t('admin.promoSubtitleAr')}>
              <Textarea
                value={pForm.subtitle_ar ?? ''}
                onChange={(e) => setPForm((f) => ({ ...f, subtitle_ar: e.target.value }))}
                className="min-h-[60px]"
                dir="rtl"
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.startsAt')}>
              <Input
                type="datetime-local"
                value={(pForm.starts_at as string) ?? ''}
                onChange={(e) => setPForm((f) => ({ ...f, starts_at: e.target.value }))}
                dir="ltr"
              />
            </Field>
            <Field label={t('admin.endsAt')} hint={t('admin.endsAtHint')}>
              <Input
                type="datetime-local"
                value={(pForm.ends_at as string) ?? ''}
                onChange={(e) => setPForm((f) => ({ ...f, ends_at: e.target.value }))}
                dir="ltr"
              />
            </Field>
          </div>

          <Field label={t('admin.sortOrder')}>
            <Input
              type="number"
              value={pForm.sort_order ?? 0}
              onChange={(e) => setPForm((f) => ({ ...f, sort_order: Number(e.target.value) }))}
              className="max-w-[120px]"
              dir="ltr"
            />
          </Field>

          <Toggle
            checked={pForm.is_active ?? true}
            onChange={(v) => setPForm((f) => ({ ...f, is_active: v }))}
            label={t('common.active')}
          />
        </div>
      </Modal>

      {/* coupon editor */}
      <Modal
        open={couponNew || Boolean(couponEdit)}
        onClose={() => {
          setCouponEdit(null);
          setCouponNew(false);
        }}
        title={couponEdit ? couponEdit.code : t('admin.newCoupon')}
        footer={
          <div className="flex items-center justify-between gap-2">
            {couponEdit ? (
              <Button variant="ghost" onClick={() => void destroyCoupon(couponEdit)}>
                {t('common.delete')}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setCouponEdit(null);
                  setCouponNew(false);
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button loading={saving} onClick={() => void saveCoupon()}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label={t('admin.couponCode')} required>
            <Input
              value={cForm.code ?? ''}
              onChange={(e) =>
                setCForm((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') }))
              }
              dir="ltr"
              className="font-mono"
              maxLength={24}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.couponType')}>
              <Select
                value={cForm.type ?? 'percent'}
                onChange={(e) => setCForm((f) => ({ ...f, type: e.target.value as CouponType }))}
              >
                <option value="percent">{t('admin.couponPercent')}</option>
                <option value="fixed">{t('admin.couponFixed')}</option>
              </Select>
            </Field>
            <Field
              label={`${t('admin.couponValue')} ${cForm.type === 'fixed' ? `(${t('common.sar')})` : '(%)'}`}
              required
            >
              <Input
                type="number"
                min={0}
                step={cForm.type === 'fixed' ? '0.5' : '1'}
                value={cForm.value ?? ''}
                onChange={(e) => setCForm((f) => ({ ...f, value: Number(e.target.value) }))}
                dir="ltr"
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`${t('admin.minOrder')} (${t('common.sar')})`}>
              <Input
                type="number"
                min={0}
                step="0.5"
                value={cForm.min_order ?? 0}
                onChange={(e) => setCForm((f) => ({ ...f, min_order: Number(e.target.value) }))}
                dir="ltr"
              />
            </Field>
            <Field label={`${t('admin.maxDiscount')} (${t('common.optional')})`}>
              <Input
                type="number"
                min={0}
                step="0.5"
                value={cForm.max_discount ?? ''}
                onChange={(e) =>
                  setCForm((f) => ({
                    ...f,
                    max_discount: e.target.value ? Number(e.target.value) : null,
                  }))
                }
                dir="ltr"
              />
            </Field>
          </div>

          <Field label={t('admin.usageLimit')} hint={t('admin.usageLimitHint')}>
            <Input
              type="number"
              min={1}
              value={cForm.usage_limit ?? ''}
              onChange={(e) =>
                setCForm((f) => ({ ...f, usage_limit: e.target.value ? Number(e.target.value) : null }))
              }
              className="max-w-[160px]"
              dir="ltr"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.startsAt')}>
              <Input
                type="datetime-local"
                value={(cForm.starts_at as string) ?? ''}
                onChange={(e) => setCForm((f) => ({ ...f, starts_at: e.target.value }))}
                dir="ltr"
              />
            </Field>
            <Field label={t('admin.endsAt')} hint={t('admin.endsAtHint')}>
              <Input
                type="datetime-local"
                value={(cForm.ends_at as string) ?? ''}
                onChange={(e) => setCForm((f) => ({ ...f, ends_at: e.target.value }))}
                dir="ltr"
              />
            </Field>
          </div>

          <Toggle
            checked={cForm.is_active ?? true}
            onChange={(v) => setCForm((f) => ({ ...f, is_active: v }))}
            label={t('common.active')}
          />
        </div>
      </Modal>
    </div>
  );
}
