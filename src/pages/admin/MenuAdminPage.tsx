import { useEffect, useMemo, useState } from 'react';
import { useLocale } from '@/lib/useLocale';
import { useAuth } from '@/store/auth';
import { useRows } from '@/lib/useRows';
import { supabase, errorMessage } from '@/lib/supabase';
import { ImageUpload } from '@/components/ImageUpload';
import {
  Badge,
  Button,
  Card,
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
import type { Category, MenuItem, ModifierGroup, ModifierOption } from '@/lib/types';

const EMPTY: Partial<MenuItem> = {
  name: '',
  name_ar: '',
  description: '',
  description_ar: '',
  price: 0,
  compare_at_price: null,
  category_id: null,
  image_url: null,
  prep_minutes: null,
  calories: null,
  spice_level: null,
  tags: [],
  is_available: true,
  is_popular: false,
  is_featured: false,
  sort_order: 0,
};

/* ====================================================== modifier editor == */

function ModifierEditor({ item, restaurantId }: { item: MenuItem; restaurantId: string }) {
  const { t, money, pick } = useLocale();
  const { push } = useToast();
  const { confirm, confirmNode } = useConfirm();
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('modifier_groups')
      .select('*, modifier_options(*)')
      .eq('menu_item_id', item.id)
      .order('sort_order');
    setGroups(((data ?? []) as ModifierGroup[]).map((g) => ({
      ...g,
      modifier_options: (g.modifier_options ?? []).slice().sort((a, b) => a.sort_order - b.sort_order),
    })));
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  async function addGroup() {
    const { error } = await supabase.from('modifier_groups').insert({
      restaurant_id: restaurantId,
      menu_item_id: item.id,
      name: 'New group',
      name_ar: 'مجموعة جديدة',
      min_select: 0,
      max_select: 1,
      is_required: false,
      sort_order: groups.length + 1,
    });
    if (error) push(errorMessage(error), 'error');
    else await load();
  }

  async function patchGroup(id: string, values: Partial<ModifierGroup>) {
    const { error } = await supabase.from('modifier_groups').update(values).eq('id', id);
    if (error) push(errorMessage(error), 'error');
    else await load();
  }

  async function removeGroup(g: ModifierGroup) {
    if (!(await confirm(`${t('common.delete')} “${pick(g as unknown as Record<string, unknown>, 'name')}”?`, true))) return;
    const { error } = await supabase.from('modifier_groups').delete().eq('id', g.id);
    if (error) push(errorMessage(error), 'error');
    else await load();
  }

  async function addOption(group: ModifierGroup) {
    const { error } = await supabase.from('modifier_options').insert({
      restaurant_id: restaurantId,
      group_id: group.id,
      name: 'New option',
      name_ar: 'خيار جديد',
      price_delta: 0,
      sort_order: (group.modifier_options?.length ?? 0) + 1,
    });
    if (error) push(errorMessage(error), 'error');
    else await load();
  }

  async function patchOption(id: string, values: Partial<ModifierOption>) {
    const { error } = await supabase.from('modifier_options').update(values).eq('id', id);
    if (error) push(errorMessage(error), 'error');
    else await load();
  }

  async function removeOption(id: string) {
    const { error } = await supabase.from('modifier_options').delete().eq('id', id);
    if (error) push(errorMessage(error), 'error');
    else await load();
  }

  if (loading) return <Skeleton className="h-24 w-full" />;

  return (
    <div className="space-y-4">
      {confirmNode}
      <p className="hint !mt-0">{t('admin.modifiersHint')}</p>

      {groups.map((g) => (
        <div key={g.id} className="rounded-xl border border-ink-200 p-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.groupName')}>
              <Input
                defaultValue={g.name}
                onBlur={(e) => {
                  if (e.target.value !== g.name) void patchGroup(g.id, { name: e.target.value });
                }}
                dir="ltr"
              />
            </Field>
            <Field label={t('admin.groupNameAr')}>
              <Input
                defaultValue={g.name_ar}
                onBlur={(e) => {
                  if (e.target.value !== g.name_ar) void patchGroup(g.id, { name_ar: e.target.value });
                }}
                dir="rtl"
              />
            </Field>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label={t('admin.minSelect')}>
              <Input
                type="number"
                min={0}
                defaultValue={g.min_select}
                onBlur={(e) => void patchGroup(g.id, { min_select: Math.max(0, Number(e.target.value)) })}
                dir="ltr"
              />
            </Field>
            <Field label={t('admin.maxSelect')}>
              <Input
                type="number"
                min={1}
                defaultValue={g.max_select}
                onBlur={(e) => void patchGroup(g.id, { max_select: Math.max(1, Number(e.target.value)) })}
                dir="ltr"
              />
            </Field>
            <div className="flex items-end pb-1">
              <Toggle
                checked={g.is_required}
                onChange={(v) => void patchGroup(g.id, { is_required: v })}
                label={t('admin.groupRequired')}
              />
            </div>
          </div>

          <div className="mt-3 space-y-2 border-t border-ink-100 pt-3">
            {(g.modifier_options ?? []).map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-2">
                <Input
                  defaultValue={o.name}
                  onBlur={(e) => {
                    if (e.target.value !== o.name) void patchOption(o.id, { name: e.target.value });
                  }}
                  className="min-w-[120px] grow"
                  placeholder={t('admin.optionName')}
                  dir="ltr"
                />
                <Input
                  defaultValue={o.name_ar}
                  onBlur={(e) => {
                    if (e.target.value !== o.name_ar) void patchOption(o.id, { name_ar: e.target.value });
                  }}
                  className="min-w-[120px] grow"
                  placeholder={t('admin.optionNameAr')}
                  dir="rtl"
                />
                <Input
                  type="number"
                  step="0.5"
                  defaultValue={o.price_delta}
                  onBlur={(e) => void patchOption(o.id, { price_delta: Number(e.target.value) || 0 })}
                  className="w-24"
                  placeholder={t('admin.priceDelta')}
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => void patchOption(o.id, { is_available: !o.is_available })}
                  className="shrink-0"
                  title={t('admin.markAvailable')}
                >
                  <Badge tone={o.is_available ? 'success' : 'danger'}>
                    {o.is_available ? t('common.available') : t('common.unavailable')}
                  </Badge>
                </button>
                <button
                  type="button"
                  onClick={() => void removeOption(o.id)}
                  aria-label={t('common.delete')}
                  className="shrink-0 rounded-lg p-2 text-ink-400 hover:bg-red-50 hover:text-red-600"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            ))}

            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={() => void addOption(g)}>
                {t('admin.newOption')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void removeGroup(g)}>
                {t('common.delete')}
              </Button>
            </div>
          </div>
        </div>
      ))}

      <Button variant="outline" onClick={() => void addGroup()}>
        {t('admin.newGroup')}
      </Button>
    </div>
  );
}

/* ================================================================ page == */

export function MenuAdminPage() {
  const { t, money, num, pick } = useLocale();
  const { restaurant } = useAuth();
  const { push } = useToast();
  const { confirm, confirmNode } = useConfirm();

  const items = useRows<MenuItem>('menu_items', restaurant?.id, { orderBy: 'sort_order' });
  const cats = useRows<Category>('categories', restaurant?.id, { orderBy: 'sort_order' });

  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Partial<MenuItem>>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'details' | 'options'>('details');
  const [catFilter, setCatFilter] = useState<string>('all');
  const [query, setQuery] = useState('');

  function openCreate() {
    setForm({ ...EMPTY, sort_order: items.rows.length + 1 });
    setEditing(null);
    setCreating(true);
    setTab('details');
  }

  function openEdit(item: MenuItem) {
    setForm({ ...item });
    setEditing(item);
    setCreating(false);
    setTab('details');
  }

  function close() {
    setEditing(null);
    setCreating(false);
    setForm(EMPTY);
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.rows.filter((i) => {
      if (catFilter === 'none' && i.category_id) return false;
      if (catFilter !== 'all' && catFilter !== 'none' && i.category_id !== catFilter) return false;
      if (!q) return true;
      return i.name.toLowerCase().includes(q) || i.name_ar.includes(query.trim());
    });
  }, [items.rows, catFilter, query]);

  async function save() {
    if (!restaurant) return;
    if (!form.name?.trim() || !form.name_ar?.trim()) {
      push(t('errors.saveFailed'), 'error');
      return;
    }
    setSaving(true);

    const payload: Partial<MenuItem> = {
      name: form.name!.trim(),
      name_ar: form.name_ar!.trim(),
      description: form.description?.trim() || null,
      description_ar: form.description_ar?.trim() || null,
      price: Number(form.price) || 0,
      compare_at_price: form.compare_at_price ? Number(form.compare_at_price) : null,
      category_id: form.category_id || null,
      image_url: form.image_url || null,
      prep_minutes: form.prep_minutes ? Number(form.prep_minutes) : null,
      calories: form.calories ? Number(form.calories) : null,
      spice_level: form.spice_level === null || form.spice_level === undefined ? null : Number(form.spice_level),
      tags: form.tags ?? [],
      is_available: form.is_available ?? true,
      is_popular: form.is_popular ?? false,
      is_featured: form.is_featured ?? false,
      sort_order: Number(form.sort_order) || 0,
    };

    const res = editing
      ? await items.update(editing.id, payload)
      : await items.insert(payload);

    setSaving(false);

    if (res.error) {
      push(res.error, 'error');
      return;
    }

    push(t('common.saved'), 'success');

    // stay open on a new item so options can be added straight away
    if (!editing && 'data' in res && res.data) {
      setEditing(res.data);
      setCreating(false);
      setTab('options');
    } else {
      close();
    }
  }

  async function toggleAvailable(item: MenuItem) {
    const res = await items.update(item.id, { is_available: !item.is_available });
    if (res.error) push(res.error, 'error');
  }

  async function destroy(item: MenuItem) {
    if (!(await confirm(t('admin.deleteItemConfirm', { name: item.name }), true))) return;
    const res = await items.remove(item.id);
    if (res.error) push(res.error, 'error');
    else close();
  }

  if (items.loading && !items.rows.length) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-40" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {confirmNode}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold text-ink-900">{t('admin.menuTitle')}</h1>
          <p className="mt-0.5 text-[13px] text-ink-500">{t('admin.menuSubtitle')}</p>
        </div>
        <Button onClick={openCreate}>{t('admin.newItem')}</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('common.search')}
          className="max-w-[220px]"
        />
        <Select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="max-w-[220px]">
          <option value="all">{t('common.all')}</option>
          {cats.rows.map((c) => (
            <option key={c.id} value={c.id}>
              {pick(c as unknown as Record<string, unknown>, 'name')}
            </option>
          ))}
          <option value="none">{t('admin.uncategorised')}</option>
        </Select>
      </div>

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            title={t('common.noResults')}
            action={<Button onClick={openCreate}>{t('admin.newItem')}</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-2.5">
          {visible.map((item) => {
            const cat = cats.rows.find((c) => c.id === item.category_id);
            return (
              <Card key={item.id} className={cx('flex items-center gap-3 p-3', !item.is_available && 'opacity-70')}>
                {item.image_url ? (
                  <img src={item.image_url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover bg-ink-100" />
                ) : (
                  <div className="h-14 w-14 shrink-0 rounded-lg bg-ink-100" />
                )}

                <div className="min-w-0 grow">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-[14.5px] font-medium text-ink-900">{item.name}</p>
                    <span className="text-[13px] text-ink-400" dir="rtl">
                      {item.name_ar}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-semibold text-ink-700 tnum">{money(item.price)}</span>
                    {cat ? (
                      <Badge tone="neutral">{pick(cat as unknown as Record<string, unknown>, 'name')}</Badge>
                    ) : null}
                    {item.is_popular ? <Badge tone="gold">{t('menu.popular')}</Badge> : null}
                    {!item.is_available ? <Badge tone="danger">{t('menu.soldOut')}</Badge> : null}
                  </div>
                </div>

                <div className="flex shrink-0 gap-1.5">
                  <Button
                    size="sm"
                    variant={item.is_available ? 'ghost' : 'outline'}
                    onClick={() => void toggleAvailable(item)}
                  >
                    {item.is_available ? t('admin.soldOutToggle') : t('admin.inStockToggle')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openEdit(item)}>
                    {t('common.edit')}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* editor */}
      <Modal
        open={creating || Boolean(editing)}
        onClose={close}
        title={editing ? t('admin.editItem') : t('admin.newItem')}
        size="lg"
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
              <Button variant="ghost" onClick={close}>
                {t('common.cancel')}
              </Button>
              <Button loading={saving} onClick={() => void save()}>
                {saving ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </div>
        }
      >
        {editing ? (
          <Segmented
            className="mb-4"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'details', label: t('common.edit') },
              { value: 'options', label: t('admin.modifiers') },
            ]}
          />
        ) : null}

        {tab === 'options' && editing && restaurant ? (
          <ModifierEditor item={editing} restaurantId={restaurant.id} />
        ) : (
          <div className="space-y-4">
            {restaurant ? (
              <ImageUpload
                label={t('admin.photo')}
                value={form.image_url ?? null}
                onChange={(url) => setForm((f) => ({ ...f, image_url: url }))}
                restaurantId={restaurant.id}
                folder="items"
              />
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('admin.itemName')} required>
                <Input
                  value={form.name ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  dir="ltr"
                />
              </Field>
              <Field label={t('admin.itemNameAr')} required>
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
                  className="min-h-[72px]"
                  dir="ltr"
                />
              </Field>
              <Field label={t('admin.itemDescriptionAr')}>
                <Textarea
                  value={form.description_ar ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, description_ar: e.target.value }))}
                  className="min-h-[72px]"
                  dir="rtl"
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={`${t('admin.price')} (${t('common.sar')})`} required>
                <Input
                  type="number"
                  step="0.5"
                  min={0}
                  value={form.price ?? 0}
                  onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value) }))}
                  dir="ltr"
                />
              </Field>
              <Field label={t('admin.compareAtPrice')} hint={t('common.optional')}>
                <Input
                  type="number"
                  step="0.5"
                  min={0}
                  value={form.compare_at_price ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      compare_at_price: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                  dir="ltr"
                />
              </Field>
              <Field label={t('admin.category')}>
                <Select
                  value={form.category_id ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value || null }))}
                >
                  <option value="">{t('admin.uncategorised')}</option>
                  {cats.rows.map((c) => (
                    <option key={c.id} value={c.id}>
                      {pick(c as unknown as Record<string, unknown>, 'name')}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <Field label={t('admin.prepTime')}>
                <Input
                  type="number"
                  min={0}
                  value={form.prep_minutes ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, prep_minutes: e.target.value ? Number(e.target.value) : null }))
                  }
                  dir="ltr"
                />
              </Field>
              <Field label={t('admin.calories')}>
                <Input
                  type="number"
                  min={0}
                  value={form.calories ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, calories: e.target.value ? Number(e.target.value) : null }))
                  }
                  dir="ltr"
                />
              </Field>
              <Field label={t('admin.spiceLevel')}>
                <Select
                  value={String(form.spice_level ?? '')}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, spice_level: e.target.value === '' ? null : Number(e.target.value) }))
                  }
                >
                  <option value="">{t('common.none')}</option>
                  <option value="1">🌶</option>
                  <option value="2">🌶🌶</option>
                  <option value="3">🌶🌶🌶</option>
                </Select>
              </Field>
              <Field label={t('admin.sortOrder')}>
                <Input
                  type="number"
                  value={form.sort_order ?? 0}
                  onChange={(e) => setForm((f) => ({ ...f, sort_order: Number(e.target.value) }))}
                  dir="ltr"
                />
              </Field>
            </div>

            <Field label={t('admin.tags')} hint={t('admin.tagsHint')}>
              <Input
                value={(form.tags ?? []).join(', ')}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    tags: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }))
                }
                placeholder="vegetarian, signature, saudi"
                dir="ltr"
              />
            </Field>

            <div className="space-y-3 border-t border-ink-100 pt-4">
              <Toggle
                checked={form.is_available ?? true}
                onChange={(v) => setForm((f) => ({ ...f, is_available: v }))}
                label={t('admin.markAvailable')}
              />
              <Toggle
                checked={form.is_popular ?? false}
                onChange={(v) => setForm((f) => ({ ...f, is_popular: v }))}
                label={t('admin.markPopular')}
              />
              <Toggle
                checked={form.is_featured ?? false}
                onChange={(v) => setForm((f) => ({ ...f, is_featured: v }))}
                label={t('admin.markFeatured')}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
