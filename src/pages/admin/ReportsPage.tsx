import { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useLocale } from '@/lib/useLocale';
import { useAuth } from '@/store/auth';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardHeader, EmptyState, Input, Segmented, Skeleton, Stat } from '@/components/ui';
import { toCsv, downloadFile } from '@/lib/format';
import type { SalesReport } from '@/lib/types';

type Preset = 'week' | 'month' | 'quarter' | 'custom';

const DAYS: Record<Exclude<Preset, 'custom'>, number> = { week: 7, month: 30, quarter: 90 };

export function ReportsPage() {
  const { t, money, num, locale, dateOnly } = useLocale();
  const { restaurant } = useAuth();

  const [preset, setPreset] = useState<Preset>('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [report, setReport] = useState<SalesReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!restaurant) return;
    setLoading(true);

    const fromIso =
      preset === 'custom' && from
        ? new Date(from).toISOString()
        : new Date(Date.now() - DAYS[preset === 'custom' ? 'month' : preset] * 86400000).toISOString();

    const toIso = preset === 'custom' && to ? new Date(`${to}T23:59:59`).toISOString() : new Date().toISOString();

    const { data } = await supabase.rpc('sales_report', {
      p_restaurant: restaurant.id,
      p_from: fromIso,
      p_to: toIso,
    });

    setReport((data as SalesReport) ?? null);
    setLoading(false);
  }, [restaurant, preset, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  function exportReport() {
    if (!report) return;

    const sections: (string | number | null)[][] = [];
    sections.push(['-- totals --']);
    for (const [k, v] of Object.entries(report.totals)) sections.push([k, v as number]);

    sections.push([]);
    sections.push(['-- by day --']);
    sections.push(['day', 'orders', 'revenue']);
    for (const d of report.by_day) sections.push([d.day, d.orders, d.revenue]);

    sections.push([]);
    sections.push(['-- top items --']);
    sections.push(['name', 'name_ar', 'qty', 'revenue']);
    for (const i of report.top_items) sections.push([i.name, i.name_ar, i.qty, i.revenue]);

    sections.push([]);
    sections.push(['-- by table --']);
    sections.push(['table', 'orders', 'revenue']);
    for (const tb of report.by_table) sections.push([tb.label, tb.orders, tb.revenue]);

    downloadFile(
      `report-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(['metric', 'value', 'extra', 'extra2'], sections),
      'text/csv',
    );
  }

  if (loading && !report) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-32" />
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const totals = report?.totals;

  const dayData = (report?.by_day ?? []).map((d) => ({
    label: new Date(d.day).toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-GB', {
      day: 'numeric',
      month: 'short',
    }),
    revenue: Number(d.revenue),
    orders: Number(d.orders),
  }));

  const itemData = (report?.top_items ?? []).map((i) => ({
    name: locale === 'ar' ? i.name_ar || i.name : i.name,
    qty: Number(i.qty),
    revenue: Number(i.revenue),
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold text-ink-900">{t('admin.reportsTitle')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={preset}
            onChange={setPreset}
            options={[
              { value: 'week', label: t('common.week') },
              { value: 'month', label: t('common.month') },
              { value: 'quarter', label: t('common.quarter') },
              { value: 'custom', label: t('common.edit') },
            ]}
          />
          <Button variant="outline" size="sm" onClick={exportReport} disabled={!report}>
            {t('admin.exportCsv')}
          </Button>
        </div>
      </div>

      {preset === 'custom' ? (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <div>
            <label className="label">{t('common.from')}</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" />
          </div>
          <div>
            <label className="label">{t('common.to')}</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" />
          </div>
          <Button onClick={() => void load()}>{t('common.refresh')}</Button>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('admin.revenue')} value={money(totals?.revenue ?? 0)} />
        <Stat label={t('admin.paidOrders')} value={num(report?.status_breakdown?.paid ?? 0)} />
        <Stat label={t('admin.avgTicket')} value={money(totals?.avg_ticket ?? 0)} />
        <Stat label={t('admin.guestsServed')} value={num(totals?.guests ?? 0)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('admin.discountsGiven')} value={money(totals?.discounts ?? 0)} />
        <Stat label={t('admin.vatCollected')} value={money(totals?.vat ?? 0)} />
        <Stat label={t('admin.cancelledOrders')} value={num(totals?.cancelled ?? 0)} tone="danger" />
        <Stat
          label={t('admin.averageRating')}
          value={report?.reviews?.average ? Number(report.reviews.average).toFixed(1) : '—'}
          sub={
            report?.reviews?.count
              ? t('admin.reviewCount', { count: num(report.reviews.count) })
              : undefined
          }
        />
      </div>

      <Card>
        <CardHeader title={t('admin.revenueTrend')} />
        <div className="px-2 pb-4">
          {dayData.length === 0 ? (
            <EmptyState title={t('admin.noOrdersPeriod')} className="py-10" />
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={dayData} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
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
                  width={52}
                  orientation={locale === 'ar' ? 'right' : 'left'}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: '1px solid #e7e7e4', fontSize: 12 }}
                  formatter={(v: number) => money(v)}
                />
                <Bar dataKey="revenue" fill="#39664c" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('admin.topItems')} />
          <div className="px-2 pb-4">
            {itemData.length === 0 ? (
              <EmptyState title={t('admin.noOrdersPeriod')} className="py-8" />
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(200, itemData.length * 34)}>
                <BarChart
                  data={itemData}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
                >
                  <CartesianGrid stroke="#e7e7e4" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: '#88887c' }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                    reversed={locale === 'ar'}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 11, fill: '#57574e' }}
                    axisLine={false}
                    tickLine={false}
                    width={110}
                    orientation={locale === 'ar' ? 'right' : 'left'}
                  />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e7e7e4', fontSize: 12 }} />
                  <Bar dataKey="qty" radius={[0, 5, 5, 0]}>
                    {itemData.map((_, i) => (
                      <Cell key={i} fill={i === 0 ? '#c08f33' : '#6c9c7e'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title={t('admin.byTable')} />
          {report?.by_table?.length ? (
            <div className="divide-y divide-ink-100 border-t border-ink-100">
              {report.by_table.map((tb, i) => (
                <div key={`${tb.table_id}-${i}`} className="flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 grow truncate text-[14px] text-ink-800">{tb.label}</span>
                  <span className="shrink-0 text-[12.5px] text-ink-400 tnum">
                    {num(tb.orders)}
                  </span>
                  <span className="w-24 shrink-0 text-end text-[13.5px] font-medium text-ink-800 tnum">
                    {money(tb.revenue)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title={t('admin.noOrdersPeriod')} className="py-8" />
          )}
        </Card>
      </div>

      {report?.range ? (
        <p className="text-center text-[12px] text-ink-400">
          {dateOnly(report.range.from)} → {dateOnly(report.range.to)}
        </p>
      ) : null}
    </div>
  );
}
