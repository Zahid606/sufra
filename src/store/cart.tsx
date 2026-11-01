import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { CartLine } from '@/lib/types';
import { readLocal, writeLocal, removeLocal } from '@/lib/session';

/**
 * The cart lives in localStorage keyed by table, so a guest who locks their
 * phone mid-order still has it when they come back. Totals shown here are a
 * preview only — the authoritative figures come back from place_order, which
 * recomputes everything from the database.
 */

interface CartState {
  lines: CartLine[];
  count: number;
  subtotal: number;
  add: (line: Omit<CartLine, 'key'>) => void;
  setQuantity: (key: string, quantity: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  /** payload for the place_order RPC */
  toPayload: () => {
    menu_item_id: string;
    quantity: number;
    option_ids: string[];
    notes: string | null;
  }[];
}

const Ctx = createContext<CartState | null>(null);

function lineKey(l: Omit<CartLine, 'key'>): string {
  const opts = l.options
    .map((o) => o.id)
    .sort()
    .join('.');
  // notes are part of the identity: "no onions" is a different line
  return `${l.menuItemId}|${opts}|${(l.notes ?? '').trim().toLowerCase()}`;
}

export function lineTotal(l: CartLine): number {
  const mods = l.options.reduce((s, o) => s + Number(o.priceDelta || 0), 0);
  return Math.round((Number(l.basePrice) + mods) * l.quantity * 100) / 100;
}

export function CartProvider({ tableId, children }: { tableId: string; children: ReactNode }) {
  const storageKey = `sufra.cart.${tableId}`;
  const [lines, setLines] = useState<CartLine[]>(() => readLocal<CartLine[]>(storageKey, []));

  // reload when the guest moves to a different table in the same browser
  useEffect(() => {
    setLines(readLocal<CartLine[]>(storageKey, []));
  }, [storageKey]);

  useEffect(() => {
    if (lines.length) writeLocal(storageKey, lines);
    else removeLocal(storageKey);
  }, [lines, storageKey]);

  const add = useCallback((line: Omit<CartLine, 'key'>) => {
    const key = lineKey(line);
    setLines((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) =>
          l.key === key ? { ...l, quantity: Math.min(99, l.quantity + line.quantity) } : l,
        );
      }
      return [...prev, { ...line, key }];
    });
  }, []);

  const setQuantity = useCallback((key: string, quantity: number) => {
    setLines((prev) =>
      quantity <= 0
        ? prev.filter((l) => l.key !== key)
        : prev.map((l) => (l.key === key ? { ...l, quantity: Math.min(99, quantity) } : l)),
    );
  }, []);

  const remove = useCallback((key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const toPayload = useCallback(
    () =>
      lines.map((l) => ({
        menu_item_id: l.menuItemId,
        quantity: l.quantity,
        option_ids: l.options.map((o) => o.id),
        notes: l.notes,
      })),
    [lines],
  );

  const value = useMemo<CartState>(() => {
    const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
    return {
      lines,
      count: lines.reduce((s, l) => s + l.quantity, 0),
      subtotal: Math.round(subtotal * 100) / 100,
      add,
      setQuantity,
      remove,
      clear,
      toPayload,
    };
  }, [lines, add, setQuantity, remove, clear, toPayload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart(): CartState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
