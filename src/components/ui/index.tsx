import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ Button */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold' | 'outline';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm',
  secondary: 'bg-ink-900 text-white hover:bg-ink-800 active:bg-ink-950 shadow-sm',
  outline: 'bg-white text-ink-800 border border-ink-200 hover:bg-ink-50 active:bg-ink-100',
  ghost: 'bg-transparent text-ink-700 hover:bg-ink-100 active:bg-ink-200',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 shadow-sm',
  gold: 'bg-gold-500 text-ink-950 hover:bg-gold-400 active:bg-gold-600 shadow-sm',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-[13px] rounded-lg gap-1.5',
  md: 'h-11 px-4 text-[15px] rounded-xl gap-2',
  lg: 'h-[52px] px-5 text-base rounded-xl gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  block?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  block = false,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center font-medium transition-colors select-none',
        'disabled:opacity-45 disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
    >
      {loading ? <Spinner size={size === 'sm' ? 14 : 16} /> : icon}
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- Spinner */

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={cx('animate-spin', className)}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------- Card */

export function Card({
  className,
  children,
  as: As = 'div',
}: {
  className?: string;
  children: ReactNode;
  as?: 'div' | 'section' | 'article' | 'li';
}) {
  return <As className={cx('card', className)}>{children}</As>;
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex items-start justify-between gap-3 p-4 sm:p-5', className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink-900">{title}</h2>
        {subtitle ? <p className="text-[13px] text-ink-500 mt-0.5">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------- Badge */

type Tone = 'neutral' | 'brand' | 'warn' | 'danger' | 'success' | 'gold' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-ink-100 text-ink-700',
  brand: 'bg-brand-100 text-brand-800',
  warn: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-800',
  success: 'bg-emerald-100 text-emerald-800',
  gold: 'bg-gold-100 text-gold-700',
  info: 'bg-sky-100 text-sky-800',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  dot = false,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" /> : null}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ Fields */

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}

export function Field({ label, hint, error, required, children, className, htmlFor }: FieldProps) {
  return (
    <div className={className}>
      {label ? (
        <label className="label" htmlFor={htmlFor}>
          {label}
          {required ? <span className="text-red-600 ms-1">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="text-[12px] text-red-600 mt-1.5">{error}</p>
      ) : hint ? (
        <p className="hint">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx('input', className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx('input min-h-[88px] resize-y', className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx('input appearance-none pe-9 bg-no-repeat', className)}>
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors',
          checked ? 'bg-brand-600' : 'bg-ink-200',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
            checked ? 'start-[1.375rem]' : 'start-0.5',
          )}
        />
      </button>
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-[14px] font-medium text-ink-800">{label}</span>
        {hint ? <span className="block text-[12px] text-ink-500 mt-0.5">{hint}</span> : null}
      </label>
    </div>
  );
}

/* ------------------------------------------------------------------- Modal */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = {
    sm: 'sm:max-w-sm',
    md: 'sm:max-w-lg',
    lg: 'sm:max-w-2xl',
    xl: 'sm:max-w-4xl',
  }[size];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-ink-950/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          'relative w-full bg-white shadow-lift',
          'rounded-t-3xl sm:rounded-2xl',
          'max-h-[92vh] sm:max-h-[86vh] flex flex-col',
          'animate-slide-up sm:animate-fade-up',
          widths,
        )}
      >
        {title ? (
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-ink-100 shrink-0">
            <h2 className="text-base font-semibold text-ink-900">{title}</h2>
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M18 6 6 18M6 6l12 12"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        ) : null}
        <div className="overflow-y-auto px-5 py-4 grow">{children}</div>
        {footer ? (
          <div className="px-5 py-4 border-t border-ink-100 shrink-0 pb-safe sm:pb-4">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Toasts */

type ToastTone = 'info' | 'success' | 'error';
interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastCtx = createContext<{ push: (message: string, tone?: ToastTone) => void }>({
  push: () => undefined,
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = ++seq.current;
    setToasts((prev) => [...prev.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4200);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div
        className="fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 p-3 pointer-events-none"
        role="status"
        aria-live="polite"
      >
        {toasts.map((x) => (
          <div
            key={x.id}
            className={cx(
              'pointer-events-auto max-w-sm w-full sm:w-auto rounded-xl px-4 py-3 text-[14px]',
              'shadow-lift animate-fade-up',
              x.tone === 'success' && 'bg-brand-700 text-white',
              x.tone === 'error' && 'bg-red-600 text-white',
              x.tone === 'info' && 'bg-ink-900 text-white',
            )}
          >
            {x.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

/* -------------------------------------------------------------- Empty / etc */

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('text-center px-6 py-12', className)}>
      {icon ? <div className="mx-auto mb-4 text-ink-300">{icon}</div> : null}
      <h3 className="text-[15px] font-semibold text-ink-800">{title}</h3>
      {body ? <p className="text-[13px] text-ink-500 mt-1.5 max-w-sm mx-auto">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = 'neutral',
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div className={cx('card p-4', className)}>
      <p className="text-[12px] font-medium text-ink-500">{label}</p>
      <p className="text-2xl font-semibold text-ink-900 mt-1.5 tnum">{value}</p>
      {sub ? (
        <div className="mt-2">
          {typeof sub === 'string' ? (
            <Badge tone={tone}>{sub}</Badge>
          ) : (
            <div className="text-[12px] text-ink-500">{sub}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} />;
}

/** Segmented control, used for filters and tabs across the dashboards. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; count?: number }[];
  className?: string;
}) {
  return (
    <div className={cx('inline-flex rounded-xl bg-ink-100 p-1 gap-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
            value === o.value ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700',
          )}
        >
          {o.label}
          {typeof o.count === 'number' ? (
            <span
              className={cx(
                'rounded-full px-1.5 text-[11px] tnum',
                value === o.value ? 'bg-ink-100 text-ink-700' : 'bg-ink-200/70 text-ink-600',
              )}
            >
              {o.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/** Confirmation dialog that returns a promise, so callers can just await it. */
export function useConfirm() {
  const [state, setState] = useState<{
    message: string;
    resolve: (v: boolean) => void;
    danger: boolean;
  } | null>(null);
  const { t } = useTranslation();

  const confirm = useCallback(
    (message: string, danger = false) =>
      new Promise<boolean>((resolve) => setState({ message, resolve, danger })),
    [],
  );

  const node = state ? (
    <Modal
      open
      size="sm"
      onClose={() => {
        state.resolve(false);
        setState(null);
      }}
      footer={
        <div className="flex gap-2 justify-end">
          <Button
            variant="ghost"
            onClick={() => {
              state.resolve(false);
              setState(null);
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant={state.danger ? 'danger' : 'primary'}
            onClick={() => {
              state.resolve(true);
              setState(null);
            }}
          >
            {t('common.confirm')}
          </Button>
        </div>
      }
    >
      <p className="text-[15px] text-ink-800 leading-relaxed py-2">{state.message}</p>
    </Modal>
  ) : null;

  return { confirm, confirmNode: node };
}
