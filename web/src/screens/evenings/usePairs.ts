import type { PairView } from '@contract';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/api';
import { dropGroup } from '@/lib/evenings';

export type PairLoad = { status: 'loading' } | { status: 'ok'; pair: PairView } | { status: 'error'; error: ApiError };

/**
 * Every remembered group's PairView, fetched in parallel; each group loads,
 * fails and retries on its own. A group whose link answers 404 (a demo copy
 * the server deleted after three days) is dropped from the memory quietly.
 * Coming back to the tab refreshes them, keeping what's shown meanwhile.
 */
export function usePairs(ids: readonly string[]) {
  const [loads, setLoads] = useState<Record<string, PairLoad>>({});
  const started = useRef(new Set<string>());

  const fetchOne = useCallback((id: string, quiet: boolean) => {
    if (!quiet) setLoads((l) => ({ ...l, [id]: { status: 'loading' } }));
    api
      .getPair(id)
      .then((pair) => setLoads((l) => ({ ...l, [id]: { status: 'ok', pair } })))
      .catch((err: unknown) => {
        const error = ApiError.from(err);
        if (error.status === 404) return dropGroup(id);
        // A refresh that fails keeps the group as it was shown.
        setLoads((l) => (quiet && l[id]?.status === 'ok' ? l : { ...l, [id]: { status: 'error', error } }));
      });
  }, []);

  const key = ids.join(',');
  useEffect(() => {
    for (const id of key ? key.split(',') : []) {
      if (started.current.has(id)) continue;
      started.current.add(id);
      fetchOne(id, false);
    }
  }, [key, fetchOne]);

  useEffect(() => {
    const back = () => {
      if (document.visibilityState === 'visible') for (const id of key ? key.split(',') : []) fetchOne(id, true);
    };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [key, fetchOne]);

  const retry = useCallback((id: string) => fetchOne(id, false), [fetchOne]);
  return { loads, retry };
}
