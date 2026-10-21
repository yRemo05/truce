/**
 * Abuse limits for a public demo: a sliding-window limit per client and
 * action, kept in memory (one server process). The daily cap on model-run
 * truces lives in the runner, which falls back to rule-based agents past it
 * so the demo keeps working without spending credits.
 */

export interface Limit {
  /** Requests allowed per window. */
  max: number;
  windowMs: number;
}

export const LIMITS = {
  search: { max: 60, windowMs: 60_000 },
  pair: { max: 12, windowMs: 60 * 60_000 },
  side: { max: 40, windowMs: 10 * 60_000 },
  truce: { max: 8, windowMs: 10 * 60_000 },
  demo: { max: 6, windowMs: 10 * 60_000 },
  checkin: { max: 20, windowMs: 10 * 60_000 },
} satisfies Record<string, Limit>;

export type Action = keyof typeof LIMITS;

export function createLimiter(now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  let lastSweep = now();

  return {
    /** Records a hit; returns seconds to wait when over the limit, else 0. */
    hit(action: Action, client: string): number {
      const { max, windowMs } = LIMITS[action];
      const t = now();
      if (t - lastSweep > 10 * 60_000) {
        for (const [k, v] of hits) if (!v.length || t - v[v.length - 1]! > 60 * 60_000) hits.delete(k);
        lastSweep = t;
      }
      const key = `${action}:${client}`;
      const recent = (hits.get(key) ?? []).filter((at) => t - at < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return Math.ceil((windowMs - (t - recent[0]!)) / 1000);
      }
      recent.push(t);
      hits.set(key, recent);
      return 0;
    },
  };
}

/** The client's address behind Railway's proxy: the first X-Forwarded-For hop. */
export function clientOf(forwardedFor: string | undefined, fallback: string): string {
  const first = forwardedFor?.split(',')[0]?.trim();
  return first || fallback;
}
