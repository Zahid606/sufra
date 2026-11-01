import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '@/lib/useLocale';
import { useGuest } from '@/store/guest';
import { lineTotal, useCart } from '@/store/cart';
import { supabase } from '@/lib/supabase';
import { newIdempotencyKey } from '@/lib/session';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Textarea,
  cx,
  useToast,
} from '@/components/ui';
import type { CouponQuote, PlaceOrderResult } from '@/lib/types';

export function CartPage() {
  const { t, money, pick, locale } = useLocale();
  const navigate = useNavigate();
  const { restaurant, table, sessionId, pendingCoupon, setPendingCoupon } = useGuest();
  const { lines, count, subtotal, setQuantity, remove, clear, toPayload } = useCart();
  const { push } = useToast();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [guests, setGuests] = useState('');
  const [notes, setNotes] = useState('');

  const [couponInput, setCouponInput] = useState(pendingCoupon ?? '');
  const [coupon, setCoupon] = useState<{ code: string; discount: number } | null>(null);
  const [checkingCoupon, setCheckingCoupon] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  /**
   * One idempotency key per cart composition. A double tap, a flaky connection
   * or an impatient retry all carry the same key, so place_order returns the
   * original order instead of creating a second one. It is regenerated only
   * after a successful submit, or when the cart contents change.
   */
  const cartSignature = useMemo(
    () => lines.map((l) => `${l.key}x${l.quantity}`).join(','),
    [lines],
  );
  const idempotencyKey = useRef(newIdempotencyKey());
  useEffect(() => {
    idempotencyKey.current = newIdempotencyKey();
  }, [cartSignature]);

  /* ---- coupon ---- */

  const applyCoupon = useCallback(
    async (raw: string, silent = false) => {
      const code = raw.trim();
      if (!code) return;
      setCheckingCoupon(true);

      const { data, error } = await supabase.rpc('validate_coupon', {
        p_restaurant: restaurant.id,
        p_code: code,
        p_subtotal: subtotal,
        p_session_id: sessionId,
      });

      setCheckingCoupon(false);

      if (error) {
        if (!silent) push(t('errors.loadFailed'), 'error');
        return;
      }

      const quote = data as CouponQuote;
      if (!quote?.ok) {
        setCoupon(null);
        if (!silent) {
          const key = `cart.${quote?.error ?? 'coupon_not_found'}`;
          const msg = t(key, { min_order: String(quote?.min_order ?? '') });
          push(msg === key ? t('cart.coupon_not_found') : msg, 'error');
        }
        return;
      }

      setCoupon({ code: quote.code, discount: Number(quote.discount) });
      setPendingCoupon(quote.code);
      if (!silent) push(t('cart.couponApplied', { code: quote.code }), 'success');
    },
    [restaurant.id, subtotal, sessionId, push, t, setPendingCoupon],
  );

  // a code won from the wheel is validated quietly the first time the cart opens
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current || !pendingCoupon || !lines.length) return;
    autoTried.current = true;
    void applyCoupon(pendingCoupon, true);
  }, [pendingCoupon, lines.length, applyCoupon]);

  // the discount depends on the subtotal, so re-quote when the cart changes
  useEffect(() => {
    if (!coupon) return;
    void applyCoupon(coupon.code, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartSignature]);

  function removeCoupon() {
    setCoupon(null);
    setCouponInput('');
    setPendingCoupon(null);
  }

  /* ---- totals preview (the server recomputes these authoritatively) ---- */

  const discount = coupon?.discount ?? 0;
  const net = Math.max(0, subtotal - discount);
  const service = Math.round(net * Number(restaurant.service_charge_rate || 0) * 100) / 100;
  const vatRate = Number(restaurant.vat_rate || 0);
  const total = restaurant.prices_include_vat
    ? Math.round((net + service) * 100) / 100
    : Math.round((net + service) * (1 + vatRate) * 100) / 100;
  const vat = restaurant.prices_include_vat
    ? Math.round(((net + service) * vatRate) / (1 + vatRate) * 100) / 100
    : Math.round((net + service) * vatRate * 100) / 100;

  /* ---- submit ---- */

  async function placeOrder() {
    if (!lines.length || submitting) return;
    setSubmitting(true);

    const { data, error } = await supabase.rpc('place_order', {
      p_table_id: table.id,
      p_session_id: sessionId,
      p_items: toPayload(),
      p_idempotency_key: idempotencyKey.current,
      p_customer_name: name.trim() || null,
      p_customer_phone: phone.trim() || null,
      p_notes: notes.trim() || null,
      p_coupon_code: coupon?.code ?? null,
      p_guest_count: guests ? Number(guests) : null,
    });

    setSubmitting(false);

    if (error) {
      push(t('errors.loadFailed'), 'error');
      return;
    }

    const result = data as PlaceOrderResult;

    if (!result?.ok) {
      const key = `cart.${result?.error ?? 'error'}`;
      const msg = t(key, {
        name: String(locale === 'ar' ? result?.name_ar ?? result?.name ?? '' : result?.name ?? ''),
        group: String(locale === 'ar' ? result?.group_ar ?? result?.group ?? '' : result?.group ?? ''),
        max: String(result?.max ?? ''),
        min_order: String(result?.min_order ?? ''),
      });
      push(msg === key ? t('common.error') : msg, 'error');

      // a rejected cart keeps its contents so the guest can fix one line
      if (result?.error === 'duplicate_order') navigate('../orders');
      return;
    }

    clear();
    removeCoupon();
    idempotencyKey.current = newIdempotencyKey();
    navigate(`../orders?highlight=${result.order_id}`);
  }

  /* ---- empty ---- */

  if (!lines.length) {
    return (
      <EmptyState
        className="pt-16"
        icon={
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M5.5 8h13l-1.1 10.2A2 2 0 0 1 15.4 20H8.6a2 2 0 0 1-2-1.8L5.5 8Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path d="M9 8V6.5a3 3 0 0 1 6 0V8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        }
        title={t('cart.empty')}
        body={t('cart.emptyBody')}
        action={
          <Button onClick={() => navigate('..')} variant="outline">
            {t('cart.browseMenu')}
          </Button>
        }
      />
    );
  }

  return (
    <div className="px-4 py-5 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[17px] font-semibold text-ink-900">{t('cart.title')}</h1>
        <Badge tone="neutral">{t('cart.yourTable', { label: table.label_ar || table.label })}</Badge>
      </div>

      {/* lines */}
      <Card className="divide-y divide-ink-100 overflow-hidden">
        {lines.map((l) => {
          const label = locale === 'ar' ? l.nameAr || l.name : l.name;
          return (
            <div key={l.key} className="flex gap-3 p-3.5">
              {l.imageUrl ? (
                <img src={l.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover bg-ink-100" />
              ) : null}

              <div className="min-w-0 grow">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[14.5px] font-medium text-ink-900">{label}</h3>
                  <span className="shrink-0 text-[14px] font-semibold text-ink-900 tnum">
                    {money(lineTotal(l))}
                  </span>
                </div>

                {l.options.length ? (
                  <p className="mt-1 text-[12.5px] text-ink-500 leading-relaxed">
                    {l.options
                      .map((o) => (locale === 'ar' ? o.nameAr || o.name : o.name))
                      .join(' · ')}
                  </p>
                ) : null}

                {l.notes ? (
                  <p className="mt-1 text-[12.5px] italic text-ink-500">“{l.notes}”</p>
                ) : null}

                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <div className="flex items-center rounded-lg border border-ink-200">
                    <button
                      type="button"
                      onClick={() => setQuantity(l.key, l.quantity - 1)}
                      aria-label="−"
                      className="h-8 w-8 grid place-items-center text-ink-600"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                      </svg>
                    </button>
                    <span className="w-7 text-center text-[14px] font-semibold tnum">{l.quantity}</span>
                    <button
                      type="button"
                      onClick={() => setQuantity(l.key, l.quantity + 1)}
                      aria-label="+"
                      className="h-8 w-8 grid place-items-center text-ink-600"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => remove(l.key)}
                    className="text-[12.5px] font-medium text-ink-400 hover:text-red-600"
                  >
                    {t('cart.removeItem')}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </Card>

      {/* coupon */}
      <Card className="p-4">
        <Field label={t('cart.couponLabel')}>
          {coupon ? (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-brand-50 px-3.5 py-3">
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-brand-800">{coupon.code}</p>
                <p className="text-[12.5px] text-brand-700 tnum">− {money(coupon.discount)}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={removeCoupon}>
                {t('cart.couponRemove')}
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                placeholder={t('cart.couponPlaceholder')}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                dir="ltr"
                className="grow"
              />
              <Button
                variant="outline"
                loading={checkingCoupon}
                onClick={() => void applyCoupon(couponInput)}
                disabled={!couponInput.trim()}
              >
                {t('cart.couponApply')}
              </Button>
            </div>
          )}
        </Field>
      </Card>

      {/* guest details */}
      <Card className="p-4 space-y-4">
        <Field label={t('cart.nameLabel')} hint={t('cart.namePlaceholder')}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            autoComplete="name"
          />
        </Field>

        {restaurant.loyalty_enabled ? (
          <Field label={t('cart.phoneLabel')} hint={t('cart.phoneHint')}>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              type="tel"
              inputMode="tel"
              dir="ltr"
              placeholder="05XXXXXXXX"
              maxLength={20}
              autoComplete="tel"
            />
          </Field>
        ) : null}

        <Field label={t('cart.guestsLabel')}>
          <Input
            value={guests}
            onChange={(e) => setGuests(e.target.value.replace(/\D/g, '').slice(0, 2))}
            inputMode="numeric"
            dir="ltr"
            className="max-w-[120px]"
          />
        </Field>

        {restaurant.allow_customer_notes ? (
          <Field label={t('cart.notesLabel')}>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={400}
              className="min-h-[72px]"
            />
          </Field>
        ) : null}
      </Card>

      {/* totals */}
      <Card className="p-4">
        <dl className="space-y-2.5 text-[14px]">
          <div className="flex justify-between">
            <dt className="text-ink-500">{t('common.subtotal')}</dt>
            <dd className="text-ink-800 tnum">{money(subtotal)}</dd>
          </div>

          {discount > 0 ? (
            <div className="flex justify-between">
              <dt className="text-brand-700">{t('common.discount')}</dt>
              <dd className="text-brand-700 tnum">− {money(discount)}</dd>
            </div>
          ) : null}

          {service > 0 ? (
            <div className="flex justify-between">
              <dt className="text-ink-500">{t('common.serviceCharge')}</dt>
              <dd className="text-ink-800 tnum">{money(service)}</dd>
            </div>
          ) : null}

          <div className="flex justify-between">
            <dt className="text-ink-500">
              {t('common.vat')}
              {restaurant.prices_include_vat ? (
                <span className="text-[12px] text-ink-400 ms-1">({t('common.vatIncluded')})</span>
              ) : null}
            </dt>
            <dd className="text-ink-800 tnum">{money(vat)}</dd>
          </div>

          <div className="flex justify-between border-t border-ink-100 pt-2.5">
            <dt className="text-[15px] font-semibold text-ink-900">{t('common.total')}</dt>
            <dd className="text-[17px] font-semibold text-ink-900 tnum">{money(total)}</dd>
          </div>
        </dl>

        <div className="mt-4 rounded-xl bg-ink-50 p-3">
          <p className="text-[12.5px] leading-relaxed text-ink-600">
            {restaurant.requires_waiter_confirmation ? `${t('cart.waiterWillConfirm')} ` : ''}
            {t('cart.payAtCashier')}
          </p>
        </div>
      </Card>

      <div className="pt-1 pb-2">
        <Button
          size="lg"
          block
          loading={submitting}
          onClick={() => void placeOrder()}
          className={cx('shadow-card')}
        >
          <span className="flex w-full items-center justify-between gap-3">
            <span>{submitting ? t('cart.placing') : t('cart.placeOrder')}</span>
            <span className="tnum">
              {count} · {money(total)}
            </span>
          </span>
        </Button>
      </div>
    </div>
  );
}
