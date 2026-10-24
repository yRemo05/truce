/**
 * Abuse limits for a public demo: a sliding-window limit per client and
 * action, kept in memory (one server process). The daily cap on model-run
 * truces lives in the runner, which falls back to rule-based agents past it
 * so the demo keeps working without spending credits. Search and briefs
 * spend outside truces, so they have daily budgets of their own (`createDaily`).
 */
import { isIP } from 'node:net';

export interface Limit {
  /** Requests allowed per window. */
  max: number;
  windowMs: number;
}

const DAY = 24 * 60 * 60_000;

export const LIMITS = {
  // Typing a search is a few requests; a restaurant search can cost several Qloo calls and a model call.
  search: { max: 20, windowMs: 60_000 },
  searchDay: { max: 300, windowMs: DAY },
  pair: { max: 12, windowMs: 60 * 60_000 },
  side: { max: 20, windowMs: 10 * 60_000 },
  truce: { max: 8, windowMs: 10 * 60_000 },
  truceDay: { max: 30, windowMs: DAY },
  demo: { max: 6, windowMs: 10 * 60_000 },
  checkin: { max: 20, windowMs: 10 * 60_000 },
  swap: { max: 20, windowMs: 10 * 60_000 },
  vote: { max: 60, windowMs: 10 * 60_000 },
  stream: { max: 60, windowMs: 10 * 60_000 },
} satisfies Record<string, Limit>;

export type Action = keyof typeof LIMITS;

/** Clients tracked at once; past it the oldest are forgotten, so a flood of addresses can't grow memory. */
const MAX_KEYS = 50_000;

export function createLimiter(now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  let lastSweep = now();

  return {
    /** Records a hit; returns seconds to wait when over the limit, else 0. */
    hit(action: Action, client: string): number {
      const { max, windowMs } = LIMITS[action];
      const t = now();
      if (t - lastSweep > 10 * 60_000) {
        for (const [k, v] of hits) if (!v.length || t - v[v.length - 1]! > DAY) hits.delete(k);
        lastSweep = t;
      }
      // Maps keep insertion order: the first keys are the longest unseen.
      if (hits.size >= MAX_KEYS) for (const k of [...hits.keys()].slice(0, MAX_KEYS / 10)) hits.delete(k);
      const key = `${action}:${client}`;
      const recent = (hits.get(key) ?? []).filter((at) => t - at < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return Math.ceil((windowMs - (t - recent[0]!)) / 1000);
      }
      recent.push(t);
      hits.delete(key);
      hits.set(key, recent);
      return 0;
    },
  };
}

/**
 * The client's address behind Railway's proxy: the first X-Forwarded-For hop
 * (Railway's edge sets the header itself; a client's own value doesn't get
 * through). Anything that isn't an IP address shares the fallback bucket, and
 * an IPv6 address counts by its /64, which one client usually holds whole.
 */
export function clientOf(forwardedFor: string | undefined, fallback: string): string {
  const first = forwardedFor?.split(',')[0]?.trim() ?? '';
  const kind = isIP(first);
  if (kind === 4) return first;
  if (kind === 6) return first.toLowerCase().split(':').slice(0, 4).join(':');
  return fallback;
}

/** A count that starts again each UTC day: spending outside truces, which have their own caps. */
export function createDaily(max: number, now: () => number = Date.now) {
  let day = Math.floor(now() / DAY);
  let used = 0;
  const roll = () => {
    const today = Math.floor(now() / DAY);
    if (today !== day) {
      day = today;
      used = 0;
    }
  };
  return {
    left(): number {
      roll();
      return max - used;
    },
    add(n = 1) {
      roll();
      used += n;
    },
  };
}
