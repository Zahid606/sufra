import { useLocale } from '@/lib/useLocale';
import { LanguageToggle } from './LanguageToggle';

/**
 * Shown instead of a blank page when VITE_SUPABASE_URL / ANON_KEY are missing.
 * A fresh clone otherwise fails with opaque fetch errors, which tells nobody
 * what to do next.
 */
export function SetupNotice() {
  const { t } = useLocale();

  const steps = [t('setup.step1'), t('setup.step2'), t('setup.step3')];

  return (
    <div className="min-h-dvh grid place-items-center bg-ink-50 px-5 py-10">
      <div className="card w-full max-w-md p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-100 grid place-items-center text-amber-700 shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 8.5v5M12 16.5h.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <LanguageToggle variant="plain" />
        </div>

        <h1 className="mt-4 text-lg font-semibold text-ink-900">{t('setup.title')}</h1>
        <p className="mt-2 text-[14px] text-ink-600 leading-relaxed">{t('setup.body')}</p>

        <ol className="mt-5 space-y-3">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-ink-100 text-ink-700 text-[12px] font-semibold grid place-items-center tnum">
                {i + 1}
              </span>
              <span className="text-[14px] text-ink-700 leading-relaxed">{s}</span>
            </li>
          ))}
        </ol>

        <pre className="mt-5 overflow-x-auto rounded-xl bg-ink-900 p-4 text-[12px] leading-relaxed text-ink-100" dir="ltr">
{`VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
VITE_PUBLIC_BASE_URL=http://localhost:5173`}
        </pre>

        <p className="hint mt-4">{t('setup.docs')}</p>
      </div>
    </div>
  );
}
