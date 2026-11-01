import { useState } from 'react';
import { useLocale } from '@/lib/useLocale';
import { useAuth } from '@/store/auth';
import { useRows } from '@/lib/useRows';
import { supabase, errorMessage } from '@/lib/supabase';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  Toggle,
  cx,
  useToast,
} from '@/components/ui';
import { initials } from '@/lib/format';
import type { AppRole, Profile } from '@/lib/types';

const ROLES: AppRole[] = ['restaurant_admin', 'manager', 'waiter', 'kitchen', 'cashier'];

const ROLE_TONE: Record<string, 'brand' | 'info' | 'neutral' | 'gold'> = {
  restaurant_admin: 'brand',
  manager: 'brand',
  waiter: 'info',
  kitchen: 'gold',
  cashier: 'neutral',
};

export function StaffPage() {
  const { t, dateTime } = useLocale();
  const { restaurant, profile } = useAuth();
  const { push } = useToast();

  const staff = useRows<Profile>('profiles', restaurant?.id, { orderBy: 'created_at' });

  const [linking, setLinking] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [form, setForm] = useState<{ id: string; full_name: string; phone: string; role: AppRole }>({
    id: '',
    full_name: '',
    phone: '',
    role: 'waiter',
  });
  const [saving, setSaving] = useState(false);

  function roleLabel(role: AppRole): string {
    switch (role) {
      case 'restaurant_admin':
        return t('admin.roleRestaurantAdmin');
      case 'manager':
        return t('admin.roleManager');
      case 'waiter':
        return t('admin.roleWaiter');
      case 'kitchen':
        return t('admin.roleKitchen');
      case 'cashier':
        return t('admin.roleCashier');
      default:
        return role;
    }
  }

  /**
   * Creating an auth user needs the service_role key, which must never reach a
   * browser bundle. So the flow is: the owner adds the user in Supabase Auth,
   * then links that user id to a role here. The handle_new_user trigger covers
   * the invite path, where role and restaurant travel in the invite metadata.
   */
  async function link() {
    if (!restaurant) return;
    const id = form.id.trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      push(t('errors.saveFailed'), 'error');
      return;
    }
    setSaving(true);

    const { error } = await supabase.from('profiles').insert({
      id,
      restaurant_id: restaurant.id,
      full_name: form.full_name.trim(),
      phone: form.phone.trim() || null,
      role: form.role,
      is_active: true,
    });

    setSaving(false);

    if (error) {
      push(errorMessage(error), 'error');
      return;
    }
    push(t('admin.inviteSent'), 'success');
    setLinking(false);
    setForm({ id: '', full_name: '', phone: '', role: 'waiter' });
    await staff.reload();
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);

    const res = await staff.update(editing.id, {
      full_name: form.full_name.trim(),
      phone: form.phone.trim() || null,
      role: form.role,
    });

    setSaving(false);

    if (res.error) {
      // the guard_profile_role trigger blocks self-escalation and tenant moves
      push(res.error, 'error');
      return;
    }
    push(t('common.saved'), 'success');
    setEditing(null);
  }

  async function toggleActive(p: Profile) {
    if (p.id === profile?.id) {
      push(t('admin.cannotEditSelf'), 'error');
      return;
    }
    const res = await staff.update(p.id, { is_active: !p.is_active });
    if (res.error) push(res.error, 'error');
  }

  if (staff.loading && !staff.rows.length) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-32" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold text-ink-900">{t('admin.staffTitle')}</h1>
          <p className="mt-0.5 text-[13px] text-ink-500">{t('admin.staffSubtitle')}</p>
        </div>
        <Button onClick={() => setLinking(true)}>{t('admin.inviteStaff')}</Button>
      </div>

      <Card className="bg-sky-50 p-3.5">
        <p className="text-[12.5px] leading-relaxed text-sky-900">{t('admin.staffInviteNote')}</p>
      </Card>

      {staff.rows.length === 0 ? (
        <Card>
          <EmptyState title={t('common.noResults')} />
        </Card>
      ) : (
        <Card className="divide-y divide-ink-100 overflow-hidden">
          {staff.rows.map((p) => (
            <div key={p.id} className={cx('flex flex-wrap items-center gap-3 p-3.5', !p.is_active && 'opacity-55')}>
              <div className="h-9 w-9 shrink-0 rounded-full bg-ink-100 text-[12px] font-semibold text-ink-600 grid place-items-center">
                {initials(p.full_name)}
              </div>

              <div className="min-w-0 grow">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[14.5px] font-medium text-ink-900">{p.full_name || '—'}</p>
                  <Badge tone={ROLE_TONE[p.role] ?? 'neutral'}>{roleLabel(p.role)}</Badge>
                  {p.id === profile?.id ? <Badge tone="neutral">{t('common.yes')}</Badge> : null}
                </div>
                <p className="mt-0.5 text-[12px] text-ink-400">
                  {p.phone ? <span dir="ltr">{p.phone} · </span> : null}
                  {p.last_seen_at ? dateTime(p.last_seen_at) : t('common.notSet')}
                </p>
                <p className="mt-0.5 text-[11px] text-ink-300" dir="ltr">
                  {p.id}
                </p>
              </div>

              <div className="flex shrink-0 gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={p.id === profile?.id}
                  onClick={() => void toggleActive(p)}
                >
                  {p.is_active ? t('admin.deactivate') : t('admin.reactivate')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setForm({
                      id: p.id,
                      full_name: p.full_name,
                      phone: p.phone ?? '',
                      role: p.role,
                    });
                    setEditing(p);
                  }}
                >
                  {t('common.edit')}
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* role reference */}
      <Card className="p-4">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-400">
          {t('admin.role')}
        </h2>
        <dl className="mt-3 space-y-2.5">
          {ROLES.map((r) => (
            <div key={r} className="flex flex-wrap gap-2">
              <dt className="w-28 shrink-0">
                <Badge tone={ROLE_TONE[r] ?? 'neutral'}>{roleLabel(r)}</Badge>
              </dt>
              <dd className="min-w-0 grow text-[13px] text-ink-600">
                {t(`admin.rolePermissions.${r}`)}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      {/* link an existing auth user */}
      <Modal
        open={linking}
        onClose={() => setLinking(false)}
        title={t('admin.linkExisting')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setLinking(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={saving} onClick={() => void link()}>
              {t('common.save')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label={t('admin.authUserId')} hint={t('admin.authUserIdHint')} required>
            <Input
              value={form.id}
              onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
              placeholder="00000000-0000-0000-0000-000000000000"
              dir="ltr"
              className="!text-[12.5px]"
            />
          </Field>
          <Field label={t('admin.fullName')} required>
            <Input
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
            />
          </Field>
          <Field label={t('admin.phone')}>
            <Input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              dir="ltr"
            />
          </Field>
          <Field label={t('admin.role')}>
            <Select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as AppRole }))}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>

      {/* edit */}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.full_name || t('common.edit')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button loading={saving} onClick={() => void saveEdit()}>
              {t('common.save')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label={t('admin.fullName')}>
            <Input
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
            />
          </Field>
          <Field label={t('admin.phone')}>
            <Input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              dir="ltr"
            />
          </Field>
          <Field
            label={t('admin.role')}
            hint={editing?.id === profile?.id ? t('admin.cannotEditSelf') : undefined}
          >
            <Select
              value={form.role}
              disabled={editing?.id === profile?.id}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as AppRole }))}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </Select>
          </Field>
          {editing ? (
            <Toggle
              checked={editing.is_active}
              disabled={editing.id === profile?.id}
              onChange={() => void toggleActive(editing)}
              label={t('common.active')}
            />
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
