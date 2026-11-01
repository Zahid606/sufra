import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useLocale } from '@/lib/useLocale';
import { supabase, isConfigured } from '@/lib/supabase';
import { Button, Card, cx } from '@/components/ui';
import { LanguageToggle } from '@/components/LanguageToggle';
import type { Plan } from '@/lib/types';

/**
 * The platform's own front door. A diner never lands here — they arrive at
 * /r/:slug/t/:code from a QR code or an NFC tag. This page is for restaurant
 * owners evaluating the product and for staff finding the sign-in link.
 */
export function LandingPage() {
  const { t, locale, money, num } = useLocale();
  const [plans, setPlans] = useState<Plan[]>([]);

  useEffect(() => {
    if (!isConfigured) return;
    void (async () => {
      const { data } = await supabase.from('plans').select('*').order('sort_order');
      setPlans((data ?? []) as Plan[]);
    })();
  }, []);

  const features = [
    {
      title: locale === 'ar' ? 'مسح QR أو لمس NFC' : 'Scan a QR or tap an NFC tag',
      body:
        locale === 'ar'
          ? 'كل طاولة لها رابطها الخاص المحمي برمز سري، فيفتح الزائر القائمة الصحيحة للطاولة الصحيحة.'
          : 'Every table has its own token-protected link, so a guest always opens the right menu for the right table.',
    },
    {
      title: locale === 'ar' ? 'الموظف يؤكد قبل المطبخ' : 'The waiter confirms before the kitchen',
      body:
        locale === 'ar'
          ? 'لا يصل أي طلب إلى المطبخ قبل أن يراجعه الموظف، والدفع يبقى عند الكاشير.'
          : 'No order reaches the kitchen until a waiter has checked it, and payment stays at the cashier.',
    },
    {
      title: locale === 'ar' ? 'عربي وإنجليزي بالكامل' : 'Full Arabic and English',
      body:
        locale === 'ar'
          ? 'واجهة مبنية من اليمين إلى اليسار، مع أرقام عربية وضريبة قيمة مضافة سعودية.'
          : 'A genuinely right-to-left interface, with Arabic numerals and Saudi VAT handling.',
    },
    {
      title: locale === 'ar' ? 'ألعاب ونقاط ولاء' : 'Games and loyalty points',
      body:
        locale === 'ar'
          ? 'عجلة خصومات وتحدي أسئلة ونقاط تتجمع مع كل فاتورة — واحتمالات الجوائز على الخادم.'
          : 'A discount wheel, food trivia and points on every bill — with the prize odds held server-side.',
    },
  ];

  return (
    <div className="min-h-dvh bg-ink-950 text-white">
      {/* nav */}
      <header className="relative z-10 mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-brand-500 grid place-items-center font-display text-[15px] font-bold">
            س
          </div>
          <span className="font-display text-[17px] font-semibold">{t('common.appName')}</span>
        </div>
        <div className="flex items-center gap-3">
          <LanguageToggle variant="glass" />
          <Link to="/signin">
            <Button size="sm" variant="outline" className="!bg-white/10 !text-white !border-white/20 hover:!bg-white/20">
              {t('auth.signIn')}
            </Button>
          </Link>
        </div>
      </header>

      {/* hero */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(80% 60% at 75% -10%, #2e523e66, transparent 65%), radial-gradient(60% 50% at 0% 100%, #c08f3326, transparent 60%)',
          }}
        />
        <div className="relative mx-auto max-w-5xl px-5 pb-16 pt-10 sm:pt-16">
          <p className="text-[12.5px] font-medium uppercase tracking-[0.16em] text-gold-300">
            {locale === 'ar' ? 'للمطاعم في السعودية' : 'For restaurants in Saudi Arabia'}
          </p>
          <h1 className="mt-4 max-w-2xl font-display text-[34px] font-bold leading-[1.15] sm:text-[48px]">
            {locale === 'ar'
              ? 'قائمة رقمية وطلبات من الطاولة، بمسح واحد.'
              : 'A digital menu and table ordering, in one scan.'}
          </h1>
          <p className="mt-5 max-w-xl text-[15.5px] leading-relaxed text-white/65">
            {locale === 'ar'
              ? 'يمسح الزائر الرمز على طاولته، يتصفح القائمة بالصور، يبني طلبه ويرسله للموظف. الموظف يؤكد، المطبخ يحضّر، والدفع عند الكاشير.'
              : 'A guest scans the code on their table, browses the menu with photos, builds an order and sends it to the waiter. The waiter confirms, the kitchen cooks, and payment happens at the cashier.'}
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/signin">
              <Button size="lg" variant="gold">
                {t('auth.signIn')}
              </Button>
            </Link>
            <a href="#plans">
              <Button
                size="lg"
                variant="outline"
                className="!bg-white/10 !text-white !border-white/20 hover:!bg-white/20"
              >
                {locale === 'ar' ? 'الخطط والأسعار' : 'Plans and pricing'}
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* features */}
      <section className="mx-auto max-w-5xl px-5 pb-16">
        <div className="grid gap-4 sm:grid-cols-2">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur"
            >
              <h3 className="text-[15.5px] font-semibold">{f.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-white/60">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* plans */}
      {plans.length ? (
        <section id="plans" className="bg-ink-50 py-16 text-ink-900">
          <div className="mx-auto max-w-5xl px-5">
            <h2 className="font-display text-[26px] font-bold">
              {locale === 'ar' ? 'خطط واضحة' : 'Straightforward plans'}
            </h2>
            <p className="mt-2 text-[14.5px] text-ink-500">
              {locale === 'ar'
                ? 'تبدأ كل خطة بفترة تجريبية مجانية. الأسعار بالريال السعودي شهرياً.'
                : 'Every plan starts with a free trial. Prices are in Saudi riyals per month.'}
            </p>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {plans.map((p, i) => (
                <Card
                  key={p.id}
                  className={cx('p-5 flex flex-col', i === 1 && 'ring-2 ring-brand-500')}
                >
                  <h3 className="text-[15px] font-semibold text-ink-900">
                    {locale === 'ar' ? p.name_ar : p.name}
                  </h3>
                  <p className="mt-3 text-[28px] font-semibold text-ink-900 tnum">
                    {money(p.price_monthly)}
                  </p>
                  <p className="mt-1 text-[12.5px] text-ink-400">
                    {locale === 'ar' ? 'شهرياً' : 'per month'} ·{' '}
                    {locale === 'ar'
                      ? `${num(p.trial_days)} يوم تجربة`
                      : `${p.trial_days}-day trial`}
                  </p>

                  <ul className="mt-5 space-y-2 text-[13.5px] text-ink-600">
                    {[
                      locale === 'ar'
                        ? `حتى ${num(p.max_tables)} طاولة`
                        : `Up to ${p.max_tables} tables`,
                      locale === 'ar'
                        ? `حتى ${num(p.max_menu_items)} طبق`
                        : `Up to ${p.max_menu_items} dishes`,
                      locale === 'ar'
                        ? `حتى ${num(p.max_staff)} موظف`
                        : `Up to ${p.max_staff} staff accounts`,
                      locale === 'ar'
                        ? `${num(p.max_branches)} فرع`
                        : `${p.max_branches} branch${p.max_branches > 1 ? 'es' : ''}`,
                    ].map((line) => (
                      <li key={line} className="flex gap-2">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="mt-0.5 shrink-0 text-brand-600" aria-hidden>
                          <path d="m5 13 4 4L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {line}
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <footer className="border-t border-white/10 py-8">
        <p className="text-center text-[12.5px] text-white/35">
          {t('common.appName')} · {locale === 'ar' ? 'المملكة العربية السعودية' : 'Saudi Arabia'}
        </p>
      </footer>
    </div>
  );
}
