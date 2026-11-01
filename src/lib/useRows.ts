import { useCallback, useEffect, useState } from 'react';
import { supabase, errorMessage } from './supabase';

/**
 * A small CRUD hook over one Supabase table, scoped to a restaurant.
 *
 * It exists to keep every admin screen honest about two things: the
 * restaurant_id is attached on insert (RLS would reject it anyway, but failing
 * at the policy is a worse error message than never sending it wrong), and the
 * local list is refetched after each write rather than patched optimistically,
 * so what the screen shows is what the database actually holds.
 */
export interface RowsApi<T> {
  rows: T[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  insert: (values: Partial<T>) => Promise<{ error: string | null; data: T | null }>;
  update: (id: string, values: Partial<T>) => Promise<{ error: string | null }>;
  remove: (id: string) => Promise<{ error: string | null }>;
}

export function useRows<T extends { id: string }>(
  table: string,
  restaurantId: string | null | undefined,
  options: {
    select?: string;
    orderBy?: string;
    ascending?: boolean;
    /** extra equality filters, e.g. { game_id: '...' } */
    filters?: Record<string, string | number | boolean | null>;
    /** skip the restaurant_id filter (for platform-wide tables like plans) */
    global?: boolean;
    limit?: number;
  } = {},
): RowsApi<T> {
  const {
    select = '*',
    orderBy = 'created_at',
    ascending = true,
    filters,
    global = false,
    limit,
  } = options;

  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filterKey = JSON.stringify(filters ?? {});

  const reload = useCallback(async () => {
    if (!global && !restaurantId) {
      setRows([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    let q = supabase.from(table).select(select);
    if (!global && restaurantId) q = q.eq('restaurant_id', restaurantId);

    const parsed = JSON.parse(filterKey) as Record<string, string | number | boolean | null>;
    for (const [k, v] of Object.entries(parsed)) {
      q = v === null ? q.is(k, null) : q.eq(k, v);
    }

    q = q.order(orderBy, { ascending });
    if (limit) q = q.limit(limit);

    const { data, error: err } = await q;

    if (err) {
      setError(errorMessage(err));
      setRows([]);
    } else {
      setRows((data ?? []) as T[]);
    }
    setLoading(false);
  }, [table, select, orderBy, ascending, filterKey, global, restaurantId, limit]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const insert = useCallback(
    async (values: Partial<T>) => {
      const payload =
        global || !restaurantId ? values : { ...values, restaurant_id: restaurantId };

      const { data, error: err } = await supabase
        .from(table)
        .insert(payload)
        .select()
        .maybeSingle();

      if (err) return { error: errorMessage(err), data: null };
      await reload();
      return { error: null, data: (data ?? null) as T | null };
    },
    [table, restaurantId, global, reload],
  );

  const update = useCallback(
    async (id: string, values: Partial<T>) => {
      const { error: err } = await supabase.from(table).update(values).eq('id', id);
      if (err) return { error: errorMessage(err) };
      await reload();
      return { error: null };
    },
    [table, reload],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error: err } = await supabase.from(table).delete().eq('id', id);
      if (err) return { error: errorMessage(err) };
      await reload();
      return { error: null };
    },
    [table, reload],
  );

  return { rows, loading, error, reload, insert, update, remove };
}
