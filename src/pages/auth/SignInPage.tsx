import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLocale } from '@/lib/useLocale';
import { homeRouteFor, useAuth } from '@/store/auth';
import { supabase, isConfigured } from '@/lib/supabase';
import { Button, Card, Field, Input, cx, useToast } from '@/components/ui';
import { LanguageToggle } from '@/components/LanguageToggle';
import { SetupNotice } from '@/components/SetupNotice';

export function SignInPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const { signIn, profile, profileError, loading, signOut } = useAuth();
  const { push } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'signin' | 'reset'>('signin');

  // already signed in: go straight to wherever this role belongs
  useEffect(() => {
    if (!loading && profile) navigate(homeRouteFor(profile.role), { replace: true });
  }, [loading, profile, navigate]);

  if (!isConfigured) return <SetupNotice />;

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) {
      push(t('auth.invalidCredentials'), 'error');
      return;
    }
    // the profile effect above handles the redirect once it loads
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/signin`,
    });
    setBusy(false);
    // deliberately the same message whether or not the address exists, so the
    // form cannot be used to discover who has an account
    push(t('auth.resetSent'), 'success');
    setMode('signin');
  }

  return (
    <div className="min-h-dvh bg-ink-900 grid place-items-center px-5 py-10">
      <div
        className="pointer-events-none fixed inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(90% 60% at 80% 0%, #2e523e55, transparent 60%), radial-gradient(70% 50% at 10% 100%, #c08f3333, transparent 60%)',
        }}
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-brand-500 grid place-items-center font-display text-[15px] font-bold text-white">
              س
            </div>
            <span className="font-display text-[17px] font-semibold text-white">
              {t('common.appName')}
            </span>
          </div>
          <LanguageToggle variant="glass" />
        </div>

        <Card className="p-6">
          <h1 className="text-[18px] font-semibold text-ink-900">
            {mode === 'signin' ? t('auth.signInTitle') : t('auth.forgot')}
          </h1>
          <p className="mt-1 text-[13px] text-ink-500">{t('auth.signInSubtitle')}</p>

          {profileError ? (
            <div
              className={cx(
                'mt-4 rounded-xl p-3.5 text-[13px] leading-relaxed',
                'bg-amber-50 text-amber-900',
              )}
            >
              {profileError === 'missing' ? t('auth.noProfile') : t('auth.inactive')}
              <button
                type="button"
                onClick={() => void signOut()}
                className="mt-2 block font-medium underline"
              >
                {t('common.signOut')}
              </button>
            </div>
          ) : null}

          <form
            onSubmit={mode === 'signin' ? handleSignIn : handleReset}
            className="mt-5 space-y-4"
          >
            <Field label={t('auth.email')} htmlFor="email">
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                dir="ltr"
                required
              />
            </Field>

            {mode === 'signin' ? (
              <Field label={t('auth.password')} htmlFor="password">
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  dir="ltr"
                  required
                />
              </Field>
            ) : null}

            <Button type="submit" size="lg" block loading={busy}>
              {mode === 'signin'
                ? busy
                  ? t('auth.signingIn')
                  : t('auth.signIn')
                : t('auth.sendReset')}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => setMode(mode === 'signin' ? 'reset' : 'signin')}
            className="mt-4 text-[13px] font-medium text-brand-700 hover:underline"
          >
            {mode === 'signin' ? t('auth.forgot') : t('auth.backToSignIn')}
          </button>

          <p className="mt-5 border-t border-ink-100 pt-4 text-[12.5px] leading-relaxed text-ink-400">
            {t('auth.guestHint')}
          </p>
        </Card>

        <p className="mt-6 text-center text-[12px] text-white/40">
          <Link to="/" className="hover:text-white/70">
            {t('errors.goHome')}
          </Link>
        </p>
      </div>
    </div>
  );
}
