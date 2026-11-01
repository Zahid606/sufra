import { useLocale } from '@/lib/useLocale';
import { cx } from '@/components/ui';

/**
 * A two-state language switch. Each label is written in its own language, so
 * a guest who cannot read the current one can still find their way out.
 */
export function LanguageToggle({
  variant = 'solid',
  className,
}: {
  variant?: 'solid' | 'glass' | 'plain';
  className?: string;
}) {
  const { locale, change } = useLocale();

  const base =
    'inline-flex items-center rounded-full p-0.5 text-[12px] font-medium select-none';
  const skins = {
    solid: 'bg-ink-100',
    glass: 'bg-white/15 backdrop-blur ring-1 ring-white/25',
    plain: 'bg-transparent border border-ink-200',
  }[variant];

  const activeSkin = variant === 'glass' ? 'bg-white text-ink-900' : 'bg-white text-ink-900 shadow-sm';
  const idleSkin = variant === 'glass' ? 'text-white/85 hover:text-white' : 'text-ink-500 hover:text-ink-700';

  return (
    <div className={cx(base, skins, className)} role="group" aria-label="Language">
      <button
        type="button"
        onClick={() => void change('ar')}
        aria-pressed={locale === 'ar'}
        className={cx(
          'rounded-full px-2.5 py-1 transition-colors',
          locale === 'ar' ? activeSkin : idleSkin,
        )}
      >
        عربي
      </button>
      <button
        type="button"
        onClick={() => void change('en')}
        aria-pressed={locale === 'en'}
        className={cx(
          'rounded-full px-2.5 py-1 transition-colors',
          locale === 'en' ? activeSkin : idleSkin,
        )}
      >
        EN
      </button>
    </div>
  );
}
