import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from '@/lib/useLocale';
import { useAuth } from '@/store/auth';
import { supabase, errorMessage } from '@/lib/supabase';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  Segmented,
  Skeleton,
  Textarea,
  cx,
  useToast,
} from '@/components/ui';
import { toCsv, downloadFile } from '@/lib/format';
import type { Order, OrderStatus } from '@/lib/types';

const OPEN_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'ready', 'served'];

export const STATUS_TONE: Record<
  OrderStatus,
  'neutral' | 'warn' | 'info' | 'brand' | 'success' | 'danger'
> = {
  pending: 'warn',
  confirmed: 'info',
  preparing: 'info',
  ready: 'brand',
  served: 'success',
  paid: 'success',
  cancelled: 'danger',
};

export function OrdersAdminPage() {
  const { t, money, num, locale, dateTime, elapsed } = useLocale();
  const { restaurant, isManager } = useAuth();
  const { push } = useToast();

  const [orders, setOrders] = useState<Order[] | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!restaurant) return;

    let q = supabase
      .from('orders')
      .select('*, order_items(*), restaurant_tables(label, code)')
      .eq('restaurant_id', restaurant.id)
      .order('placed_at', { ascending: false })
      .limit(200);

    if (filter === 'open') q = q.in('status', OPEN_STATUSES);

    const { data, error } = await q;
    if (error) {
      push(t('errors.loadFailed'), 'error');
      setOrders([]);
      return;
    }
    setOrders((data ?? []) as Order[]);
  }, [restaurant, filter, push, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!restaurant?.id) return;
    const channel = supabase
      .channel(`admin-orders-${restaurant.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurant.id}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [restaurant?.id, load]);

  // keep the open detail sheet in step with realtime updates
  useEffect(() => {
    if (!detail || !orders) return;
    const fresh = orders.find((o) => o.id === detail.id);
    if (fresh && fresh.status !== detail.status) setDetail(fresh);
  }, [orders, detail]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !orders) return orders ?? [];
    return orders.filter(
      (o) =>
        String(o.order_number).includes(q) ||
        (o.restaurant_tables?.label ?? '').toLowerCase().includes(q) ||
        (o.customer_name ?? '').toLowerCase().includes(q) ||
        (o.customer_phone ?? '').includes(q),
    );
  }, [orders, query]);

  async function setStatus(order: Order, status: OrderStatus, reason?: string) {
    setBusy(true);
    const patch: Record<string, unknown> = { status };
    if (status === 'cancelled' && reason) patch.cancel_reason = reason;

    const { error } = await supabase.from('orders').update(patch).eq('id', order.id);
    setBusy(false);

    if (error) {
      // the guard trigger rejects illegal moves and roles with a clear message
      push(errorMessage(error), 'error');
      return;
    }
    setCancelReason('');
    await load();
  }

  function exportCsv() {
    if (!orders?.length) return;
    const rows = orders.map((o) => [
      o.order_number,
      o.restaurant_tables?.label ?? '',
      o.status,
      o.customer_name ?? '',
      o.customer_phone ?? '',
      o.subtotal,
      o.discount_total,
      o.vat_total,
      o.total,
      o.coupon_code ?? '',
      o.placed_at,
      o.paid_at ?? '',
    ]);
    downloadFile(
      `orders-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        ['order', 'table', 'status', 'name', 'phone', 'subtotal', 'discount', 'vat', 'total', 'coupon', 'placed_at', 'paid_at'],
        rows,
      ),
      'text/csv',
    );
  }

  /** The buttons that make sense for the order's current state. */
  function actionsFor(o: Order) {
    const acts: { label: string; status: OrderStatus; variant?: 'primary' | 'outline' | 'danger' }[] = [];
    if (o.status === 'pending') acts.push({ label: t('waiter.confirmOrder'), status: 'confirmed' });
    if (o.status === 'confirmed') acts.push({ label: t('kitchen.startPreparing'), status: 'preparing' });
    if (o.status === 'preparing') acts.push({ label: t('kitchen.markReady'), status: 'ready' });
    if (o.status === 'ready') acts.push({ label: t('waiter.markServed'), status: 'served' });
    if (o.status === 'served') acts.push({ label: t('waiter.markPaid'), status: 'paid' });
    return acts;
  }

  if (orders === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-40" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold text-ink-900">{t('admin.ordersTitle')}</h1>
        <div className="flex items-center gap-2">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'open', label: t('admin.orderFilterOpen') },
              { value: 'all', label: t('admin.orderFilterAll') },
            ]}
          />
          {isManager ? (
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={!orders.length}>
              {t('admin.exportCsv')}
            </Button>
          ) : null}
        </div>
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('admin.orderSearch')}
        className="max-w-sm"
      />

      {visible.length === 0 ? (
        <Card>
          <EmptyState title={t('admin.noOrdersPeriod')} />
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((o) => (
            <Card key={o.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[15px] font-semibold text-ink-900 tnum">#{o.order_number}</h2>
                    <Badge tone={STATUS_TONE[o.status]} dot>
                      {t(`status.${o.status}`)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[12.5px] text-ink-500">
                    {t('waiter.table', { label: o.restaurant_tables?.label ?? '—' })}
                    {' · '}
                    {dateTime(o.placed_at)}
                    {OPEN_STATUSES.includes(o.status) ? ` · ${elapsed(o.placed_at)}` : ''}
                  </p>
                  {o.customer_name || o.customer_phone ? (
                    <p className="mt-0.5 text-[12.5px] text-ink-500">
                      {o.customer_name}
                      {o.customer_phone ? <span dir="ltr"> · {o.customer_phone}</span> : null}
                    </p>
                  ) : null}
                </div>

                <div className="text-end">
                  <p className="text-[16px] font-semibold text-ink-900 tnum">{money(o.total)}</p>
                  <p className="text-[12px] text-ink-400 tnum">
                    {t('waiter.itemsCount', {
                      count: o.order_items?.reduce((s, i) => s + i.quantity, 0) ?? 0,
                    })}
                  </p>
                </div>
              </div>

              <ul className="mt-3 space-y-1">
                {(o.order_items ?? []).slice(0, 4).map((it) => (
                  <li key={it.id} className="flex gap-2 text-[13px] text-ink-600">
                    <span className="font-medium text-ink-400 tnum">{it.quantity}×</span>
                    <span className="truncate">
                      {locale === 'ar' ? it.name_ar_snapshot : it.name_snapshot}
                    </span>
                  </li>
                ))}
                {(o.order_items?.length ?? 0) > 4 ? (
                  <li className="text-[12.5px] text-ink-400">
                    +{num((o.order_items?.length ?? 0) - 4)}
                  </li>
                ) : null}
              </ul>

              <div className="mt-3 flex flex-wrap gap-2 border-t border-ink-100 pt-3">
                {actionsFor(o).map((a) => (
                  <Button
                    key={a.status}
                    size="sm"
                    loading={busy}
                    onClick={() => void setStatus(o, a.status)}
                  >
                    {a.label}
                  </Button>
                ))}
                <Button size="sm" variant="outline" onClick={() => setDetail(o)}>
                  {t('common.edit')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* detail */}
      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? t('admin.orderDetail', { number: detail.order_number }) : ''}
        size="lg"
      >
        {detail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
              {[
                [t('admin.orderTable'), detail.restaurant_tables?.label ?? '—'],
                [t('common.total'), money(detail.total)],
                [t('admin.orderPlaced'), dateTime(detail.placed_at)],
                [t('admin.orderGuest'), detail.customer_name || '—'],
              ].map(([k, v]) => (
                <div key={String(k)} className="rounded-xl bg-ink-50 p-3">
                  <p className="text-[11.5px] text-ink-400">{k}</p>
                  <p className="mt-0.5 font-medium text-ink-800 tnum">{v}</p>
                </div>
              ))}
            </div>

            <div className="overflow-hidden rounded-xl border border-ink-200">
              {(detail.order_items ?? []).map((it) => (
                <div key={it.id} className="flex gap-3 border-b border-ink-100 p-3 last:border-0">
                  <span className="shrink-0 text-[13px] font-semibold text-ink-400 tnum">
                    {it.quantity}×
                  </span>
                  <div className="min-w-0 grow">
                    <p className="text-[14px] text-ink-800">
                      {locale === 'ar' ? it.name_ar_snapshot : it.name_snapshot}
                    </p>
                    {it.modifiers?.length ? (
                      <p className="mt-0.5 text-[12px] text-ink-500">
                        {it.modifiers
                          .map((m) => (locale === 'ar' ? m.name_ar || m.name : m.name))
                          .join(' · ')}
                      </p>
                    ) : null}
                    {it.notes ? (
                      <p className="mt-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[12px] text-amber-900">
                        {it.notes}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-[13px] text-ink-700 tnum">{money(it.line_total)}</span>
                </div>
              ))}
            </div>

            {detail.notes ? (
              <div className="rounded-xl bg-amber-50 p-3 text-[13px] text-amber-900">{detail.notes}</div>
            ) : null}

            <dl className="space-y-1.5 text-[13.5px]">
              {[
                [t('common.subtotal'), detail.subtotal],
                ...(Number(detail.discount_total) > 0
                  ? [[`${t('common.discount')} ${detail.coupon_code ?? ''}`, -detail.discount_total]]
                  : []),
                ...(Number(detail.service_charge) > 0
                  ? [[t('common.serviceCharge'), detail.service_charge]]
                  : []),
                [t('common.vat'), detail.vat_total],
                [t('common.total'), detail.total],
              ].map(([k, v], i, arr) => (
                <div
                  key={String(k)}
                  className={cx(
                    'flex justify-between',
                    i === arr.length - 1 && 'border-t border-ink-100 pt-1.5 font-semibold',
                  )}
                >
                  <dt className="text-ink-500">{k}</dt>
                  <dd className="text-ink-800 tnum">{money(Number(v))}</dd>
                </div>
              ))}
            </dl>

            {!['paid', 'cancelled'].includes(detail.status) ? (
              <div className="border-t border-ink-100 pt-4">
                <p className="label">{t('admin.cancelOrder')}</p>
                <Textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder={t('admin.cancelReason')}
                  className="min-h-[60px]"
                />
                <Button
                  variant="danger"
                  size="sm"
                  className="mt-2"
                  loading={busy}
                  onClick={() => void setStatus(detail, 'cancelled', cancelReason)}
                >
                  {t('admin.cancelOrder')}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
