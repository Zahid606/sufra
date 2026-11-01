import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from '@/lib/supabase';
import { getSessionId, readLocal, writeLocal } from '@/lib/session';
import type { ResolveTableOk, ResolveTableResult, Restaurant } from '@/lib/types';
import { setLocale, currentLocale, LOCALE_KEY } from '@/lib/i18n';

interface GuestState {
  restaurant: Restaurant;
  table: ResolveTableOk['table'];
  sessionId: string;
  /** a coupon won from a game, offered in the cart */
  pendingCoupon: string | null;
  setPendingCoupon: (code: string | null) => void;
}

const Ctx = createContext<GuestState | null>(null);

export type ResolveState =
  | { status: 'loading' }
  | { status: 'ok'; data: ResolveTableOk }
  | { status: 'error'; error: string };

/**
 * Resolves /r/:slug/t/:code?k=:token into a restaurant and a table through the
 * resolve_table RPC. The token check happens on the server, so a guessed URL
 * cannot open a table, and the restaurant's own default language is applied on
 * first visit unless the guest has already chosen one.
 */
export function useResolveTable(
  slug: string | undefined,
  code: string | undefined,
  token: string | null,
): { state: ResolveState; retry: () => void } {
  const [state, setState] = useState<ResolveState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;

    if (!slug || !code) {
      setState({ status: 'error', error: 'missingParams' });
      return;
    }

    setState({ status: 'loading' });

    void (async () => {
      const { data, error } = await supabase.rpc('resolve_table', {
        p_slug: slug,
        p_code: code,
        p_token: token,
      });

      if (!alive) return;

      if (error) {
        setState({ status: 'error', error: 'generic' });
        return;
      }

      const result = data as ResolveTableResult;
      if (!result?.ok) {
        setState({ status: 'error', error: result?.error ?? 'generic' });
        return;
      }

      // honour the restaurant's default language, but never override a guest
      // who has already picked one themselves
      let guestChose = false;
      try {
        guestChose = Boolean(localStorage.getItem(LOCALE_KEY));
      } catch {
        /* storage blocked */
      }
      if (!guestChose && result.restaurant.default_locale !== currentLocale()) {
        await setLocale(result.restaurant.default_locale);
      }

      setState({ status: 'ok', data: result });
    })();

    return () => {
      alive = false;
    };
  }, [slug, code, token, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { state, retry };
}

export function GuestProvider({
  data,
  children,
}: {
  data: ResolveTableOk;
  children: ReactNode;
}) {
  const sessionId = getSessionId();
  const couponKey = `sufra.coupon.${data.restaurant.id}`;
  const [pendingCoupon, setCoupon] = useState<string | null>(() =>
    readLocal<string | null>(couponKey, null),
  );

  const setPendingCoupon = useCallback(
    (code: string | null) => {
      setCoupon(code);
      writeLocal(couponKey, code);
    },
    [couponKey],
  );

  // let a restaurant's accent colour drive the themeable CSS variables
  useEffect(() => {
    const root = document.documentElement;
    if (data.restaurant.primary_color) {
      root.style.setProperty('--brand', data.restaurant.primary_color);
    }
    return () => {
      root.style.removeProperty('--brand');
    };
  }, [data.restaurant.primary_color]);

  const value = useMemo<GuestState>(
    () => ({
      restaurant: data.restaurant,
      table: data.table,
      sessionId,
      pendingCoupon,
      setPendingCoupon,
    }),
    [data.restaurant, data.table, sessionId, pendingCoupon, setPendingCoupon],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGuest(): GuestState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useGuest must be used inside <GuestProvider>');
  return ctx;
}
