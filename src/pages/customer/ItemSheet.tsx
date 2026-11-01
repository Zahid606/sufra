import { useEffect, useMemo, useState } from 'react';
import { useLocale } from '@/lib/useLocale';
import { useModifiers } from '@/lib/useMenu';
import { useCart } from '@/store/cart';
import { useGuest } from '@/store/guest';
import { Badge, Button, Modal, Spinner, Textarea, cx, useToast } from '@/components/ui';
import type { MenuItem, ModifierOption } from '@/lib/types';

/**
 * The dish detail sheet: photo, description, option groups, notes, quantity.
 *
 * Selection rules (required groups, max picks) are enforced here so the guest
 * gets an immediate, translated nudge — and enforced again in place_order, so
 * a hand-crafted request cannot slip past them.
 */
export function ItemSheet({
  item,
  open,
  onClose,
}: {
  item: MenuItem | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t, money, pick, locale } = useLocale();
  const { restaurant } = useGuest();
  const { add } = useCart();
  const { push } = useToast();
  const { groups, loading } = useModifiers(open && item ? item.id : null);

  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [touched, setTouched] = useState(false);

  // reset whenever a different dish opens
  useEffect(() => {
    if (!open) return;
    setSelected({});
    setNotes('');
    setQuantity(1);
    setTouched(false);
  }, [open, item?.id]);

  // pre-tick the defaults a restaurant marked, so the common case is one tap
  useEffect(() => {
    if (!groups.length) return;
    setSelected((prev) => {
      if (Object.keys(prev).length) return prev;
      const next: Record<string, string[]> = {};
      for (const g of groups) {
        const defaults = (g.modifier_options ?? [])
          .filter((o) => o.is_default && o.is_available)
          .slice(0, g.max_select)
          .map((o) => o.id);
        if (defaults.length) next[g.id] = defaults;
      }
      return next;
    });
  }, [groups]);

  const chosenOptions = useMemo<ModifierOption[]>(() => {
    const byId = new Map<string, ModifierOption>();
    for (const g of groups) {
      for (const o of g.modifier_options ?? []) byId.set(o.id, o);
    }
    return Object.values(selected)
      .flat()
      .map((id) => byId.get(id))
      .filter((o): o is ModifierOption => Boolean(o));
  }, [selected, groups]);

  const modifiersTotal = chosenOptions.reduce((s, o) => s + Number(o.price_delta || 0), 0);
  const unitPrice = Number(item?.price ?? 0) + modifiersTotal;
  const lineTotal = Math.round(unitPrice * quantity * 100) / 100;

  /** The first unmet requirement, used to label and block the add button. */
  const unmet = useMemo(() => {
    for (const g of groups) {
      const picked = selected[g.id]?.length ?? 0;
      const min = g.is_required ? Math.max(g.min_select, 1) : g.min_select;
      if (picked < min) {
        return { group: g, min };
      }
    }
    return null;
  }, [groups, selected]);

  function toggleOption(groupId: string, option: ModifierOption, maxSelect: number) {
    if (!option.is_available) return;
    setTouched(true);
    setSelected((prev) => {
      const current = prev[groupId] ?? [];
      const has = current.includes(option.id);

      if (has) {
        return { ...prev, [groupId]: current.filter((x) => x !== option.id) };
      }
      if (maxSelect === 1) {
        // single-choice behaves like a radio: replace rather than reject
        return { ...prev, [groupId]: [option.id] };
      }
      if (current.length >= maxSelect) {
        push(
          t('cart.modifier_group_max', {
            max: maxSelect,
            group: pick(groups.find((g) => g.id === groupId) as unknown as Record<string, unknown>, 'name'),
          }),
          'info',
        );
        return prev;
      }
      return { ...prev, [groupId]: [...current, option.id] };
    });
  }

  function handleAdd() {
    if (!item) return;
    setTouched(true);

    if (unmet) {
      push(
        t('cart.modifier_group_required', {
          group: pick(unmet.group as unknown as Record<string, unknown>, 'name'),
          min: unmet.min,
        }),
        'error',
      );
      // scroll the offending group into view
      document.getElementById(`group-${unmet.group.id}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
      return;
    }

    add({
      menuItemId: item.id,
      name: item.name,
      nameAr: item.name_ar,
      imageUrl: item.image_url,
      basePrice: Number(item.price),
      quantity,
      options: chosenOptions.map((o) => ({
        id: o.id,
        groupId: o.group_id,
        name: o.name,
        nameAr: o.name_ar,
        priceDelta: Number(o.price_delta),
      })),
      notes: notes.trim() ? notes.trim() : null,
    });

    onClose();
  }

  if (!item) return null;

  const name = pick(item as unknown as Record<string, unknown>, 'name');
  const description = pick(item as unknown as Record<string, unknown>, 'description');

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      footer={
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-xl border border-ink-200 bg-white shrink-0">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              aria-label="−"
              className="h-11 w-11 grid place-items-center text-ink-600 disabled:text-ink-300"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            <span className="w-7 text-center text-[15px] font-semibold tnum">{quantity}</span>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(99, q + 1))}
              aria-label="+"
              className="h-11 w-11 grid place-items-center text-ink-600"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M12 5v14M5 12h14"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          <Button
            size="lg"
            className="grow"
            onClick={handleAdd}
            disabled={!item.is_available}
          >
            {item.is_available ? (
              <span className="flex items-baseline gap-2">
                <span>{t('menu.addToCart')}</span>
                <span className="opacity-80 tnum">· {money(lineTotal)}</span>
              </span>
            ) : (
              t('menu.soldOut')
            )}
          </Button>
        </div>
      }
    >
      {item.image_url ? (
        <img
          src={item.image_url}
          alt=""
          className="-mx-5 -mt-4 mb-4 h-52 w-[calc(100%+2.5rem)] object-cover"
        />
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[19px] font-semibold text-ink-900 leading-snug">{name}</h2>
        <div className="text-end shrink-0">
          <p className="text-[17px] font-semibold text-ink-900 tnum">{money(item.price)}</p>
          {item.compare_at_price && Number(item.compare_at_price) > Number(item.price) ? (
            <p className="text-[13px] text-ink-400 line-through tnum">
              {money(item.compare_at_price)}
            </p>
          ) : null}
        </div>
      </div>

      {description ? (
        <p className="mt-2 text-[14px] text-ink-600 leading-relaxed">{description}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {!item.is_available ? <Badge tone="danger">{t('menu.soldOut')}</Badge> : null}
        {item.is_popular ? <Badge tone="gold">{t('menu.popular')}</Badge> : null}
        {item.prep_minutes ? (
          <Badge tone="neutral">
            {item.prep_minutes} {t('common.minutes')}
          </Badge>
        ) : null}
        {item.calories ? (
          <Badge tone="neutral">
            {item.calories} {t('common.kcal')}
          </Badge>
        ) : null}
        {item.spice_level ? (
          <Badge tone="warn">
            {t('menu.spicy')} {'🌶'.repeat(Math.min(3, item.spice_level))}
          </Badge>
        ) : null}
        {item.tags?.includes('vegetarian') ? (
          <Badge tone="success">{t('menu.vegetarian')}</Badge>
        ) : null}
      </div>

      {loading ? (
        <div className="py-8 grid place-items-center">
          <Spinner className="text-brand-600" />
        </div>
      ) : null}

      {groups.map((g) => {
        const picked = selected[g.id] ?? [];
        const min = g.is_required ? Math.max(g.min_select, 1) : g.min_select;
        const isUnmet = touched && picked.length < min;
        const groupName = pick(g as unknown as Record<string, unknown>, 'name');

        return (
          <section key={g.id} id={`group-${g.id}`} className="mt-6">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-[15px] font-semibold text-ink-900">{groupName}</h3>
              <span className={cx('text-[12px]', isUnmet ? 'text-red-600' : 'text-ink-400')}>
                {min > 0
                  ? g.max_select === 1
                    ? t('menu.chooseOne')
                    : t('menu.chooseAtLeast', { min })
                  : t('menu.chooseUpTo', { max: g.max_select })}
              </span>
            </div>

            <div
              className={cx(
                'mt-2.5 rounded-xl border divide-y overflow-hidden',
                isUnmet ? 'border-red-300 divide-red-100' : 'border-ink-200 divide-ink-100',
              )}
            >
              {(g.modifier_options ?? []).map((o) => {
                const isPicked = picked.includes(o.id);
                const optName = pick(o as unknown as Record<string, unknown>, 'name');

                return (
                  <button
                    key={o.id}
                    type="button"
                    disabled={!o.is_available}
                    onClick={() => toggleOption(g.id, o, g.max_select)}
                    className={cx(
                      'flex w-full items-center gap-3 px-3.5 py-3 text-start transition-colors',
                      isPicked ? 'bg-brand-50' : 'bg-white hover:bg-ink-50',
                      !o.is_available && 'opacity-50 cursor-not-allowed',
                    )}
                  >
                    <span
                      className={cx(
                        'grid h-5 w-5 shrink-0 place-items-center border-2 transition-colors',
                        g.max_select === 1 ? 'rounded-full' : 'rounded-md',
                        isPicked ? 'border-brand-600 bg-brand-600' : 'border-ink-300 bg-white',
                      )}
                    >
                      {isPicked ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                          <path
                            d="m5 13 4 4L19 7"
                            stroke="white"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : null}
                    </span>

                    <span className="grow text-[14.5px] text-ink-800">{optName}</span>

                    {Number(o.price_delta) !== 0 ? (
                      <span className="shrink-0 text-[13px] font-medium text-ink-500 tnum">
                        {Number(o.price_delta) > 0 ? '+' : '−'}
                        {money(Math.abs(Number(o.price_delta)))}
                      </span>
                    ) : null}

                    {!o.is_available ? (
                      <span className="shrink-0 text-[12px] text-ink-400">{t('menu.soldOut')}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {restaurant.allow_customer_notes ? (
        <section className="mt-6">
          <h3 className="text-[15px] font-semibold text-ink-900">{t('menu.specialRequests')}</h3>
          <Textarea
            className="mt-2.5 min-h-[72px]"
            value={notes}
            maxLength={240}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('menu.notesPlaceholder')}
            dir={locale === 'ar' ? 'rtl' : 'ltr'}
          />
        </section>
      ) : null}
    </Modal>
  );
}
