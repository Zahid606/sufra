import { NavLink, Outlet, useParams, useSearchParams } from 'react-router-dom';
import { useLocale } from '@/lib/useLocale';
import { GuestProvider, useGuest, useResolveTable } from '@/store/guest';
import { CartProvider, useCart } from '@/store/cart';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Button, Spinner, cx } from '@/components/ui';
import { isConfigured } from '@/lib/supabase';
import { SetupNotice } from '@/components/SetupNotice';

/* --------------------------------------------------------------- icons --- */

function IconMenuBook({ filled }: { filled?: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H5.5A1.5 1.5 0 0 1 4 15.5v-10Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h4.5a1.5 1.5 0 0 0 1.5-1.5v-10Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconBag({ filled }: { filled?: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5.5 8h13l-1.1 10.2A2 2 0 0 1 15.4 20H8.6a2 2 0 0 1-2-1.8L5.5 8Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M9 8V6.5a3 3 0 0 1 6 0V8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconClock({ filled }: { filled?: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle
        cx="12"
        cy="12"
        r="8.2"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M12 8v4.2l2.8 1.8"
        stroke={filled ? 'white' : 'currentColor'}
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSparkle({ filled }: { filled?: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3.5l1.7 4.6 4.6 1.7-4.6 1.7L12 16.1l-1.7-4.6L5.7 9.8l4.6-1.7L12 3.5Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M18.2 15.4l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------ bottom nav - */

function BottomNav() {
  const { t } = useLocale();
  const { count } = useCart();
  const { restaurant } = useGuest();

  const tabs = [
    { to: '', label: t('menu.title'), Icon: IconMenuBook, end: true },
    { to: 'cart', label: t('cart.title'), Icon: IconBag, badge: count },
    { to: 'orders', label: t('status.title'), Icon: IconClock },
    {
      to: 'more',
      label: restaurant.games_enabled || restaurant.loyalty_enabled
        ? t('games.title')
        : t('menu.aboutUs'),
      Icon: IconSparkle,
    },
  ];

  return (
    <nav
      className="sticky-bar no-print"
      style={{ paddingTop: '0.375rem' }}
      aria-label={t('menu.title')}
    >
      <div className="mx-auto max-w-2xl grid grid-cols-4">
        {tabs.map(({ to, label, Icon, badge, end }) => (
          <NavLink
            key={to || 'menu'}
            to={to}
            end={end}
            className={({ isActive }) =>
              cx(
                'relative flex flex-col items-center gap-1 py-2 text-[11px] font-medium transition-colors',
                isActive ? 'text-brand-700' : 'text-ink-400',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className="relative">
                  <Icon filled={isActive} />
                  {badge ? (
                    <span className="absolute -top-1.5 -end-2 min-w-[18px] h-[18px] rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white grid place-items-center tnum">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  ) : null}
                </span>
                <span className="truncate max-w-full px-1">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/* ---------------------------------------------------------------- header - */

function GuestHeader() {
  const { t, pick } = useLocale();
  const { restaurant, table } = useGuest();
  const name = pick(restaurant as unknown as Record<string, unknown>, 'name');
  const tagline = pick(restaurant as unknown as Record<string, unknown>, 'tagline');
  const tableLabel = table.label_ar || table.label;

  return (
    <header className="relative overflow-hidden bg-ink-900 text-white">
      {restaurant.cover_url ? (
        <>
          <img
            src={restaurant.cover_url}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-45"
            loading="eager"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/55 to-ink-950/20" />
        </>
      ) : (
        <div
          className="absolute inset-0 opacity-90"
          style={{
            background: `radial-gradient(120% 90% at 85% 0%, ${restaurant.primary_color}44, transparent 60%), linear-gradient(160deg,#1a1a17,#0f0f0d)`,
          }}
        />
      )}

      <div className="relative mx-auto max-w-2xl px-4 pt-4 pb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {restaurant.logo_url ? (
              <img
                src={restaurant.logo_url}
                alt=""
                className="h-12 w-12 rounded-xl object-cover ring-1 ring-white/25 bg-white/10 shrink-0"
              />
            ) : (
              <div
                className="h-12 w-12 rounded-xl grid place-items-center font-display text-lg font-bold ring-1 ring-white/20 shrink-0"
                style={{ background: restaurant.primary_color }}
              >
                {name.trim().charAt(0) || '•'}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-lg font-semibold leading-tight truncate">{name}</h1>
              {tagline ? (
                <p className="text-[12.5px] text-white/65 truncate mt-0.5">{tagline}</p>
              ) : null}
            </div>
          </div>
          <LanguageToggle variant="glass" className="shrink-0" />
        </div>

        <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/12 ring-1 ring-white/20 px-3 py-1.5 text-[12.5px] backdrop-blur">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M4 10h16M6 10V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3M7 10v9M17 10v9"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
          <span>{t('scan.tableLabel', { label: tableLabel })}</span>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ shell - */

export function GuestShell() {
  const { slug, code } = useParams<{ slug: string; code: string }>();
  const [params] = useSearchParams();
  const token = params.get('k');
  const { t } = useLocale();
  const { state, retry } = useResolveTable(slug, code, token);

  if (!isConfigured) return <SetupNotice />;

  if (state.status === 'loading') {
    return (
      <div className="min-h-dvh grid place-items-center bg-ink-50 px-6">
        <div className="text-center">
          <Spinner size={28} className="text-brand-600 mx-auto" />
          <p className="mt-4 text-[14px] text-ink-500">{t('scan.resolving')}</p>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    const key = `scan.${state.error}`;
    const translated = t(key);
    const message = translated === key ? t('scan.generic') : translated;

    return (
      <div className="min-h-dvh grid place-items-center bg-ink-50 px-6">
        <div className="card max-w-sm w-full p-6 text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-amber-100 grid place-items-center text-amber-700">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 8.5v5M12 16.5h.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h1 className="text-[17px] font-semibold text-ink-900">{t('scan.errorTitle')}</h1>
          <p className="mt-2 text-[14px] text-ink-600 leading-relaxed">{message}</p>
          <div className="mt-5 flex flex-col gap-2">
            <Button block onClick={retry}>
              {t('common.retry')}
            </Button>
            <LanguageToggle variant="plain" className="self-center mt-1" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <GuestProvider data={state.data}>
      <CartProvider tableId={state.data.table.id}>
        <div className="min-h-dvh bg-ink-50 pb-24">
          <GuestHeader />
          <main className="mx-auto max-w-2xl">
            <Outlet />
          </main>
          <BottomNav />
        </div>
      </CartProvider>
    </GuestProvider>
  );
}
