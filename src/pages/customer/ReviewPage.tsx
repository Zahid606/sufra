import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '@/lib/useLocale';
import { useGuest } from '@/store/guest';
import { supabase } from '@/lib/supabase';
import { Button, Card, EmptyState, Field, Input, Textarea, cx, useToast } from '@/components/ui';
import type { GuestOrder } from '@/lib/types';

function StarPicker({
  value,
  onChange,
  label,
  size = 34,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  size?: number;
}) {
  return (
    <div>
      <p className="mb-2 text-[13px] font-medium text-ink-600">{label}</p>
      <div className="flex gap-1.5" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={String(n)}
            onClick={() => onChange(n)}
            className="transition-transform active:scale-90"
          >
            <svg
              width={size}
              height={size}
              viewBox="0 0 24 24"
              fill={n <= value ? 'currentColor' : 'none'}
              className={n <= value ? 'text-gold-500' : 'text-ink-300'}
              aria-hidden
            >
              <path
                d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.6 9.7l5.8-.8L12 3.6Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ReviewPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const { restaurant, table, sessionId } = useGuest();
  const { push } = useToast();

  const [overall, setOverall] = useState(0);
  const [food, setFood] = useState(0);
  const [service, setService] = useState(0);
  const [comment, setComment] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);

  // attach the review to the guest's most recent order, if there is one
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.rpc('get_my_orders', {
        p_session_id: sessionId,
        p_restaurant: restaurant.id,
      });
      const orders = (data ?? []) as GuestOrder[];
      const recent = orders.find((o) => ['served', 'paid'].includes(o.status)) ?? orders[0];
      setOrderId(recent?.id ?? null);
    })();
  }, [sessionId, restaurant.id]);

  async function submit() {
    if (!overall) {
      push(t('review.invalid_rating'), 'error');
      return;
    }
    setSubmitting(true);

    const { data, error } = await supabase.rpc('submit_review', {
      p_restaurant: restaurant.id,
      p_session_id: sessionId,
      p_rating: overall,
      p_comment: comment.trim() || null,
      p_customer_name: name.trim() || null,
      p_food_rating: food || null,
      p_service_rating: service || null,
      p_table_id: table.id,
      p_order_id: orderId,
    });

    setSubmitting(false);

    if (error) {
      push(t('errors.loadFailed'), 'error');
      return;
    }

    const res = data as { ok: boolean; error?: string };
    if (!res?.ok) {
      const key = `review.${res?.error ?? 'error'}`;
      const msg = t(key);
      push(msg === key ? t('common.error') : msg, 'error');
      if (res?.error === 'already_reviewed') setDone(true);
      return;
    }

    setDone(true);
  }

  if (!restaurant.reviews_enabled) {
    return (
      <div className="px-4 py-5">
        <Card>
          <EmptyState title={t('review.reviews_disabled')} />
        </Card>
      </div>
    );
  }

  if (done) {
    const happy = overall >= 4;

    return (
      <div className="px-4 py-5">
        <Card className="p-6 text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-brand-100 grid place-items-center text-brand-700">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="m5 13 4 4L19 7"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h1 className="mt-4 text-[18px] font-semibold text-ink-900">{t('review.thanks')}</h1>
          <p className="mt-1.5 text-[14px] text-ink-600">{t('review.thanksBody')}</p>

          {/* Only nudge toward Google when the guest was actually happy.
              Funnelling a 2-star visit to a public page helps nobody. */}
          {happy && restaurant.google_reviews_url ? (
            <div className="mt-6 rounded-xl bg-gold-100 p-4">
              <p className="text-[14px] font-medium text-gold-700">{t('review.alsoGoogle')}</p>
              <Button
                variant="gold"
                className="mt-3"
                block
                onClick={() => window.open(restaurant.google_reviews_url!, '_blank', 'noopener')}
              >
                {t('review.googleCta')}
              </Button>
            </div>
          ) : null}

          <Button variant="outline" className="mt-4" block onClick={() => navigate('..')}>
            {t('cart.browseMenu')}
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="px-4 py-5 space-y-4">
      <div>
        <h1 className="text-[17px] font-semibold text-ink-900">{t('review.title')}</h1>
        <p className="mt-0.5 text-[13px] text-ink-500">{t('review.subtitle')}</p>
      </div>

      <Card className="p-5 space-y-5">
        <StarPicker value={overall} onChange={setOverall} label={t('review.overall')} />
        <div className="grid grid-cols-2 gap-4">
          <StarPicker value={food} onChange={setFood} label={t('review.food')} size={26} />
          <StarPicker value={service} onChange={setService} label={t('review.service')} size={26} />
        </div>

        <Field label={t('review.commentLabel')}>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            placeholder={t('review.commentPlaceholder')}
          />
        </Field>

        <Field label={`${t('review.nameLabel')} (${t('common.optional')})`}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>

        <Button
          size="lg"
          block
          loading={submitting}
          disabled={!overall}
          onClick={() => void submit()}
        >
          {submitting ? t('review.submitting') : t('review.submit')}
        </Button>
      </Card>
    </div>
  );
}
