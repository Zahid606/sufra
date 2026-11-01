import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * True when the app has real credentials. The UI uses this to show a setup
 * screen instead of failing with opaque network errors on a fresh clone.
 */
export const isConfigured = Boolean(
  url && anonKey && !url.includes('YOUR-PROJECT-REF') && !anonKey.includes('YOUR-'),
);

if (!isConfigured && import.meta.env.DEV) {
  console.warn(
    '[sufra] Supabase is not configured. Copy .env.example to .env.local and fill in ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  );
}

export const supabase = createClient(
  url || 'http://localhost:54321',
  anonKey || 'public-anon-key-placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'sufra-auth',
    },
    realtime: { params: { eventsPerSecond: 10 } },
    global: { headers: { 'x-application-name': 'sufra' } },
  },
);

export const publicBaseUrl = (
  (import.meta.env.VITE_PUBLIC_BASE_URL as string | undefined) ||
  (typeof window !== 'undefined' ? window.location.origin : '')
).replace(/\/$/, '');

/** Narrow a Supabase error into a message safe to show a guest. */
export function errorMessage(e: unknown): string {
  if (!e) return 'unknown_error';
  if (typeof e === 'string') return e;
  if (typeof e === 'object') {
    const o = e as { message?: string; error_description?: string; details?: string };
    return o.message || o.error_description || o.details || 'unknown_error';
  }
  return 'unknown_error';
}
