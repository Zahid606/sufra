import { Link } from 'react-router-dom';
import { useLocale } from '@/lib/useLocale';
import { Button, Card } from '@/components/ui';
import { LanguageToggle } from '@/components/LanguageToggle';

export function NotFoundPage() {
  const { t } = useLocale();

  return (
    <div className="min-h-dvh grid place-items-center bg-ink-50 px-5">
      <Card className="w-full max-w-sm p-6 text-center">
        <p className="font-display text-[42px] font-bold text-ink-200">404</p>
        <h1 className="mt-2 text-[16px] font-semibold text-ink-900">{t('errors.notFound')}</h1>
        <p className="mt-1.5 text-[13.5px] text-ink-500">{t('errors.notFoundBody')}</p>
        <Link to="/" className="mt-5 block">
          <Button block variant="outline">
            {t('errors.goHome')}
          </Button>
        </Link>
        <div className="mt-4 flex justify-center">
          <LanguageToggle variant="plain" />
        </div>
      </Card>
    </div>
  );
}
