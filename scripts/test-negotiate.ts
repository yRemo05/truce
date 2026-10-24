/**
 * The referee on random worlds, for couples and groups of three and four:
 * every truce ends, nobody is talked below their floor, a deal needs
 * everyone's yes, a deadlock ends in the fair evening, broken or lying
 * agents cannot break the evening, and the ledger's tilt shows up in
 * outcomes. Rule-based agents only; no network. Run with `npm run test:negotiate`.
 */
import { RuleBrain, type AgentBrain, type AgentView, type RawMove } from '../src/agents/brain';
import { floorOf } from '../src/truce/bargain';
import { negotiate, type TruceEvent, type TruceSetup } from '../src/truce/negotiate';
import type { Pool, PoolItem } from '../src/truce/pool';
import { SLOTS, at, membersOf, perSide, sameBundle, type PerSide, type Side, type Slot, type Weights } from '../src/truce/types';
import { normalizeWeights } from '../src/truce/utility';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}

// Deterministic randomness so a failure is reproducible.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function item(id: string, slot: Slot): PoolItem {
  return {
    id, name: id, kind: slot === 'film' ? 'movie' : slot === 'music' ? 'artist' : 'place',
    disambiguation: null, popularity: null, imageUrl: null, year: null, blurb: null, tags: [],
    facts: {}, location: null, address: null, priceLevel: null, hours: null, isClosed: false,
    external: {}, googlePlaceId: null, website: null, menuUrl: null, phone: null, venue: null,
    origins: ['joint'], serves: [], scoutedBy: null, scoutWhy: null,
  };
}

/** A random pool: `n` items per slot, utilities spread 0–1 per person and slot. */
function randomWorld(seed: number, members: Side[], n = 4) {
  const r = rng(seed);
  const pool: Pool = { members, items: {} as Pool['items'], affinity: {}, drivers: {}, utilities: {}, indifferent: {}, serves: {} };
  for (const side of members) {
    pool.affinity[side] = {} as Record<Slot, Record<string, number>>;
    pool.drivers[side] = {} as Record<Slot, Record<string, { seedId: string; share: number }[]>>;
    pool.utilities[side] = {} as Record<Slot, Record<string, number>>;
    pool.indifferent[side] = {} as Record<Slot, boolean>;
  }
  for (const s of SLOTS) {
    pool.items[s] = Array.from({ length: n }, (_, i) => item(`${s}${i}`, s));
    for (const side of members) {
      const raw = pool.items[s].map(() => r());
      const lo = Math.min(...raw);
      const hi = Math.max(...raw);
      at(pool.utilities, side)[s] = Object.fromEntries(pool.items[s].map((it, i) => [it.id, (raw[i]! - lo) / (hi - lo)]));
      at(pool.affinity, side)[s] = {};
      at(pool.drivers, side)[s] = {};
      at(pool.indifferent, side)[s] = false;
    }
  }
  const weights = perSide(members, () => normalizeWeights({ film: r() + 0.2, restaurant: r() + 0.2, music: r() + 0.2 }));
  return { pool, weights };
}

const NAMES = ['Ada', 'Bo', 'Cem', 'Dila'];
const noSeeds = { film: [], restaurant: [], music: [] } as Record<Slot, string[]>;
function setupFor(members: Side[], weights: PerSide<Weights>, alpha: PerSide<number>, opener: Side = 'a'): TruceSetup {
  return {
    mode: members.length === 2 ? 'couple' : 'bff',
    members,
    names: perSide(members, (s) => NAMES[members.indexOf(s)]!),
    weights,
    seedNames: {},
    seeds: perSide(members, () => noSeeds),
    alpha,
    opener,
    moveTimeoutMs: 500,
  };
}
const even = (members: Side[]) => perSide(members, () => 1 / members.length);

const rules = new RuleBrain();
const allRules = (members: Side[]) => perSide(members, () => rules as AgentBrain);

// --- Invariants over random worlds, per group size ---------------------------
for (const size of [2, 3, 4]) {
  const members = membersOf(size);
  let ended = 0, floorsHeld = 0, ruledFair = 0, ruled = 0, agreed = 0, unanimous = 0, concessionsOk = 0;
  const N = size === 2 ? 150 : 80;
  for (let seed = 1; seed <= N; seed++) {
    const { pool, weights } = randomWorld(seed * 31 + size, members, size === 4 ? 3 : 4);
    const r = rng(seed * 7);
    const raw = perSide(members, () => 0.7 + r() * 0.6);
    const total = members.reduce((t, s) => t + at(raw, s), 0);
    const alpha = perSide(members, (s) => at(raw, s) / total);
    const events: TruceEvent[] = [];
    const opener = members[seed % size]!;
    const result = await negotiate(pool, setupFor(members, weights, alpha, opener), allRules(members), (e) => events.push(e));
    // Three moves per person plus one last-call round.
    if (result.turnsUsed <= 3 * size + 1 && events.at(-1)?.type === 'done') ended++;
    if (members.every((s) => at(result.utilities, s) >= floorOf(at(result.fair.u, s)) - 1e-9)) floorsHeld++;
    if (result.how === 'ruled') {
      ruled++;
      if (sameBundle(result.bundle, result.fair.bundle)) ruledFair++;
    } else {
      agreed++;
      const deal = events.find((e): e is Extract<TruceEvent, { type: 'agreement' }> => e.type === 'agreement');
      if (deal && members.every((s) => deal.by.includes(s))) unanimous++;
    }
    if (members.every((s) => at(result.concession, s) >= 0)) concessionsOk++;
  }
  const tag = `${size} people`;
  check(`${tag}: every truce ends within its turns`, ended === N, `${ended}/${N}`);
  check(`${tag}: nobody ends below their floor`, floorsHeld === N, `${floorsHeld}/${N}`);
  check(`${tag}: a deal has everyone's yes`, unanimous === agreed, `${unanimous}/${agreed}`);
  check(`${tag}: a deadlock is ruled to the fair evening`, ruledFair === ruled, `${ruledFair}/${ruled} ruled, ${agreed} agreed`);
  check(`${tag}: most truces are agreed, not ruled`, agreed > ruled, `${agreed} agreed / ${ruled} ruled`);
  check(`${tag}: concessions are never negative`, concessionsOk === N);
}

// --- The ledger's tilt shows in outcomes ----------------------------------
for (const size of [2, 3]) {
  const members = membersOf(size);
  let gainA = 0;
  const N = 100;
  for (let seed = 1000; seed < 1000 + N; seed++) {
    const { pool, weights } = randomWorld(seed, members);
    const tilt = (favourA: boolean) => {
      const raw = perSide(members, (s) => (s === 'a' ? (favourA ? 1.6 : 0.6) : 1));
      const total = members.reduce((t, s) => t + at(raw, s), 0);
      return perSide(members, (s) => at(raw, s) / total);
    };
    const favA = await negotiate(pool, setupFor(members, weights, tilt(true)), allRules(members));
    const favOthers = await negotiate(pool, setupFor(members, weights, tilt(false)), allRules(members));
    gainA += at(favA.utilities, 'a') - at(favOthers.utilities, 'a');
  }
  check(`${size} people: favouring A gives A more on average`, gainA / N > 0.02, `mean +${(gainA / N).toFixed(3)} for A`);
}

// --- Broken agents cannot break the evening ---------------------------------
class GarbageBrain implements AgentBrain {
  readonly name = 'garbage';
  async move(): Promise<RawMove> {
    return { action: 'counter', counters: [{ film: 'Z9', restaurant: 'nope', music: '??' }], message: 'blah' };
  }
}
class YesBrain implements AgentBrain {
  readonly name = 'yes';
  async move(view: AgentView): Promise<RawMove> {
    // Accepts everything, even when nothing is on the table or it is below the minimum.
    return { action: 'accept', counters: [], message: `Sure, whatever ${view.others[0]?.nickname} wants.` };
  }
}
class ThrowingBrain implements AgentBrain {
  readonly name = 'throws';
  async move(): Promise<RawMove> {
    throw new Error('model unavailable');
  }
}
class SlowBrain implements AgentBrain {
  readonly name = 'slow';
  move(): Promise<RawMove> {
    return new Promise(() => {}); // never answers
  }
}

for (const size of [2, 3]) {
  const members = membersOf(size);
  for (const [label, bad] of [
    ['garbage codes', new GarbageBrain()],
    ['accepts anything', new YesBrain()],
    ['throws', new ThrowingBrain()],
    ['never answers', new SlowBrain()],
  ] as const) {
    const { pool, weights } = randomWorld(42, members);
    const events: TruceEvent[] = [];
    const brains = perSide(members, (s) => (s === 'a' ? bad : rules) as AgentBrain);
    const result = await negotiate(pool, setupFor(members, weights, even(members)), brains, (e) => events.push(e));
    const rejected = events.filter((e) => e.type === 'rejected' && e.side === 'a').length;
    const aMoves = events.filter((e): e is Extract<TruceEvent, { type: 'move' }> => e.type === 'move' && e.side === 'a');
    // Whatever the bad agent is credited with must have passed the referee: an
    // accept that clears its person's floor (the accept-anything agent can be
    // right by accident on the last call).
    const floorA = Math.round(floorOf(at(result.fair.u, 'a')) * 100);
    const creditedOk = aMoves.every((m) => m.brain === 'rules' || (m.action === 'accept' && at(m.scores, 'a') >= floorA - 1));
    const tag = `${size} people, agent that ${label}`;
    check(`${tag}: the truce still ends`, events.at(-1)?.type === 'done');
    check(`${tag}: its bad moves are rejected and replaced`, rejected > 0 && creditedOk, `${rejected} rejected`);
    check(`${tag}: its person keeps their floor`, at(result.utilities, 'a') >= floorOf(at(result.fair.u, 'a')) - 1e-9);
  }
}

// --- Events tell the whole story in order ----------------------------------
{
  const members = membersOf(2);
  const { pool, weights } = randomWorld(7, members);
  const events: TruceEvent[] = [];
  await negotiate(pool, setupFor(members, weights, even(members), 'b'), allRules(members), (e) => events.push(e));
  const moves = events.filter((e): e is Extract<TruceEvent, { type: 'move' }> => e.type === 'move');
  check('events: start first, done last', events[0]?.type === 'start' && events.at(-1)?.type === 'done');
  check('two people: the opener moves first and sides alternate', moves.every((m, i) => m.side === (i % 2 === 0 ? 'b' : 'a')));
  check('events: every move carries both scores', moves.every((m) => at(m.scores, 'a') >= 0 && at(m.scores, 'b') <= 100));
  check('two people: a counter is accepted by its maker only, an accept by both', moves.every((m) => (m.action === 'counter' ? m.acceptedBy.length === 1 : m.acceptedBy.length === 2)));
}
{
  const members = membersOf(3);
  const { pool, weights } = randomWorld(11, members);
  const events: TruceEvent[] = [];
  await negotiate(pool, setupFor(members, weights, even(members), 'c'), allRules(members), (e) => events.push(e));
  const start = events[0] as Extract<TruceEvent, { type: 'start' }>;
  const moves = events.filter((e): e is Extract<TruceEvent, { type: 'move' }> => e.type === 'move' && e.turn <= start.turns);
  check('three people: seat order starts at the opener', start.order.join('') === 'cab');
  check('three people: turns go round the table', moves.every((m, i) => m.side === start.order[i % 3]));
  check('three people: an accept adds one yes to the offer', moves.every((m, i) => m.action === 'counter' || m.acceptedBy.length === (moves[i - 1]?.acceptedBy.length ?? 0) + 1));
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
