/**
 * The live truce: loads what has happened, follows the stream, reconnects
 * when it drops (the server replays from the first event, so events already
 * seen are skipped by count), and paces live events so a burst — the
 * rule-based agents answer instantly — still reads one move at a time.
 */
import type { StreamEvent, TruceView } from '@contract';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { api, ApiError } from '@/api';
import { applyEvent, initialTruce, type Arrival, type TruceState } from './truce';

export type Link = 'loading' | 'live' | 'reconnecting' | 'offline' | 'ended';

/** Least time after the previous release before an event of this type shows, in ms. */
const GAP: Partial<Record<StreamEvent['type'], number>> = {
  pool: 1500,
  start: 1100,
  thinking: 450,
  rejected: 800,
  move: 1300,
  declined: 1300,
  agreement: 700,
  ruling: 1000,
  polish: 1100,
  done: 900,
};

const BACKOFF = [1000, 2000, 4000, 8000, 8000];

type Meta = Omit<TruceView, 'events' | 'status'>;
type Action = { type: 'reset' } | { type: 'arrive'; batch: Arrival[] };

const reducer = (state: TruceState, action: Action): TruceState =>
  action.type === 'reset' ? initialTruce : action.batch.reduce(applyEvent, state);

export function useTruce(truceId: string) {
  const [state, dispatch] = useReducer(reducer, initialTruce);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [link, setLink] = useState<Link>('loading');
  const [arrivedLive, setArrivedLive] = useState(false);
  const [backlog, setBacklog] = useState(0);
  const [attempt, setAttempt] = useState(0);

  const queue = useRef<StreamEvent[]>([]);
  const lastRelease = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pump = useCallback(function pump() {
    if (timer.current) return;
    const batch: Arrival[] = [];
    let next: StreamEvent | undefined;
    while ((next = queue.current[0])) {
      const wait = lastRelease.current + (GAP[next.type] ?? 0) - performance.now();
      if (wait > 0) {
        timer.current = setTimeout(() => {
          timer.current = null;
          pump();
        }, wait);
        break;
      }
      queue.current.shift();
      lastRelease.current = performance.now();
      batch.push({ event: next, live: true });
    }
    if (batch.length) dispatch({ type: 'arrive', batch });
    setBacklog(queue.current.length);
  }, []);

  /** Shows everything that has arrived, now. */
  const skipAhead = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const batch = queue.current.splice(0).map((event) => ({ event, live: true }));
    if (batch.length) dispatch({ type: 'arrive', batch });
    lastRelease.current = performance.now();
    setBacklog(0);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let close: (() => void) | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let seen = 0;
    let failures = 0;
    let ended = false;

    const connect = () => {
      let index = 0;
      close = api.stream(truceId, {
        onOpen() {
          index = 0;
          failures = 0;
          if (!cancelled) setLink('live');
        },
        onEvent(event) {
          index += 1;
          if (cancelled || index <= seen) return;
          seen = index;
          if (event.type === 'ledger' || event.type === 'error') {
            ended = true;
            setLink('ended');
          }
          queue.current.push(event);
          pump();
        },
        onDrop(willRetry) {
          if (cancelled || ended) return;
          setLink('reconnecting');
          if (willRetry) return;
          close?.();
          const delay = BACKOFF[failures];
          failures += 1;
          if (delay === undefined) setLink('offline');
          else retry = setTimeout(connect, delay);
        },
      });
    };

    dispatch({ type: 'reset' });
    api
      .getTruce(truceId)
      .then((view) => {
        if (cancelled) return;
        const { events, status, ...rest } = view;
        setMeta(rest);
        seen = events.length;
        if (events.length) dispatch({ type: 'arrive', batch: events.map((event) => ({ event, live: false })) });
        lastRelease.current = performance.now();
        if (status === 'running') {
          setArrivedLive(true);
          connect();
        } else {
          setLink('ended');
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(ApiError.from(err));
      });

    return () => {
      cancelled = true;
      close?.();
      if (retry) clearTimeout(retry);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      queue.current = [];
    };
  }, [truceId, attempt, pump]);

  const reload = useCallback(() => {
    setLoadError(null);
    setLink('loading');
    setAttempt((n) => n + 1);
  }, []);

  return { state, meta, loadError, link, arrivedLive, backlog, skipAhead, reload };
}
