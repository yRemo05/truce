import type { CardItem } from '@contract';
import { createContext, useContext } from 'react';
import type { Names } from '@/lib/people';

export interface TruceCtx {
  names: Names;
  letters: Names;
  location: string;
  items: Record<string, CardItem>;
  /** Turns before the last call. */
  turns: number;
  /** The overall brain; per-move fallbacks are only worth flagging when the model is running. */
  brain: 'claude' | 'rules' | null;
}

export const TruceContext = createContext<TruceCtx | null>(null);

export function useTruceCtx(): TruceCtx {
  const ctx = useContext(TruceContext);
  if (!ctx) throw new Error('useTruceCtx outside a TruceContext');
  return ctx;
}
