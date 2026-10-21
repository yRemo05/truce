/**
 * The whole API, in the browser: pairs, sides and truces live in
 * localStorage, and a truce's events are released on its own clock, so a
 * refresh mid-truce picks up where it was and a reconnect replays from the
 * start, as the server does. Add `?drop` to a truce URL to have the stream
 * drop once, seven seconds in; a pair whose place is "Atlantis" fails while
 * scouting, as the server does when Qloo finds no restaurants.
 */
import type { LedgerView, PairView, SearchHit, Side, SideInput, Slot, StreamEvent, TruceView } from '@contract';
import { ApiError, type Api } from '../api/api';
import { byName, CATALOG } from './catalog';
import { bySlot, SLOTS } from '@/lib/truce';
import { buildTimeline, type Timed } from './script';

interface MockPair {
  id: string;
  mode: PairView['mode'];
  names: Record<Side, string>;
  location: string;
  sides: Partial<Record<Side, SideInput>>;
}

interface MockTruce {
  id: string;
  pairId: string;
  createdAt: number;
  timeline: Timed[];
  concession: Record<Side, number>;
  evening: Record<Slot, string>;
  failed?: boolean;
}

interface Db {
  pairs: Record<string, MockPair>;
  truces: Record<string, MockTruce>;
}

const KEY = 'truce:mock:v1';

/** Parsed once per page load; every write goes back to localStorage. */
let cached: Db | null = null;

function read(): Db {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return (cached = JSON.parse(raw) as Db);
  } catch {
    /* a corrupt store starts over */
  }
  return (cached = { pairs: {}, truces: {} });
}

function write(db: Db) {
  cached = db;
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* private mode: the mock still works for this page */
  }
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
}

const endOf = (t: MockTruce) => t.timeline[t.timeline.length - 1]!.at;
const isDone = (t: MockTruce) => Date.now() - t.createdAt >= endOf(t);
const settled = (t: MockTruce) => isDone(t) && !t.failed;
const trucesOf = (db: Db, pairId: string) =>
  Object.values(db.truces)
    .filter((t) => t.pairId === pairId)
    .sort((x, y) => x.createdAt - y.createdAt);

const DECAY = 0.7;
const alphaOf = (balance: number) => 0.5 + 0.15 * Math.tanh(balance / 0.3);
const owedOf = (balance: number): Side | null => (balance > 0.02 ? 'a' : balance < -0.02 ? 'b' : null);

function ledgerOf(done: readonly MockTruce[], extra?: Record<Side, number>): LedgerView {
  const concessions = [...done.map((t) => t.concession), ...(extra ? [extra] : [])];
  const balance = concessions.reduce((b, c) => b * DECAY + (c.a - c.b), 0);
  return {
    balance,
    alphaA: alphaOf(balance),
    owed: owedOf(balance),
    entries: done.map((t) => ({
      truceId: t.id,
      at: new Date(t.createdAt + endOf(t)).toISOString(),
      concession: t.concession,
      evening: t.evening,
    })),
  };
}

function pairOr404(db: Db, id: string): MockPair {
  const pair = db.pairs[id];
  if (!pair) throw new ApiError(404, 'not_found', 'This truce link does not exist.');
  return pair;
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

function start(db: Db, pairId: string): string {
  const pair = pairOr404(db, pairId);
  const all = trucesOf(db, pairId);
  const running = all.find((t) => !isDone(t));
  if (running) return running.id;
  const done = all.filter(settled);
  const { a, b } = pair.sides;
  if (!a || !b) throw new ApiError(409, 'not_ready', 'Both people need to finish their picks first.');
  const before = ledgerOf(done);
  if (pair.location.trim().toLowerCase() === 'atlantis') return failing(db, pairId, pair.location);
  const { timeline, result } = buildTimeline({
    mode: pair.mode,
    names: pair.names,
    location: pair.location,
    sides: { a, b },
    alphaA: before.alphaA,
    doneBefore: done.length,
    brain: 'claude',
    ledgerAfter: (concession) => {
      const after = ledgerOf(done, concession);
      return {
        type: 'ledger',
        before: { balance: before.balance, alphaA: before.alphaA },
        after: { balance: after.balance, alphaA: after.alphaA, owed: after.owed },
      };
    },
  });
  const pool = timeline.find((t) => t.event.type === 'pool')!.event as Extract<StreamEvent, { type: 'pool' }>;
  const id = newId();
  db.truces[id] = {
    id,
    pairId,
    createdAt: Date.now(),
    timeline,
    concession: result.concession,
    evening: bySlot((s) => pool.items[s].find((i) => i.id === result.bundle[s])?.name ?? ''),
  };
  write(db);
  return id;
}

function failing(db: Db, pairId: string, location: string): string {
  const id = newId();
  const message = `Qloo found no restaurants for "${location}". Try a city or neighbourhood name like "Manhattan" or "Istanbul".`;
  db.truces[id] = {
    id,
    pairId,
    createdAt: Date.now(),
    timeline: [
      { at: 0, event: { type: 'status', phase: 'scouting', brain: 'claude' } },
      { at: 3500, event: { type: 'error', message } },
    ],
    concession: { a: 0, b: 0 },
    evening: { film: '', restaurant: '', music: '' },
    failed: true,
  };
  write(db);
  return id;
}

const seed = (slot: Slot, name: string) => {
  const e = byName(slot, name);
  return { id: e.id, name: e.name };
};

const DEMO = {
  names: { a: 'Maya', b: 'Deniz' },
  sides: {
    a: {
      seeds: {
        film: [seed('film', 'In the Mood for Love'), seed('film', 'Lost in Translation')],
        restaurant: [seed('restaurant', 'Trattoria Sole')],
        music: [seed('music', 'Radiohead')],
      },
      weights: { film: 50, restaurant: 25, music: 25 },
    },
    b: {
      seeds: {
        film: [seed('film', 'Mad Max: Fury Road'), seed('film', 'John Wick')],
        restaurant: [seed('restaurant', 'Patty Wagon')],
        music: [seed('music', 'Bad Bunny')],
      },
      weights: { film: 25, restaurant: 50, music: 25 },
    },
  } satisfies Record<Side, SideInput>,
};

export const mockApi: Api = {
  kind: 'mock',

  async search(slot, q, signal) {
    await wait(220 + Math.random() * 260, signal);
    const query = fold(q.trim());
    if (!query) return [];
    return CATALOG[slot]
      .filter((e) => fold(e.name).includes(query))
      .slice(0, 6)
      .map(
        (e): SearchHit => ({
          id: e.id,
          name: e.name,
          disambiguation: e.disambiguation,
          imageUrl: e.imageUrl,
          blurb: e.blurb,
          year: e.year,
          popularity: e.popularity,
        }),
      );
  },

  async createPair(input) {
    await wait(300);
    const db = read();
    const id = newId();
    db.pairs[id] = { id, mode: input.mode, names: input.names, location: input.location, sides: {} };
    write(db);
    return { id };
  },

  async getPair(id) {
    await wait(180);
    const db = read();
    const pair = pairOr404(db, id);
    const all = trucesOf(db, id);
    return {
      id,
      mode: pair.mode,
      names: pair.names,
      location: pair.location,
      ready: { a: Boolean(pair.sides.a), b: Boolean(pair.sides.b) },
      ledger: ledgerOf(all.filter(settled)),
      lastTruceId: all[all.length - 1]?.id ?? null,
    };
  },

  async saveSide(pairId, side, input) {
    await wait(350);
    const db = read();
    const pair = pairOr404(db, pairId);
    if (!SLOTS.some((s) => input.seeds[s].length > 0)) throw new ApiError(400, 'invalid', 'Pick at least one thing you love.');
    pair.sides[side] = input;
    write(db);
    return { ready: { a: Boolean(pair.sides.a), b: Boolean(pair.sides.b) } };
  },

  async startTruce(pairId) {
    await wait(400);
    const db = read();
    return { truceId: start(db, pairId) };
  },

  async demo() {
    await wait(900);
    const db = read();
    const pairId = newId();
    db.pairs[pairId] = { id: pairId, mode: 'couple', names: DEMO.names, location: 'Manhattan', sides: DEMO.sides };
    return { pairId, truceId: start(db, pairId) };
  },

  async getTruce(id) {
    await wait(160);
    const db = read();
    const t = db.truces[id];
    if (!t) throw new ApiError(404, 'not_found', 'This truce does not exist.');
    const pair = db.pairs[t.pairId]!;
    const elapsed = Date.now() - t.createdAt;
    return {
      id,
      pairId: t.pairId,
      status: t.failed && isDone(t) ? 'failed' : isDone(t) ? 'done' : 'running',
      mode: pair.mode,
      names: pair.names,
      location: pair.location,
      events: t.timeline.filter((x) => x.at <= elapsed).map((x) => x.event),
    } satisfies TruceView;
  },

  stream(truceId, handlers) {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const clear = () => timers.splice(0).forEach(clearTimeout);
    let closed = false;
    let dropped = !new URLSearchParams(location.search).has('drop');

    const open = () => {
      timers.push(
        setTimeout(() => {
          const t = read().truces[truceId];
          if (closed) return;
          if (!t) return handlers.onDrop(false);
          handlers.onOpen();
          const elapsed = Date.now() - t.createdAt;
          for (const item of t.timeline) {
            const delay = item.at - elapsed;
            if (delay <= 0) handlers.onEvent(item.event);
            else timers.push(setTimeout(() => !closed && handlers.onEvent(item.event), delay));
          }
          if (!dropped && endOf(t) - elapsed > 7000) {
            dropped = true;
            timers.push(
              setTimeout(() => {
                clear();
                handlers.onDrop(true);
                timers.push(setTimeout(open, 1800));
              }, 7000),
            );
          }
        }, 150),
      );
    };

    open();
    return () => {
      closed = true;
      clear();
    };
  },
};
