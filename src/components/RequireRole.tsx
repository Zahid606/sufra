import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { homeRouteFor, useAuth } from '@/store/auth';
import { useLocale } from '@/lib/useLocale';
import { Button, Card, Spinner } from '@/components/ui';
import type { AppRole } from '@/lib/types';

/**
 * Route guard. This is a usability boundary, not a security one: every query
 * behind it is also fenced by RLS, so a user who forces their way to a URL
 * sees an empty screen rather than another tenant's data.
 */
export function RequireRole({
  roles,
  children,
}: {
  roles: AppRole[];
  children: ReactNode;
}) {
  const { loading, session, profile } = useAuth();
  const { t } = useLocale();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-dvh grid place-items-center bg-ink-50">
        <Spinner size={28} className="text-brand-600" />
      </div>
    );
  }

  if (!session || !profile) {
    return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  }

  const allowed = profile.role === 'super_admin' || roles.includes(profile.role);

  if (!allowed) {
    return (
      <div className="min-h-dvh grid place-items-center bg-ink-50 px-5">
        <Card className="max-w-sm w-full p-6 text-center">
          <h1 className="text-[16px] font-semibold text-ink-900">{t('errors.notAuthorised')}</h1>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => {
              window.location.href = homeRouteFor(profile.role);
            }}
          >
            {t('errors.goHome')}
          </Button>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
