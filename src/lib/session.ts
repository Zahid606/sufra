/**
 * Guest identity. A diner never signs in, so a random id is minted once per
 * browser and kept in localStorage. It is what lets the status screen show
 * "your" order and nobody else's, and what the server rate-limits games,
 * reviews and waiter calls against.
 *
 * It is not a security boundary — anyone can mint one. It is a stable handle
 * for an anonymous visitor, and everything that actually matters (prices,
 * prize odds, order state) is decided server-side regardless.
 */
const KEY = 'sufra.session';
const FALLBACK_PREFIX = 'mem-';

let memorySession: string | null = null;

function mint(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getSessionId(): string {
  if (memorySession) return memorySession;
  try {
    const existing = localStorage.getItem(KEY);
    // the server requires 16..64 chars; reject anything tampered with
    if (existing && existing.length >= 16 && existing.length <= 64) {
      memorySession = existing;
      return existing;
    }
    const fresh = mint();
    localStorage.setItem(KEY, fresh);
    memorySession = fresh;
    return fresh;
  } catch {
    // private browsing with storage disabled: keep it for this page life only
    memorySession = FALLBACK_PREFIX + mint();
    return memorySession;
  }
}

/** A fresh idempotency key per submit attempt, reused across retries. */
export function newIdempotencyKey(): string {
  return `${Date.now().toString(36)}-${mint()}`;
}

/* ---------- small typed localStorage helpers ---------- */

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or disabled — the feature degrades, the app does not break */
  }
}

export function removeLocal(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
