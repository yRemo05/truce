import type { SwapsView } from '@contract';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/api';
import { openOf } from './swaps';

/** Every 3 s while a request waits for votes, else every 15 s; never while the page is hidden. */
const FAST_MS = 3000;
const SLOW_MS = 15_000;
/**
 * Locks that never lift. A replanned or superseded evening can come back:
 * the newer truce may fail, and then the server gives this evening back.
 */
const FINAL: ReadonlySet<string> = new Set(['checked_in', 'past', 'history']);

export interface Swaps {
  view: SwapsView | null;
  loadError: ApiError | null;
  /** Shows a view an action returned, at once. */
  apply: (view: SwapsView) => void;
  /** Fetches now, e.g. after a request lost a race with someone else's. */
  refresh: () => void;
}

/**
 * A decided evening's swaps, kept fresh: loaded once the truce is decided,
 * then polled, quickly while a vote is open, until the evening can no longer
 * change. Polls that bring nothing new keep the old object, so the page
 * doesn't re-render.
 */
export function useSwaps(truceId: string, enabled: boolean): Swaps {
  const [view, setView] = useState<SwapsView | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const alive = useRef(true);
  const open = openOf(view) !== null;
  const settled = view?.lock != null && FINAL.has(view.lock);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const apply = useCallback((next: SwapsView) => {
    setView((old) => (old && JSON.stringify(old) === JSON.stringify(next) ? old : next));
    setLoadError(null);
  }, []);

  const load = useCallback(() => {
    api
      .getSwaps(truceId)
      .then((v) => alive.current && apply(v))
      .catch((err: unknown) => alive.current && setLoadError(ApiError.from(err)));
  }, [truceId, apply]);

  // Once decided.
  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  // Then on a clock, skipping ticks while the page is hidden and catching up when it's back.
  useEffect(() => {
    if (!enabled || settled) return;
    const timer = setInterval(() => !document.hidden && load(), open ? FAST_MS : SLOW_MS);
    const onVisible = () => !document.hidden && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, settled, open, load]);

  return { view, loadError, apply, refresh: load };
}

/** One swap call behind a button: which one is busy, the error if it failed; the new view shows at once. */
export function useSwapCall({ apply, refresh }: Pick<Swaps, 'apply' | 'refresh'>) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const run = async (key: string, call: () => Promise<SwapsView>): Promise<SwapsView | null> => {
    setBusy(key);
    setError(null);
    try {
      const next = await call();
      apply(next);
      return next;
    } catch (err) {
      const e = ApiError.from(err);
      setError(e);
      // Someone else got there first: show the evening as it stands now.
      if (e.status === 409) refresh();
      return null;
    } finally {
      setBusy(null);
    }
  };
  return { run, busy, error };
}
