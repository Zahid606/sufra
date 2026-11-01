import { useEffect, useState } from 'react';
import { useLocale } from '@/lib/useLocale';
import { useAuth } from '@/store/auth';
import { useRows } from '@/lib/useRows';
import { supabase, errorMessage } from '@/lib/supabase';
import { buildQrSheet, nfcSupport, qrDataUrl, tableUrl, writeNfcTag } from '@/lib/qr';
import { downloadFile } from '@/lib/format';
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
import type { Plan, RestaurantTable } from '@/lib/types';

export function TablesPage() {
  const { t, num, locale } = useLocale();
  const { restaurant } = useAuth();
  const { push } = useToast();
  const { confirm, confirmNode } = useConfirm();

  const tables = useRows<RestaurantTable>('restaurant_tables', restaurant?.id, {
    orderBy: 'code',
  });

  const [plan, setPlan] = useState<Plan | null>(null);
  const [detail, setDetail] = useState<RestaurantTable | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [editing, setEditing] = useState<RestaurantTable | null>(null);
  const [creating, setCreating] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [form, setForm] = useState<Partial<RestaurantTable>>({});
  const [bulkForm, setBulkForm] = useState({ count: 10, from: 1, seats: 4 });
  const [saving, setSaving] = useState(false);
  const [nfcState, setNfcState] = useState<'idle' | 'writing' | 'done' | 'failed'>('idle');
  const [copied, setCopied] = useState(false);

  const nfc = nfcSupport();

  useEffect(() => {
    if (!restaurant?.plan_id) return;
    void (async () => {
      const { data } = await supabase.from('plans').select('*').eq('id', restaurant.plan_id).maybeSingle();
      setPlan((data as Plan) ?? null);
    })();
  }, [restaurant?.plan_id]);

  // render the QR whenever the detail sheet opens or the token rotates
  useEffect(() => {
    if (!detail || !restaurant) {
      setQr(null);
      return;
    }
    void (async () => {
      setQr(await qrDataUrl(tableUrl(restaurant.slug, detail), { size: 640 }));
    })();
  }, [detail, restaurant]);

  const atLimit = plan ? tables.rows.length >= plan.max_tables : false;

  function openCreate() {
    if (atLimit) {
      push(t('errors.limitReached'), 'error');
      return;
    }
    const next = String(tables.rows.length + 1);
    setForm({ code: next, label: `Table ${next}`, label_ar: `طاولة ${next}`, seats: 4, zone: '', is_active: true });
    setEditing(null);
    setCreating(true);
  }

  async function save() {
    if (!form.code?.trim() || !form.label?.trim()) {
      push(t('errors.saveFailed'), 'error');
      return;
    }
    setSaving(true);

    const payload: Partial<RestaurantTable> = {
      code: form.code.trim(),
      label: form.label.trim(),
      label_ar: form.label_ar?.trim() || null,
      zone: form.zone?.trim() || null,
      seats: Number(form.seats) || 4,
      is_active: form.is_active ?? true,
      branch_id: form.branch_id ?? null,
    };

    const res = editing ? await tables.update(editing.id, payload) : await tables.insert(payload);
    setSaving(false);

    if (res.error) {
      // the unique (restaurant_id, code) index is the usual culprit here
      push(
        res.error.includes('duplicate') || res.error.includes('unique')
          ? `${t('admin.tableCode')}: ${form.code} — ${t('superAdmin.slugTaken')}`
          : res.error,
        'error',
      );
      return;
    }

    push(t('common.saved'), 'success');
    setEditing(null);
    setCreating(false);
  }

  async function saveBulk() {
    if (!restaurant) return;
    const count = Math.max(1, Math.min(100, Number(bulkForm.count) || 1));
    const from = Math.max(1, Number(bulkForm.from) || 1);

    if (plan && tables.rows.length + count > plan.max_tables) {
      push(t('errors.limitReached'), 'error');
      return;
    }

    setSaving(true);
    const existing = new Set(tables.rows.map((x) => x.code));
    const payload = Array.from({ length: count }, (_, i) => from + i)
      .filter((n) => !existing.has(String(n)))
      .map((n) => ({
        restaurant_id: restaurant.id,
        code: String(n),
        label: `Table ${n}`,
        label_ar: `طاولة ${n}`,
        seats: Number(bulkForm.seats) || 4,
      }));

    if (!payload.length) {
      setSaving(false);
      setBulk(false);
      return;
    }

    const { error } = await supabase.from('restaurant_tables').insert(payload);
    setSaving(false);

    if (error) {
      push(errorMessage(error), 'error');
      return;
    }
    await tables.reload();
    setBulk(false);
    push(t('common.saved'), 'success');
  }

  async function rotate(table: RestaurantTable) {
    if (!(await confirm(t('admin.rotateConfirm', { label: table.label }), true))) return;

    const { data, error } = await supabase.rpc('rotate_table_token', { p_table_id: table.id });
    if (error) {
      push(errorMessage(error), 'error');
      return;
    }

    const res = data as { ok: boolean; qr_token?: string };
    if (!res?.ok) {
      push(t('errors.saveFailed'), 'error');
      return;
    }

    await tables.reload();
    setDetail({ ...table, qr_token: res.qr_token! });
    push(t('admin.rotated'), 'success');
  }

  async function destroy(table: RestaurantTable) {
    if (!(await confirm(t('admin.deleteTableConfirm', { label: table.label }), true))) return;
    const res = await tables.remove(table.id);
    if (res.error) push(res.error, 'error');
    else {
      setDetail(null);
      setEditing(null);
    }
  }

  async function copyLink(table: RestaurantTable) {
    if (!restaurant) return;
    const url = tableUrl(restaurant.slug, table);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      push(url, 'info');
    }
  }

  function downloadQr(table: RestaurantTable) {
    if (!qr) return;
    const base64 = qr.split(',')[1];
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    downloadFile(`qr-table-${table.code}.png`, new Blob([bytes], { type: 'image/png' }));
  }

  async function printSheet() {
    if (!restaurant) return;
    const active = tables.rows.filter((x) => x.is_active);
    if (!active.length) return;

    const html = await buildQrSheet(
      locale === 'ar' ? restaurant.name_ar : restaurant.name,
      restaurant.slug,
      active,
      { table: t('admin.tableLabel'), scanPrompt: t('scan.viewMenu') },
    );

    const w = window.open('', '_blank');
    if (!w) {
      push(t('errors.saveFailed'), 'error');
      return;
    }
    w.document.write(html);
    w.document.close();
  }

  async function writeTag(table: RestaurantTable) {
    if (!restaurant) return;
    setNfcState('writing');
    try {
      await writeNfcTag(tableUrl(restaurant.slug, table));
      setNfcState('done');
      push(t('admin.nfcWritten'), 'success');
    } catch {
      setNfcState('failed');
      push(t('admin.nfcFailed'), 'error');
    }
  }

  if (tables.loading && !tables.rows.length) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }

  const zones = Array.from(new Set(tables.rows.map((x) => x.zone).filter(Boolean))) as string[];

  return (
    <div className="space-y-4">
      {confirmNode}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold text-ink-900">{t('admin.tablesTitle')}</h1>
          <p className="mt-0.5 max-w-xl text-[13px] text-ink-500">{t('admin.tablesSubtitle')}</p>
          {plan ? (
            <p className="mt-1.5 text-[12.5px] text-ink-400 tnum">
              {t('admin.usageTables', { used: num(tables.rows.length), limit: num(plan.max_tables) })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void printSheet()} disabled={!tables.rows.length}>
            {t('admin.printSheet')}
          </Button>
          <Button variant="outline" onClick={() => setBulk(true)}>
            {t('admin.bulkAdd')}
          </Button>
          <Button onClick={openCreate} disabled={atLimit}>
            {t('admin.newTable')}
          </Button>
        </div>
      </div>

      {atLimit ? (
        <Card className="bg-amber-50 p-3.5">
          <p className="text-[13px] text-amber-900">{t('admin.limitReached')}</p>
        </Card>
      ) : null}

      {tables.rows.length === 0 ? (
        <Card>
          <EmptyState
            title={t('common.noResults')}
            action={<Button onClick={() => setBulk(true)}>{t('admin.bulkAdd')}</Button>}
          />
        </Card>
      ) : (
        (zones.length ? [...zones, null] : [null]).map((zone) => {
          const list = tables.rows.filter((x) => (zone === null ? !x.zone : x.zone === zone));
          if (!list.length) return null;

          return (
            <section key={zone ?? 'none'}>
              {zones.length ? (
                <h2 className="mb-2.5 text-[12.5px] font-semibold uppercase tracking-wide text-ink-400">
                  {zone ?? t('common.none')}
                </h2>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((tb) => (
                  <Card
                    key={tb.id}
                    className={cx('p-4 transition-shadow hover:shadow-lift', !tb.is_active && 'opacity-60')}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold text-ink-900">{tb.label}</p>
                        <p className="mt-0.5 text-[12.5px] text-ink-500 tnum">
                          {t('admin.tableCode')}: {tb.code} · {num(tb.seats)} {t('admin.seats')}
                        </p>
                      </div>
                      {!tb.is_active ? <Badge tone="danger">{t('common.inactive')}</Badge> : null}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Button size="sm" onClick={() => setDetail(tb)}>
                        {t('admin.qrCode')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setForm({ ...tb });
                          setEditing(tb);
                          setCreating(false);
                        }}
                      >
                        {t('common.edit')}
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          );
        })
      )}

      {/* ---------- QR / NFC detail ---------- */}
      <Modal
        open={Boolean(detail)}
        onClose={() => {
          setDetail(null);
          setNfcState('idle');
        }}
        title={detail?.label ?? ''}
        size="md"
      >
        {detail && restaurant ? (
          <div className="space-y-5">
            <div className="rounded-2xl bg-white p-5 text-center ring-1 ring-ink-200">
              {qr ? (
                <img src={qr} alt="" className="mx-auto h-56 w-56" />
              ) : (
                <Skeleton className="mx-auto h-56 w-56" />
              )}
              <p className="mt-3 text-[15px] font-semibold text-ink-900">{detail.label}</p>
              <p className="text-[12px] text-ink-400">{t('scan.viewMenu')}</p>
            </div>

            <Field label={t('admin.tableLink')}>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={tableUrl(restaurant.slug, detail)}
                  dir="ltr"
                  className="grow !text-[12px]"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button variant="outline" onClick={() => void copyLink(detail)}>
                  {copied ? t('common.copied') : t('common.copy')}
                </Button>
              </div>
            </Field>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => downloadQr(detail)} disabled={!qr}>
                {t('admin.downloadQr')}
              </Button>
              <Button
                variant="outline"
                onClick={() => window.open(tableUrl(restaurant.slug, detail), '_blank')}
              >
                {t('superAdmin.openOrderingPage')}
              </Button>
            </div>

            {/* NFC */}
            <div className="rounded-xl border border-ink-200 p-4">
              <h3 className="text-[14px] font-semibold text-ink-900">{t('admin.nfcTitle')}</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-500">{t('admin.nfcBody')}</p>

              {nfc.supported ? (
                <>
                  <Button
                    className="mt-3"
                    size="sm"
                    loading={nfcState === 'writing'}
                    onClick={() => void writeTag(detail)}
                  >
                    {t('admin.nfcWrite')}
                  </Button>
                  {nfcState === 'writing' ? (
                    <p className="mt-2 text-[12.5px] text-brand-700">{t('admin.nfcWriting')}</p>
                  ) : null}
                  {nfcState === 'done' ? (
                    <p className="mt-2 text-[12.5px] text-brand-700">{t('admin.nfcWritten')}</p>
                  ) : null}
                  {nfcState === 'failed' ? (
                    <p className="mt-2 text-[12.5px] text-red-600">{t('admin.nfcFailed')}</p>
                  ) : null}
                </>
              ) : (
                <p className="mt-3 rounded-lg bg-ink-50 p-2.5 text-[12.5px] text-ink-500">
                  {t('admin.nfcUnsupported')}
                </p>
              )}
            </div>

            {/* rotate */}
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="text-[14px] font-semibold text-amber-900">{t('admin.rotateToken')}</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-amber-800">
                {t('admin.rotateHint')}
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void rotate(detail)}>
                {t('admin.rotateToken')}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ---------- edit / create ---------- */}
      <Modal
        open={creating || Boolean(editing)}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        title={editing ? t('admin.editTable') : t('admin.newTable')}
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
          <Field label={t('admin.tableCode')} hint={t('admin.tableCodeHint')} required>
            <Input
              value={form.code ?? ''}
              onChange={(e) =>
                setForm((f) => ({ ...f, code: e.target.value.replace(/[^A-Za-z0-9_-]/g, '') }))
              }
              dir="ltr"
              maxLength={16}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.tableLabel')} required>
              <Input
                value={form.label ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                dir="ltr"
              />
            </Field>
            <Field label={t('admin.tableLabelAr')}>
              <Input
                value={form.label_ar ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, label_ar: e.target.value }))}
                dir="rtl"
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.zone')}>
              <Input
                value={form.zone ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, zone: e.target.value }))}
                list="zones"
              />
              <datalist id="zones">
                {zones.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </Field>
            <Field label={t('admin.seats')}>
              <Input
                type="number"
                min={1}
                value={form.seats ?? 4}
                onChange={(e) => setForm((f) => ({ ...f, seats: Number(e.target.value) }))}
                dir="ltr"
              />
            </Field>
          </div>

          <Toggle
            checked={form.is_active ?? true}
            onChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
            label={t('common.active')}
          />
        </div>
      </Modal>

      {/* ---------- bulk add ---------- */}
      <Modal
        open={bulk}
        onClose={() => setBulk(false)}
        title={t('admin.bulkAdd')}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setBulk(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={saving} onClick={() => void saveBulk()}>
              {t('common.create')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label={t('admin.bulkAddCount')}>
            <Input
              type="number"
              min={1}
              max={100}
              value={bulkForm.count}
              onChange={(e) => setBulkForm((f) => ({ ...f, count: Number(e.target.value) }))}
              dir="ltr"
            />
          </Field>
          <Field label={t('admin.bulkAddFrom')}>
            <Input
              type="number"
              min={1}
              value={bulkForm.from}
              onChange={(e) => setBulkForm((f) => ({ ...f, from: Number(e.target.value) }))}
              dir="ltr"
            />
          </Field>
          <Field label={t('admin.seats')}>
            <Input
              type="number"
              min={1}
              value={bulkForm.seats}
              onChange={(e) => setBulkForm((f) => ({ ...f, seats: Number(e.target.value) }))}
              dir="ltr"
            />
          </Field>
          <p className="hint">
            {t('admin.tableCodeHint')}
          </p>
        </div>
      </Modal>
    </div>
  );
}
