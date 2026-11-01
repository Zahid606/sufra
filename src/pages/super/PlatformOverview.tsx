import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useLocale } from '@/lib/useLocale';
import { supabase } from '@/lib/supabase';
import { Badge, Button, Card, CardHeader, EmptyState, Skeleton, Stat } from '@/components/ui';
import type { PlatformStats } from '@/lib/types';

export function PlatformOverview() {
  const { t, money, num, locale, dateOnly } = useLocale();
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data, error: err } = await supabase.rpc('platform_stats');
      if (err) {
        setError(err.message);
        return;
      }
      setStats(data as PlatformStats);
    })();
  }, []);

  if (error) {
    return (
      <Card>
        <EmptyState title={t('errors.notAuthorised')} body={error} />
      </Card>
    );
  }

  if (!stats) {
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

  const trend = (stats.by_day ?? []).map((d) => ({
    label: new Date(d.day).toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-GB', {
      day: 'numeric',
      month: 'short',
    }),
    gmv: Number(d.gmv),
    orders: Number(d.orders),
  }));

  return (
    <div className="space-y-5">
      <h1 className="text-[20px] font-semibold text-ink-900">{t('nav.platform')}</h1>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t('superAdmin.totalRestaurants')}
          value={num(stats.restaurants)}
          sub={`${num(stats.active)} ${t('superAdmin.activeRestaurants')}`}
          tone="success"
        />
        <Stat label={t('superAdmin.mrr')} value={money(stats.mrr)} />
        <Stat label={t('superAdmin.gmv30d')} value={money(stats.gmv_30d)} />
        <Stat label={t('superAdmin.orders30d')} value={num(stats.orders_30d)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('superAdmin.trialing')} value={num(stats.trialing)} tone="info" />
        <Stat label={t('superAdmin.suspended')} value={num(stats.suspended)} tone="danger" />
        <Stat label={t('superAdmin.totalTables')} value={num(stats.tables)} />
        <Stat label={t('superAdmin.totalStaff')} value={num(stats.staff)} />
      </div>

      {/* trials about to lapse — the one list that needs acting on */}
      <Card>
        <CardHeader
          title={t('superAdmin.expiringTrials')}
          action={
            <Link to="/platform/restaurants">
              <Button size="sm" variant="outline">
                {t('nav.restaurants')}
              </Button>
            </Link>
          }
        />
        {stats.expiring_trials?.length ? (
          <div className="divide-y divide-ink-100 border-t border-ink-100">
            {stats.expiring_trials.map((r) => {
              const days = Math.ceil((new Date(r.trial_ends_at).getTime() - Date.now()) / 86400000);
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0 grow">
                    <p className="text-[14px] font-medium text-ink-900">
                      {locale === 'ar' ? r.name_ar : r.name}
                    </p>
                    <p className="text-[12px] text-ink-400" dir="ltr">
                      /r/{r.slug}
                    </p>
                  </div>
                  <Badge tone={days <= 2 ? 'danger' : 'warn'}>
                    {dateOnly(r.trial_ends_at)}
                  </Badge>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title={t('superAdmin.noExpiring')} className="py-8" />
        )}
      </Card>

      <Card>
        <CardHeader title={t('superAdmin.gmv30d')} />
        <div className="px-2 pb-4">
          {trend.length === 0 ? (
            <EmptyState title={t('admin.noOrdersPeriod')} className="py-10" />
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={trend} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="gmv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#39664c" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#39664c" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
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
                  width={56}
                  orientation={locale === 'ar' ? 'right' : 'left'}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: '1px solid #e7e7e4', fontSize: 12 }}
                  formatter={(v: number) => money(v)}
                />
                <Area
                  type="monotone"
                  dataKey="gmv"
                  stroke="#39664c"
                  strokeWidth={2.5}
                  fill="url(#gmv)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
    </div>
  );
}
