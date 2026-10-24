import type { Api } from './api';
import { httpApi } from './http';

export { ApiError, type Api } from './api';

/** `npm run dev:mock` (or VITE_MOCK=1) swaps the server for an in-browser replay. */
const useMock = import.meta.env.MODE === 'mock' || import.meta.env.VITE_MOCK === '1';

let impl: Promise<Api> | null = null;
// The mock is a separate chunk, so a server build never ships it.
const load = () => (impl ??= useMock ? import('../mock/server').then((m) => m.mockApi) : Promise.resolve(httpApi));

export const api: Api = {
  kind: useMock ? 'mock' : 'server',
  search: async (...args) => (await load()).search(...args),
  createPair: async (...args) => (await load()).createPair(...args),
  getPair: async (...args) => (await load()).getPair(...args),
  setLocation: async (...args) => (await load()).setLocation(...args),
  saveSide: async (...args) => (await load()).saveSide(...args),
  saveTonight: async (...args) => (await load()).saveTonight(...args),
  startTruce: async (...args) => (await load()).startTruce(...args),
  demo: async (...args) => (await load()).demo(...args),
  getTruce: async (...args) => (await load()).getTruce(...args),
  receipts: async (...args) => (await load()).receipts(...args),
  checkin: async (...args) => (await load()).checkin(...args),
  calendarUrl: async (...args) => (await load()).calendarUrl(...args),
  getSwaps: async (...args) => (await load()).getSwaps(...args),
  askSwap: async (...args) => (await load()).askSwap(...args),
  vote: async (...args) => (await load()).vote(...args),
  cancelSwap: async (...args) => (await load()).cancelSwap(...args),
  stream(truceId, from, handlers) {
    let close = () => {};
    let closed = false;
    void load().then((a) => {
      if (!closed) close = a.stream(truceId, from, handlers);
    });
    return () => {
      closed = true;
      close();
    };
  },
};
