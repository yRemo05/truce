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

  search(slot, q, near, signal) {
    const params = new URLSearchParams({ slot, q, ...(near ? { near } : {}) });
    return request(`/api/search?${params}`, { signal });
  },

  createPair: (input) => request('/api/pairs', json('POST', input)),
  getPair: (id) => request(`/api/pairs/${encodeURIComponent(id)}`),
  setLocation: (pairId, location) => request(`/api/pairs/${encodeURIComponent(pairId)}`, json('PATCH', { location })),
  saveSide: (pairId, side, input) =>
    request(`/api/pairs/${encodeURIComponent(pairId)}/sides/${side}`, json('PUT', input)),
  startTruce: (pairId) => request(`/api/pairs/${encodeURIComponent(pairId)}/truces`, json('POST')),
  demo: (kind) => request('/api/demo', json('POST', { kind })),
  getTruce: (id) => request(`/api/truces/${encodeURIComponent(id)}`),
  checkin: (truceId, side, input) =>
    request(`/api/truces/${encodeURIComponent(truceId)}/checkins/${side}`, json('PUT', input)),
  calendarUrl: async (truceId) => `/api/truces/${encodeURIComponent(truceId)}/calendar.ics`,
  getSwaps: (truceId) => request(`/api/truces/${encodeURIComponent(truceId)}/swaps`),
  askSwap: (truceId, input) => request(`/api/truces/${encodeURIComponent(truceId)}/swaps`, json('POST', input)),
  vote: (truceId, swapId, side, vote) =>
    request(`/api/truces/${encodeURIComponent(truceId)}/swaps/${encodeURIComponent(swapId)}/votes/${side}`, json('PUT', { vote })),
  cancelSwap: (truceId, swapId, side) =>
    request(`/api/truces/${encodeURIComponent(truceId)}/swaps/${encodeURIComponent(swapId)}/cancel`, json('POST', { side })),

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
