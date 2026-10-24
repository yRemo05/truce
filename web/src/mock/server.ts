/**
 * The whole API, in the browser: groups, sides, truces and check-ins live in
 * localStorage, and a truce's events are released on its own clock, so a
 * refresh mid-truce picks up where it was and a reconnect resumes where it
 * left off, as the server does. Add `?drop` to a truce URL to have the stream
 * drop once, seven seconds in; a group whose place is "Atlantis" fails while
 * gathering, as the server does when Qloo finds no restaurants. Add `?rules`
 * when starting a truce or saving a side to play a server with no model, and
 * `?interrupt` when starting one to have it stop mid-talks.
 *
 * Swaps follow the server's rules with stand-in maths and a 30-second vote:
 * the replacement is the item left in the slot with the highest summed score
 * that keeps everyone at or above their minimum (the fair evening less 0.10),
 * and an agent answering for someone says yes when that person's score for
 * the replacement is within 10 of the item it replaces.
 */
import type {
  BriefView,
  CardItem,
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
  SwapLock,
  SwapsView,
  SwapView,
  SwapVote,
  TruceResult,
  TruceView,
} from '@contract';
import { ApiError, type Api } from '../api/api';
import { membersOf, nameOf, perSide, type Names } from '@/lib/people';
import { isFact, pendingOf, swappedAway, yesCount } from '@/lib/swaps';
import { bySlot, SLOTS, type Bundle } from '@/lib/truce';
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
  /** Which demo group this is; absent for a group people made. */
  demo?: DemoInput['kind'];
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
  /** The evening after any swaps; the result's own until one happens. */
  bundle?: Bundle;
  /** Swaps and replans asked for on this evening, oldest first. */
  swaps?: SwapView[];
  /** The truce that planned this evening again, and the one this one plans again. */
  replacedBy?: string | null;
  replaces?: string | null;
  /** An instant replay of a demo, and when its "recording" was made. */
  replay?: { recordedAt: string };
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

/** A finished evening the ledger counts: not one a replan replaced. */
const counted = (t: MockTruce) => settled(t) && !t.replacedBy;

const checkedIn = (t: MockTruce) => perSide(t.members, (s) => Boolean(t.checkins[s]));

const poolOf = (t: MockTruce) => {
  const e = t.timeline.find((x) => x.event.type === 'pool')?.event;
  return e?.type === 'pool' ? e : null;
};
const bundleOf = (t: MockTruce): Bundle => t.bundle ?? t.result!.bundle;
const swapsOf = (t: MockTruce) => (t.swaps ??= []);
/** The request waiting for votes on an evening, if any. */
const openIn = (t: MockTruce) => swapsOf(t).find((w) => w.status === 'open');
const itemOf = (t: MockTruce, slot: Slot, id: string): CardItem | undefined => poolOf(t)?.items[slot].find((i) => i.id === id);

/** A person's 0–1 value for an evening, summed the way the script sums it. */
const valueOf = (t: MockTruce, s: Side, bundle: Bundle) =>
  SLOTS.reduce((sum, slot) => sum + (t.result!.weights[s]?.[slot] ?? 0) * ((itemOf(t, slot, bundle[slot])?.scores[s] ?? 0) / 100), 0);
const scoresOf = (t: MockTruce, bundle: Bundle) => perSide(t.members, (s) => Math.round(valueOf(t, s, bundle) * 100));

/** A finished truce's concessions at its evening as it stands, with each check-in counted halfway toward how it really went. */
function concessionOf(t: MockTruce): PerSide<number> {
  const r = t.result!;
  const bundle = bundleOf(t);
  const hasPool = poolOf(t) !== null;
  return perSide(t.members, (s) => {
    const c = t.checkins[s];
    const predicted = hasPool ? valueOf(t, s, bundle) : (r.utilities[s] ?? 0);
    const best = r.best[s] ?? 0;
    if (!c?.went) return Math.max(0, best - predicted);
    const items = hasPool ? bySlot((slot) => (itemOf(t, slot, bundle[slot])?.scores[s] ?? 0) / 100) : r.items[s]!;
    return realised(best, predicted, experienced(r.weights[s]!, items, c.ratings));
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
    ledger: ledgerOf(pair, all.filter(counted)),
    lastTruceId: last?.id ?? null,
    lastTruce: last ? { id: last.id, status: statusOf(last), checkedIn: checkedIn(last), openSwap: openSwapOf(last) } : null,
  };
}

function openSwapOf(t: MockTruce): NonNullable<PairView['lastTruce']>['openSwap'] {
  const open = openIn(t);
  return open ? { id: open.id, kind: open.kind, side: open.side, slot: open.slot, deadline: open.deadline, waiting: pendingOf(open, t.members) } : null;
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

/** A replan: the evening it plans again, and the item names to leave out. */
interface Again {
  replaces: string;
  exclude: string[];
}

function start(db: Db, pairId: string, again?: Again): string {
  const pair = pairOr404(db, pairId);
  const all = trucesOf(db, pairId);
  const running = all.find((t) => !isDone(t));
  if (running) return running.id;
  const { members } = pair;
  if (members.some((s) => !pair.sides[s])) throw new ApiError(409, 'not_ready', 'Everyone needs to finish their picks first.');
  if (pair.location.trim().toLowerCase() === 'atlantis') return failing(db, pair);

  const done = all.filter((t) => counted(t) && t.id !== again?.replaces);
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
    exclude: again?.exclude,
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
    replaces: again?.replaces ?? null,
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
    demo: kind,
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

/* ---------- Swaps ---------- */

const VOTE_MS = 30_000;
/** The fair evening less this is each person's minimum: no replacement takes anyone below it. */
const MINIMUM_GAP = 0.1;
/** Requests one evening takes, all kinds together (withdrawn ones aside), and swaps of fact per person. */
const MAX_REQUESTS = 12;
const FACT_SWAPS_PER_PERSON = 3;

const iso = (ms: number) => new Date(ms).toISOString();
const neededOf = (t: MockTruce) => Math.floor(t.members.length / 2) + 1;

const LOCK_MESSAGE: Record<Exclude<SwapLock, 'open'>, string> = {
  not_done: 'This evening isn’t decided yet.',
  history: 'This earlier evening can’t be changed.',
  replanned: 'This evening was planned again. Swap on the new plan instead.',
  superseded: 'The group has planned a newer evening since, so this one stays as it was.',
  checked_in: 'Someone already checked in, so this evening is settled.',
  past: 'This evening has passed.',
};

/** A newer truce (planning or planned, not failed) has taken this evening's place. */
const supersededIn = (db: Db, t: MockTruce) => trucesOf(db, t.pairId).some((x) => x.id !== t.id && x.createdAt > t.createdAt && !x.failed);

function lockOf(db: Db, t: MockTruce, pair: MockPair): SwapLock | null {
  if (!settled(t)) return 'not_done';
  if (t.replacedBy) return 'replanned';
  if (supersededIn(db, t)) return 'superseded';
  if (t.members.some((s) => t.checkins[s])) return 'checked_in';
  const tonight = poolOf(t)?.tonight;
  if (tonight && tonight.date < tonightIn(pair.location).date) return 'past';
  if (openIn(t)) return 'open';
  return null;
}

/** Whether someone still has their one taste swap: a withdrawn request gives it back. */
const canAskOf = (t: MockTruce, s: Side) =>
  !swapsOf(t).some((w) => w.side === s && w.kind === 'swap' && w.reason !== null && !isFact(w.reason) && w.status !== 'cancelled');

/** The last settled swap was an item that can't happen, with nothing to put in its place, and it is still in the evening. */
function stuckOf(t: MockTruce): boolean {
  const last = swapsOf(t).findLast((w) => w.kind === 'swap' && w.status !== 'open' && w.status !== 'cancelled');
  return Boolean(last?.status === 'no_alternative' && last.reason === 'unavailable' && last.slot && last.from && bundleOf(t)[last.slot] === last.from.id);
}

/** The referee's stand-in: the item left in the slot with the highest summed score that keeps everyone at or above their minimum. */
function replacementFor(t: MockTruce, slot: Slot): CardItem | null {
  const bundle = bundleOf(t);
  const gone = new Set([bundle[slot], ...swapsOf(t).flatMap((w) => (w.slot === slot && w.from && w.status === 'swapped' ? [w.from.id] : []))]);
  const floor = (s: Side) => (t.result!.fair.u[s] ?? 0) - MINIMUM_GAP;
  const total = (i: CardItem) => t.members.reduce((sum, s) => sum + (i.scores[s] ?? 0), 0);
  const fits = (poolOf(t)?.items[slot] ?? []).filter((i) => !gone.has(i.id) && t.members.every((s) => valueOf(t, s, { ...bundle, [slot]: i.id }) >= floor(s)));
  return fits.sort((x, y) => total(y) - total(x))[0] ?? null;
}

/** What an agent answers for someone who stayed silent, with a reason in a few words. */
function agentVote(t: MockTruce, names: Names, w: SwapView, s: Side): SwapVote {
  const name = nameOf(names, s);
  const say = (yes: boolean, why: string): SwapVote => ({ vote: yes ? 'yes' : 'no', by: 'agent', why });
  if (w.kind === 'replan' || !w.slot || !w.from) {
    const now = scoresOf(t, bundleOf(t))[s] ?? 0;
    return now < 70 ? say(true, `Tonight’s plan doesn’t suit ${name} much.`) : say(false, `Tonight’s plan suits ${name} well.`);
  }
  const next = replacementFor(t, w.slot);
  if (!next) return say(true, `${name} doesn’t mind the referee looking.`);
  const change = (next.scores[s] ?? 0) - (itemOf(t, w.slot, w.from.id)?.scores[s] ?? 0);
  if (change >= 0) return say(true, `The new ${w.slot} suits ${name} at least as well.`);
  if (change >= -10) return say(true, `The new ${w.slot} costs ${name} little.`);
  return say(false, `${w.from.name} matters to ${name} tonight.`);
}

/** The referee swaps the item in, or finds nothing fair left. */
function swapIn(t: MockTruce, w: SwapView) {
  const slot = w.slot!;
  const next = replacementFor(t, slot);
  if (!next) {
    w.status = 'no_alternative';
    return;
  }
  const before = bundleOf(t);
  const after = { ...before, [slot]: next.id };
  t.bundle = after;
  t.evening[slot] = next.name;
  t.picks[slot] = { id: next.id, name: next.name };
  w.status = 'swapped';
  w.to = { id: next.id, name: next.name };
  w.scores = { before: w.scores?.before ?? scoresOf(t, before), after: scoresOf(t, after) };
}

/** A new truce for the same evening, without what was swapped away. */
function replan(db: Db, t: MockTruce, w: SwapView) {
  const exclude = swappedAway(swapsOf(t)).map((x) => x.from!.name);
  const id = start(db, t.pairId, { replaces: t.id, exclude });
  t.replacedBy = id;
  w.status = 'replanned';
  w.truceId = id;
}

/** The group has answered: enough yeses and the request goes ahead, else the evening stays as it is. */
function resolve(db: Db, t: MockTruce, w: SwapView, now: number) {
  w.resolvedAt = iso(now);
  if (yesCount(w) < w.needed) w.status = 'kept';
  else if (w.kind === 'replan') replan(db, t, w);
  else swapIn(t, w);
}

/**
 * Closes every vote whose time is up, the agents answering for anyone silent,
 * and calls off one whose evening a newer truce has taken over. The server
 * does this on its own clock too.
 */
function settleSwaps(db: Db, t: MockTruce): boolean {
  const w = openIn(t);
  if (!w) return false;
  const now = Date.now();
  if (supersededIn(db, t)) {
    Object.assign(w, { status: 'cancelled', cancelled: 'superseded', resolvedAt: iso(now) });
    return true;
  }
  if (!w.deadline || Date.parse(w.deadline) > now) return false;
  const names = db.pairs[t.pairId]!.names;
  for (const s of t.members) if (!w.votes[s]) w.votes[s] = agentVote(t, names, w, s);
  resolve(db, t, w, now);
  return true;
}

function swapsView(db: Db, t: MockTruce): SwapsView {
  const pair = db.pairs[t.pairId]!;
  const decided = settled(t);
  // The ledger with this evening as it is now: every counted evening before it, then it.
  const before = trucesOf(db, pair.id).filter((x) => x.id !== t.id && counted(x) && x.createdAt < t.createdAt);
  const ledger = ledgerOf(pair, decided ? [...before, t] : before);
  return {
    bundle: decided ? bundleOf(t) : null,
    scores: decided && poolOf(t) ? scoresOf(t, bundleOf(t)) : null,
    concession: decided && poolOf(t) ? perSide(t.members, (s) => Math.max(0, (t.result!.best[s] ?? 0) - valueOf(t, s, bundleOf(t)))) : null,
    ledger: { alpha: ledger.alpha, tilt: ledger.tilt, owed: ledger.owed },
    swaps: swapsOf(t),
    lock: lockOf(db, t, pair),
    canAsk: perSide(t.members, (s) => canAskOf(t, s)),
    needed: neededOf(t),
    voteMinutes: VOTE_MS / 60_000,
    replanNow: stuckOf(t),
    replacedBy: t.replacedBy ?? null,
  };
}

/** A truce with its votes brought up to date, saved only if that changed anything. */
function liveTruce(db: Db, id: string): MockTruce {
  const t = truceOr404(db, id);
  if (settleSwaps(db, t)) write(db);
  return t;
}

/** The evening as a calendar file: 19:30 to 23:30 in the restaurant's city. */
function calendarFile(t: MockTruce, pair: MockPair): string {
  const pool = poolOf(t);
  const tonight = pool?.tonight ?? tonightIn(pair.location);
  const day = tonight.date.replace(/-/g, '');
  const restaurant = pool && t.result ? itemOf(t, 'restaurant', bundleOf(t).restaurant) : undefined;
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
    const pair = pairOr404(db, id);
    const last = trucesOf(db, id).at(-1);
    if (last) liveTruce(db, last.id);
    return pairView(db, pair);
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

  async demo(kind, replay = false) {
    await wait(replay ? 300 : 900);
    const db = read();
    const pair = demoPair(kind);
    db.pairs[pair.id] = pair;
    const truceId = start(db, pair.id);
    // A replay: the same script, started long enough ago to be over, as a recording of yesterday's run.
    if (replay) {
      const t = db.truces[truceId]!;
      t.createdAt = Date.now() - endOf(t) - 1000;
      t.replay = { recordedAt: new Date(Date.now() - 86_400_000).toISOString() };
      write(db);
    }
    return { pairId: pair.id, truceId, replay };
  },

  // The mock keeps no Qloo calls: its truces show no receipts, like a truce from before they were kept.
  async receipts() {
    await wait(150);
    return { calls: [], totals: { calls: 0, cached: 0, ms: 0 }, example: null };
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
      replacedBy: t.replacedBy ?? null,
      replaces: t.replaces ?? null,
      replay: t.replay ?? null,
      demo: pair.demo ?? null,
    } satisfies TruceView;
  },

  async checkin(truceId, side, input) {
    await wait(450);
    const db = read();
    const t = truceOr404(db, truceId);
    if (!t.members.includes(side)) throw new ApiError(404, 'not_found', 'There is no such person in this truce.');
    if (!settled(t)) throw new ApiError(409, 'not_done', 'This evening isn’t planned yet.');
    if (t.replacedBy) throw new ApiError(409, 'locked', 'This evening was planned again. Check in on the new plan.');
    if (settleSwaps(db, t)) write(db);
    // A check-in settles the evening, so it waits for a vote in progress rather than cutting it off.
    if (openIn(t)) throw new ApiError(409, 'swap_open', 'A swap is waiting for votes. Check in once it is settled.');
    t.checkins[side] = input;
    write(db);
    const pair = db.pairs[t.pairId]!;
    const rated = (r: string) => (input.went ? SLOTS.filter((s) => input.ratings[s] === r).map((s) => t.picks[s]) : []);
    return { ledger: ledgerOf(pair, trucesOf(db, pair.id).filter(counted)), learned: { loved: rated('loved'), avoided: rated('not_for_me') } };
  },

  async getSwaps(truceId) {
    await wait(200);
    const db = read();
    return swapsView(db, liveTruce(db, truceId));
  },

  async askSwap(truceId, input) {
    await wait(380);
    const db = read();
    const t = truceOr404(db, truceId);
    if (settleSwaps(db, t)) write(db);
    const pair = db.pairs[t.pairId]!;
    const { side } = input;
    if (!t.members.includes(side)) throw new ApiError(404, 'not_found', 'There is no such person in this truce.');
    const lock = lockOf(db, t, pair);
    if (lock === 'open') throw new ApiError(409, 'swap_open', 'Another request is waiting for votes. Ask again once it is settled.');
    if (lock) throw new ApiError(409, 'locked', LOCK_MESSAGE[lock]);
    const live = swapsOf(t).filter((w) => w.status !== 'cancelled');
    const mine = live.filter((w) => w.side === side);
    if (live.length >= MAX_REQUESTS) throw new ApiError(409, 'too_many', 'That’s a lot of changes for one evening. Plan it again instead.');

    const now = Date.now();
    const asked = {
      id: newId(),
      side,
      status: 'open' as const,
      createdAt: iso(now),
      resolvedAt: null,
      votes: { [side]: { vote: 'yes', by: 'person', why: null } } as PerSide<SwapVote>,
      to: null,
      truceId: null,
      cancelled: null,
    };
    let w: SwapView;
    if (input.kind === 'swap') {
      const { slot, reason } = input;
      if (reason === 'seen' && slot !== 'film') throw new ApiError(400, 'invalid', 'Only a film can be one you’ve seen.');
      const fact = isFact(reason);
      if (fact && mine.filter((w) => w.reason === 'unavailable').length >= FACT_SWAPS_PER_PERSON)
        throw new ApiError(409, 'too_many', 'That’s a lot of swaps for one evening. Plan it again instead.');
      if (!fact && !canAskOf(t, side))
        throw new ApiError(409, 'swap_used', 'You’ve used your swap for tonight. Something that can’t happen (booked, closed, can’t watch it) still swaps.');
      const bundle = bundleOf(t);
      w = {
        ...asked,
        kind: 'swap',
        slot,
        reason,
        deadline: fact ? null : iso(now + VOTE_MS),
        needed: fact ? 0 : neededOf(t),
        from: { id: bundle[slot], name: itemOf(t, slot, bundle[slot])?.name ?? '' },
        scores: { before: scoresOf(t, bundle), after: null },
      };
    } else {
      if (mine.some((w) => w.kind === 'replan')) throw new ApiError(409, 'swap_used', 'You’ve already asked to plan tonight again.');
      if (trucesOf(db, t.pairId).some((x) => !isDone(x))) throw new ApiError(409, 'locked', 'A new truce is already being planned for this group.');
      // An item that can't happen and has no replacement leaves no way around it: plan again at once.
      const stuck = stuckOf(t);
      w = { ...asked, kind: 'replan', slot: null, reason: null, deadline: stuck ? null : iso(now + VOTE_MS), needed: stuck ? 0 : neededOf(t), from: null, scores: null };
    }
    swapsOf(t).push(w);
    if (w.needed === 0) resolve(db, t, w, now);
    write(db);
    return swapsView(db, t);
  },

  async vote(truceId, swapId, side, vote) {
    await wait(260);
    const db = read();
    const t = truceOr404(db, truceId);
    if (settleSwaps(db, t)) write(db);
    const w = swapsOf(t).find((x) => x.id === swapId);
    if (!w) throw new ApiError(404, 'not_found', 'This request does not exist.');
    if (!t.members.includes(side)) throw new ApiError(404, 'not_found', 'There is no such person in this truce.');
    if (w.status !== 'open') throw new ApiError(409, 'locked', 'This vote has already closed.');
    const name = nameOf(db.pairs[t.pairId]!.names, side);
    if (w.side === side) throw new ApiError(409, 'not_voter', `${name} asked for this, so their yes already counts.`);
    if (w.votes[side]) throw new ApiError(409, 'not_voter', `${name} has already answered.`);
    w.votes[side] = { vote, by: 'person', why: null };
    // Decided once enough said yes, or too many said no for the rest to make up.
    const noes = t.members.filter((s) => w.votes[s]?.vote === 'no').length;
    if (yesCount(w) >= w.needed || noes > t.members.length - w.needed) resolve(db, t, w, Date.now());
    write(db);
    return swapsView(db, t);
  },

  async cancelSwap(truceId, swapId, side) {
    await wait(260);
    const db = read();
    const t = truceOr404(db, truceId);
    if (settleSwaps(db, t)) write(db);
    const w = swapsOf(t).find((x) => x.id === swapId);
    if (!w) throw new ApiError(404, 'not_found', 'This request does not exist.');
    if (w.status !== 'open') throw new ApiError(409, 'locked', 'This request has already closed.');
    if (w.side !== side) throw new ApiError(409, 'not_voter', 'Only the person who asked can withdraw it.');
    w.status = 'cancelled';
    w.cancelled = 'withdrawn';
    w.resolvedAt = iso(Date.now());
    write(db);
    return swapsView(db, t);
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
