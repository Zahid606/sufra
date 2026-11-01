import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '@/lib/useLocale';
import { useGuest } from '@/store/guest';
import { useCart } from '@/store/cart';
import { useMenu } from '@/lib/useMenu';
import { Badge, Button, EmptyState, Input, Skeleton, cx } from '@/components/ui';
import { ItemSheet } from './ItemSheet';
import type { MenuItem } from '@/lib/types';

const ALL = '__all__';
const POPULAR = '__popular__';
const FAVORITES = '__favorites__';

/* ------------------------------------------------------------- item card -- */

function ItemCard({
  item,
  isFavorite,
  onOpen,
  onToggleFavorite,
}: {
  item: MenuItem;
  isFavorite: boolean;
  onOpen: () => void;
  onToggleFavorite: () => void;
}) {
  const { t, money, pick } = useLocale();
  const name = pick(item as unknown as Record<string, unknown>, 'name');
  const description = pick(item as unknown as Record<string, unknown>, 'description');
  const onSale = item.compare_at_price && Number(item.compare_at_price) > Number(item.price);

  return (
    <article
      className={cx(
        'card relative flex gap-3 p-3 transition-shadow',
        item.is_available ? 'hover:shadow-lift cursor-pointer' : 'opacity-70',
      )}
      onClick={item.is_available ? onOpen : undefined}
    >
      <div className="min-w-0 grow">
        <div className="flex items-start gap-2">
          <h3 className="text-[15px] font-semibold text-ink-900 leading-snug">{name}</h3>
        </div>

        {description ? (
          <p className="mt-1 text-[13px] text-ink-500 leading-relaxed line-clamp-2">
            {description}
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {!item.is_available ? (
            <Badge tone="danger">{t('menu.soldOut')}</Badge>
          ) : (
            <>
              {item.is_popular ? <Badge tone="gold">{t('menu.popular')}</Badge> : null}
              {item.spice_level ? <Badge tone="warn">{'🌶'.repeat(Math.min(3, item.spice_level))}</Badge> : null}
              {item.tags?.includes('vegetarian') ? (
                <Badge tone="success">{t('menu.vegetarian')}</Badge>
              ) : null}
            </>
          )}
        </div>

        <div className="mt-2.5 flex items-baseline gap-2">
          <span className="text-[15px] font-semibold text-ink-900 tnum">{money(item.price)}</span>
          {onSale ? (
            <span className="text-[13px] text-ink-400 line-through tnum">
              {money(item.compare_at_price)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="relative shrink-0">
        {item.image_url ? (
          <img
            src={item.image_url}
            alt=""
            loading="lazy"
            className="h-[92px] w-[92px] rounded-xl object-cover bg-ink-100"
          />
        ) : (
          <div className="h-[92px] w-[92px] rounded-xl bg-ink-100 grid place-items-center text-ink-300">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M5 20h14M6 16.5h12M7.5 13c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5M12 5.5V7"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </div>
        )}

        <button
          type="button"
          aria-label={t('menu.favorites')}
          aria-pressed={isFavorite}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          className={cx(
            'absolute -top-1.5 -end-1.5 h-8 w-8 rounded-full grid place-items-center',
            'bg-white shadow-card ring-1 ring-ink-100 transition-colors',
            isFavorite ? 'text-red-500' : 'text-ink-300 hover:text-ink-500',
          )}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} aria-hidden>
            <path
              d="M12 20s-7.5-4.4-7.5-9.3A4.2 4.2 0 0 1 12 7.8a4.2 4.2 0 0 1 7.5 2.9C19.5 15.6 12 20 12 20Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ page -- */

export function MenuPage() {
  const { t, pick, money } = useLocale();
  const navigate = useNavigate();
  const { restaurant } = useGuest();
  const { count, subtotal } = useCart();
  const { categories, items, promotions, favorites, loading, error, reload, toggleFavorite } =
    useMenu(restaurant.id);

  const [activeCat, setActiveCat] = useState<string>(ALL);
  const [query, setQuery] = useState('');
  const [sheetItem, setSheetItem] = useState<MenuItem | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  const popularCount = items.filter((i) => i.is_popular).length;

  const tabs = useMemo(() => {
    const list: { id: string; label: string; count?: number }[] = [
      { id: ALL, label: t('common.all') },
    ];
    if (popularCount) list.push({ id: POPULAR, label: t('menu.popular') });
    if (favorites.size) list.push({ id: FAVORITES, label: t('menu.favorites'), count: favorites.size });
    for (const c of categories) {
      const n = items.filter((i) => i.category_id === c.id).length;
      if (n) list.push({ id: c.id, label: pick(c as unknown as Record<string, unknown>, 'name'), count: n });
    }
    return list;
  }, [categories, items, favorites.size, popularCount, pick, t]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = items;

    if (q) {
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.name_ar.includes(query.trim()) ||
          (i.description ?? '').toLowerCase().includes(q) ||
          (i.description_ar ?? '').includes(query.trim()),
      );
    } else if (activeCat === POPULAR) {
      list = list.filter((i) => i.is_popular);
    } else if (activeCat === FAVORITES) {
      list = list.filter((i) => favorites.has(i.id));
    } else if (activeCat !== ALL) {
      list = list.filter((i) => i.category_id === activeCat);
    }

    // available dishes first, so a sold-out item never heads a section
    return list
      .slice()
      .sort((a, b) =>
        a.is_available === b.is_available ? a.sort_order - b.sort_order : a.is_available ? -1 : 1,
      );
  }, [items, query, activeCat, favorites]);

  /** When showing everything, group by category so the menu reads like a menu. */
  const grouped = useMemo(() => {
    if (query.trim() || activeCat !== ALL) return null;
    const byCat = categories
      .map((c) => ({
        category: c,
        items: visible.filter((i) => i.category_id === c.id),
      }))
      .filter((g) => g.items.length);

    const orphans = visible.filter((i) => !i.category_id || !categories.some((c) => c.id === i.category_id));
    if (orphans.length) {
      byCat.push({
        category: { ...categories[0], id: '__none__', name: t('admin.uncategorised'), name_ar: t('admin.uncategorised') } as never,
        items: orphans,
      });
    }
    return byCat;
  }, [categories, visible, query, activeCat, t]);

  if (loading) {
    return (
      <div className="px-4 py-5 space-y-3">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-9 w-2/3" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[116px] w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        title={t('errors.loadFailed')}
        action={<Button onClick={reload}>{t('common.retry')}</Button>}
      />
    );
  }

  return (
    <>
      {/* offers */}
      {promotions.length ? (
        <section className="pt-4">
          <div className="rail px-4 pb-1">
            {promotions.map((p) => {
              const title = pick(p as unknown as Record<string, unknown>, 'title');
              const sub = pick(p as unknown as Record<string, unknown>, 'subtitle');
              return (
                <div
                  key={p.id}
                  className="relative shrink-0 w-[85%] max-w-sm overflow-hidden rounded-2xl p-4 text-white shadow-card"
                  style={{
                    background: `linear-gradient(135deg, ${restaurant.primary_color}, #1a1a17)`,
                    scrollSnapAlign: 'start',
                  }}
                >
                  {p.image_url ? (
                    <img
                      src={p.image_url}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover opacity-30"
                      loading="lazy"
                    />
                  ) : null}
                  <div className="relative">
                    <Badge tone="gold" className="mb-2">
                      {t('menu.offers')}
                    </Badge>
                    <h3 className="text-[15px] font-semibold leading-snug">{title}</h3>
                    {sub ? <p className="mt-1 text-[13px] text-white/75">{sub}</p> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* search */}
      <div className="px-4 pt-4">
        <div className="relative">
          <span className="absolute inset-y-0 start-0 grid w-10 place-items-center text-ink-400">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
              <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('menu.searchPlaceholder')}
            className="ps-10"
            inputMode="search"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={t('common.close')}
              className="absolute inset-y-0 end-0 grid w-10 place-items-center text-ink-400"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      {/* category rail */}
      {!query.trim() ? (
        <div ref={railRef} className="rail sticky top-0 z-20 bg-ink-50/95 px-4 py-3 backdrop-blur">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveCat(tab.id)}
              className={cx(
                'shrink-0 rounded-full px-3.5 py-2 text-[13px] font-medium transition-colors',
                activeCat === tab.id
                  ? 'bg-ink-900 text-white'
                  : 'bg-white text-ink-600 ring-1 ring-ink-200 hover:text-ink-900',
              )}
              style={{ scrollSnapAlign: 'start' }}
            >
              {tab.label}
              {tab.count ? <span className="ms-1.5 opacity-60 tnum">{tab.count}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {/* items */}
      <div className="px-4 pb-6">
        {visible.length === 0 ? (
          activeCat === FAVORITES ? (
            <EmptyState title={t('menu.favorites')} body={t('menu.noFavorites')} />
          ) : query.trim() ? (
            <EmptyState title={t('menu.noSearchResults', { q: query.trim() })} />
          ) : (
            <EmptyState title={t('menu.noItems')} />
          )
        ) : grouped ? (
          <div className="space-y-7">
            {grouped.map(({ category, items: list }) => (
              <section key={category.id}>
                <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-ink-400">
                  {pick(category as unknown as Record<string, unknown>, 'name')}
                </h2>
                <div className="space-y-3">
                  {list.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      isFavorite={favorites.has(item.id)}
                      onOpen={() => setSheetItem(item)}
                      onToggleFavorite={() => void toggleFavorite(item.id)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                isFavorite={favorites.has(item.id)}
                onOpen={() => setSheetItem(item)}
                onToggleFavorite={() => void toggleFavorite(item.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* floating cart bar, sits above the tab bar */}
      {count > 0 ? (
        <div className="fixed inset-x-0 bottom-[68px] z-30 px-4 no-print" style={{ paddingBottom: 'var(--safe-bottom)' }}>
          <div className="mx-auto max-w-2xl">
            <Button
              size="lg"
              block
              onClick={() => navigate('cart')}
              className="shadow-lift"
            >
              <span className="flex w-full items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <span className="grid h-6 min-w-6 place-items-center rounded-full bg-white/20 px-1.5 text-[12px] font-semibold tnum">
                    {count}
                  </span>
                  {t('menu.viewCart')}
                </span>
                <span className="tnum">{money(subtotal)}</span>
              </span>
            </Button>
          </div>
        </div>
      ) : null}

      <ItemSheet item={sheetItem} open={Boolean(sheetItem)} onClose={() => setSheetItem(null)} />
    </>
  );
}
