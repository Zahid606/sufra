import { useMemo, useState } from 'react';
import { useLocale } from '@/lib/useLocale';
import { useAuth } from '@/store/auth';
import { useRows } from '@/lib/useRows';
import { supabase, errorMessage } from '@/lib/supabase';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Segmented,
  Skeleton,
  Stat,
  Textarea,
  cx,
  useToast,
} from '@/components/ui';
import type { Review } from '@/lib/types';

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${value}/5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill={n <= value ? 'currentColor' : 'none'}
          className={n <= value ? 'text-gold-500' : 'text-ink-300'}
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

export function ReviewsAdminPage() {
  const { t, num, dateTime } = useLocale();
  const { restaurant, isManager } = useAuth();
  const { push } = useToast();

  const reviews = useRows<Review>('reviews', restaurant?.id, {
    orderBy: 'created_at',
    ascending: false,
    limit: 300,
  });

  const [filter, setFilter] = useState<'all' | 'low' | 'unreplied'>('all');
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [googleUrl, setGoogleUrl] = useState(restaurant?.google_reviews_url ?? '');
  const [saving, setSaving] = useState(false);

  const stats = useMemo(() => {
    const rows = reviews.rows;
    if (!rows.length) return { count: 0, average: 0, five: 0, low: 0 };
    return {
      count: rows.length,
      average: rows.reduce((s, r) => s + r.rating, 0) / rows.length,
      five: rows.filter((r) => r.rating === 5).length,
      low: rows.filter((r) => r.rating <= 2).length,
    };
  }, [reviews.rows]);

  const visible = useMemo(() => {
    if (filter === 'low') return reviews.rows.filter((r) => r.rating <= 2);
    if (filter === 'unreplied') return reviews.rows.filter((r) => !r.reply);
    return reviews.rows;
  }, [reviews.rows, filter]);

  async function togglePublished(r: Review) {
    const res = await reviews.update(r.id, { is_published: !r.is_published });
    if (res.error) push(res.error, 'error');
  }

  async function saveReply(r: Review) {
    setSaving(true);
    const res = await reviews.update(r.id, {
      reply: replyText.trim() || null,
      replied_at: replyText.trim() ? new Date().toISOString() : null,
    });
    setSaving(false);

    if (res.error) {
      push(res.error, 'error');
      return;
    }
    setReplyFor(null);
    setReplyText('');
    push(t('common.saved'), 'success');
  }

  async function saveGoogleUrl() {
    if (!restaurant) return;
    const { error } = await supabase
      .from('restaurants')
      .update({ google_reviews_url: googleUrl.trim() || null })
      .eq('id', restaurant.id);

    if (error) push(errorMessage(error), 'error');
    else push(t('common.saved'), 'success');
  }

  if (reviews.loading && !reviews.rows.length) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-semibold text-ink-900">{t('admin.reviewsTitle')}</h1>
        <p className="mt-0.5 text-[13px] text-ink-500">{t('admin.reviewsSubtitle')}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('admin.averageRating')} value={stats.average ? stats.average.toFixed(1) : '—'} />
        <Stat label={t('admin.reviewCount', { count: '' }).trim()} value={num(stats.count)} />
        <Stat label="5 ★" value={num(stats.five)} />
        <Stat label="1–2 ★" value={num(stats.low)} tone="danger" />
      </div>

      {isManager ? (
        <Card className="p-4">
          <Field label={t('admin.googleLinkLabel')} hint={t('admin.googleLinkHint')}>
            <div className="flex gap-2">
              <Input
                value={googleUrl}
                onChange={(e) => setGoogleUrl(e.target.value)}
                placeholder="https://search.google.com/local/writereview?placeid=..."
                dir="ltr"
                className="grow !text-[12.5px]"
              />
              <Button variant="outline" onClick={() => void saveGoogleUrl()}>
                {t('common.save')}
              </Button>
            </div>
          </Field>
        </Card>
      ) : null}

      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: t('common.all'), count: reviews.rows.length },
          { value: 'low', label: '1–2 ★', count: stats.low },
          { value: 'unreplied', label: t('admin.replyTo'), count: reviews.rows.filter((r) => !r.reply).length },
        ]}
      />

      {visible.length === 0 ? (
        <Card>
          <EmptyState title={t('common.noResults')} />
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => (
            <Card key={r.id} className={cx('p-4', !r.is_published && 'opacity-60')}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Stars value={r.rating} />
                    <span className="text-[13px] font-medium text-ink-800">
                      {r.customer_name || '—'}
                    </span>
                    {!r.is_published ? <Badge tone="neutral">{t('admin.unpublish')}</Badge> : null}
                  </div>
                  <p className="mt-1 text-[12px] text-ink-400">{dateTime(r.created_at)}</p>
                </div>

                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => void togglePublished(r)}>
                    {r.is_published ? t('admin.unpublish') : t('admin.publish')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setReplyFor(r.id);
                      setReplyText(r.reply ?? '');
                    }}
                  >
                    {t('admin.replyTo')}
                  </Button>
                </div>
              </div>

              {r.food_rating || r.service_rating ? (
                <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-ink-500">
                  {r.food_rating ? (
                    <span>
                      {t('review.food')}: {num(r.food_rating)}/5
                    </span>
                  ) : null}
                  {r.service_rating ? (
                    <span>
                      {t('review.service')}: {num(r.service_rating)}/5
                    </span>
                  ) : null}
                </div>
              ) : null}

              {r.comment ? (
                <p className="mt-2.5 text-[14px] leading-relaxed text-ink-700">{r.comment}</p>
              ) : null}

              {replyFor === r.id ? (
                <div className="mt-3 border-t border-ink-100 pt-3">
                  <Textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder={t('admin.replyPlaceholder')}
                    className="min-h-[70px]"
                  />
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" loading={saving} onClick={() => void saveReply(r)}>
                      {t('common.save')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setReplyFor(null)}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                </div>
              ) : r.reply ? (
                <div className="mt-3 rounded-xl bg-brand-50 p-3">
                  <p className="text-[11.5px] font-medium text-brand-700">{t('admin.replyTo')}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-brand-900">{r.reply}</p>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
