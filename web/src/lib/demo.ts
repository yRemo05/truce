import type { DemoInput } from '@contract';
import { useState } from 'react';
import { useLocation } from 'wouter';
import { api } from '@/api';
import { useAction } from './useAction';

export type DemoKind = DemoInput['kind'];

/** Remembered for this tab: asked for a live run, got a recording because the server was busy. */
const busyKey = (truceId: string) => `truce:busy-replay:${truceId}`;

export function wasBusyReplay(truceId: string): boolean {
  try {
    return sessionStorage.getItem(busyKey(truceId)) === '1';
  } catch {
    return false;
  }
}

/**
 * Starts a demo and goes to it: an instant replay of a recorded run, or a
 * live one (about a minute). A live ask the server answers with a recording
 * is remembered, so the truce page can say why.
 */
export function useDemo() {
  const [, navigate] = useLocation();
  const [asked, setAsked] = useState<{ kind: DemoKind; replay: boolean } | null>(null);
  const action = useAction(async (kind: DemoKind, replay: boolean) => {
    setAsked({ kind, replay });
    const started = await api.demo(kind, replay);
    if (!replay && started.replay) {
      try {
        sessionStorage.setItem(busyKey(started.truceId), '1');
      } catch {
        /* private mode: the page just won't say why */
      }
    }
    navigate(`/t/${started.truceId}`);
  });
  /** Whether this exact button is the one working. */
  const busyFor = (kind: DemoKind, replay: boolean) => action.busy && asked?.kind === kind && asked.replay === replay;
  return { run: action.run, busy: action.busy, error: action.error, busyFor };
}
