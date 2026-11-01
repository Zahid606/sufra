import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Category, MenuItem, ModifierGroup, Promotion } from './types';
import { getSessionId } from './session';

export interface MenuData {
  categories: Category[];
  items: MenuItem[];
  promotions: Promotion[];
  favorites: Set<string>;
  loading: boolean;
  error: string | null;
  reload: () => void;
  toggleFavorite: (menuItemId: string) => Promise<void>;
}

/**
 * Loads the guest-visible menu in three parallel queries. RLS already limits
 * every row to this restaurant and hides inactive categories, so there is no
 * tenant filter to get wrong here — but we pass restaurant_id anyway so a
 * browser that has several tabs open on different restaurants stays correct.
 */
export function useMenu(restaurantId: string): MenuData {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const sessionId = getSessionId();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    void (async () => {
      const [cats, mi, promos, favs] = await Promise.all([
        supabase
          .from('categories')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .order('sort_order'),
        supabase
          .from('menu_items')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .order('sort_order'),
        supabase
          .from('promotions')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .order('sort_order'),
        supabase
          .from('favorites')
          .select('menu_item_id')
          .eq('restaurant_id', restaurantId)
          .eq('session_id', sessionId),
      ]);

      if (!alive) return;

      if (cats.error || mi.error) {
        setError(cats.error?.message || mi.error?.message || 'load_failed');
        setLoading(false);
        return;
      }

      setCategories((cats.data ?? []) as Category[]);
      setItems((mi.data ?? []) as MenuItem[]);
      setPromotions((promos.data ?? []) as Promotion[]);
      setFavorites(new Set(((favs.data ?? []) as { menu_item_id: string }[]).map((f) => f.menu_item_id)));
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [restaurantId, sessionId, tick]);

  // Keep availability honest: if the kitchen marks a dish sold out while the
  // guest is browsing, the card greys out without a reload.
  useEffect(() => {
    const channel = supabase
      .channel(`menu-${restaurantId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'menu_items',
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        (payload) => {
          const next = payload.new as MenuItem;
          setItems((prev) => prev.map((it) => (it.id === next.id ? { ...it, ...next } : it)));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [restaurantId]);

  const toggleFavorite = useCallback(
    async (menuItemId: string) => {
      const isFav = favorites.has(menuItemId);

      // optimistic: the heart should respond instantly on a slow connection
      setFavorites((prev) => {
        const next = new Set(prev);
        if (isFav) next.delete(menuItemId);
        else next.add(menuItemId);
        return next;
      });

      const { error: err } = isFav
        ? await supabase
            .from('favorites')
            .delete()
            .eq('session_id', sessionId)
            .eq('menu_item_id', menuItemId)
        : await supabase
            .from('favorites')
            .insert({
              restaurant_id: restaurantId,
              menu_item_id: menuItemId,
              session_id: sessionId,
            });

      if (err) {
        // roll back so the UI never claims something the server rejected
        setFavorites((prev) => {
          const next = new Set(prev);
          if (isFav) next.add(menuItemId);
          else next.delete(menuItemId);
          return next;
        });
      }
    },
    [favorites, restaurantId, sessionId],
  );

  return {
    categories,
    items,
    promotions,
    favorites,
    loading,
    error,
    reload: () => setTick((t) => t + 1),
    toggleFavorite,
  };
}

/** Modifier groups for one dish, loaded when its sheet opens. */
export function useModifiers(menuItemId: string | null) {
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!menuItemId) {
      setGroups([]);
      return;
    }
    let alive = true;
    setLoading(true);

    void (async () => {
      const { data } = await supabase
        .from('modifier_groups')
        .select('*, modifier_options(*)')
        .eq('menu_item_id', menuItemId)
        .order('sort_order');

      if (!alive) return;

      const rows = ((data ?? []) as ModifierGroup[]).map((g) => ({
        ...g,
        modifier_options: (g.modifier_options ?? [])
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order),
      }));

      setGroups(rows);
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [menuItemId]);

  return { groups, loading };
}
