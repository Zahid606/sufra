import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useLocale } from '@/lib/useLocale';
import { useAuth } from '@/store/auth';
import { supabase } from '@/lib/supabase';
import { Badge, Button, Card, CardHeader, EmptyState, Segmented, Skeleton, Stat } from '@/components/ui';
import type { SalesReport, ServiceRequest } from '@/lib/types';

type Range = 'today' | 'week' | 'month';

const RANGE_DAYS: Record<Range, number> = { today: 1, week: 7, month: 30 };

export function OverviewPage() {
  const { t, money, num, locale, elapsed } = useLocale();
  const { restaurant } = useAuth();
  const [range, setRange] = useState<Range>('today');
  const [report, setReport] = useState<SalesReport | null>(null);
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!restaurant) return;
    setLoading(true);

    const from =
      range === 'today'
        ? new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
        : new Date(Date.now() - RANGE_DAYS[range] * 86400000).toISOString();

    const [rep, reqs] = await Promise.all([
      supabase.rpc('sales_report', {
        p_restaurant: restaurant.id,
        p_from: from,
        p_to: new Date().toISOString(),
      }),
      supabase
        .from('service_requests')
        .select('*, restaurant_tables(label, code)')
        .eq('restaurant_id', restaurant.id)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(8),
    ]);

    setReport((rep.data as SalesReport) ?? null);
    setRequests((reqs.data ?? []) as ServiceRequest[]);
    setLoading(false);
  }, [restaurant, range]);

  useEffect(() => {
    void load();
  }, [load]);

  // keep the tiles live while the screen is open on a pass counter
  useEffect(() => {
    if (!restaurant?.id) return;
    const channel = supabase
      .channel(`overview-${restaurant.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurant.id}` },
        () => void load(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'service_requests', filter: `restaurant_id=eq.${restaurant.id}` },
        () => void load(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [restaurant?.id, load]);

  if (loading && !report) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const totals = report?.totals;
  const pending = report?.status_breakdown?.pending ?? 0;
  const open =
    (report?.status_breakdown?.pending ?? 0) +
    (report?.status_breakdown?.confirmed ?? 0) +
    (report?.status_breakdown?.preparing ?? 0) +
    (report?.status_breakdown?.ready ?? 0);

  const trend = (report?.by_day ?? []).map((d) => ({
    label: new Date(d.day).toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-GB', {
      day: 'numeric',
      month: 'short',
    }),
    revenue: Number(d.revenue),
    orders: Number(d.orders),
  }));

  // every hour of the clock, so a quiet mid-afternoon reads as a gap rather
  // than silently collapsing the axis
  const hours = Array.from({ length: 24 }, (_, h) => ({
    hour: String(h).padStart(2, '0'),
    orders: Number(report?.by_hour?.find((x) => x.hour === h)?.orders ?? 0),
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold text-ink-900">{t('admin.overviewTitle')}</h1>
        <Segmented
          value={range}
          onChange={setRange}
          options={[
            { value: 'today', label: t('common.today') },
            { value: 'week', label: t('common.week') },
            { value: 'month', label: t('common.month') },
          ]}
        />
      </div>

      {/* tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('admin.todayOrders')} value={num(totals?.orders ?? 0)} />
        <Stat label={t('admin.todayRevenue')} value={money(totals?.revenue ?? 0)} />
        <Stat label={t('admin.avgTicket')} value={money(totals?.avg_ticket ?? 0)} />
        <Stat
          label={t('admin.openOrders')}
          value={num(open)}
          sub={pending > 0 ? `${num(pending)} ${t('admin.pendingConfirmation')}` : undefined}
          tone="warn"
        />
      </div>

      {/* open table requests */}
      {requests.length ? (
        <Card>
          <CardHeader
            title={t('admin.openRequests')}
            action={
              <Link to="/waiter">
                <Button size="sm" variant="outline">
                  {t('nav.waiter')}
                </Button>
              </Link>
            }
          />
          <div className="divide-y divide-ink-100 border-t border-ink-100">
            {requests.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <Badge tone="warn" dot>
                  {t(`waiter.${r.type}`)}
                </Badge>
                <span className="grow text-[14px] text-ink-800">
                  {t('waiter.table', { label: r.restaurant_tables?.label ?? '—' })}
                </span>
                <span className="text-[12.5px] text-ink-400 tnum">{elapsed(r.created_at)}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-5">
        {/* revenue trend */}
        <Card className="lg:col-span-3">
          <CardHeader title={t('admin.revenueTrend')} />
          <div className="px-2 pb-4">
            {trend.length === 0 ? (
              <EmptyState title={t('admin.quietHours')} className="py-8" />
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={trend} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid stroke="#e7e7e4" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: '#88887c' }}
                    axisLine={false}
                    tickLine={false}
                    reversed={locale === 'ar'}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#88887c' }}
                    axisLine={false}
                    tickLine={false}
                    width={46}
                    orientation={locale === 'ar' ? 'right' : 'left'}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: '1px solid #e7e7e4',
                      fontSize: 12,
                      boxShadow: '0 8px 24px -12px rgba(15,15,13,.18)',
                    }}
                    formatter={(v: number) => money(v)}
                  />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#39664c"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: '#39664c' }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* top items */}
        <Card className="lg:col-span-2">
          <CardHeader
            title={t('admin.topItems')}
            action={
              <Link to="/admin/reports">
                <Button size="sm" variant="ghost">
                  {t('common.seeAll')}
                </Button>
              </Link>
            }
          />
          {report?.top_items?.length ? (
            <ol className="divide-y divide-ink-100 border-t border-ink-100">
              {report.top_items.slice(0, 6).map((it, i) => (
                <li key={`${it.menu_item_id}-${i}`} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <span className="h-6 w-6 shrink-0 rounded-md bg-ink-100 text-[11.5px] font-semibold text-ink-600 grid place-items-center tnum">
                    {i + 1}
                  </span>
                  <span className="min-w-0 grow truncate text-[14px] text-ink-800">
                    {locale === 'ar' ? it.name_ar || it.name : it.name}
                  </span>
                  <span className="shrink-0 text-[13px] font-medium text-ink-500 tnum">
                    ×{num(it.qty)}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title={t('admin.quietHours')} className="py-8" />
          )}
        </Card>
      </div>

      {/* orders by hour */}
      <Card>
        <CardHeader title={t('admin.ordersByHour')} />
        <div className="px-2 pb-4">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={hours} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid stroke="#e7e7e4" vertical={false} />
              <XAxis
                dataKey="hour"
                tick={{ fontSize: 10, fill: '#88887c' }}
                axisLine={false}
                tickLine={false}
                interval={1}
                reversed={locale === 'ar'}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#88887c' }}
                axisLine={false}
                tickLine={false}
                width={32}
                allowDecimals={false}
                orientation={locale === 'ar' ? 'right' : 'left'}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 12,
                  border: '1px solid #e7e7e4',
                  fontSize: 12,
                }}
              />
              <Bar dataKey="orders" fill="#6c9c7e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
