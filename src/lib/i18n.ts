import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/locales/en';
import ar from '@/locales/ar';

export type Locale = 'ar' | 'en';
export const LOCALE_KEY = 'sufra.locale';

export function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (stored === 'ar' || stored === 'en') return stored;
  } catch {
    /* storage unavailable */
  }
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ar')) {
    return 'ar';
  }
  // Saudi-first product: Arabic is the default when nothing else is known
  return 'ar';
}

/**
 * Sets <html lang> and <html dir>. Every layout is written with CSS logical
 * properties (ms-*, me-*, text-start, text-end) so flipping dir here mirrors
 * the entire interface without a second stylesheet.
 */
export function applyDirection(locale: Locale): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  html.lang = locale;
  html.dir = locale === 'ar' ? 'rtl' : 'ltr';
  html.classList.toggle('font-arabic', locale === 'ar');
}

const initial = detectLocale();

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar },
  },
  lng: initial,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
  pluralSeparator: '_',
});

applyDirection(initial);

export async function setLocale(locale: Locale): Promise<void> {
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    /* ignore */
  }
  await i18n.changeLanguage(locale);
  applyDirection(locale);
}

export function currentLocale(): Locale {
  return (i18n.language?.startsWith('ar') ? 'ar' : 'en') as Locale;
}

export function isRtl(): boolean {
  return currentLocale() === 'ar';
}

export default i18n;
