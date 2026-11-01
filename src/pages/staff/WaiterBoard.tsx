import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLocale } from '@/lib/useLocale';
import { useAuth } from '@/store/auth';
import { supabase, errorMessage } from '@/lib/supabase';
import { useChime } from '@/lib/useChime';
import { LanguageToggle } from '@/components/LanguageToggle';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Segmented,
  Skeleton,
  cx,
  useToast,
} from '@/components/ui';
import { initials } from '@/lib/format';
import type { Order, OrderStatus, ServiceRequest } from '@/lib/types';

const ACTIVE: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'ready', 'served'];

const REQUEST_TONE: Record<string, 'warn' | 'danger' | 'info' | 'neutral'> = {
  waiter: 'warn',
  bill: 'danger',
  water: 'info',
  cleaning: 'neutral',
  cutlery: 'neutral',
};

export function WaiterBoard() {
  const { t, money, num, locale, elapsed, time } = useLocale();
  const { restaurant, profile, signOut } = useAuth();
  const { push } = useToast();
  const chime = useChime();

  const [orders, setOrders] = useState<Order[] | null>(null);
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [tab, setTab] = useState<'new' | 'progress' | 'requests'>('new');
  const [busy, setBusy] = useState<string | null>(null);

  /** ids already seen, so the chime fires once per genuinely new ticket. */
  const seenOrders = useRef<Set<string>>(new Set());
  const seenRequests = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  const load = useCallback(async () => {
    if (!restaurant) return;

    const [o, r] = await Promise.all([
      supabase
        .from('orders')
        .select('*, order_items(*), restaurant_tables(label, code)')
        .eq('restaurant_id', restaurant.id)
        .in('status', ACTIVE)
        .order('placed_at', { ascending: true }),
      supabase
        .from('service_requests')
        .select('*, restaurant_tables(label, code)')
        .eq('restaurant_id', restaurant.id)
        .in('status', ['open', 'acknowledged'])
        .order('created_at', { ascending: true }),
    ]);

    const nextOrders = (o.data ?? []) as Order[];
    const nextRequests = (r.data ?? []) as ServiceRequest[];

    // the first load primes the "seen" sets without making a sound, so a
    // waiter opening the board at the start of a shift is not greeted by a
    // burst of chimes for orders that arrived while nobody was looking
    if (!primed.current) {
      for (const x of nextOrders) seenOrders.current.add(x.id);
      for (const x of nextRequests) seenRequests.current.add(x.id);
      primed.current = true;
    } else {
      const fresh = nextOrders.filter((x) => x.status === 'pending' && !seenOrders.current.has(x.id));
      const freshReq = nextRequests.filter((x) => !seenRequests.current.has(x.id));

      if (fresh.length) {
        chime.play('order');
        push(
          t('waiter.newOrderAlert', { label: fresh[0].restaurant_tables?.label ?? '—' }),
          'info',
        );
      }
      if (freshReq.length) {
        chime.play('request');
        push(
          t('waiter.newRequestAlert', { label: freshReq[0].restaurant_tables?.label ?? '—' }),
          'info',
        );
      }

      for (const x of nextOrders) seenOrders.current.add(x.id);
      for (const x of nextRequests) seenRequests.current.add(x.id);
    }

    setOrders(nextOrders);
    setRequests(nextRequests);
  }, [restaurant, chime, push, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!restaurant?.id) return;

    const channel = supabase
      .channel(`waiter-${restaurant.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurant.id}` },
        () => void load(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'service_requests',
          filter: `restaurant_id=eq.${restaurant.id}`,
        },
        () => void load(),
      )
      .subscribe();

    // a slow poll keeps the board honest if the socket drops on venue wifi
    const poll = setInterval(() => void load(), 25000);

    return () => {
      void supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [restaurant?.id, load]);

  // re-render once a minute so the "waiting 6 min" labels stay truthful
  const [, setClock] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setClock((c) => c + 1), 30000);
    return () => clearInterval(id);
  }, []);

  async function setStatus(order: Order, status: OrderStatus) {
    setBusy(order.id);
    const { error } = await supabase.from('orders').update({ status }).eq('id', order.id);
    setBusy(null);

    if (error) {
      push(errorMessage(error), 'error');
      return;
    }
    await load();
  }

  async function resolveRequest(r: ServiceRequest, status: 'acknowledged' | 'resolved') {
    setBusy(r.id);
    const patch: Record<string, unknown> = { status, handled_by: profile?.id ?? null };
    patch[status === 'acknowledged' ? 'acknowledged_at' : 'resolved_at'] = new Date().toISOString();

    const { error } = await supabase.from('service_requests').update(patch).eq('id', r.id);
    setBusy(null);

    if (error) {
      push(errorMessage(error), 'error');
      return;
    }
    await load();
  }

  const pendingOrders = useMemo(() => (orders ?? []).filter((o) => o.status === 'pending'), [orders]);
  const inProgress = useMemo(
    () => (orders ?? []).filter((o) => o.status !== 'pending'),
    [orders],
  );

  const list = tab === 'new' ? pendingOrders : tab === 'progress' ? inProgress : [];

  function actionsFor(o: Order) {
    switch (o.status) {
      case 'pending':
        return [
          { label: t('waiter.confirmOrder'), status: 'confirmed' as OrderStatus, variant: 'primary' as const },
          { label: t('waiter.reject'), status: 'cancelled' as OrderStatus, variant: 'outline' as const },
        ];
      case 'ready':
        return [{ label: t('waiter.markServed'), status: 'served' as OrderStatus, variant: 'primary' as const }];
      case 'served':
        return [{ label: t('waiter.markPaid'), status: 'paid' as OrderStatus, variant: 'primary' as const }];
      default:
        return [];
    }
  }

  return (
    <div className="min-h-dvh bg-ink-100">
      <header className="sticky top-0 z-30 border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <h1 className="text-[16px] font-semibold text-ink-900">{t('waiter.title')}</h1>
          <span className="text-[13px] text-ink-400">
            {locale === 'ar' ? restaurant?.name_ar : restaurant?.name}
          </span>

          <div className="ms-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                chime.unlock();
                chime.setEnabled(!chime.enabled);
                if (!chime.enabled) chime.play('request');
              }}
              className={cx(
                'rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors',
                chime.enabled ? 'bg-brand-100 text-brand-800' : 'bg-ink-100 text-ink-500',
              )}
            >
              {chime.enabled ? t('waiter.soundOn') : t('waiter.soundOff')}
            </button>
            <LanguageToggle />
            <Link to="/kitchen">
              <Button size="sm" variant="ghost">
                {t('nav.kitchen')}
              </Button>
            </Link>
            <div className="h-8 w-8 rounded-full bg-ink-100 text-[11px] font-semibold text-ink-600 grid place-items-center">
              {initials(profile?.full_name)}
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              aria-label={t('common.signOut')}
              className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M15 17l5-5-5-5M20 12H9M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="mx-auto max-w-5xl px-4 pb-3">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'new', label: t('waiter.newOrders'), count: pendingOrders.length },
              { value: 'progress', label: t('waiter.inProgress'), count: inProgress.length },
              { value: 'requests', label: t('waiter.requests'), count: requests.length },
            ]}
          />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-4">
        {orders === null ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-44" />
            ))}
          </div>
        ) : tab === 'requests' ? (
          requests.length === 0 ? (
            <Card>
              <EmptyState title={t('waiter.noNew')} body={t('waiter.noNewBody')} />
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {requests.map((r) => (
                <Card
                  key={r.id}
                  className={cx(
                    'p-4',
                    r.status === 'open' && 'ring-2 ring-amber-300',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[17px] font-semibold text-ink-900">
                        {t('waiter.table', { label: r.restaurant_tables?.label ?? '—' })}
                      </p>
                      <Badge tone={REQUEST_TONE[r.type] ?? 'neutral'} className="mt-1.5">
                        {t(`waiter.${r.type}`)}
                      </Badge>
                    </div>
                    <span className="shrink-0 text-[12.5px] text-ink-400 tnum">
                      {elapsed(r.created_at)}
                    </span>
                  </div>

                  {r.note ? (
                    <p className="mt-2.5 text-[13px] text-ink-600">{r.note}</p>
                  ) : null}

                  <div className="mt-3 flex gap-2">
                    {r.status === 'open' ? (
                      <Button
                        size="sm"
                        loading={busy === r.id}
                        onClick={() => void resolveRequest(r, 'acknowledged')}
                      >
                        {t('waiter.acknowledge')}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      loading={busy === r.id}
                      onClick={() => void resolveRequest(r, 'resolved')}
                    >
                      {t('waiter.resolve')}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )
        ) : list.length === 0 ? (
          <Card>
            <EmptyState title={t('waiter.noNew')} body={t('waiter.noNewBody')} />
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((o) => {
              const waitingMinutes = Math.floor((Date.now() - new Date(o.placed_at).getTime()) / 60000);
              const stale = o.status === 'pending' && waitingMinutes >= 4;

              return (
                <Card
                  key={o.id}
                  className={cx(
                    'flex flex-col p-4',
                    o.status === 'pending' && 'ring-2 ring-amber-300',
                    stale && 'ring-red-400',
                    o.status === 'ready' && 'ring-2 ring-brand-400',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[18px] font-semibold leading-tight text-ink-900">
                        {t('waiter.table', { label: o.restaurant_tables?.label ?? '—' })}
                      </p>
                      <p className="mt-0.5 text-[12.5px] text-ink-400 tnum">
                        #{o.order_number} · {time(o.placed_at)}
                      </p>
                    </div>
                    <div className="shrink-0 text-end">
                      <Badge
                        tone={
                          o.status === 'pending'
                            ? stale
                              ? 'danger'
                              : 'warn'
                            : o.status === 'ready'
                              ? 'brand'
                              : 'info'
                        }
                        dot
                      >
                        {t(`status.${o.status}`)}
                      </Badge>
                      <p className={cx('mt-1 text-[12px] tnum', stale ? 'text-red-600 font-semibold' : 'text-ink-400')}>
                        {t('waiter.waitingFor', { time: elapsed(o.placed_at) })}
                      </p>
                    </div>
                  </div>

                  {o.customer_name ? (
                    <p className="mt-2 text-[12.5px] text-ink-500">
                      {t('waiter.guestName')}: {o.customer_name}
                      {o.guest_count ? ` · ${num(o.guest_count)}` : ''}
                    </p>
                  ) : null}

                  <ul className="mt-3 grow space-y-1.5">
                    {(o.order_items ?? []).map((it) => (
                      <li key={it.id} className="text-[13.5px]">
                        <div className="flex gap-2">
                          <span className="shrink-0 font-semibold text-ink-500 tnum">
                            {it.quantity}×
                          </span>
                          <span className="text-ink-800">
                            {locale === 'ar' ? it.name_ar_snapshot : it.name_snapshot}
                          </span>
                        </div>
                        {it.modifiers?.length ? (
                          <p className="ms-6 text-[12px] text-ink-500">
                            {it.modifiers
                              .map((m) => (locale === 'ar' ? m.name_ar || m.name : m.name))
                              .join(' · ')}
                          </p>
                        ) : null}
                        {it.notes ? (
                          <p className="ms-6 mt-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[12px] text-amber-900">
                            {it.notes}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>

                  {o.notes ? (
                    <p className="mt-2 rounded-lg bg-amber-50 p-2 text-[12.5px] text-amber-900">
                      {o.notes}
                    </p>
                  ) : null}

                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-ink-100 pt-3">
                    <span className="text-[15px] font-semibold text-ink-900 tnum">{money(o.total)}</span>
                    {o.coupon_code ? <Badge tone="gold">{o.coupon_code}</Badge> : null}
                  </div>

                  <div className="mt-2.5 flex gap-2">
                    {actionsFor(o).map((a) => (
                      <Button
                        key={a.status}
                        size="md"
                        variant={a.variant}
                        className="grow"
                        loading={busy === o.id}
                        onClick={() => void setStatus(o, a.status)}
                      >
                        {a.label}
                      </Button>
                    ))}
                    {actionsFor(o).length === 0 ? (
                      <p className="w-full text-center text-[12.5px] text-ink-400">
                        {t(`status.${o.status}Hint`)}
                      </p>
                    ) : null}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
