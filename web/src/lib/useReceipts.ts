import type { ReceiptsView } from '@contract';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/api';

/** While a truce runs, every 4 s (never while the page is hidden), and again on each change of phase. */
const POLL_MS = 4000;

/**
 * A truce's Qloo receipts: loaded once, then kept up while the truce runs.
 * `phase` is the truce's live phase; a change fetches at once, so the last
 * fetch comes when it ends and the example is ready. Polls that bring nothing
 * new keep the old object.
 */
export function useReceipts(truceId: string, phase: string, running: boolean) {
  const [view, setView] = useState<ReceiptsView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(() => {
    api
      .receipts(truceId)
      .then((next) => {
        if (!alive.current) return;
        setView((old) => (old && JSON.stringify(old) === JSON.stringify(next) ? old : next));
        setError(null);
      })
      .catch((err: unknown) => alive.current && setError(ApiError.from(err)));
  }, [truceId]);

  useEffect(() => load(), [load, phase]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => !document.hidden && load(), POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  return { view, error, reload: load };
}
