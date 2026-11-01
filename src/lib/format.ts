import type { Locale } from './i18n';

/**
 * Money. Saudi riyals, two decimals, with the numerals in the reader's own
 * script — Arabic-Indic digits for Arabic, Latin for English.
 */
export function money(amount: number | string | null | undefined, locale: Locale): string {
  const n = typeof amount === 'string' ? Number(amount) : (amount ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  const formatted = new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-SA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
  return locale === 'ar' ? `${formatted} ر.س` : `SAR ${formatted}`;
}

/** Money without the currency marker, for table cells and inputs. */
export function amount(value: number | string | null | undefined, locale: Locale): string {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0);
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-SA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

export function num(value: number | null | undefined, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-SA').format(value ?? 0);
}

export function percent(fraction: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-SA', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(fraction || 0);
}

export function time(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function dateTime(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function dateOnly(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

/** "4 min", "2 h 10 m" — how long a ticket has been sitting. */
export function elapsed(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  const mins = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  const fmt = (v: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en').format(v);

  if (mins < 1) return locale === 'ar' ? 'الآن' : 'just now';
  if (mins < 60) return locale === 'ar' ? `${fmt(mins)} د` : `${fmt(mins)} min`;
  const remMins = mins % 60;
  return locale === 'ar'
    ? `${fmt(hours)} س ${fmt(remMins)} د`
    : `${fmt(hours)} h ${fmt(remMins)} m`;
}

/** Minutes until a future moment, for a game cooldown. */
export function until(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return '—';
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return '—';
  const mins = Math.max(0, Math.ceil((target - Date.now()) / 60000));
  const hours = Math.floor(mins / 60);
  const fmt = (v: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en').format(v);
  if (mins < 60) return locale === 'ar' ? `${fmt(mins)} دقيقة` : `${fmt(mins)} min`;
  return locale === 'ar' ? `${fmt(hours)} ساعة` : `${fmt(hours)} h`;
}

/** Pick the right language field off a bilingual row. */
export function pick(
  row: Record<string, unknown> | null | undefined,
  field: string,
  locale: Locale,
): string {
  if (!row) return '';
  if (locale === 'ar') {
    const arVal = row[`${field}_ar`];
    if (typeof arVal === 'string' && arVal.trim()) return arVal;
  }
  const base = row[field];
  return typeof base === 'string' ? base : '';
}

/** Build a CSV from rows of primitives, Excel-safe for Arabic via BOM. */
export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const esc = (v: string | number | null) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}

export function downloadFile(filename: string, content: string | Blob, mime = 'text/plain'): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function initials(name: string | null | undefined): string {
  if (!name) return '—';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
