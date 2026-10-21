/**
 * The whole API, in the browser: groups, sides, truces and check-ins live in
 * localStorage, and a truce's events are released on its own clock, so a
 * refresh mid-truce picks up where it was and a reconnect resumes where it
 * left off, as the server does. Add `?drop` to a truce URL to have the stream
 * drop once, seven seconds in; a group whose place is "Atlantis" fails while
 * gathering, as the server does when Qloo finds no restaurants. Add `?rules`
 * when starting a truce or saving a side to play a server with no model, and
 * `?interrupt` when starting one to have it stop mid-talks.
 */
import type {
  BriefView,
  CheckinInput,
  DemoInput,
  LedgerEntry,
  LedgerView,
  PairInput,
  PairView,
  PerSide,
  SearchHit,
  Seed,
  Side,
  SideInput,
  Slot,
  TruceResult,
  TruceView,
} from '@contract';
import { ApiError, type Api } from '../api/api';
import { membersOf, perSide, type Names } from '@/lib/people';
import { bySlot, SLOTS } from '@/lib/truce';
import { understand } from './brief';
import { byName, CATALOG, findFoods, foodByName } from './catalog';
import { alphaOf, balanceOf, experienced, owedOf, realised, tiltOf } from './ledger';
import { buildTimeline, tonightIn, type Timed } from './script';

interface MockSide {
  input: SideInput;
  brief: BriefView | null;
}

/** A made-up earlier evening the demo groups start with. */
interface Earlier {
  id: string;
  at: string;
  concession: PerSide<number>;
  evening: Record<Slot, string>;
}

interface MockPair {
  id: string;
  mode: PairView['mode'];
  members: Side[];
  names: Names;
  location: string;
  sides: PerSide<MockSide>;
  earlier: Earlier[];
}

interface MockTruce {
  id: string;
  pairId: string;
  members: Side[];
  createdAt: number;
  timeline: Timed[];
  result: TruceResult | null;
  evening: Record<Slot, string>;
  /** Item names by id, for what a check-in teaches. */
  picks: Record<Slot, Seed>;
  checkins: PerSide<CheckinInput>;
  failed?: boolean;
}

interface Db {
  pairs: Record<string, MockPair>;
  truces: Record<string, MockTruce>;
}

const KEY = 'truce:mock:v2';

/** `?rules` on the page plays the server without a model: rule-based agents, no scouting, notes unread. */
const rulesToday = () => new URLSearchParams(location.search).has('rules');
/** `?interrupt` when starting: the truce stops after turn 4, as the server does when it restarts mid-truce. */
const interruptToday = () => new URLSearchParams(location.search).has('interrupt');

/** Cuts the talks after turn 4 and ends them with the error a restarted server sends. */
function interrupted(timeline: Timed[]): Timed[] {
  const cut = timeline.findIndex((t) => t.event.type === 'move' && t.event.turn === 4);
  const kept = timeline.slice(0, cut + 1);
  const message = 'The truce was interrupted. Start it again; everyone’s favourites are still saved.';
  return [...kept, { at: kept[kept.length - 1]!.at + 1500, event: { type: 'error', code: 'interrupted', message, retryable: true } }];
}

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
const settled = (t: MockTruce) => isDone(t) && !t.failed && t.result !== null;
const statusOf = (t: MockTruce): TruceView['status'] => (!isDone(t) ? 'running' : t.failed ? 'failed' : 'done');
const trucesOf = (db: Db, pairId: string) =>
  Object.values(db.truces)
    .filter((t) => t.pairId === pairId)
    .sort((x, y) => x.createdAt - y.createdAt);

const checkedIn = (t: MockTruce) => perSide(t.members, (s) => Boolean(t.checkins[s]));

/** A finished truce's concessions, with each check-in counted halfway toward how it really went. */
function concessionOf(t: MockTruce): PerSide<number> {
  const r = t.result!;
  return perSide(t.members, (s) => {
    const c = t.checkins[s];
    const predicted = r.utilities[s] ?? 0;
    const best = r.best[s] ?? 0;
    if (!c?.went) return r.concession[s] ?? 0;
    return realised(best, predicted, experienced(r.weights[s]!, r.items[s]!, c.ratings));
  });
}

/** The ledger over the earlier evenings and every finished truce, plus an optional one still to be counted. */
function ledgerOf(pair: MockPair, done: readonly MockTruce[], extra?: PerSide<number>): LedgerView {
  const { members } = pair;
  const entries: LedgerEntry[] = [
    ...pair.earlier.map((e) => ({ truceId: e.id, at: e.at, concession: e.concession, checkedIn: perSide(members, () => false), evening: e.evening, earlier: true })),
    ...done.map((t) => ({
      truceId: t.id,
      at: new Date(t.createdAt + endOf(t)).toISOString(),
      concession: concessionOf(t),
      checkedIn: checkedIn(t),
      evening: t.evening,
      earlier: false,
    })),
  ];
  const balance = balanceOf([...entries.map((e) => e.concession), ...(extra ? [extra] : [])], members);
  const alpha = alphaOf(balance, members);
  return { members, balance, alpha, tilt: tiltOf(alpha, members), owed: owedOf(balance, members), entries };
}

function pairView(db: Db, pair: MockPair): PairView {
  const all = trucesOf(db, pair.id);
  const last = all[all.length - 1];
  return {
    id: pair.id,
    mode: pair.mode,
    members: pair.members,
    names: pair.names,
    location: pair.location,
    ready: perSide(pair.members, (s) => Boolean(pair.sides[s])),
    ledger: ledgerOf(pair, all.filter(settled)),
    lastTruceId: last?.id ?? null,
    lastTruce: last ? { id: last.id, status: statusOf(last), checkedIn: checkedIn(last) } : null,
  };
}

function pairOr404(db: Db, id: string): MockPair {
  const pair = db.pairs[id];
  if (!pair) throw new ApiError(404, 'not_found', 'This truce link does not exist.');
  return pair;
}

function truceOr404(db: Db, id: string): MockTruce {
  const t = db.truces[id];
  if (!t) throw new ApiError(404, 'not_found', 'This truce does not exist.');
  return t;
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

function start(db: Db, pairId: string): string {
  const pair = pairOr404(db, pairId);
  const all = trucesOf(db, pairId);
  const running = all.find((t) => !isDone(t));
  if (running) return running.id;
  const { members } = pair;
  if (members.some((s) => !pair.sides[s])) throw new ApiError(409, 'not_ready', 'Everyone needs to finish their picks first.');
  if (pair.location.trim().toLowerCase() === 'atlantis') return failing(db, pair);

  const done = all.filter(settled);
  const before = ledgerOf(pair, done);
  const count = done.length;
  // A couple alternates a deal and a stand-off; a group always finds its deal.
  const variant = members.length === 2 && count % 2 === 1 ? 'hardline' : 'deal';
  const sides = perSide(members, (s) => pair.sides[s]!);
  const { timeline, result, items } = buildTimeline({
    mode: pair.mode,
    members,
    names: pair.names,
    location: pair.location,
    sides: perSide(members, (s) => sides[s]!.input),
    briefs: perSide(members, (s) => sides[s]!.brief),
    alpha: before.alpha,
    opener: members[count % members.length]!,
    variant,
    strikeAt: rulesToday() ? null : variant === 'hardline' ? 5 : members.length === 2 ? 3 : 4,
    brain: rulesToday() ? 'rules' : 'claude',
    ledgerAfter: (concession) => {
      const after = ledgerOf(pair, done, concession);
      return {
        type: 'ledger',
        before: { alpha: before.alpha, tilt: before.tilt },
        after: { alpha: after.alpha, tilt: after.tilt, owed: after.owed },
      };
    },
  });
  const pick = (slot: Slot) => items[slot].find((i) => i.id === result.bundle[slot]);
  const id = newId();
  const cut = interruptToday();
  db.truces[id] = {
    id,
    pairId,
    members,
    createdAt: Date.now(),
    timeline: cut ? interrupted(timeline) : timeline,
    result: cut ? null : result,
    failed: cut,
    evening: bySlot((s) => pick(s)?.name ?? ''),
    picks: bySlot((s) => ({ id: result.bundle[s], name: pick(s)?.name ?? '' })),
    checkins: {},
  };
  write(db);
  return id;
}

function failing(db: Db, pair: MockPair): string {
  const id = newId();
  const message = `Qloo found no restaurants open tonight for "${pair.location}". Try a city or neighbourhood name like "Manhattan" or "Istanbul".`;
  db.truces[id] = {
    id,
    pairId: pair.id,
    members: pair.members,
    createdAt: Date.now(),
    timeline: [
      { at: 0, event: { type: 'status', phase: 'gathering', brain: 'claude' } },
      { at: 3500, event: { type: 'error', code: 'no_restaurants', message, retryable: false } },
    ],
    result: null,
    evening: { film: '', restaurant: '', music: '' },
    picks: bySlot(() => ({ id: '', name: '' })),
    checkins: {},
    failed: true,
  };
  write(db);
  return id;
}

const seed = (slot: Slot, name: string): Seed => {
  const e = byName(slot, name);
  return { id: e.id, name: e.name };
};

interface DemoPerson {
  loves: Record<Slot, string[]>;
  /** Foods they love, by the mock's food names. */
  foods?: string[];
  weights: Record<Slot, number>;
  brief: string;
}

interface DemoGroup {
  pair: PairInput;
  people: DemoPerson[];
  /** Per earlier evening: days ago, what it was, and each person's [best, got] in seat order. */
  earlier: { daysAgo: number; evening: Record<Slot, string>; scores: [number, number][] }[];
}

/** The mock's versions of the server's demo groups: same people and briefs, the mock's own invented places. */
const DEMOS: Record<DemoInput['kind'], DemoGroup> = {
  couple: {
    pair: { mode: 'couple', names: ['Maya', 'Deniz'], location: 'Manhattan' },
    people: [
      {
        loves: { film: ['In the Mood for Love', 'Lost in Translation'], restaurant: ['Trattoria Sole'], music: ['Radiohead'] },
        foods: ['Ramen'],
        weights: { film: 50, restaurant: 25, music: 25 },
        brief: "Something cosy tonight. I've already seen Past Lives.",
      },
      {
        loves: { film: ['Mad Max: Fury Road', 'John Wick'], restaurant: ['Patty Wagon'], music: ['Bad Bunny'] },
        weights: { film: 25, restaurant: 50, music: 25 },
        brief: 'No horror please, and nothing too pricey.',
      },
    ],
    // Two evenings that went Deniz's way, so the ledger starts out owing Maya.
    earlier: [
      { daysAgo: 14, evening: { film: 'Top Gun: Maverick', restaurant: 'Golden Hour Diner', music: 'Daft Punk' }, scores: [[0.9, 0.52], [0.88, 0.83]] },
      { daysAgo: 7, evening: { film: 'Heat', restaurant: 'Smokehouse 41', music: 'Kendrick Lamar' }, scores: [[0.86, 0.6], [0.9, 0.81]] },
    ],
  },
  friends: {
    pair: { mode: 'bff', names: ['Ada', 'Kerem', 'Lina'], location: 'Istanbul' },
    people: [
      {
        loves: { film: ['Amélie', 'Before Sunrise'], restaurant: ['Kuzguncuk Bostan'], music: ['Norah Jones'] },
        weights: { film: 40, restaurant: 40, music: 20 },
        brief: 'Vegetarian options, please.',
      },
      {
        loves: { film: ['The Dark Knight', 'Inception'], restaurant: ['Etçi Mehmet'], music: ['Duman'] },
        weights: { film: 30, restaurant: 30, music: 40 },
        brief: 'Nothing too pricey this week.',
      },
      {
        loves: { film: ['Spirited Away', 'Everything Everywhere All at Once'], restaurant: ['Karaköy Lokanta Evi'], music: ['Tame Impala'] },
        foods: ['Meze'],
        weights: { film: 50, restaurant: 25, music: 25 },
        brief: 'No horror, I want to laugh.',
      },
    ],
    // One evening that went against Lina.
    earlier: [{ daysAgo: 6, evening: { film: 'Top Gun: Maverick', restaurant: 'Etçi Mehmet', music: 'Duman' }, scores: [[0.85, 0.7], [0.9, 0.88], [0.88, 0.55]] }],
  },
};

function demoPair(kind: DemoInput['kind']): MockPair {
  const group = DEMOS[kind];
  const members = membersOf(group.people.length);
  return {
    id: newId(),
    mode: group.pair.mode,
    members,
    names: perSide(members, (s) => group.pair.names[members.indexOf(s)]!),
    location: group.pair.location,
    sides: perSide(members, (s) => {
      const p = group.people[members.indexOf(s)]!;
      const foods = (p.foods ?? []).map(foodByName);
      return {
        input: { seeds: bySlot((slot) => p.loves[slot].map((n) => seed(slot, n))), ...(foods.length ? { foods } : {}), weights: p.weights, brief: p.brief },
        brief: understand(p.brief),
      };
    }),
    earlier: group.earlier.map((e) => ({
      id: newId(),
      at: new Date(Date.now() - e.daysAgo * 86_400_000).toISOString(),
      concession: perSide(members, (s) => {
        const [best, got] = e.scores[members.indexOf(s)]!;
        return Math.max(0, best - got);
      }),
      evening: e.evening,
    })),
  };
}

/** The evening as a calendar file: 19:30 to 23:30 in the restaurant's city. */
function calendarFile(t: MockTruce, pair: MockPair): string {
  const pool = t.timeline.find((x) => x.event.type === 'pool')?.event;
  const tonight = pool?.type === 'pool' ? pool.tonight : tonightIn(pair.location);
  const day = tonight.date.replace(/-/g, '');
  const restaurant = pool?.type === 'pool' ? pool.items.restaurant.find((i) => i.id === t.result?.bundle.restaurant) : undefined;
  const esc = (s: string) => s.replace(/([,;\\])/g, '\\$1');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Truce//Mock//EN',
    'BEGIN:VEVENT',
    `UID:${t.id}@truce.mock`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`,
    `DTSTART;TZID=${tonight.timeZone}:${day}T193000`,
    `DTEND;TZID=${tonight.timeZone}:${day}T233000`,
    `SUMMARY:${esc(`Tonight: ${t.evening.film}, ${t.evening.restaurant}, ${t.evening.music}`)}`,
    `LOCATION:${esc([t.evening.restaurant, restaurant?.address].filter(Boolean).join(', '))}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

export const mockApi: Api = {
  kind: 'mock',

  async search(slot, q, near, signal) {
    await wait(220 + Math.random() * 260, signal);
    const query = fold(q.trim());
    // The catalogue has no places to filter by; it only echoes the area.
    const area = slot === 'restaurant' ? near : null;
    if (!query) return { hits: [], foods: [], near: area };
    const foods = slot === 'restaurant' ? findFoods(query) : [];
    const hits = CATALOG[slot]
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
    return { hits, foods, near: area };
  },

  async createPair(input) {
    await wait(300);
    const db = read();
    const id = newId();
    const members = membersOf(input.names.length);
    db.pairs[id] = { id, mode: input.mode, members, names: perSide(members, (s) => input.names[members.indexOf(s)]!), location: input.location, sides: {}, earlier: [] };
    write(db);
    return { id };
  },

  async getPair(id) {
    await wait(180);
    const db = read();
    return pairView(db, pairOr404(db, id));
  },

  async setLocation(pairId, location) {
    await wait(250);
    const db = read();
    const pair = pairOr404(db, pairId);
    pair.location = location.trim();
    write(db);
    return pairView(db, pair);
  },

  async saveSide(pairId, side, input) {
    await wait(350);
    const db = read();
    const pair = pairOr404(db, pairId);
    if (!pair.members.includes(side)) throw new ApiError(404, 'not_found', 'There is no such person in this truce.');
    if (!SLOTS.some((s) => input.seeds[s].length > 0)) throw new ApiError(400, 'invalid', 'Pick at least one film, artist or restaurant you love.');
    if (input.seeds.restaurant.length + (input.foods?.length ?? 0) > 3) throw new ApiError(400, 'invalid', 'Up to three restaurants and foods together.');
    const text = input.brief?.trim() ?? '';
    if (text.length > 280) throw new ApiError(400, 'invalid', 'Keep the note to 280 characters.');
    const brief = text && !rulesToday() ? understand(text) : null;
    pair.sides[side] = { input, brief };
    write(db);
    return { ready: perSide(pair.members, (s) => Boolean(pair.sides[s])), brief };
  },

  async startTruce(pairId) {
    await wait(400);
    return { truceId: start(read(), pairId) };
  },

  async demo(kind) {
    await wait(900);
    const db = read();
    const pair = demoPair(kind);
    db.pairs[pair.id] = pair;
    return { pairId: pair.id, truceId: start(db, pair.id) };
  },

  async getTruce(id) {
    await wait(160);
    const db = read();
    const t = truceOr404(db, id);
    const pair = db.pairs[t.pairId]!;
    const elapsed = Date.now() - t.createdAt;
    return {
      id,
      pairId: t.pairId,
      status: statusOf(t),
      mode: pair.mode,
      members: t.members,
      names: pair.names,
      location: pair.location,
      createdAt: new Date(t.createdAt).toISOString(),
      endedAt: isDone(t) ? new Date(t.createdAt + endOf(t)).toISOString() : null,
      checkedIn: checkedIn(t),
      events: t.timeline.filter((x) => x.at <= elapsed).map((x) => x.event),
    } satisfies TruceView;
  },

  async checkin(truceId, side, input) {
    await wait(450);
    const db = read();
    const t = truceOr404(db, truceId);
    if (!t.members.includes(side)) throw new ApiError(404, 'not_found', 'There is no such person in this truce.');
    if (!settled(t)) throw new ApiError(409, 'not_done', 'This evening isn’t planned yet.');
    t.checkins[side] = input;
    write(db);
    const pair = db.pairs[t.pairId]!;
    const rated = (r: string) => (input.went ? SLOTS.filter((s) => input.ratings[s] === r).map((s) => t.picks[s]) : []);
    return { ledger: ledgerOf(pair, trucesOf(db, pair.id).filter(settled)), learned: { loved: rated('loved'), avoided: rated('not_for_me') } };
  },

  async calendarUrl(truceId) {
    const db = read();
    const t = truceOr404(db, truceId);
    return URL.createObjectURL(new Blob([calendarFile(t, db.pairs[t.pairId]!)], { type: 'text/calendar' }));
  },

  stream(truceId, from, handlers) {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const clear = () => timers.splice(0).forEach(clearTimeout);
    let closed = false;
    let dropped = !new URLSearchParams(location.search).has('drop');
    // Like Last-Event-ID: a reconnect resumes after the last event sent.
    let next = from;

    const open = () => {
      timers.push(
        setTimeout(() => {
          const t = read().truces[truceId];
          if (closed) return;
          if (!t) return handlers.onDrop(false);
          handlers.onOpen();
          const elapsed = Date.now() - t.createdAt;
          const send = (index: number) => {
            if (closed) return;
            next = index + 1;
            handlers.onEvent(t.timeline[index]!.event, index);
          };
          t.timeline.forEach((item, index) => {
            if (index < next) return;
            const delay = item.at - elapsed;
            if (delay <= 0) send(index);
            else timers.push(setTimeout(() => send(index), delay));
          });
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
