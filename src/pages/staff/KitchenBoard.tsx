import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLocale } from '@/lib/useLocale';
import { useAuth } from '@/store/auth';
import { supabase, errorMessage } from '@/lib/supabase';
import { useChime } from '@/lib/useChime';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Badge, Button, Card, EmptyState, Skeleton, cx, useToast } from '@/components/ui';
import type { Order, OrderStatus } from '@/lib/types';

const COLUMNS: { status: OrderStatus; next?: OrderStatus }[] = [
  { status: 'confirmed', next: 'preparing' },
  { status: 'preparing', next: 'ready' },
  { status: 'ready' },
];

/**
 * A three-column ticket rail, built for a wall-mounted tablet: large type,
 * no modals, one tap to advance. Tickets turn amber then red as they age, so
 * the oldest thing on the pass is the loudest thing on the screen.
 */
export function KitchenBoard() {
  const { t, num, locale, elapsed, time } = useLocale();
  const { restaurant, signOut } = useAuth();
  const { push } = useToast();
  const chime = useChime();

  const [orders, setOrders] = useState<Order[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  const load = useCallback(async () => {
    if (!restaurant) return;

    const { data } = await supabase
      .from('orders')
      .select('*, order_items(*), restaurant_tables(label, code)')
      .eq('restaurant_id', restaurant.id)
      .in('status', ['confirmed', 'preparing', 'ready'])
      .order('placed_at', { ascending: true });

    const rows = (data ?? []) as Order[];

    if (!primed.current) {
      for (const o of rows) seen.current.add(o.id);
      primed.current = true;
    } else {
      const fresh = rows.filter((o) => o.status === 'confirmed' && !seen.current.has(o.id));
      if (fresh.length) {
        chime.play('order');
        push(t('waiter.newOrderAlert', { label: fresh[0].restaurant_tables?.label ?? '—' }), 'info');
      }
      for (const o of rows) seen.current.add(o.id);
    }

    setOrders(rows);
  }, [restaurant, chime, push, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!restaurant?.id) return;
    const channel = supabase
      .channel(`kitchen-${restaurant.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurant.id}` },
        () => void load(),
      )
      .subscribe();

    const poll = setInterval(() => void load(), 25000);

    return () => {
      void supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [restaurant?.id, load]);

  const [, setClock] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setClock((c) => c + 1), 20000);
    return () => clearInterval(id);
  }, []);

  async function advance(order: Order, status: OrderStatus) {
    setBusy(order.id);
    const { error } = await supabase.from('orders').update({ status }).eq('id', order.id);
    setBusy(null);

    if (error) {
      push(errorMessage(error), 'error');
      return;
    }
    await load();
  }

  /** Total quantity of each dish still to cook, for the prep station. */
  const allDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of orders ?? []) {
      if (o.status === 'ready') continue;
      for (const it of o.order_items ?? []) {
        const key = locale === 'ar' ? it.name_ar_snapshot : it.name_snapshot;
        map.set(key, (map.get(key) ?? 0) + it.quantity);
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [orders, locale]);

  function ageTone(o: Order): string {
    const mins = Math.floor((Date.now() - new Date(o.confirmed_at ?? o.placed_at).getTime()) / 60000);
    if (o.status === 'ready') return 'ring-brand-400';
    if (mins >= 18) return 'ring-red-500';
    if (mins >= 10) return 'ring-amber-400';
    return 'ring-ink-200';
  }

  return (
    <div className="min-h-dvh bg-ink-950 text-white">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-ink-900">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3">
          <h1 className="text-[17px] font-semibold">{t('kitchen.title')}</h1>
          <span className="text-[13px] text-white/45">
            {locale === 'ar' ? restaurant?.name_ar : restaurant?.name}
          </span>

          <div className="ms-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                chime.unlock();
                chime.setEnabled(!chime.enabled);
                if (!chime.enabled) chime.play('order');
              }}
              className={cx(
                'rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors',
                chime.enabled ? 'bg-brand-500/25 text-brand-100' : 'bg-white/10 text-white/50',
              )}
            >
              {chime.enabled ? t('waiter.soundOn') : t('waiter.soundOff')}
            </button>
            <LanguageToggle variant="glass" />
            <Link to="/waiter">
              <Button size="sm" variant="outline" className="!bg-white/10 !text-white !border-white/20">
                {t('nav.waiter')}
              </Button>
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              aria-label={t('common.signOut')}
              className="rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white"
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
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-4">
        {/* all-day counts */}
        {allDay.length ? (
          <div className="mb-4 rounded-2xl bg-white/[0.06] p-3.5">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-white/45">
              {t('kitchen.allDay')}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {allDay.map(([name, qty]) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1 text-[13px]"
                >
                  <span className="font-semibold text-gold-300 tnum">{num(qty)}</span>
                  <span className="text-white/80">{name}</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {orders === null ? (
          <div className="grid gap-4 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-64 !bg-white/10" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {COLUMNS.map(({ status, next }) => {
              const list = (orders ?? []).filter((o) => o.status === status);

              return (
                <section key={status}>
                  <div className="mb-2.5 flex items-center justify-between gap-2">
                    <h2 className="text-[14px] font-semibold text-white/85">
                      {t(`kitchen.${status === 'confirmed' ? 'confirmed' : status}`)}
                    </h2>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[12px] text-white/60 tnum">
                      {num(list.length)}
                    </span>
                  </div>

                  {list.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/15 py-10 text-center">
                      <p className="text-[13px] text-white/35">{t('kitchen.noOrders')}</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {list.map((o) => (
                        <Card
                          key={o.id}
                          className={cx(
                            '!bg-ink-900 !border-0 p-4 ring-2',
                            ageTone(o),
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-[19px] font-semibold leading-tight text-white">
                                {o.restaurant_tables?.label ?? '—'}
                              </p>
                              <p className="mt-0.5 text-[12px] text-white/40 tnum">
                                #{o.order_number} · {time(o.placed_at)}
                              </p>
                            </div>
                            <span className="shrink-0 rounded-lg bg-white/10 px-2 py-1 text-[12.5px] font-medium text-white/80 tnum">
                              {t('kitchen.elapsed', { time: elapsed(o.confirmed_at ?? o.placed_at) })}
                            </span>
                          </div>

                          <ul className="mt-3 space-y-2">
                            {(o.order_items ?? []).map((it) => (
                              <li key={it.id}>
                                <div className="flex gap-2">
                                  <span className="shrink-0 text-[16px] font-bold text-gold-300 tnum">
                                    {it.quantity}×
                                  </span>
                                  <span className="text-[15px] leading-snug text-white">
                                    {locale === 'ar' ? it.name_ar_snapshot : it.name_snapshot}
                                  </span>
                                </div>
                                {it.modifiers?.length ? (
                                  <p className="ms-7 text-[13px] text-white/55">
                                    {it.modifiers
                                      .map((m) => (locale === 'ar' ? m.name_ar || m.name : m.name))
                                      .join(' · ')}
                                  </p>
                                ) : null}
                                {it.notes ? (
                                  <p className="ms-7 mt-1 rounded bg-amber-400/20 px-2 py-1 text-[13px] font-medium text-amber-200">
                                    {t('kitchen.itemNote')}: {it.notes}
                                  </p>
                                ) : null}
                              </li>
                            ))}
                          </ul>

                          {o.notes ? (
                            <p className="mt-3 rounded-lg bg-amber-400/20 p-2 text-[13px] font-medium text-amber-200">
                              {o.notes}
                            </p>
                          ) : null}

                          {next ? (
                            <Button
                              size="lg"
                              block
                              className="mt-3"
                              loading={busy === o.id}
                              onClick={() => void advance(o, next)}
                            >
                              {next === 'preparing' ? t('kitchen.startPreparing') : t('kitchen.markReady')}
                            </Button>
                          ) : (
                            <div className="mt-3 rounded-xl bg-brand-500/20 py-2.5 text-center">
                              <p className="text-[13px] font-medium text-brand-100">
                                {t('status.readyHint')}
                              </p>
                            </div>
                          )}
                        </Card>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
