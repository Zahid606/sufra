import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { currentLocale, setLocale, type Locale } from './i18n';
import { money, amount, num, percent, time, dateTime, dateOnly, elapsed, until, pick } from './format';

/**
 * One hook for everything language-dependent: the current locale, a setter,
 * the RTL flag, locale-aware formatters, and `pick` for bilingual rows.
 */
export function useLocale() {
  const { i18n, t } = useTranslation();
  const locale = currentLocale();
  const rtl = locale === 'ar';

  const change = useCallback(async (next: Locale) => {
    await setLocale(next);
  }, []);

  const toggle = useCallback(async () => {
    await setLocale(locale === 'ar' ? 'en' : 'ar');
  }, [locale]);

  return {
    t,
    i18n,
    locale,
    rtl,
    change,
    toggle,
    money: (v: number | string | null | undefined) => money(v, locale),
    amount: (v: number | string | null | undefined) => amount(v, locale),
    num: (v: number | null | undefined) => num(v, locale),
    percent: (v: number) => percent(v, locale),
    time: (v: string | null | undefined) => time(v, locale),
    dateTime: (v: string | null | undefined) => dateTime(v, locale),
    dateOnly: (v: string | null | undefined) => dateOnly(v, locale),
    elapsed: (v: string | null | undefined) => elapsed(v, locale),
    until: (v: string | null | undefined) => until(v, locale),
    pick: (row: Record<string, unknown> | null | undefined, field: string) =>
      pick(row, field, locale),
  };
}
