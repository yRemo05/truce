import { useState } from 'react';
import { useLocation } from 'wouter';
import { api, ApiError } from '@/api';

/**
 * One async action behind a button: busy while it runs, the error if it fails.
 * Busy stays on after success, since every action here navigates away.
 */
export function useAction<A extends unknown[]>(action: (...args: A) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const run = async (...args: A) => {
    setBusy(true);
    setError(null);
    try {
      await action(...args);
    } catch (err) {
      setError(ApiError.from(err));
      setBusy(false);
    }
  };
  return { run, busy, error };
}

/** Start (or rejoin) the pair's truce and go watch it. */
export function useStartTruce(pairId: string) {
  const [, navigate] = useLocation();
  return useAction(async () => {
    const { truceId } = await api.startTruce(pairId);
    navigate(`/t/${truceId}`);
  });
}
