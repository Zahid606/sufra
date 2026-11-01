import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '@/lib/useLocale';
import { useGuest } from '@/store/guest';
import { supabase } from '@/lib/supabase';
import { Badge, Button, Card, EmptyState, Segmented, Spinner, cx, useToast } from '@/components/ui';
import type { Game, SpinResult, SpinResultOk, TriviaQuestion } from '@/lib/types';

/* =========================================================== spin wheel == */

/**
 * The wheel is purely presentational. spin_wheel() decides the outcome in the
 * database using server-side weights, returns the winning segment index, and
 * the animation is then aimed at that segment. Patching this file cannot
 * change what is won — only how the spin looks on the way there.
 *
 * Segment labels are not loaded from game_prizes (anon has no read access to
 * the weights), so the wheel is drawn from the prize count the restaurant
 * publishes via the game row and filled in with the won label on landing.
 */
const WHEEL_COLORS = ['#2e523e', '#c08f33', '#4b8061', '#d4a74f', '#6c9c7e', '#a0712a', '#21372b', '#e3c27f'];

function Wheel({
  segments,
  rotation,
  spinning,
}: {
  segments: number;
  rotation: number;
  spinning: boolean;
}) {
  const slice = 360 / segments;
  const r = 100;

  const paths = Array.from({ length: segments }, (_, i) => {
    const start = (i * slice - 90) * (Math.PI / 180);
    const end = ((i + 1) * slice - 90) * (Math.PI / 180);
    const x1 = r + r * Math.cos(start);
    const y1 = r + r * Math.sin(start);
    const x2 = r + r * Math.cos(end);
    const y2 = r + r * Math.sin(end);
    const large = slice > 180 ? 1 : 0;
    return {
      d: `M ${r} ${r} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`,
      fill: WHEEL_COLORS[i % WHEEL_COLORS.length],
    };
  });

  return (
    <div className="relative mx-auto w-[260px] max-w-full">
      {/* pointer */}
      <div className="absolute -top-1 left-1/2 z-10 -translate-x-1/2">
        <svg width="26" height="20" viewBox="0 0 26 20" aria-hidden>
          <path d="M13 20 3 2h20L13 20Z" fill="#1a1a17" />
          <path d="M13 17 6 4h14l-7 13Z" fill="#d4a74f" />
        </svg>
      </div>

      <svg
        viewBox="0 0 200 200"
        className="w-full drop-shadow-lg"
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: spinning ? 'transform 4.2s cubic-bezier(0.16, 0.9, 0.18, 1)' : 'none',
        }}
        aria-hidden
      >
        <circle cx="100" cy="100" r="99" fill="#0f0f0d" />
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill={p.fill} stroke="#0f0f0d" strokeWidth="1.5" />
        ))}
        <circle cx="100" cy="100" r="22" fill="#0f0f0d" />
        <circle cx="100" cy="100" r="15" fill="#d4a74f" />
      </svg>
    </div>
  );
}

function SpinGame({ game }: { game: Game }) {
  const { t, locale, money, until } = useLocale();
  const navigate = useNavigate();
  const { table, sessionId, setPendingCoupon } = useGuest();
  const { push } = useToast();

  // the wheel's visual segment count: whatever the restaurant configured, as
  // reported by the spin result; 6 is a sensible default for the first spin
  const [segments, setSegments] = useState(6);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<SpinResultOk | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  async function spin() {
    if (spinning) return;
    setSpinning(true);
    setResult(null);

    const { data, error } = await supabase.rpc('spin_wheel', {
      p_game_id: game.id,
      p_session_id: sessionId,
      p_table_id: table.id,
    });

    if (error) {
      setSpinning(false);
      push(t('errors.loadFailed'), 'error');
      return;
    }

    const res = data as SpinResult;

    if (!res?.ok) {
      setSpinning(false);
      if (res?.error === 'cooldown') {
        setCooldownUntil(String(res.next_play_at ?? ''));
        return;
      }
      const key = `games.${res?.error ?? 'error'}`;
      const msg = t(key);
      push(msg === key ? t('common.error') : msg, 'info');
      return;
    }

    // aim the wheel at the segment the server picked: five full turns plus the
    // offset that brings that slice under the pointer
    const total = Math.max(segments, res.segment_index + 1);
    setSegments(total);
    const slice = 360 / total;
    const target = 360 * 5 + (360 - (res.segment_index * slice + slice / 2));
    setRotation((prev) => prev + target);

    timer.current = window.setTimeout(() => {
      setSpinning(false);
      setResult(res);
      setCooldownUntil(res.next_play_at);
      if (res.coupon_code) setPendingCoupon(res.coupon_code);
    }, 4300);
  }

  const won = result?.coupon_code;
  const label = result ? (locale === 'ar' ? result.label_ar || result.label : result.label) : '';

  return (
    <Card className="p-5">
      <div className="text-center">
        <h2 className="text-[17px] font-semibold text-ink-900">
          {locale === 'ar' ? game.name_ar || game.name : game.name}
        </h2>
        {game.description ? (
          <p className="mt-1 text-[13px] text-ink-500">
            {locale === 'ar' ? game.description_ar || game.description : game.description}
          </p>
        ) : null}
      </div>

      <div className="my-6">
        <Wheel segments={segments} rotation={rotation} spinning={spinning} />
      </div>

      {result ? (
        <div
          className={cx(
            'rounded-2xl p-4 text-center',
            won ? 'bg-brand-50' : 'bg-ink-50',
          )}
        >
          {won ? (
            <>
              <p className="text-[12px] font-semibold uppercase tracking-wide text-brand-700">
                {t('games.youWon')}
              </p>
              <p className="mt-1 text-[20px] font-semibold text-ink-900">{label}</p>
              {result.is_jackpot ? (
                <div className="mt-2">
                  <Badge tone="gold">★ {t('admin.jackpot')}</Badge>
                </div>
              ) : null}

              <div className="mt-4 rounded-xl border-2 border-dashed border-brand-300 bg-white p-3">
                <p className="text-[11.5px] text-ink-400">{t('games.yourCode')}</p>
                <p className="mt-1 text-[22px] font-bold tracking-wider text-brand-800" dir="ltr">
                  {result.coupon_code}
                </p>
              </div>

              <p className="mt-3 text-[12.5px] text-ink-600">{t('games.codeHint')}</p>
              {Number(result.coupon_min_order) > 0 ? (
                <p className="mt-1 text-[12px] text-ink-400">
                  {t('games.minOrderNote', { min: money(result.coupon_min_order).replace(/[^\d.,٠-٩]/g, '') })}
                </p>
              ) : null}

              <Button
                className="mt-4"
                block
                onClick={() => navigate('../cart')}
              >
                {t('games.useNow')}
              </Button>
            </>
          ) : (
            <>
              <p className="text-[16px] font-semibold text-ink-800">{label || t('games.noPrize')}</p>
              <p className="mt-1 text-[13px] text-ink-500">{t('games.noPrizeBody')}</p>
            </>
          )}
        </div>
      ) : cooldownUntil ? (
        <div className="rounded-2xl bg-ink-50 p-4 text-center">
          <p className="text-[15px] font-semibold text-ink-800">{t('games.cooldown')}</p>
          <p className="mt-1 text-[13px] text-ink-500">
            {t('games.cooldownBody', { time: until(cooldownUntil) })}
          </p>
        </div>
      ) : (
        <Button size="lg" block loading={spinning} onClick={() => void spin()}>
          {spinning ? t('games.spinning') : t('games.spinCta')}
        </Button>
      )}
    </Card>
  );
}

/* =============================================================== trivia == */

function TriviaGame() {
  const { t, locale } = useLocale();
  const { restaurant } = useGuest();
  const [questions, setQuestions] = useState<TriviaQuestion[] | null>(null);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<{
    correct: boolean;
    correctIndex: number;
    explanation: string | null;
  } | null>(null);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('get_trivia_round', {
      p_restaurant: restaurant.id,
      p_count: 5,
    });
    setQuestions((data ?? []) as TriviaQuestion[]);
    setIndex(0);
    setPicked(null);
    setFeedback(null);
    setScore(0);
    setFinished(false);
  }, [restaurant.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function choose(i: number) {
    if (picked !== null || !questions) return;
    setPicked(i);
    setChecking(true);

    // grading happens server-side; correct_index is not readable by the client
    const { data } = await supabase.rpc('check_trivia_answer', {
      p_question_id: questions[index].id,
      p_answer_index: i,
    });

    setChecking(false);

    const res = data as {
      ok: boolean;
      correct: boolean;
      correct_index: number;
      explanation: string | null;
      explanation_ar: string | null;
      points: number;
    };

    if (!res?.ok) return;

    setFeedback({
      correct: res.correct,
      correctIndex: res.correct_index,
      explanation: locale === 'ar' ? res.explanation_ar || res.explanation : res.explanation,
    });
    if (res.correct) setScore((s) => s + 1);
  }

  function next() {
    if (!questions) return;
    if (index + 1 >= questions.length) {
      setFinished(true);
      return;
    }
    setIndex((i) => i + 1);
    setPicked(null);
    setFeedback(null);
  }

  if (questions === null) {
    return (
      <Card className="p-10 grid place-items-center">
        <Spinner className="text-brand-600" />
      </Card>
    );
  }

  if (!questions.length) {
    return (
      <Card>
        <EmptyState title={t('games.triviaNoQuestions')} />
      </Card>
    );
  }

  if (finished) {
    return (
      <Card className="p-6 text-center">
        <div className="mx-auto h-16 w-16 rounded-full bg-gold-100 grid place-items-center text-gold-700">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M8 21h8M12 17v4M6 4h12v4a6 6 0 0 1-12 0V4Z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <p className="mt-4 text-[18px] font-semibold text-ink-900">
          {t('games.triviaScore', { score, total: questions.length })}
        </p>
        <Button className="mt-5" variant="outline" onClick={() => void load()}>
          {t('games.triviaAgain')}
        </Button>
      </Card>
    );
  }

  const q = questions[index];
  const prompt = locale === 'ar' ? q.question_ar || q.question : q.question;

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-medium text-ink-400">
          {t('games.triviaQuestion', { current: index + 1, total: questions.length })}
        </span>
        <Badge tone="gold">{score} ★</Badge>
      </div>

      <div className="mt-2 flex gap-1">
        {questions.map((_, i) => (
          <span
            key={i}
            className={cx('h-1 grow rounded-full', i <= index ? 'bg-brand-600' : 'bg-ink-200')}
          />
        ))}
      </div>

      <h3 className="mt-5 text-[16.5px] font-semibold leading-snug text-ink-900">{prompt}</h3>

      <div className="mt-4 space-y-2">
        {q.options.map((o, i) => {
          const text = locale === 'ar' ? o.ar || o.en : o.en;
          const isPicked = picked === i;
          const isCorrect = feedback && feedback.correctIndex === i;
          const isWrongPick = feedback && isPicked && !feedback.correct;

          return (
            <button
              key={i}
              type="button"
              disabled={picked !== null}
              onClick={() => void choose(i)}
              className={cx(
                'flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-start text-[14.5px] transition-colors',
                !feedback && 'border-ink-200 bg-white hover:border-brand-400 hover:bg-brand-50',
                isCorrect && 'border-brand-500 bg-brand-50 text-brand-900',
                isWrongPick && 'border-red-400 bg-red-50 text-red-900',
                feedback && !isCorrect && !isWrongPick && 'border-ink-200 bg-white opacity-60',
              )}
            >
              <span className="grow">{text}</span>
              {checking && isPicked ? <Spinner size={15} /> : null}
              {isCorrect ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="m5 13 4 4L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
              {isWrongPick ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                </svg>
              ) : null}
            </button>
          );
        })}
      </div>

      {feedback ? (
        <div className={cx('mt-4 rounded-xl p-3.5', feedback.correct ? 'bg-brand-50' : 'bg-ink-50')}>
          <p
            className={cx(
              'text-[14px] font-semibold',
              feedback.correct ? 'text-brand-800' : 'text-ink-800',
            )}
          >
            {feedback.correct ? t('games.triviaCorrect') : t('games.triviaWrong')}
          </p>
          {feedback.explanation ? (
            <p className="mt-1 text-[13px] leading-relaxed text-ink-600">{feedback.explanation}</p>
          ) : null}
          <Button className="mt-3" size="sm" onClick={next}>
            {index + 1 >= questions.length ? t('common.done') : t('common.next')}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

/* ================================================================= page == */

export function GamesPage() {
  const { t } = useLocale();
  const { restaurant } = useGuest();
  const [games, setGames] = useState<Game[] | null>(null);
  const [tab, setTab] = useState<'spin' | 'trivia'>('spin');

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('games')
        .select('*')
        .eq('restaurant_id', restaurant.id);
      setGames((data ?? []) as Game[]);
    })();
  }, [restaurant.id]);

  const spin = useMemo(() => games?.find((g) => g.type === 'spin_wheel'), [games]);
  const trivia = useMemo(() => games?.find((g) => g.type === 'trivia'), [games]);

  if (!restaurant.games_enabled) {
    return (
      <div className="px-4 py-5">
        <Card>
          <EmptyState title={t('games.games_disabled')} />
        </Card>
      </div>
    );
  }

  if (games === null) {
    return (
      <div className="px-4 py-10 grid place-items-center">
        <Spinner className="text-brand-600" />
      </div>
    );
  }

  if (!spin && !trivia) {
    return (
      <div className="px-4 py-5">
        <Card>
          <EmptyState title={t('common.noResults')} body={t('games.no_prizes')} />
        </Card>
      </div>
    );
  }

  return (
    <div className="px-4 py-5 space-y-4">
      <div>
        <h1 className="text-[17px] font-semibold text-ink-900">{t('games.title')}</h1>
        <p className="mt-0.5 text-[13px] text-ink-500">{t('games.subtitle')}</p>
      </div>

      {spin && trivia ? (
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'spin', label: t('games.spinTitle') },
            { value: 'trivia', label: t('games.triviaTitle') },
          ]}
        />
      ) : null}

      {spin && (!trivia || tab === 'spin') ? <SpinGame game={spin} /> : null}
      {trivia && (!spin || tab === 'trivia') ? <TriviaGame /> : null}
    </div>
  );
}
