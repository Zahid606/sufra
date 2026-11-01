import { useEffect, useState } from 'react';
import { useLocale } from '@/lib/useLocale';
import { useAuth } from '@/store/auth';
import { useRows } from '@/lib/useRows';
import { supabase, errorMessage } from '@/lib/supabase';
import { ImageUpload } from '@/components/ImageUpload';
import {
  Badge,
  Button,
  Card,
  CardHeader,
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
import { toCsv, downloadFile } from '@/lib/format';
import type { MenuItem, Reward, RewardType } from '@/lib/types';

interface LoyaltyAccount {
  id: string;
  restaurant_id: string;
  phone: string;
  name: string | null;
  points: number;
  lifetime_points: number;
  total_spent: number;
  visits: number;
  tier: string;
  updated_at: string;
}

const TIER_TONE: Record<string, 'gold' | 'neutral' | 'info'> = {
  gold: 'gold',
  silver: 'info',
  bronze: 'neutral',
};

export function LoyaltyAdminPage() {
  const { t, money, num, dateOnly } = useLocale();
  const { restaurant } = useAuth();
  const { push } = useToast();
  const { confirm, confirmNode } = useConfirm();

  const [tab, setTab] = useState<'rewards' | 'members'>('rewards');

  const rewards = useRows<Reward>('rewards', restaurant?.id, { orderBy: 'points_cost' });
  const items = useRows<MenuItem>('menu_items', restaurant?.id, { select: 'id,name,name_ar,price' });
  const members = useRows<LoyaltyAccount>('loyalty_accounts', restaurant?.id, {
    orderBy: 'points',
    ascending: false,
    limit: 300,
  });

  const [editing, setEditing] = useState<Reward | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Partial<Reward>>({});
  const [saving, setSaving] = useState(false);

  const [adjusting, setAdjusting] = useState<LoyaltyAccount | null>(null);
  const [adjustBy, setAdjustBy] = useState('');
  const [adjustNote, setAdjustNote] = useState('');

  const [rate, setRate] = useState<string>(String(restaurant?.loyalty_points_per_sar ?? 1));
  const [enabled, setEnabled] = useState<boolean>(restaurant?.loyalty_enabled ?? true);

  useEffect(() => {
    setRate(String(restaurant?.loyalty_points_per_sar ?? 1));
    setEnabled(restaurant?.loyalty_enabled ?? true);
  }, [restaurant?.loyalty_points_per_sar, restaurant?.loyalty_enabled]);

  async function saveProgramme(values: { loyalty_points_per_sar?: number; loyalty_enabled?: boolean }) {
    if (!restaurant) return;
    const { error } = await supabase.from('restaurants').update(values).eq('id', restaurant.id);
    if (error) push(errorMessage(error), 'error');
    else push(t('common.saved'), 'success');
  }

  async function saveReward() {
    if (!form.name?.trim() || !form.name_ar?.trim() || !form.points_cost) {
      push(t('errors.saveFailed'), 'error');
      return;
    }
    setSaving(true);

    const payload: Partial<Reward> = {
      name: form.name.trim(),
      name_ar: form.name_ar.trim(),
      description: form.description?.trim() || null,
      description_ar: form.description_ar?.trim() || null,
      image_url: form.image_url || null,
      points_cost: Number(form.points_cost),
      type: (form.type ?? 'discount_percent') as RewardType,
      value: Number(form.value ?? 0),
      menu_item_id: form.type === 'free_item' ? form.menu_item_id || null : null,
      stock: form.stock === null || form.stock === undefined || form.stock === ('' as never)
        ? null
        : Number(form.stock),
      sort_order: Number(form.sort_order ?? rewards.rows.length + 1),
      is_active: form.is_active ?? true,
    };

    const res = editing ? await rewards.update(editing.id, payload) : await rewards.insert(payload);
    setSaving(false);

    if (res.error) {
      push(res.error, 'error');
      return;
    }
    push(t('common.saved'), 'success');
    setEditing(null);
    setCreating(false);
  }

  async function destroyReward(r: Reward) {
    if (!(await confirm(`${t('common.delete')} “${r.name}”?`, true))) return;
    const res = await rewards.remove(r.id);
    if (res.error) push(res.error, 'error');
    else setEditing(null);
  }

  /**
   * A manual points adjustment writes both the balance and a ledger row, so a
   * later dispute can be traced to who granted what and why.
   */
  async function applyAdjustment() {
    if (!adjusting || !restaurant) return;
    const delta = Number(adjustBy);
    if (!Number.isFinite(delta) || delta === 0) return;

    const next = Math.max(0, adjusting.points + delta);
    setSaving(true);

    const { error: balErr } = await supabase
      .from('loyalty_accounts')
      .update({ points: next })
      .eq('id', adjusting.id);

    if (balErr) {
      setSaving(false);
      push(errorMessage(balErr), 'error');
      return;
    }

    const { error: txnErr } = await supabase.from('loyalty_transactions').insert({
      restaurant_id: restaurant.id,
      account_id: adjusting.id,
      type: 'adjust',
      points: delta,
      note: adjustNote.trim() || null,
    });

    setSaving(false);

    if (txnErr) {
      push(errorMessage(txnErr), 'error');
      return;
    }

    push(t('common.saved'), 'success');
    setAdjusting(null);
    setAdjustBy('');
    setAdjustNote('');
    await members.reload();
  }

  function exportMembers() {
    if (!members.rows.length) return;
    downloadFile(
      `loyalty-members-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        ['phone', 'name', 'points', 'lifetime_points', 'visits', 'total_spent', 'tier'],
        members.rows.map((m) => [
          m.phone,
          m.name ?? '',
          m.points,
          m.lifetime_points,
          m.visits,
          m.total_spent,
          m.tier,
        ]),
      ),
      'text/csv',
    );
  }

  return (
    <div className="space-y-4">
      {confirmNode}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold text-ink-900">{t('admin.loyaltyTitle')}</h1>
        {tab === 'rewards' ? (
          <Button
            onClick={() => {
              setForm({
                type: 'discount_percent',
                value: 10,
                points_cost: 300,
                sort_order: rewards.rows.length + 1,
                is_active: true,
              });
              setEditing(null);
              setCreating(true);
            }}
          >
            {t('admin.newReward')}
          </Button>
        ) : (
          <Button variant="outline" onClick={exportMembers} disabled={!members.rows.length}>
            {t('admin.exportCsv')}
          </Button>
        )}
      </div>

      {/* programme settings */}
      <Card className="p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('admin.pointsRate')}>
            <Input
              type="number"
              min={0}
              step="0.1"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              onBlur={() => void saveProgramme({ loyalty_points_per_sar: Number(rate) || 0 })}
              className="max-w-[140px]"
              dir="ltr"
            />
          </Field>
          <div className="flex items-end pb-1">
            <Toggle
              checked={enabled}
              onChange={(v) => {
                setEnabled(v);
                void saveProgramme({ loyalty_enabled: v });
              }}
              label={t('admin.loyaltyToggle')}
            />
          </div>
        </div>
      </Card>

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'rewards', label: t('admin.rewardsTitle'), count: rewards.rows.length },
          { value: 'members', label: t('admin.membersTitle'), count: members.rows.length },
        ]}
      />

      {/* rewards */}
      {tab === 'rewards' ? (
        rewards.loading && !rewards.rows.length ? (
          <Skeleton className="h-32" />
        ) : rewards.rows.length === 0 ? (
          <Card>
            <EmptyState title={t('common.noResults')} />
          </Card>
        ) : (
          <Card className="divide-y divide-ink-100 overflow-hidden">
            {rewards.rows.map((r) => (
              <div key={r.id} className={cx('flex items-center gap-3 p-3.5', !r.is_active && 'opacity-55')}>
                {r.image_url ? (
                  <img src={r.image_url} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover bg-ink-100" />
                ) : (
                  <div className="h-11 w-11 shrink-0 rounded-lg bg-gold-100 text-[11px] font-bold text-gold-700 grid place-items-center tnum">
                    {num(r.points_cost)}
                  </div>
                )}

                <div className="min-w-0 grow">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[14.5px] font-medium text-ink-900">{r.name}</p>
                    <span className="text-[13px] text-ink-400" dir="rtl">
                      {r.name_ar}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-ink-400 tnum">
                    {t('admin.pointsCost')}: {num(r.points_cost)} ·{' '}
                    {r.type === 'discount_percent'
                      ? `${num(r.value)}%`
                      : r.type === 'free_item'
                        ? t('admin.rewardFreeItem')
                        : money(r.value)}
                    {r.stock !== null ? ` · ${t('admin.stock')} ${num(r.stock)}` : ''}
                  </p>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setForm({ ...r });
                    setEditing(r);
                    setCreating(false);
                  }}
                >
                  {t('common.edit')}
                </Button>
              </div>
            ))}
          </Card>
        )
      ) : members.loading && !members.rows.length ? (
        <Skeleton className="h-32" />
      ) : members.rows.length === 0 ? (
        <Card>
          <EmptyState title={t('loyalty.noAccount')} body={t('loyalty.noAccountBody')} />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13.5px]">
            <thead>
              <tr className="border-b border-ink-100 text-start text-[12px] text-ink-400">
                <th className="px-4 py-3 text-start font-medium">{t('admin.memberPhone')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('admin.fullName')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('admin.memberPoints')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('admin.memberVisits')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('admin.memberSpent')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('loyalty.tier', { tier: '' })}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {members.rows.map((m) => (
                <tr key={m.id} className="border-b border-ink-100 last:border-0">
                  <td className="px-4 py-3" dir="ltr">
                    {m.phone}
                  </td>
                  <td className="px-4 py-3 text-ink-600">{m.name || '—'}</td>
                  <td className="px-4 py-3 text-end font-semibold tnum">{num(m.points)}</td>
                  <td className="px-4 py-3 text-end tnum">{num(m.visits)}</td>
                  <td className="px-4 py-3 text-end tnum">{money(m.total_spent)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={TIER_TONE[m.tier] ?? 'neutral'}>{t(`loyalty.${m.tier}`)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setAdjusting(m);
                        setAdjustBy('');
                        setAdjustNote('');
                      }}
                    >
                      {t('admin.adjustPoints')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* reward editor */}
      <Modal
        open={creating || Boolean(editing)}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        title={editing ? t('common.edit') : t('admin.newReward')}
        footer={
          <div className="flex items-center justify-between gap-2">
            {editing ? (
              <Button variant="ghost" onClick={() => void destroyReward(editing)}>
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
              <Button loading={saving} onClick={() => void saveReward()}>
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
              value={form.image_url ?? null}
              onChange={(url) => setForm((f) => ({ ...f, image_url: url }))}
              restaurantId={restaurant.id}
              folder="rewards"
            />
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.rewardName')} required>
              <Input
                value={form.name ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                dir="ltr"
              />
            </Field>
            <Field label={t('admin.rewardNameAr')} required>
              <Input
                value={form.name_ar ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, name_ar: e.target.value }))}
                dir="rtl"
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.itemDescription')}>
              <Textarea
                value={form.description ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="min-h-[56px]"
                dir="ltr"
              />
            </Field>
            <Field label={t('admin.itemDescriptionAr')}>
              <Textarea
                value={form.description_ar ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, description_ar: e.target.value }))}
                className="min-h-[56px]"
                dir="rtl"
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('admin.pointsCost')} required>
              <Input
                type="number"
                min={1}
                value={form.points_cost ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, points_cost: Number(e.target.value) }))}
                dir="ltr"
              />
            </Field>
            <Field label={t('admin.rewardType')}>
              <Select
                value={form.type ?? 'discount_percent'}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as RewardType }))}
              >
                <option value="discount_percent">{t('admin.rewardPercent')}</option>
                <option value="discount_fixed">{t('admin.rewardFixed')}</option>
                <option value="free_item">{t('admin.rewardFreeItem')}</option>
              </Select>
            </Field>
            {form.type === 'free_item' ? (
              <Field label={t('admin.rewardItem')}>
                <Select
                  value={form.menu_item_id ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, menu_item_id: e.target.value || null }))}
                >
                  <option value="">—</option>
                  {items.rows.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label={t('admin.rewardValue')}>
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  value={form.value ?? 0}
                  onChange={(e) => setForm((f) => ({ ...f, value: Number(e.target.value) }))}
                  dir="ltr"
                />
              </Field>
            )}
          </div>

          <Field label={t('admin.stock')} hint={t('admin.stockHint')}>
            <Input
              type="number"
              min={0}
              value={form.stock ?? ''}
              onChange={(e) =>
                setForm((f) => ({ ...f, stock: e.target.value === '' ? null : Number(e.target.value) }))
              }
              className="max-w-[140px]"
              dir="ltr"
            />
          </Field>

          <Toggle
            checked={form.is_active ?? true}
            onChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
            label={t('common.active')}
          />
        </div>
      </Modal>

      {/* points adjustment */}
      <Modal
        open={Boolean(adjusting)}
        onClose={() => setAdjusting(null)}
        title={t('admin.adjustPoints')}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAdjusting(null)}>
              {t('common.cancel')}
            </Button>
            <Button loading={saving} onClick={() => void applyAdjustment()}>
              {t('common.save')}
            </Button>
          </div>
        }
      >
        {adjusting ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-ink-50 p-3">
              <p className="text-[13px] text-ink-500" dir="ltr">
                {adjusting.phone}
              </p>
              <p className="mt-0.5 text-[15px] font-semibold text-ink-900 tnum">
                {t('loyalty.yourPoints', { points: num(adjusting.points) })}
              </p>
            </div>

            <Field label={t('admin.adjustPoints')} hint="+100 / −50">
              <Input
                type="number"
                value={adjustBy}
                onChange={(e) => setAdjustBy(e.target.value)}
                dir="ltr"
              />
            </Field>

            <Field label={t('superAdmin.note')}>
              <Input value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} />
            </Field>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
