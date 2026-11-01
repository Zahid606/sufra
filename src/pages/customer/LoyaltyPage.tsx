import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '@/lib/useLocale';
import { useGuest } from '@/store/guest';
import { supabase } from '@/lib/supabase';
import { readLocal, writeLocal } from '@/lib/session';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Spinner,
  cx,
  useToast,
} from '@/components/ui';
import type { LoyaltyInfo, Reward } from '@/lib/types';

const TIER_STYLE: Record<string, string> = {
  bronze: 'from-amber-700 to-amber-900',
  silver: 'from-slate-400 to-slate-600',
  gold: 'from-gold-400 to-gold-700',
};

export function LoyaltyPage() {
  const { t, money, locale, num } = useLocale();
  const navigate = useNavigate();
  const { restaurant, sessionId, setPendingCoupon } = useGuest();
  const { push } = useToast();

  const phoneKey = `sufra.phone.${restaurant.id}`;
  const [phone, setPhone] = useState<string>(() => readLocal<string>(phoneKey, ''));
  const [info, setInfo] = useState<LoyaltyInfo | null>(null);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [looking, setLooking] = useState(false);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ code: string; left: number } | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('rewards')
        .select('*')
        .eq('restaurant_id', restaurant.id)
        .order('points_cost');
      setRewards((data ?? []) as Reward[]);
    })();
  }, [restaurant.id]);

  const lookup = useCallback(
    async (raw: string, silent = false) => {
      const value = raw.trim();
      if (value.replace(/\D/g, '').length < 9) {
        if (!silent) push(t('loyalty.invalid_phone'), 'error');
        return;
      }
      setLooking(true);

      const { data, error } = await supabase.rpc('loyalty_lookup', {
        p_restaurant: restaurant.id,
        p_phone: value,
      });

      setLooking(false);

      if (error) {
        if (!silent) push(t('errors.loadFailed'), 'error');
        return;
      }

      const res = data as LoyaltyInfo & { error?: string };
      if (!res?.ok) {
        if (!silent) {
          const key = `loyalty.${res?.error ?? 'account_not_found'}`;
          const msg = t(key);
          push(msg === key ? t('common.error') : msg, 'error');
        }
        return;
      }

      setInfo(res);
      writeLocal(phoneKey, value);
    },
    [restaurant.id, push, t, phoneKey],
  );

  // a returning guest on the same phone sees their balance without retyping
  useEffect(() => {
    if (phone) void lookup(phone, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function redeem(reward: Reward) {
    if (!info?.exists) return;
    setRedeeming(reward.id);

    const { data, error } = await supabase.rpc('redeem_reward', {
      p_restaurant: restaurant.id,
      p_phone: phone,
      p_reward_id: reward.id,
      p_session_id: sessionId,
    });

    setRedeeming(null);

    if (error) {
      push(t('errors.loadFailed'), 'error');
      return;
    }

    const res = data as {
      ok: boolean;
      error?: string;
      coupon_code?: string;
      points_left?: number;
      required?: number;
      points?: number;
    };

    if (!res?.ok) {
      const key = `loyalty.${res?.error ?? 'error'}`;
      const msg = t(key, { required: String(res?.required ?? ''), points: String(res?.points ?? '') });
      push(msg === key ? t('common.error') : msg, 'error');
      return;
    }

    setIssued({ code: res.coupon_code!, left: res.points_left ?? 0 });
    setInfo((prev) => (prev ? { ...prev, points: res.points_left ?? prev.points } : prev));
    setPendingCoupon(res.coupon_code!);
    push(t('loyalty.redeemed'), 'success');
  }

  const points = info?.points ?? 0;
  const tier = (info?.tier ?? 'bronze').toLowerCase();

  return (
    <div className="px-4 py-5 space-y-4">
      <div>
        <h1 className="text-[17px] font-semibold text-ink-900">{t('loyalty.title')}</h1>
        <p className="mt-0.5 text-[13px] text-ink-500">{t('loyalty.subtitle')}</p>
      </div>

      {/* balance card */}
      {info?.exists ? (
        <div
          className={cx(
            'relative overflow-hidden rounded-2xl bg-gradient-to-br p-5 text-white shadow-lift',
            TIER_STYLE[tier] ?? TIER_STYLE.bronze,
          )}
        >
          <div className="absolute -end-8 -top-8 h-32 w-32 rounded-full bg-white/10" />
          <div className="relative">
            <p className="text-[12px] uppercase tracking-wide text-white/70">
              {t('loyalty.tier', { tier: t(`loyalty.${tier}`) })}
            </p>
            <p className="mt-1.5 text-[30px] font-semibold leading-none tnum">
              {num(points)}
              <span className="ms-2 text-[15px] font-normal text-white/80">
                {t('loyalty.yourPoints', { points: '' }).replace(/\s*$/, '')}
              </span>
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-[12.5px] text-white/85">
              <span>{t('loyalty.visits', { count: info.visits ?? 0 })}</span>
              {info.total_spent ? (
                <>
                  <span className="opacity-50">·</span>
                  <span className="tnum">{money(info.total_spent)}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <Card className="p-4">
          <Field label={t('loyalty.enterPhone')} hint={t('loyalty.phoneHint')}>
            <div className="flex gap-2">
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                type="tel"
                inputMode="tel"
                dir="ltr"
                placeholder="05XXXXXXXX"
                maxLength={20}
                autoComplete="tel"
                className="grow"
              />
              <Button loading={looking} onClick={() => void lookup(phone)}>
                {t('loyalty.lookup')}
              </Button>
            </div>
          </Field>

          {info && !info.exists ? (
            <div className="mt-4 rounded-xl bg-ink-50 p-3.5">
              <p className="text-[14px] font-semibold text-ink-800">{t('loyalty.noAccount')}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-600">
                {t('loyalty.noAccountBody')}
              </p>
            </div>
          ) : null}
        </Card>
      )}

      {/* a freshly minted reward code */}
      {issued ? (
        <Card className="p-4 text-center">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-brand-700">
            {t('loyalty.redeemed')}
          </p>
          <p className="mt-2 text-[22px] font-bold tracking-wider text-brand-800" dir="ltr">
            {issued.code}
          </p>
          <p className="mt-2 text-[12.5px] text-ink-500">{t('games.codeHint')}</p>
          <Button className="mt-3" block onClick={() => navigate('../cart')}>
            {t('games.useNow')}
          </Button>
        </Card>
      ) : null}

      {/* rewards */}
      {rewards.length ? (
        <section>
          <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-wide text-ink-400">
            {t('loyalty.available')}
          </h2>
          <div className="space-y-3">
            {rewards.map((r) => {
              const name = locale === 'ar' ? r.name_ar || r.name : r.name;
              const desc = locale === 'ar' ? r.description_ar || r.description : r.description;
              const affordable = info?.exists && points >= r.points_cost;
              const shortBy = r.points_cost - points;

              return (
                <Card key={r.id} className="flex items-center gap-3 p-3.5">
                  <div
                    className={cx(
                      'h-11 w-11 shrink-0 rounded-xl grid place-items-center text-[12px] font-bold tnum',
                      affordable ? 'bg-gold-100 text-gold-700' : 'bg-ink-100 text-ink-400',
                    )}
                  >
                    {num(r.points_cost)}
                  </div>

                  <div className="min-w-0 grow">
                    <p className="text-[14.5px] font-medium text-ink-900">{name}</p>
                    {desc ? <p className="mt-0.5 text-[12.5px] text-ink-500">{desc}</p> : null}
                    {info?.exists && !affordable ? (
                      <p className="mt-1 text-[12px] text-ink-400">
                        {t('loyalty.short', { n: num(shortBy) })}
                      </p>
                    ) : null}
                    {r.stock !== null && r.stock <= 0 ? (
                      <Badge tone="danger" className="mt-1.5">
                        {t('menu.soldOut')}
                      </Badge>
                    ) : null}
                  </div>

                  <Button
                    size="sm"
                    variant={affordable ? 'primary' : 'outline'}
                    disabled={!affordable || (r.stock !== null && r.stock <= 0)}
                    loading={redeeming === r.id}
                    onClick={() => void redeem(r)}
                    className="shrink-0"
                  >
                    {t('loyalty.redeem')}
                  </Button>
                </Card>
              );
            })}
          </div>
        </section>
      ) : (
        <Card>
          <EmptyState title={t('common.noResults')} />
        </Card>
      )}

      {/* how it works */}
      <Card className="p-4">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-400">
          {t('loyalty.howTitle')}
        </h2>
        <ol className="mt-3 space-y-2.5">
          {[
            t('loyalty.how1'),
            t('loyalty.how2', { rate: num(restaurant.loyalty_points_per_sar) }),
            t('loyalty.how3'),
          ].map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-ink-100 text-[11px] font-semibold text-ink-600 grid place-items-center tnum">
                {i + 1}
              </span>
              <span className="text-[13.5px] leading-relaxed text-ink-700">{s}</span>
            </li>
          ))}
        </ol>
      </Card>

      {looking ? (
        <div className="grid place-items-center py-2">
          <Spinner className="text-brand-600" />
        </div>
      ) : null}
    </div>
  );
}
