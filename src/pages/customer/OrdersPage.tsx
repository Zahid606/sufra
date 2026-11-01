import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLocale } from '@/lib/useLocale';
import { useGuest } from '@/store/guest';
import { supabase } from '@/lib/supabase';
import { Badge, Button, Card, EmptyState, Skeleton, cx, useToast } from '@/components/ui';
import type { GuestOrder, OrderStatus } from '@/lib/types';

/** The visible lifecycle, in order. 'paid' is a terminal step shown separately. */
const FLOW: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'ready', 'served'];

const TONE: Record<OrderStatus, 'neutral' | 'warn' | 'info' | 'brand' | 'success' | 'danger'> = {
  pending: 'warn',
  confirmed: 'info',
  preparing: 'info',
  ready: 'brand',
  served: 'success',
  paid: 'success',
  cancelled: 'danger',
};

function StatusTrack({ status }: { status: OrderStatus }) {
  const { t } = useLocale();

  if (status === 'cancelled') {
    return (
      <div className="rounded-xl bg-red-50 p-3.5">
        <p className="text-[14px] font-semibold text-red-800">{t('status.cancelled')}</p>
        <p className="mt-0.5 text-[12.5px] text-red-700">{t('status.cancelledHint')}</p>
      </div>
    );
  }

  const current = status === 'paid' ? FLOW.length - 1 : FLOW.indexOf(status);

  return (
    <div>
      <div className="flex items-center gap-1.5">
        {FLOW.map((s, i) => (
          <div key={s} className="flex grow items-center gap-1.5">
            <span
              className={cx(
                'h-1.5 grow rounded-full transition-colors',
                i <= current ? 'bg-brand-600' : 'bg-ink-200',
              )}
            />
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-start gap-3">
        <span
          className={cx(
            'mt-0.5 h-9 w-9 shrink-0 rounded-full grid place-items-center',
            status === 'ready' ? 'bg-brand-600 text-white animate-pulse-ring' : 'bg-brand-100 text-brand-700',
          )}
        >
          {status === 'served' || status === 'paid' ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="m5 13 4 4L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
              <path d="M12 8v4.2l2.8 1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          )}
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-ink-900">{t(`status.${status}`)}</p>
          <p className="mt-0.5 text-[13px] text-ink-500 leading-relaxed">
            {t(`status.${status}Hint`)}
          </p>
        </div>
      </div>
    </div>
  );
}

export function OrdersPage() {
  const { t, money, locale, time, elapsed } = useLocale();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const highlight = params.get('highlight');
  const { restaurant, table, sessionId } = useGuest();
  const { push } = useToast();

  const [orders, setOrders] = useState<GuestOrder[] | null>(null);
  const [requesting, setRequesting] = useState<string | null>(null);
  const [requested, setRequested] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_my_orders', {
      p_session_id: sessionId,
      p_restaurant: restaurant.id,
    });
    if (error) {
      setOrders([]);
      return;
    }
    setOrders((data ?? []) as GuestOrder[]);
  }, [sessionId, restaurant.id]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Realtime on this table's orders. The guest's own rows are the only ones
   * that matter, but the filter has to be server-side, so we filter by table
   * and then match the session id on arrival.
   */
  const knownStatuses = useRef<Map<string, OrderStatus>>(new Map());

  useEffect(() => {
    const channel = supabase
      .channel(`guest-orders-${table.id}-${sessionId.slice(0, 8)}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `table_id=eq.${table.id}`,
        },
        (payload) => {
          const row = payload.new as { session_id?: string; id?: string; status?: OrderStatus };
          if (row?.session_id && row.session_id !== sessionId) return;

          // announce only genuine transitions, not the echo of our own insert
          if (row.id && row.status) {
            const prev = knownStatuses.current.get(row.id);
            if (prev && prev !== row.status && row.status === 'ready') {
              push(t('status.ready'), 'success');
            }
          }
          void load();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [table.id, sessionId, load, push, t]);

  useEffect(() => {
    if (!orders) return;
    const next = new Map<string, OrderStatus>();
    for (const o of orders) next.set(o.id, o.status);
    knownStatuses.current = next;
  }, [orders]);

  // a slow poll as a safety net: realtime can drop on a flaky restaurant wifi
  useEffect(() => {
    const id = setInterval(() => void load(), 20000);
    return () => clearInterval(id);
  }, [load]);

  async function requestService(type: 'waiter' | 'bill' | 'water') {
    setRequesting(type);
    const openOrder = orders?.find((o) => !['paid', 'cancelled'].includes(o.status));

    const { data, error } = await supabase.rpc('request_service', {
      p_table_id: table.id,
      p_session_id: sessionId,
      p_type: type,
      p_note: null,
      p_order_id: openOrder?.id ?? null,
    });

    setRequesting(null);

    if (error) {
      push(t('errors.loadFailed'), 'error');
      return;
    }

    const res = data as { ok: boolean; error?: string };
    if (!res?.ok) {
      const key = `status.${res?.error ?? 'error'}`;
      const msg = t(key);
      push(msg === key ? t('common.error') : msg, 'info');
      return;
    }

    setRequested((prev) => new Set(prev).add(type));
    push(t('status.requested'), 'success');
    setTimeout(() => {
      setRequested((prev) => {
        const next = new Set(prev);
        next.delete(type);
        return next;
      });
    }, 95000);
  }

  if (orders === null) {
    return (
      <div className="px-4 py-5 space-y-3">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  const latest = orders[0];
  const canReview = restaurant.reviews_enabled && orders.some((o) => ['served', 'paid'].includes(o.status));

  return (
    <div className="px-4 py-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[17px] font-semibold text-ink-900">{t('status.title')}</h1>
        {orders.length ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-400">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500 animate-pulse" />
            {t('status.liveUpdating')}
          </span>
        ) : null}
      </div>

      {/* table service — useful even with no order yet */}
      <Card className="p-4">
        <div className="grid grid-cols-3 gap-2">
          {([
            ['waiter', t('status.callWaiter')],
            ['bill', t('status.requestBill')],
            ['water', t('status.requestWater')],
          ] as const).map(([type, label]) => (
            <Button
              key={type}
              variant={requested.has(type) ? 'secondary' : 'outline'}
              size="md"
              loading={requesting === type}
              disabled={requested.has(type)}
              onClick={() => void requestService(type)}
              className="flex-col !h-auto py-3 gap-1.5 text-[12.5px] leading-tight text-center"
            >
              {requested.has(type) ? t('status.requested') : label}
            </Button>
          ))}
        </div>
        {latest && ['served', 'paid'].includes(latest.status) ? (
          <p className="mt-3 text-[12.5px] text-ink-500">{t('status.payAtCashierNote')}</p>
        ) : null}
      </Card>

      {orders.length === 0 ? (
        <EmptyState
          title={t('status.noOrders')}
          body={t('status.noOrdersBody')}
          action={
            <Button variant="outline" onClick={() => navigate('..')}>
              {t('cart.browseMenu')}
            </Button>
          }
        />
      ) : (
        orders.map((o) => (
          <Card
            key={o.id}
            className={cx(
              'overflow-hidden',
              highlight === o.id && 'ring-2 ring-brand-500 ring-offset-2 ring-offset-ink-50',
            )}
          >
            <div className="flex items-start justify-between gap-3 p-4 pb-3">
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold text-ink-900">
                  {t('status.orderNumber', { number: o.order_number })}
                </h2>
                <p className="mt-0.5 text-[12.5px] text-ink-500">
                  {t('status.placedAt', { time: time(o.placed_at) })}
                  {' · '}
                  {elapsed(o.placed_at)}
                </p>
              </div>
              <Badge tone={TONE[o.status]} dot>
                {t(`status.${o.status}`)}
              </Badge>
            </div>

            <div className="px-4 pb-4">
              <StatusTrack status={o.status} />
            </div>

            <div className="divide-y divide-ink-100 border-t border-ink-100">
              {o.items.map((it) => (
                <div key={it.id} className="flex gap-3 px-4 py-3">
                  <span className="shrink-0 text-[13px] font-semibold text-ink-400 tnum">
                    {it.quantity}×
                  </span>
                  <div className="min-w-0 grow">
                    <p className="text-[14px] text-ink-800">
                      {locale === 'ar' ? it.name_ar || it.name : it.name}
                    </p>
                    {it.modifiers?.length ? (
                      <p className="mt-0.5 text-[12px] text-ink-500">
                        {it.modifiers
                          .map((m) => (locale === 'ar' ? m.name_ar || m.name : m.name))
                          .join(' · ')}
                      </p>
                    ) : null}
                    {it.notes ? (
                      <p className="mt-0.5 text-[12px] italic text-ink-500">“{it.notes}”</p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-[13.5px] text-ink-700 tnum">
                    {money(it.line_total)}
                  </span>
                </div>
              ))}
            </div>

            <div className="bg-ink-50 px-4 py-3.5">
              <dl className="space-y-1.5 text-[13px]">
                <div className="flex justify-between">
                  <dt className="text-ink-500">{t('common.subtotal')}</dt>
                  <dd className="text-ink-700 tnum">{money(o.subtotal)}</dd>
                </div>
                {Number(o.discount_total) > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-brand-700">
                      {t('common.discount')}
                      {o.coupon_code ? <span className="ms-1 text-ink-400">({o.coupon_code})</span> : null}
                    </dt>
                    <dd className="text-brand-700 tnum">− {money(o.discount_total)}</dd>
                  </div>
                ) : null}
                {Number(o.service_charge) > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-ink-500">{t('common.serviceCharge')}</dt>
                    <dd className="text-ink-700 tnum">{money(o.service_charge)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <dt className="text-ink-500">{t('common.vat')}</dt>
                  <dd className="text-ink-700 tnum">{money(o.vat_total)}</dd>
                </div>
                <div className="flex justify-between border-t border-ink-200 pt-1.5">
                  <dt className="text-[14px] font-semibold text-ink-900">{t('common.total')}</dt>
                  <dd className="text-[15px] font-semibold text-ink-900 tnum">{money(o.total)}</dd>
                </div>
              </dl>

              {o.loyalty_points_earned > 0 ? (
                <div className="mt-3">
                  <Badge tone="gold">
                    {t('status.pointsEarned', { points: o.loyalty_points_earned })}
                  </Badge>
                </div>
              ) : null}
            </div>
          </Card>
        ))
      )}

      <div className="flex flex-col gap-2 pt-1">
        {canReview ? (
          <Button variant="gold" block onClick={() => navigate('../review')}>
            {t('status.leaveReview')}
          </Button>
        ) : null}
        <Button variant="outline" block onClick={() => navigate('..')}>
          {t('status.orderAgain')}
        </Button>
      </div>
    </div>
  );
}
