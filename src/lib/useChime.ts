import { useCallback, useEffect, useRef, useState } from 'react';
import { readLocal, writeLocal } from './session';

/**
 * A short chime for the waiter and kitchen boards.
 *
 * Synthesised with the Web Audio API rather than shipped as an audio file:
 * no asset to load, no 404 on a slow connection, and it still works when the
 * tablet is offline. Browsers block audio until the user interacts with the
 * page, so the AudioContext is created lazily on the first toggle or tap and
 * resumed if it was suspended.
 */
const KEY = 'sufra.chime';

export function useChime() {
  const [enabled, setEnabled] = useState<boolean>(() => readLocal<boolean>(KEY, true));
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    writeLocal(KEY, enabled);
  }, [enabled]);

  useEffect(
    () => () => {
      void ctxRef.current?.close();
      ctxRef.current = null;
    },
    [],
  );

  const play = useCallback(
    (tone: 'order' | 'request' = 'order') => {
      if (!enabled) return;

      try {
        type AudioCtor = typeof AudioContext;
        const Ctor =
          (window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor })
            .AudioContext ??
          (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
        if (!Ctor) return;

        if (!ctxRef.current) ctxRef.current = new Ctor();
        const ctx = ctxRef.current;
        if (ctx.state === 'suspended') void ctx.resume();

        // two short notes: a rising pair for an order, a single ping for a call
        const notes = tone === 'order' ? [660, 880] : [990];
        const now = ctx.currentTime;

        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;

          const start = now + i * 0.16;
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(0.18, start + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0008, start + 0.26);

          osc.connect(gain).connect(ctx.destination);
          osc.start(start);
          osc.stop(start + 0.3);
        });
      } catch {
        /* audio is a nicety; never let it break the board */
      }
    },
    [enabled],
  );

  /** Call from a click handler so the first chime is allowed to sound. */
  const unlock = useCallback(() => {
    try {
      type AudioCtor = typeof AudioContext;
      const Ctor =
        (window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor })
          .AudioContext ??
        (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
      if (!Ctor) return;
      if (!ctxRef.current) ctxRef.current = new Ctor();
      if (ctxRef.current.state === 'suspended') void ctxRef.current.resume();
    } catch {
      /* ignore */
    }
  }, []);

  return { enabled, setEnabled, play, unlock };
}
