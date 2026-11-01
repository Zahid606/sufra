import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useLocale } from '@/lib/useLocale';
import { useAuth } from '@/store/auth';
import { supabase } from '@/lib/supabase';
import { Badge, Button, Spinner, cx } from '@/components/ui';
import { LanguageToggle } from '@/components/LanguageToggle';
import { initials } from '@/lib/format';
import type { Plan } from '@/lib/types';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  end?: boolean;
  managerOnly?: boolean;
}

function I({ d, fill }: { d: string; fill?: boolean }) {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} aria-hidden>
      <path d={d} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AdminLayout() {
  const { t, pick } = useLocale();
  const { profile, restaurant, signOut, isManager } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  // close the drawer on navigation
  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!restaurant?.plan_id) return;
    void (async () => {
      const { data } = await supabase.from('plans').select('*').eq('id', restaurant.plan_id).maybeSingle();
      setPlan((data as Plan) ?? null);
    })();
  }, [restaurant?.plan_id]);

  // a live count of orders waiting on a waiter, shown on the Orders nav item
  useEffect(() => {
    if (!restaurant?.id) return;

    const refresh = async () => {
      const { count } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restaurant.id)
        .eq('status', 'pending');
      setPendingCount(count ?? 0);
    };

    void refresh();

    const channel = supabase
      .channel(`admin-pending-${restaurant.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurant.id}` },
        () => void refresh(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [restaurant?.id]);

  if (!restaurant || !profile) {
    return (
      <div className="min-h-dvh grid place-items-center bg-ink-50">
        <Spinner size={26} className="text-brand-600" />
      </div>
    );
  }

  const nav: NavItem[] = [
    { to: '/admin', end: true, label: t('nav.dashboard'), icon: <I d="M4 13h7V4H4v9ZM13 20h7v-9h-7v9ZM4 20h7v-5H4v5ZM13 9h7V4h-7v5Z" /> },
    { to: '/admin/orders', label: t('nav.orders'), icon: <I d="M8 6h11M8 12h11M8 18h11M4 6h.01M4 12h.01M4 18h.01" /> },
    { to: '/admin/menu', label: t('nav.menu'), icon: <I d="M5 20h14M6.5 16.5h11M8 13c0-2.2 1.8-4 4-4s4 1.8 4 4M12 6v1.5" /> },
    { to: '/admin/categories', label: t('nav.categories'), icon: <I d="M4 6h7v5H4V6ZM13 6h7v5h-7V6ZM4 13h7v5H4v-5ZM13 13h7v5h-7v-5Z" /> },
    { to: '/admin/tables', label: t('nav.tables'), icon: <I d="M4 9h6V4H4v5ZM14 9h6V4h-6v5ZM4 20h6v-5H4v5ZM14 17.5h2.5M17.5 20h2.5M14 20h1M19 15h1" /> },
    { to: '/admin/marketing', label: t('nav.promotions'), icon: <I d="M4 10v4l12 5V5L4 10ZM16 8.5h2.5a3.5 3.5 0 0 1 0 7H16" /> },
    { to: '/admin/games', label: t('nav.games'), icon: <I d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM12 4v16M4 12h16M6.3 6.3l11.4 11.4M17.7 6.3 6.3 17.7" /> },
    { to: '/admin/loyalty', label: t('nav.loyalty'), icon: <I d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.6 9.7l5.8-.8L12 3.6Z" /> },
    { to: '/admin/reviews', label: t('nav.reviews'), icon: <I d="M20 13.5A3.5 3.5 0 0 1 16.5 17H9l-4 3v-3.5A3.5 3.5 0 0 1 4 13V7.5A3.5 3.5 0 0 1 7.5 4h9A3.5 3.5 0 0 1 20 7.5v6Z" /> },
    { to: '/admin/reports', label: t('nav.reports'), icon: <I d="M5 20V10M12 20V4M19 20v-7" /> },
    { to: '/admin/staff', label: t('nav.staff'), managerOnly: true, icon: <I d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.3a3.5 3.5 0 0 1 0 6.4" /> },
    { to: '/admin/settings', label: t('nav.settings'), managerOnly: true, icon: <I d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H2.8a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.2 8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4V3.8a2 2 0 1 1 4 0V4a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 20 11h.2a2 2 0 1 1 0 4H20Z" /> },
  ].filter((n) => !n.managerOnly || isManager);

  const name = pick(restaurant as unknown as Record<string, unknown>, 'name');
  const roleLabel =
    profile.role === 'restaurant_admin'
      ? t('admin.roleRestaurantAdmin')
      : profile.role === 'manager'
        ? t('admin.roleManager')
        : profile.role;

  const trialing = restaurant.subscription_status === 'trialing';
  const trialDaysLeft = restaurant.trial_ends_at
    ? Math.ceil((new Date(restaurant.trial_ends_at).getTime() - Date.now()) / 86400000)
    : null;

  const sidebar = (
    <div className="flex h-full flex-col bg-ink-900 text-white">
      <div className="flex items-center gap-2.5 px-4 py-4">
        {restaurant.logo_url ? (
          <img src={restaurant.logo_url} alt="" className="h-9 w-9 rounded-lg object-cover ring-1 ring-white/20" />
        ) : (
          <div
            className="h-9 w-9 rounded-lg grid place-items-center font-display text-[14px] font-bold"
            style={{ background: restaurant.primary_color }}
          >
            {name.charAt(0) || '•'}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold leading-tight">{name}</p>
          <p className="text-[11.5px] text-white/50">{roleLabel}</p>
        </div>
      </div>

      <nav className="grow overflow-y-auto px-2 pb-3 no-scrollbar">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cx(
                'mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13.5px] font-medium transition-colors',
                isActive ? 'bg-white/12 text-white' : 'text-white/60 hover:bg-white/[0.07] hover:text-white/90',
              )
            }
          >
            {item.icon}
            <span className="grow truncate">{item.label}</span>
            {item.to === '/admin/orders' && pendingCount > 0 ? (
              <span className="min-w-[20px] rounded-full bg-amber-400 px-1.5 text-center text-[11px] font-bold text-ink-900 tnum">
                {pendingCount}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      {trialing && trialDaysLeft !== null ? (
        <div className="mx-3 mb-3 rounded-xl bg-gold-500/15 p-3 ring-1 ring-gold-400/25">
          <p className="text-[12px] font-semibold text-gold-200">
            {t('admin.trialEnds')}
          </p>
          <p className="mt-0.5 text-[12px] text-white/60 tnum">
            {trialDaysLeft > 0 ? `${trialDaysLeft} ${t('common.today')}` : t('superAdmin.statusSuspended')}
          </p>
        </div>
      ) : null}

      {plan ? (
        <div className="mx-3 mb-3 rounded-xl bg-white/[0.06] p-3">
          <p className="text-[11.5px] text-white/45">{t('admin.planName')}</p>
          <p className="mt-0.5 text-[13px] font-medium">{pick(plan as unknown as Record<string, unknown>, 'name')}</p>
        </div>
      ) : null}

      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 shrink-0 rounded-full bg-white/10 grid place-items-center text-[11px] font-semibold">
            {initials(profile.full_name)}
          </div>
          <p className="min-w-0 grow truncate text-[12.5px] text-white/70">{profile.full_name || '—'}</p>
          <button
            type="button"
            onClick={() => void signOut()}
            aria-label={t('common.signOut')}
            className="rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M15 17l5-5-5-5M20 12H9M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-ink-50">
      {/* mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink-200 bg-white px-4 py-3 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('nav.dashboard')}
          className="rounded-lg p-1.5 text-ink-600 hover:bg-ink-100"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <span className="grow truncate text-[15px] font-semibold text-ink-900">{name}</span>
        {pendingCount > 0 ? <Badge tone="warn">{pendingCount}</Badge> : null}
        <LanguageToggle />
      </header>

      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-60 lg:block">{sidebar}</aside>

      {/* mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/50" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 start-0 w-64 animate-fade-up">{sidebar}</div>
        </div>
      ) : null}

      <div className="lg:ms-60">
        <div className="hidden items-center justify-end gap-3 border-b border-ink-200 bg-white px-6 py-3 lg:flex">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => window.open(`/r/${restaurant.slug}/t/1`, '_blank')}
          >
            {t('superAdmin.openOrderingPage')}
          </Button>
          <LanguageToggle />
        </div>

        <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-7">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
