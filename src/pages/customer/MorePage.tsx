import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLocale } from '@/lib/useLocale';
import { useGuest } from '@/store/guest';
import { supabase } from '@/lib/supabase';
import { Badge, Card, cx } from '@/components/ui';
import type { Review } from '@/lib/types';

function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${value}/5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill={n <= Math.round(value) ? 'currentColor' : 'none'}
          className={n <= Math.round(value) ? 'text-gold-500' : 'text-ink-300'}
          aria-hidden
        >
          <path
            d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.6 9.7l5.8-.8L12 3.6Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      ))}
    </span>
  );
}

function Tile({
  to,
  href,
  title,
  subtitle,
  icon,
  tone = 'brand',
}: {
  to?: string;
  href?: string;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  tone?: 'brand' | 'gold' | 'ink';
}) {
  const inner = (
    <>
      <span
        className={cx(
          'h-10 w-10 shrink-0 rounded-xl grid place-items-center',
          tone === 'brand' && 'bg-brand-100 text-brand-700',
          tone === 'gold' && 'bg-gold-100 text-gold-700',
          tone === 'ink' && 'bg-ink-100 text-ink-600',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 grow">
        <span className="block text-[14.5px] font-medium text-ink-900">{title}</span>
        {subtitle ? (
          <span className="mt-0.5 block text-[12.5px] text-ink-500">{subtitle}</span>
        ) : null}
      </span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0 text-ink-300 flip-rtl" aria-hidden>
        <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </>
  );

  const cls = 'flex items-center gap-3 p-3.5 transition-colors hover:bg-ink-50';

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <Link to={to ?? '#'} className={cls}>
      {inner}
    </Link>
  );
}

export function MorePage() {
  const { t, pick } = useLocale();
  const { restaurant } = useGuest();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [average, setAverage] = useState<number | null>(null);

  useEffect(() => {
    if (!restaurant.reviews_enabled) return;
    void (async () => {
      const { data } = await supabase
        .from('reviews')
        .select('*')
        .eq('restaurant_id', restaurant.id)
        .order('created_at', { ascending: false })
        .limit(5);

      const rows = (data ?? []) as Review[];
      setReviews(rows);
      if (rows.length) {
        setAverage(rows.reduce((s, r) => s + r.rating, 0) / rows.length);
      }
    })();
  }, [restaurant.id, restaurant.reviews_enabled]);

  const about = pick(restaurant as unknown as Record<string, unknown>, 'description');
  const address = pick(restaurant as unknown as Record<string, unknown>, 'address');

  const socials = [
    restaurant.instagram_url && { href: restaurant.instagram_url, label: 'Instagram' },
    restaurant.tiktok_url && { href: restaurant.tiktok_url, label: 'TikTok' },
    restaurant.snapchat_url && { href: restaurant.snapchat_url, label: 'Snapchat' },
    restaurant.whatsapp && {
      href: `https://wa.me/${restaurant.whatsapp.replace(/[^0-9]/g, '')}`,
      label: 'WhatsApp',
    },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <div className="px-4 py-5 space-y-4">
      {/* play & earn */}
      {restaurant.games_enabled || restaurant.loyalty_enabled ? (
        <Card className="divide-y divide-ink-100 overflow-hidden">
          {restaurant.games_enabled ? (
            <Tile
              to="../games"
              title={t('games.title')}
              subtitle={t('games.subtitle')}
              tone="gold"
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.7" />
                  <path d="M12 3.8v16.4M3.8 12h16.4M6.2 6.2l11.6 11.6M17.8 6.2 6.2 17.8" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              }
            />
          ) : null}

          {restaurant.loyalty_enabled ? (
            <Tile
              to="../loyalty"
              title={t('loyalty.title')}
              subtitle={t('loyalty.subtitle')}
              tone="gold"
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.6 9.7l5.8-.8L12 3.6Z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                </svg>
              }
            />
          ) : null}

          {restaurant.reviews_enabled ? (
            <Tile
              to="../review"
              title={t('review.title')}
              subtitle={t('review.subtitle')}
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M20 13.5A3.5 3.5 0 0 1 16.5 17H9l-4 3v-3.5A3.5 3.5 0 0 1 4 13V7.5A3.5 3.5 0 0 1 7.5 4h9A3.5 3.5 0 0 1 20 7.5v6Z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                </svg>
              }
            />
          ) : null}
        </Card>
      ) : null}

      {/* find & contact */}
      <Card className="divide-y divide-ink-100 overflow-hidden">
        {restaurant.google_maps_url ? (
          <Tile
            href={restaurant.google_maps_url}
            title={t('menu.openInMaps')}
            subtitle={address || undefined}
            tone="ink"
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M12 21s-6.5-5.4-6.5-10.2A6.5 6.5 0 0 1 18.5 10.8C18.5 15.6 12 21 12 21Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <circle cx="12" cy="10.5" r="2.4" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            }
          />
        ) : null}

        {restaurant.phone ? (
          <Tile
            href={`tel:${restaurant.phone}`}
            title={t('menu.callUs')}
            subtitle={restaurant.phone}
            tone="ink"
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M5 4h3l1.5 4-2 1.5a11 11 0 0 0 5 5L14 12.5l4 1.5v3a2 2 0 0 1-2.2 2A15 15 0 0 1 3 6.2 2 2 0 0 1 5 4Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
            }
          />
        ) : null}

        {restaurant.google_reviews_url ? (
          <Tile
            href={restaurant.google_reviews_url}
            title={t('review.googleCta')}
            tone="gold"
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.6 9.7l5.8-.8L12 3.6Z"
                  fill="currentColor"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
            }
          />
        ) : null}
      </Card>

      {/* social */}
      {socials.length ? (
        <Card className="p-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-400">
            {t('menu.followUs')}
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {socials.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-ink-100 px-3.5 py-2 text-[13px] font-medium text-ink-700 transition-colors hover:bg-ink-200"
              >
                {s.label}
              </a>
            ))}
          </div>
        </Card>
      ) : null}

      {/* about */}
      {about ? (
        <Card className="p-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-400">
            {t('menu.aboutUs')}
          </h2>
          <p className="mt-2.5 text-[14px] leading-relaxed text-ink-700">{about}</p>
          {address ? <p className="mt-3 text-[13px] text-ink-500">{address}</p> : null}
        </Card>
      ) : null}

      {/* recent reviews */}
      {reviews.length ? (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 p-4 pb-3">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-400">
              {t('review.recent')}
            </h2>
            {average !== null ? (
              <Badge tone="gold">
                {average.toFixed(1)} ★
              </Badge>
            ) : null}
          </div>
          <div className="divide-y divide-ink-100">
            {reviews.map((r) => (
              <div key={r.id} className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <Stars value={r.rating} />
                  <span className="text-[12px] text-ink-400">{r.customer_name || '—'}</span>
                </div>
                {r.comment ? (
                  <p className="mt-2 text-[13.5px] leading-relaxed text-ink-700">{r.comment}</p>
                ) : null}
                {r.reply ? (
                  <div className="mt-2.5 rounded-lg bg-ink-50 p-3">
                    <p className="text-[12.5px] leading-relaxed text-ink-600">{r.reply}</p>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <p className="pt-2 text-center text-[11.5px] text-ink-300">
        {t('common.appName')}
      </p>
    </div>
  );
}
