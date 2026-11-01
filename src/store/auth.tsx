import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isConfigured } from '@/lib/supabase';
import type { AppRole, Profile, Restaurant } from '@/lib/types';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  restaurant: Restaurant | null;
  loading: boolean;
  /** set when a user authenticates but has no usable profile row */
  profileError: 'missing' | 'inactive' | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (...roles: AppRole[]) => boolean;
  isSuperAdmin: boolean;
  isManager: boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<'missing' | 'inactive' | null>(null);

  const loadProfile = useCallback(async (uid: string | undefined) => {
    if (!uid) {
      setProfile(null);
      setRestaurant(null);
      setProfileError(null);
      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .maybeSingle();

    if (error || !data) {
      // The user exists in auth but has no profile: an invitation that was
      // never finished. Signing them out would hide the reason, so surface it.
      setProfile(null);
      setRestaurant(null);
      setProfileError('missing');
      return;
    }

    const p = data as Profile;
    if (!p.is_active) {
      setProfile(null);
      setRestaurant(null);
      setProfileError('inactive');
      return;
    }

    setProfile(p);
    setProfileError(null);

    if (p.restaurant_id) {
      const { data: r } = await supabase
        .from('restaurants')
        .select('*')
        .eq('id', p.restaurant_id)
        .maybeSingle();
      setRestaurant((r as Restaurant) ?? null);
    } else {
      setRestaurant(null);
    }

    // a light presence signal for the staff list; failure is irrelevant
    void supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', uid);
  }, []);

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }

    let alive = true;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      setSession(data.session ?? null);
      await loadProfile(data.session?.user?.id);
      if (alive) setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s ?? null);
      if (event === 'SIGNED_OUT') {
        setProfile(null);
        setRestaurant(null);
        setProfileError(null);
        return;
      }
      // TOKEN_REFRESHED fires often; the profile has not changed, skip refetch
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        void loadProfile(s?.user?.id);
      }
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) return { error: error.message };
    await loadProfile(data.session?.user?.id);
    return { error: null };
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setRestaurant(null);
    setProfileError(null);
  }, []);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    await loadProfile(data.session?.user?.id);
  }, [loadProfile]);

  const can = useCallback(
    (...roles: AppRole[]) => {
      if (!profile) return false;
      if (profile.role === 'super_admin') return true;
      return roles.includes(profile.role);
    },
    [profile],
  );

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      restaurant,
      loading,
      profileError,
      signIn,
      signOut,
      refresh,
      can,
      isSuperAdmin: profile?.role === 'super_admin',
      isManager: profile?.role === 'restaurant_admin' || profile?.role === 'manager',
    }),
    [session, profile, restaurant, loading, profileError, signIn, signOut, refresh, can],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Where a signed-in user belongs after login, based on their role. */
export function homeRouteFor(role: AppRole | undefined): string {
  switch (role) {
    case 'super_admin':
      return '/platform';
    case 'restaurant_admin':
    case 'manager':
      return '/admin';
    case 'kitchen':
      return '/kitchen';
    case 'waiter':
    case 'cashier':
      return '/waiter';
    default:
      return '/signin';
  }
}
