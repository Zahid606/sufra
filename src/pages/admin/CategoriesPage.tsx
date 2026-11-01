import { useState } from 'react';
import { useLocale } from '@/lib/useLocale';
import { useAuth } from '@/store/auth';
import { useRows } from '@/lib/useRows';
import { ImageUpload } from '@/components/ImageUpload';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Skeleton,
  Textarea,
  Toggle,
  cx,
  useConfirm,
  useToast,
} from '@/components/ui';
import type { Category, MenuItem } from '@/lib/types';

export function CategoriesPage() {
  const { t, num } = useLocale();
  const { restaurant } = useAuth();
  const { push } = useToast();
  const { confirm, confirmNode } = useConfirm();

  const cats = useRows<Category>('categories', restaurant?.id, { orderBy: 'sort_order' });
  const items = useRows<MenuItem>('menu_items', restaurant?.id, { select: 'id,category_id' });

  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Partial<Category>>({});
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setForm({
      name: '',
      name_ar: '',
      sort_order: cats.rows.length + 1,
      is_active: true,
    });
    setEditing(null);
    setCreating(true);
  }

  async function save() {
    if (!form.name?.trim() || !form.name_ar?.trim()) {
      push(t('errors.saveFailed'), 'error');
      return;
    }
    setSaving(true);

    const payload: Partial<Category> = {
      name: form.name.trim(),
      name_ar: form.name_ar.trim(),
      description: form.description?.trim() || null,
      description_ar: form.description_ar?.trim() || null,
      image_url: form.image_url || null,
      sort_order: Number(form.sort_order) || 0,
      is_active: form.is_active ?? true,
    };

    const res = editing ? await cats.update(editing.id, payload) : await cats.insert(payload);
    setSaving(false);

    if (res.error) {
      push(res.error, 'error');
      return;
    }
    push(t('common.saved'), 'success');
    setEditing(null);
    setCreating(false);
  }

  async function destroy(c: Category) {
    if (!(await confirm(t('admin.deleteCategoryConfirm', { name: c.name }), true))) return;
    const res = await cats.remove(c.id);
    if (res.error) push(res.error, 'error');
    else {
      setEditing(null);
      await items.reload();
    }
  }

  /** Move a category up or down by swapping sort_order with its neighbour. */
  async function move(c: Category, direction: -1 | 1) {
    const sorted = cats.rows.slice().sort((a, b) => a.sort_order - b.sort_order);
    const i = sorted.findIndex((x) => x.id === c.id);
    const j = i + direction;
    if (j < 0 || j >= sorted.length) return;

    const other = sorted[j];
    await cats.update(c.id, { sort_order: other.sort_order });
    await cats.update(other.id, { sort_order: c.sort_order });
  }

  if (cats.loading && !cats.rows.length) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-40" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {confirmNode}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold text-ink-900">{t('admin.categoriesTitle')}</h1>
        <Button onClick={openCreate}>{t('admin.newCategory')}</Button>
      </div>

      {cats.rows.length === 0 ? (
        <Card>
          <EmptyState
            title={t('common.noResults')}
            action={<Button onClick={openCreate}>{t('admin.newCategory')}</Button>}
          />
        </Card>
      ) : (
        <Card className="divide-y divide-ink-100 overflow-hidden">
          {cats.rows.map((c, i) => {
            const count = items.rows.filter((x) => x.category_id === c.id).length;
            return (
              <div key={c.id} className={cx('flex items-center gap-3 p-3.5', !c.is_active && 'opacity-60')}>
                <div className="flex flex-col">
                  <button
                    type="button"
                    disabled={i === 0}
                    onClick={() => void move(c, -1)}
                    aria-label="↑"
                    className="rounded p-0.5 text-ink-400 hover:bg-ink-100 disabled:opacity-30"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="m6 15 6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    disabled={i === cats.rows.length - 1}
                    onClick={() => void move(c, 1)}
                    aria-label="↓"
                    className="rounded p-0.5 text-ink-400 hover:bg-ink-100 disabled:opacity-30"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>

                {c.image_url ? (
                  <img src={c.image_url} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover bg-ink-100" />
                ) : null}

                <div className="min-w-0 grow">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-[14.5px] font-medium text-ink-900">{c.name}</p>
                    <span className="text-[13px] text-ink-400" dir="rtl">
                      {c.name_ar}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-ink-500">
                    {t('admin.itemsInCategory', { count })}
                  </p>
                </div>

                {!c.is_active ? <Badge tone="danger">{t('common.inactive')}</Badge> : null}

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setForm({ ...c });
                    setEditing(c);
                    setCreating(false);
                  }}
                >
                  {t('common.edit')}
                </Button>
              </div>
            );
          })}
        </Card>
      )}

      <Modal
        open={creating || Boolean(editing)}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        title={editing ? t('admin.editCategory') : t('admin.newCategory')}
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
          {restaurant ? (
            <ImageUpload
              label={t('admin.photo')}
              value={form.image_url ?? null}
              onChange={(url) => setForm((f) => ({ ...f, image_url: url }))}
              restaurantId={restaurant.id}
              folder="categories"
              aspect="wide"
            />
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.categoryName')} required>
              <Input
                value={form.name ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                dir="ltr"
              />
            </Field>
            <Field label={t('admin.categoryNameAr')} required>
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
                className="min-h-[60px]"
                dir="ltr"
              />
            </Field>
            <Field label={t('admin.itemDescriptionAr')}>
              <Textarea
                value={form.description_ar ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, description_ar: e.target.value }))}
                className="min-h-[60px]"
                dir="rtl"
              />
            </Field>
          </div>

          <Field label={t('admin.sortOrder')}>
            <Input
              type="number"
              value={form.sort_order ?? 0}
              onChange={(e) => setForm((f) => ({ ...f, sort_order: Number(e.target.value) }))}
              className="max-w-[120px]"
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
    </div>
  );
}
