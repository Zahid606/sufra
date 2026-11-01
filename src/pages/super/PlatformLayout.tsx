import { NavLink, Outlet } from 'react-router-dom';
import { useLocale } from '@/lib/useLocale';
import { useAuth } from '@/store/auth';
import { LanguageToggle } from '@/components/LanguageToggle';
import { cx } from '@/components/ui';
import { initials } from '@/lib/format';

export function PlatformLayout() {
  const { t } = useLocale();
  const { profile, signOut } = useAuth();

  const nav = [
    { to: '/platform', end: true, label: t('nav.dashboard') },
    { to: '/platform/restaurants', label: t('nav.restaurants') },
    { to: '/platform/plans', label: t('nav.plans') },
    { to: '/platform/subscriptions', label: t('nav.subscriptions') },
  ];

  return (
    <div className="min-h-dvh bg-ink-50">
      <header className="border-b border-ink-200 bg-ink-950 text-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-gold-500 grid place-items-center font-display text-[13px] font-bold text-ink-950">
              س
            </div>
            <div>
              <p className="text-[14px] font-semibold leading-tight">{t('common.appName')}</p>
              <p className="text-[11px] text-white/45">{t('superAdmin.title')}</p>
            </div>
          </div>

          <div className="ms-auto flex items-center gap-3">
            <LanguageToggle variant="glass" />
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-white/10 text-[11px] font-semibold grid place-items-center">
                {initials(profile?.full_name)}
              </div>
              <button
                type="button"
                onClick={() => void signOut()}
                aria-label={t('common.signOut')}
                className="rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M15 17l5-5-5-5M20 12H9M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <nav className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="rail -mb-px gap-1">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cx(
                    'shrink-0 border-b-2 px-3 pb-2.5 pt-1 text-[13.5px] font-medium transition-colors',
                    isActive
                      ? 'border-gold-400 text-white'
                      : 'border-transparent text-white/50 hover:text-white/80',
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-7">
        <Outlet />
      </main>
    </div>
  );
}
