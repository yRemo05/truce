import { useRef, type ReactNode } from 'react';
import { useMagnet } from './hooks';

/** Wraps one control so it leans toward a fine pointer (useMagnet); a plain inline box otherwise. */
export function Magnet({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useMagnet(ref);
  return (
    <span ref={ref} className="l-magnet">
      {children}
    </span>
  );
}
