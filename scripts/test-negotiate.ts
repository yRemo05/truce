/**
 * The referee on random worlds: every truce ends, nobody is talked below
 * their floor, a deadlock ends in the fair evening, broken or lying agents
 * cannot break the evening, and the ledger's tilt shows up in outcomes.
 * Rule-based agents only; no network. Run with `npm run test:negotiate`.
 */
import { RuleBrain, type AgentBrain, type AgentView, type RawMove } from '../src/agents/brain';
import { floorOf } from '../src/truce/bargain';
import { negotiate, type TruceEvent, type TruceSetup } from '../src/truce/negotiate';
import type { Pool, PoolItem } from '../src/truce/pool';
import { SLOTS, sameBundle, type Side, type Slot } from '../src/truce/types';
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
    facts: {}, location: null, address: null, priceLevel: null, origins: ['joint'],
  };
}

/** A random pool: `n` items per slot, utilities spread 0–1 per side and slot. */
function randomWorld(seed: number, n = 4) {
  const r = rng(seed);
  const pool: Pool = {
    items: {} as Pool['items'],
    affinity: { a: {} as Pool['affinity']['a'], b: {} as Pool['affinity']['b'] },
    drivers: { a: {} as Pool['drivers']['a'], b: {} as Pool['drivers']['b'] },
    utilities: { a: {} as Pool['utilities']['a'], b: {} as Pool['utilities']['b'] },
    indifferent: { a: {} as Pool['indifferent']['a'], b: {} as Pool['indifferent']['b'] },
  };
  for (const s of SLOTS) {
    pool.items[s] = Array.from({ length: n }, (_, i) => item(`${s}${i}`, s));
    for (const side of ['a', 'b'] as const) {
      const raw = pool.items[s].map(() => r());
      const lo = Math.min(...raw);
      const hi = Math.max(...raw);
      pool.utilities[side][s] = Object.fromEntries(pool.items[s].map((it, i) => [it.id, (raw[i]! - lo) / (hi - lo)]));
      pool.affinity[side][s] = {};
      pool.drivers[side][s] = {};
      pool.indifferent[side][s] = false;
    }
  }
  const weights = {
    a: normalizeWeights({ film: r() + 0.2, restaurant: r() + 0.2, music: r() + 0.2 }),
    b: normalizeWeights({ film: r() + 0.2, restaurant: r() + 0.2, music: r() + 0.2 }),
  };
  return { pool, weights };
}

const noSeeds = { film: [], restaurant: [], music: [] } as Record<Slot, string[]>;
function setupFor(weights: TruceSetup['weights'], alphaA: number, opener: Side = 'a'): TruceSetup {
  return {
    mode: 'couple', names: { a: 'Ada', b: 'Bo' }, weights, seedNames: {},
    seeds: { a: noSeeds, b: noSeeds }, alphaA, opener, turns: 6, moveTimeoutMs: 500,
  };
}

const rules = new RuleBrain();

// --- Invariants over random worlds ------------------------------------------
{
  let ended = 0, floorsHeld = 0, ruledFair = 0, ruled = 0, agreed = 0, concessionsOk = 0;
  const N = 150;
  for (let seed = 1; seed <= N; seed++) {
    const { pool, weights } = randomWorld(seed);
    const alphaA = 0.35 + rng(seed * 7)() * 0.3;
    const events: TruceEvent[] = [];
    const result = await negotiate(pool, setupFor(weights, alphaA, seed % 2 ? 'a' : 'b'), { a: rules, b: rules }, (e) => events.push(e));
    // Six turns plus at most one last call.
    if (result.turnsUsed <= 7 && events.at(-1)?.type === 'done') ended++;
    const fa = floorOf(result.fair.a), fb = floorOf(result.fair.b);
    if (result.utilities.a >= fa - 1e-9 && result.utilities.b >= fb - 1e-9) floorsHeld++;
    if (result.how === 'ruled') {
      ruled++;
      if (sameBundle(result.bundle, result.fair.bundle)) ruledFair++;
    } else agreed++;
    if (result.concession.a >= 0 && result.concession.b >= 0) concessionsOk++;
  }
  check('every truce ends within its turns', ended === N, `${ended}/${N}`);
  check('nobody ends below their floor', floorsHeld === N, `${floorsHeld}/${N}`);
  check('a deadlock is ruled to the fair evening', ruledFair === ruled, `${ruledFair}/${ruled} ruled, ${agreed} agreed`);
  check('most truces are agreed, not ruled', agreed > ruled, `${agreed} agreed / ${ruled} ruled`);
  check('concessions are never negative', concessionsOk === N);
}

// --- The ledger's tilt shows in outcomes ----------------------------------
{
  let gainA = 0;
  const N = 120;
  for (let seed = 1000; seed < 1000 + N; seed++) {
    const { pool, weights } = randomWorld(seed);
    const favA = await negotiate(pool, setupFor(weights, 0.65), { a: rules, b: rules });
    const favB = await negotiate(pool, setupFor(weights, 0.35), { a: rules, b: rules });
    gainA += favA.utilities.a - favB.utilities.a;
  }
  check('favouring A gives A more on average', gainA / N > 0.02, `mean +${(gainA / N).toFixed(3)} for A`);
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
    return { action: 'accept', counters: [], message: `Sure, whatever ${view.otherNickname} wants.` };
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

for (const [label, bad] of [
  ['garbage codes', new GarbageBrain()],
  ['accepts anything', new YesBrain()],
  ['throws', new ThrowingBrain()],
  ['never answers', new SlowBrain()],
] as const) {
  const { pool, weights } = randomWorld(42);
  const events: TruceEvent[] = [];
  const result = await negotiate(pool, setupFor(weights, 0.5), { a: bad, b: rules }, (e) => events.push(e));
  const rejected = events.filter((e) => e.type === 'rejected' && e.side === 'a').length;
  const aMoves = events.filter((e): e is Extract<TruceEvent, { type: 'move' }> => e.type === 'move' && e.side === 'a');
  // Whatever the bad agent is credited with must have passed the referee: an
  // accept that clears its person's floor (the accept-anything agent can be
  // right by accident on the last call).
  const floorA = Math.round(floorOf(result.fair.a) * 100);
  const creditedOk = aMoves.every((m) => m.brain === 'rules' || (m.action === 'accept' && m.scores.a >= floorA - 1));
  check(`agent that ${label}: the truce still ends`, events.at(-1)?.type === 'done');
  check(`agent that ${label}: its bad moves are rejected and replaced`, rejected > 0 && creditedOk, `${rejected} rejected`);
  check(`agent that ${label}: its person keeps their floor`, result.utilities.a >= floorOf(result.fair.a) - 1e-9);
}

// --- Events tell the whole story in order ----------------------------------
{
  const { pool, weights } = randomWorld(7);
  const events: TruceEvent[] = [];
  await negotiate(pool, setupFor(weights, 0.5, 'b'), { a: rules, b: rules }, (e) => events.push(e));
  const moves = events.filter((e): e is Extract<TruceEvent, { type: 'move' }> => e.type === 'move');
  check('events: start first, done last', events[0]?.type === 'start' && events.at(-1)?.type === 'done');
  check('events: the opener moves first and sides alternate', moves.every((m, i) => m.side === (i % 2 === 0 ? 'b' : 'a')));
  check('events: every move carries both scores', moves.every((m) => m.scores.a >= 0 && m.scores.b >= 0 && m.scores.a <= 100));
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
