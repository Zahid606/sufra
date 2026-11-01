import { useEffect, useMemo, useState } from 'react';
import { useLocale } from '@/lib/useLocale';
import { useAuth } from '@/store/auth';
import { useRows } from '@/lib/useRows';
import { supabase, errorMessage } from '@/lib/supabase';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Modal,
  Segmented,
  Select,
  Skeleton,
  Textarea,
  Toggle,
  cx,
  useConfirm,
  useToast,
} from '@/components/ui';
import type { CouponType, Game, GamePrize } from '@/lib/types';

interface TriviaRow {
  id: string;
  restaurant_id: string;
  game_id: string | null;
  question: string;
  question_ar: string;
  options: { en: string; ar: string }[];
  correct_index: number;
  explanation: string | null;
  explanation_ar: string | null;
  points: number;
  is_active: boolean;
}

export function GamesAdminPage() {
  const { t, money, num, percent, locale } = useLocale();
  const { restaurant } = useAuth();
  const { push } = useToast();
  const { confirm, confirmNode } = useConfirm();

  const games = useRows<Game>('games', restaurant?.id, { orderBy: 'created_at' });
  const [tab, setTab] = useState<'spin' | 'trivia'>('spin');

  const spinGame = useMemo(() => games.rows.find((g) => g.type === 'spin_wheel'), [games.rows]);
  const triviaGame = useMemo(() => games.rows.find((g) => g.type === 'trivia'), [games.rows]);

  const prizes = useRows<GamePrize>('game_prizes', restaurant?.id, {
    orderBy: 'sort_order',
    filters: spinGame ? { game_id: spinGame.id } : undefined,
  });

  const trivia = useRows<TriviaRow>('trivia_questions', restaurant?.id, { orderBy: 'created_at' });

  const [prizeEdit, setPrizeEdit] = useState<GamePrize | null>(null);
  const [prizeNew, setPrizeNew] = useState(false);
  const [pForm, setPForm] = useState<Partial<GamePrize> & { coupon_valid_hours?: number }>({});

  const [qEdit, setQEdit] = useState<TriviaRow | null>(null);
  const [qNew, setQNew] = useState(false);
  const [qForm, setQForm] = useState<Partial<TriviaRow>>({});

  const [saving, setSaving] = useState(false);

  /* ---------- ensure the games exist ---------- */

  async function createGame(type: 'spin_wheel' | 'trivia') {
    if (!restaurant) return;
    const res = await games.insert({
      type,
      name: type === 'spin_wheel' ? 'Spin & Win' : 'Food Trivia',
      name_ar: type === 'spin_wheel' ? 'اللف والفوز' : 'تحدي الطعام',
      cooldown_hours: type === 'spin_wheel' ? 12 : 2,
      is_active: true,
    } as Partial<Game>);
    if (res.error) push(res.error, 'error');
  }

  async function patchGame(game: Game, values: Partial<Game>) {
    const res = await games.update(game.id, values);
    if (res.error) push(res.error, 'error');
  }

  /* ---------- prizes ---------- */

  const totalWeight = prizes.rows
    .filter((p) => p.is_active)
    .reduce((s, p) => s + Number(p.weight || 0), 0);

  async function savePrize() {
    if (!spinGame) return;
    if (!pForm.label?.trim() || !pForm.label_ar?.trim()) {
      push(t('errors.saveFailed'), 'error');
      return;
    }
    setSaving(true);

    const hasCoupon = Boolean(pForm.coupon_type);
    const payload: Record<string, unknown> = {
      game_id: spinGame.id,
      label: pForm.label.trim(),
      label_ar: pForm.label_ar.trim(),
      weight: Math.max(0, Number(pForm.weight ?? 1)),
      coupon_type: hasCoupon ? pForm.coupon_type : null,
      coupon_value: hasCoupon ? Number(pForm.coupon_value ?? 0) : null,
      coupon_min_order: Number(pForm.coupon_min_order ?? 0),
      coupon_valid_hours: Number(pForm.coupon_valid_hours ?? 24),
      is_jackpot: pForm.is_jackpot ?? false,
      color: pForm.color || null,
      sort_order: Number(pForm.sort_order ?? prizes.rows.length + 1),
      is_active: pForm.is_active ?? true,
    };

    const res = prizeEdit
      ? await prizes.update(prizeEdit.id, payload as Partial<GamePrize>)
      : await prizes.insert(payload as Partial<GamePrize>);

    setSaving(false);

    if (res.error) {
      push(res.error, 'error');
      return;
    }
    push(t('common.saved'), 'success');
    setPrizeEdit(null);
    setPrizeNew(false);
  }

  async function destroyPrize(p: GamePrize) {
    if (!(await confirm(`${t('common.delete')} “${p.label}”?`, true))) return;
    const res = await prizes.remove(p.id);
    if (res.error) push(res.error, 'error');
    else setPrizeEdit(null);
  }

  /* ---------- trivia ---------- */

  async function saveQuestion() {
    if (!restaurant) return;
    const opts = (qForm.options ?? []).filter((o) => o.en.trim() || o.ar.trim());
    if (!qForm.question?.trim() || opts.length < 2) {
      push(t('errors.saveFailed'), 'error');
      return;
    }
    const correct = Math.min(Number(qForm.correct_index ?? 0), opts.length - 1);
    setSaving(true);

    const payload = {
      game_id: triviaGame?.id ?? null,
      question: qForm.question.trim(),
      question_ar: (qForm.question_ar ?? '').trim() || qForm.question.trim(),
      options: opts,
      correct_index: correct,
      explanation: qForm.explanation?.trim() || null,
      explanation_ar: qForm.explanation_ar?.trim() || null,
      points: Number(qForm.points ?? 10),
      is_active: qForm.is_active ?? true,
    };

    const res = qEdit
      ? await trivia.update(qEdit.id, payload as Partial<TriviaRow>)
      : await trivia.insert(payload as Partial<TriviaRow>);

    setSaving(false);

    if (res.error) {
      push(res.error, 'error');
      return;
    }
    push(t('common.saved'), 'success');
    setQEdit(null);
    setQNew(false);
  }

  async function destroyQuestion(q: TriviaRow) {
    if (!(await confirm(t('common.delete'), true))) return;
    const res = await trivia.remove(q.id);
    if (res.error) push(res.error, 'error');
    else setQEdit(null);
  }

  if (games.loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {confirmNode}

      <div>
        <h1 className="text-[20px] font-semibold text-ink-900">{t('admin.gamesTitle')}</h1>
        <p className="mt-0.5 max-w-2xl text-[13px] text-ink-500">{t('admin.gamesSubtitle')}</p>
      </div>

      {!restaurant?.games_enabled ? (
        <Card className="bg-amber-50 p-3.5">
          <p className="text-[13px] text-amber-900">{t('games.games_disabled')}</p>
        </Card>
      ) : null}

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'spin', label: t('games.spinTitle'), count: prizes.rows.length },
          { value: 'trivia', label: t('games.triviaTitle'), count: trivia.rows.length },
        ]}
      />

      {/* ---------------- spin wheel ---------------- */}
      {tab === 'spin' ? (
        !spinGame ? (
          <Card>
            <EmptyState
              title={t('games.spinTitle')}
              action={<Button onClick={() => void createGame('spin_wheel')}>{t('common.create')}</Button>}
            />
          </Card>
        ) : (
          <>
            <Card className="p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={t('admin.cooldownHours')}>
                  <Input
                    type="number"
                    min={1}
                    defaultValue={spinGame.cooldown_hours}
                    onBlur={(e) =>
                      void patchGame(spinGame, { cooldown_hours: Math.max(1, Number(e.target.value)) })
                    }
                    dir="ltr"
                  />
                </Field>
                <div className="flex items-end pb-1 sm:col-span-2">
                  <Toggle
                    checked={spinGame.is_active}
                    onChange={(v) => void patchGame(spinGame, { is_active: v })}
                    label={t('common.active')}
                  />
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader
                title={t('admin.spinPrizes')}
                subtitle={t('admin.weightsMustSum')}
                action={
                  <Button
                    size="sm"
                    onClick={() => {
                      setPForm({
                        weight: 10,
                        coupon_type: 'percent',
                        coupon_value: 10,
                        coupon_min_order: 0,
                        coupon_valid_hours: 24,
                        sort_order: prizes.rows.length + 1,
                        is_active: true,
                      });
                      setPrizeEdit(null);
                      setPrizeNew(true);
                    }}
                  >
                    {t('admin.newPrize')}
                  </Button>
                }
              />

              {prizes.rows.length === 0 ? (
                <EmptyState title={t('games.no_prizes')} className="py-8" />
              ) : (
                <div className="divide-y divide-ink-100 border-t border-ink-100">
                  {prizes.rows.map((p) => {
                    const chance = totalWeight > 0 && p.is_active ? Number(p.weight) / totalWeight : 0;
                    return (
                      <div
                        key={p.id}
                        className={cx('flex flex-wrap items-center gap-3 p-3.5', !p.is_active && 'opacity-55')}
                      >
                        <span
                          className="h-7 w-7 shrink-0 rounded-lg ring-1 ring-ink-200"
                          style={{ background: p.color ?? '#b0b0a6' }}
                          aria-hidden
                        />
                        <div className="min-w-0 grow">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[14px] font-medium text-ink-900">{p.label}</p>
                            <span className="text-[13px] text-ink-400" dir="rtl">
                              {p.label_ar}
                            </span>
                            {p.is_jackpot ? <Badge tone="gold">★</Badge> : null}
                          </div>
                          <p className="mt-0.5 text-[12px] text-ink-400 tnum">
                            {p.coupon_type
                              ? p.coupon_type === 'percent'
                                ? `${num(Number(p.coupon_value))}%`
                                : money(Number(p.coupon_value))
                              : t('admin.prizeNone')}
                            {Number(p.coupon_min_order) > 0
                              ? ` · ${t('admin.minOrder')} ${money(p.coupon_min_order)}`
                              : ''}
                          </p>
                        </div>

                        <div className="shrink-0 text-end">
                          <p className="text-[13px] font-semibold text-ink-800 tnum">{percent(chance)}</p>
                          <p className="text-[11.5px] text-ink-400 tnum">
                            {t('admin.weight')} {num(p.weight)}
                          </p>
                        </div>

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setPForm({ ...p });
                            setPrizeEdit(p);
                            setPrizeNew(false);
                          }}
                        >
                          {t('common.edit')}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </>
        )
      ) : null}

      {/* ---------------- trivia ---------------- */}
      {tab === 'trivia' ? (
        <>
          {!triviaGame ? (
            <Card className="p-4">
              <p className="text-[13px] text-ink-500">{t('games.triviaTitle')}</p>
              <Button className="mt-3" size="sm" onClick={() => void createGame('trivia')}>
                {t('common.create')}
              </Button>
            </Card>
          ) : (
            <Card className="p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={t('admin.cooldownHours')}>
                  <Input
                    type="number"
                    min={1}
                    defaultValue={triviaGame.cooldown_hours}
                    onBlur={(e) =>
                      void patchGame(triviaGame, { cooldown_hours: Math.max(1, Number(e.target.value)) })
                    }
                    dir="ltr"
                  />
                </Field>
                <div className="flex items-end pb-1 sm:col-span-2">
                  <Toggle
                    checked={triviaGame.is_active}
                    onChange={(v) => void patchGame(triviaGame, { is_active: v })}
                    label={t('common.active')}
                  />
                </div>
              </div>
            </Card>
          )}

          <Card>
            <CardHeader
              title={t('admin.triviaQuestions')}
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    setQForm({
                      question: '',
                      question_ar: '',
                      options: [
                        { en: '', ar: '' },
                        { en: '', ar: '' },
                        { en: '', ar: '' },
                        { en: '', ar: '' },
                      ],
                      correct_index: 0,
                      points: 10,
                      is_active: true,
                    });
                    setQEdit(null);
                    setQNew(true);
                  }}
                >
                  {t('admin.newQuestion')}
                </Button>
              }
            />

            {trivia.rows.length === 0 ? (
              <EmptyState title={t('games.triviaNoQuestions')} className="py-8" />
            ) : (
              <div className="divide-y divide-ink-100 border-t border-ink-100">
                {trivia.rows.map((q) => (
                  <div key={q.id} className={cx('p-3.5', !q.is_active && 'opacity-55')}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium text-ink-900">{q.question}</p>
                        <p className="mt-0.5 text-[13px] text-ink-400" dir="rtl">
                          {q.question_ar}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => {
                          setQForm({ ...q });
                          setQEdit(q);
                          setQNew(false);
                        }}
                      >
                        {t('common.edit')}
                      </Button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(q.options ?? []).map((o, i) => (
                        <Badge key={i} tone={i === q.correct_index ? 'success' : 'neutral'}>
                          {locale === 'ar' ? o.ar || o.en : o.en}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      ) : null}

      {/* prize editor */}
      <Modal
        open={prizeNew || Boolean(prizeEdit)}
        onClose={() => {
          setPrizeEdit(null);
          setPrizeNew(false);
        }}
        title={prizeEdit ? t('common.edit') : t('admin.newPrize')}
        footer={
          <div className="flex items-center justify-between gap-2">
            {prizeEdit ? (
              <Button variant="ghost" onClick={() => void destroyPrize(prizeEdit)}>
                {t('common.delete')}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setPrizeEdit(null);
                  setPrizeNew(false);
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button loading={saving} onClick={() => void savePrize()}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.prizeLabel')} required>
              <Input
                value={pForm.label ?? ''}
                onChange={(e) => setPForm((f) => ({ ...f, label: e.target.value }))}
                dir="ltr"
              />
            </Field>
            <Field label={t('admin.prizeLabelAr')} required>
              <Input
                value={pForm.label_ar ?? ''}
                onChange={(e) => setPForm((f) => ({ ...f, label_ar: e.target.value }))}
                dir="rtl"
              />
            </Field>
          </div>

          <Field label={t('admin.weight')} hint={t('admin.weightHint')}>
            <Input
              type="number"
              min={0}
              value={pForm.weight ?? 1}
              onChange={(e) => setPForm((f) => ({ ...f, weight: Number(e.target.value) }))}
              className="max-w-[140px]"
              dir="ltr"
            />
          </Field>

          <Field label={t('admin.prizeCoupon')}>
            <Select
              value={pForm.coupon_type ?? ''}
              onChange={(e) =>
                setPForm((f) => ({ ...f, coupon_type: (e.target.value || null) as CouponType | null }))
              }
            >
              <option value="">{t('admin.prizeNone')}</option>
              <option value="percent">{t('admin.couponPercent')}</option>
              <option value="fixed">{t('admin.couponFixed')}</option>
            </Select>
          </Field>

          {pForm.coupon_type ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t('admin.couponValue')}>
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  value={pForm.coupon_value ?? 0}
                  onChange={(e) => setPForm((f) => ({ ...f, coupon_value: Number(e.target.value) }))}
                  dir="ltr"
                />
              </Field>
              <Field label={t('admin.minOrder')}>
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  value={pForm.coupon_min_order ?? 0}
                  onChange={(e) => setPForm((f) => ({ ...f, coupon_min_order: Number(e.target.value) }))}
                  dir="ltr"
                />
              </Field>
              <Field label={t('admin.validHours')}>
                <Input
                  type="number"
                  min={1}
                  value={pForm.coupon_valid_hours ?? 24}
                  onChange={(e) =>
                    setPForm((f) => ({ ...f, coupon_valid_hours: Number(e.target.value) }))
                  }
                  dir="ltr"
                />
              </Field>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.primaryColor')}>
              <Input
                type="color"
                value={pForm.color ?? '#4b8061'}
                onChange={(e) => setPForm((f) => ({ ...f, color: e.target.value }))}
                className="h-11 !p-1"
              />
            </Field>
            <Field label={t('admin.sortOrder')}>
              <Input
                type="number"
                value={pForm.sort_order ?? 0}
                onChange={(e) => setPForm((f) => ({ ...f, sort_order: Number(e.target.value) }))}
                dir="ltr"
              />
            </Field>
          </div>

          <div className="space-y-3 border-t border-ink-100 pt-4">
            <Toggle
              checked={pForm.is_jackpot ?? false}
              onChange={(v) => setPForm((f) => ({ ...f, is_jackpot: v }))}
              label={t('admin.jackpot')}
            />
            <Toggle
              checked={pForm.is_active ?? true}
              onChange={(v) => setPForm((f) => ({ ...f, is_active: v }))}
              label={t('common.active')}
            />
          </div>
        </div>
      </Modal>

      {/* question editor */}
      <Modal
        open={qNew || Boolean(qEdit)}
        onClose={() => {
          setQEdit(null);
          setQNew(false);
        }}
        title={qEdit ? t('common.edit') : t('admin.newQuestion')}
        size="lg"
        footer={
          <div className="flex items-center justify-between gap-2">
            {qEdit ? (
              <Button variant="ghost" onClick={() => void destroyQuestion(qEdit)}>
                {t('common.delete')}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setQEdit(null);
                  setQNew(false);
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button loading={saving} onClick={() => void saveQuestion()}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.question')} required>
              <Textarea
                value={qForm.question ?? ''}
                onChange={(e) => setQForm((f) => ({ ...f, question: e.target.value }))}
                className="min-h-[64px]"
                dir="ltr"
              />
            </Field>
            <Field label={t('admin.questionAr')}>
              <Textarea
                value={qForm.question_ar ?? ''}
                onChange={(e) => setQForm((f) => ({ ...f, question_ar: e.target.value }))}
                className="min-h-[64px]"
                dir="rtl"
              />
            </Field>
          </div>

          <div className="space-y-2">
            {(qForm.options ?? []).map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQForm((f) => ({ ...f, correct_index: i }))}
                  aria-label={t('admin.correctAnswer')}
                  className={cx(
                    'grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-colors',
                    qForm.correct_index === i
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-ink-300 bg-white',
                  )}
                >
                  {qForm.correct_index === i ? (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="m5 13 4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </button>
                <Input
                  value={o.en}
                  onChange={(e) =>
                    setQForm((f) => ({
                      ...f,
                      options: (f.options ?? []).map((x, j) => (j === i ? { ...x, en: e.target.value } : x)),
                    }))
                  }
                  placeholder={t('admin.answerOption', { n: i + 1 })}
                  dir="ltr"
                  className="grow"
                />
                <Input
                  value={o.ar}
                  onChange={(e) =>
                    setQForm((f) => ({
                      ...f,
                      options: (f.options ?? []).map((x, j) => (j === i ? { ...x, ar: e.target.value } : x)),
                    }))
                  }
                  dir="rtl"
                  className="grow"
                />
              </div>
            ))}
            <p className="hint">{t('admin.correctAnswer')}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.explanation')}>
              <Textarea
                value={qForm.explanation ?? ''}
                onChange={(e) => setQForm((f) => ({ ...f, explanation: e.target.value }))}
                className="min-h-[60px]"
                dir="ltr"
              />
            </Field>
            <Field label={t('admin.explanationAr')}>
              <Textarea
                value={qForm.explanation_ar ?? ''}
                onChange={(e) => setQForm((f) => ({ ...f, explanation_ar: e.target.value }))}
                className="min-h-[60px]"
                dir="rtl"
              />
            </Field>
          </div>

          <Field label={t('admin.points')}>
            <Input
              type="number"
              min={1}
              value={qForm.points ?? 10}
              onChange={(e) => setQForm((f) => ({ ...f, points: Number(e.target.value) }))}
              className="max-w-[120px]"
              dir="ltr"
            />
          </Field>

          <Toggle
            checked={qForm.is_active ?? true}
            onChange={(v) => setQForm((f) => ({ ...f, is_active: v }))}
            label={t('common.active')}
          />
        </div>
      </Modal>
    </div>
  );
}
