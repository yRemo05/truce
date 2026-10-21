import type { PairView } from '@contract';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/api';

const POLL_MS = 4000;

/** A pair, kept fresh while `poll` is on and the tab is visible (the other person may be filling in their side). */
export function usePair(pairId: string, { poll = false } = {}) {
  const [pair, setPair] = useState<PairView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = () => {
      api
        .getPair(pairId)
        .then((p) => {
          if (cancelled) return;
          // A poll that brings nothing new must not re-render the page.
          setPair((old) => (old && JSON.stringify(old) === JSON.stringify(p) ? old : p));
          setError(null);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(ApiError.from(err));
        })
        .finally(() => {
          if (!cancelled && poll) timer = setTimeout(tick, POLL_MS);
        });
    };
    const tick = () => (document.visibilityState === 'visible' ? load() : (timer = setTimeout(tick, POLL_MS)));

    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pairId, poll, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { pair, error, reload };
}
