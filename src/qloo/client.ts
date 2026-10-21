/**
 * A small Qloo HTTP client: GET only (the hackathon API rejects POST bodies),
 * `X-Api-Key` auth, a per-second throttle under Qloo's 10 req/s limit,
 * bounded retries for 429 / 5xx / timeouts, and a private server-side cache
 * (allowed by Qloo; the cache never leaves the server or enters the repo).
 */
import { errorMessageOf } from './schemas';

export type Params = Record<string, string | number | boolean | undefined>;

export interface QlooCache {
  get(key: string): string | undefined;
  set(key: string, body: string): void;
}

export interface Quota {
  monthLimit: number | null;
  monthRemaining: number | null;
}

export class QlooError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = 'QlooError';
  }
}

export interface QlooClient {
  get(path: string, params: Params): Promise<unknown>;
  quota(): Quota;
}

export interface ClientOptions {
  baseUrl: string;
  apiKey: string;
  cache?: QlooCache;
  /** Requests started per second; Qloo allows 10. */
  perSecond?: number;
  timeoutMs?: number;
  retries?: number;
  fetch?: typeof fetch;
}

/** Stable cache key: path + params sorted by name, empty values dropped. */
export function requestKey(path: string, params: Params): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]): [string, string] => [k, String(v)])
    .sort(([a], [b]) => a.localeCompare(b));
  return `${path}?${new URLSearchParams(entries).toString()}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createQlooClient(opts: ClientOptions): QlooClient {
  const perSecond = opts.perSecond ?? 8;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const retries = opts.retries ?? 2;
  const doFetch = opts.fetch ?? fetch;
  const quota: Quota = { monthLimit: null, monthRemaining: null };

  // Sliding window of request start times: at most `perSecond` per 1000 ms.
  const starts: number[] = [];
  async function slot(): Promise<void> {
    for (;;) {
      const now = Date.now();
      while (starts.length && now - starts[0]! >= 1000) starts.shift();
      if (starts.length < perSecond) {
        starts.push(now);
        return;
      }
      await sleep(1000 - (now - starts[0]!) + 5);
    }
  }

  async function once(url: URL): Promise<unknown> {
    await slot();
    let res: Response;
    try {
      res = await doFetch(url, {
        headers: { 'X-Api-Key': opts.apiKey },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new QlooError(`Qloo unreachable: ${(err as Error).message}`, 0, true);
    }
    const limit = res.headers.get('x-month-ratelimit-limit');
    const remaining = res.headers.get('x-month-ratelimit-remaining');
    if (limit) quota.monthLimit = Number(limit);
    if (remaining) quota.monthRemaining = Number(remaining);

    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      // Non-JSON bodies only come with errors; handled below.
    }
    if (res.ok) return body;
    const message = errorMessageOf(body) ?? (text.slice(0, 200) || res.statusText);
    throw new QlooError(
      `Qloo ${res.status}: ${message}`,
      res.status,
      res.status === 429 || res.status >= 500,
      res.headers.get('x-qloo-request-id'),
    );
  }

  return {
    quota: () => ({ ...quota }),
    async get(path, params) {
      const key = requestKey(path, params);
      const cached = opts.cache?.get(key);
      if (cached !== undefined) return JSON.parse(cached);

      const url = new URL(key, opts.baseUrl);
      for (let attempt = 0; ; attempt++) {
        try {
          const body = await once(url);
          opts.cache?.set(key, JSON.stringify(body));
          return body;
        } catch (err) {
          if (!(err instanceof QlooError) || !err.retryable || attempt >= retries) throw err;
          await sleep(400 * 2 ** attempt);
        }
      }
    },
  };
}
