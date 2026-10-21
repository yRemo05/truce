import { useEffect, useState } from 'react';

/** A status that falls back to `idle` a moment after it changes: "Copied", "Copy failed". */
export function useFlash<T extends string>(idle: T, ms = 2400) {
  const [state, setState] = useState<T>(idle);
  useEffect(() => {
    if (state === idle) return;
    const timer = setTimeout(() => setState(idle), ms);
    return () => clearTimeout(timer);
  }, [state, idle, ms]);
  return [state, setState] as const;
}
