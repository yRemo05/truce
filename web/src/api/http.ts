import type { StreamEvent } from '@contract';
import { ApiError, type Api } from './api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw ApiError.network();
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw ApiError.fromBody(res.status, body);
  return body as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const httpApi: Api = {
  kind: 'server',

  async search(slot, q, signal) {
    const params = new URLSearchParams({ slot, q });
    const { hits } = await request<{ hits: Awaited<ReturnType<Api['search']>> }>(`/api/search?${params}`, { signal });
    return hits;
  },

  createPair: (input) => request('/api/pairs', json('POST', input)),
  getPair: (id) => request(`/api/pairs/${encodeURIComponent(id)}`),
  setLocation: (pairId, location) => request(`/api/pairs/${encodeURIComponent(pairId)}`, json('PATCH', { location })),
  saveSide: (pairId, side, input) =>
    request(`/api/pairs/${encodeURIComponent(pairId)}/sides/${side}`, json('PUT', input)),
  startTruce: (pairId) => request(`/api/pairs/${encodeURIComponent(pairId)}/truces`, json('POST')),
  demo: () => request('/api/demo', json('POST')),
  getTruce: (id) => request(`/api/truces/${encodeURIComponent(id)}`),

  stream(truceId, from, handlers) {
    const source = new EventSource(`/api/truces/${encodeURIComponent(truceId)}/stream?from=${from}`);
    source.onopen = () => handlers.onOpen();
    source.onmessage = (message) => {
      let event: StreamEvent;
      try {
        event = JSON.parse(message.data as string) as StreamEvent;
      } catch {
        return;
      }
      handlers.onEvent(event, Number(message.lastEventId));
      // The server closes after these; without this the browser would reconnect and replay.
      if (event.type === 'ledger' || event.type === 'error') source.close();
    };
    source.onerror = () => {
      const willRetry = source.readyState === EventSource.CONNECTING;
      if (!willRetry) source.close();
      handlers.onDrop(willRetry);
    };
    return () => source.close();
  },
};
