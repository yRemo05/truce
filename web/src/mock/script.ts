/**
 * Two hand-written truces, replayed through the real StreamEvent shapes:
 * one the agents settle (with a referee strike and a polish), one that
 * deadlocks into a ruling. Pairs alternate between them, as the server
 * alternates openers. Scores, best evenings, the fair bundle and the ledger
 * are computed from the pool and each person's weights, so every number on
 * screen is consistent with every other.
 */
import type { CardItem, Mode, Side, SideInput, Slot, StreamEvent, TruceResult } from '@contract';
import type { Names } from '@/lib/people';
import { bySlot, SLOTS, type Bundle } from '@/lib/truce';
import { byName, hashOf } from './catalog';

type Origin = CardItem['origins'][number];

/** [name, origins, Maya-like score, Deniz-like score] — invented numbers. */
const POOL: Record<Slot, [string, Origin[], number, number][]> = {
  film: [
    ['Chungking Express', ['a'], 100, 31],
    ['Drive', ['joint'], 78, 84],
    ['The Raid', ['b'], 0, 100],
    ['Past Lives', ['a'], 91, 9],
    ['Baby Driver', ['joint', 'b'], 61, 92],
    ['Edge of Tomorrow', ['b'], 22, 88],
    ['Arrival', ['joint'], 83, 70],
    ['Portrait of a Lady on Fire', ['a'], 96, 0],
  ],
  restaurant: [
    ['Osteria Lume', ['a'], 100, 12],
    ['Kisa Izakaya', ['joint'], 66, 86],
    ['Smokehouse 41', ['b'], 6, 100],
    ['Brass Lantern Noodle Bar', ['joint'], 81, 77],
    ['Café Meridian', ['a'], 88, 25],
    ['Neon Taquería', ['b'], 35, 94],
    ['Ostra & Pine', ['a'], 93, 0],
    ['Golden Hour Diner', ['b'], 0, 86],
  ],
  music: [
    ['Massive Attack', ['a'], 100, 40],
    ['Rosalía', ['joint'], 70, 89],
    ['Burna Boy', ['b'], 18, 100],
    ['Khruangbin', ['joint'], 86, 78],
    ['Frank Ocean', ['joint', 'a'], 90, 80],
    ['Björk', ['a'], 95, 0],
    ['Rauw Alejandro', ['b'], 0, 97],
    ['The xx', ['a'], 92, 21],
  ],
};

type Line = (n: Names) => string;
type Pick = [film: string, restaurant: string, music: string];

interface Turn {
  side: Side;
  action: 'counter' | 'accept' | 'decline';
  pick?: Pick;
  say: Line;
  /** The model's move was struck and the rule-based agent's stands instead. */
  struck?: Line;
}

const SCRIPTS: { opener: Side; turns: Turn[] }[] = [
  {
    opener: 'a',
    turns: [
      { side: 'a', action: 'counter', pick: ['Chungking Express', 'Osteria Lume', 'Massive Attack'], say: (n) => `${n.a} would start with Chungking Express, dinner at Osteria Lume and Massive Attack on the walk home. Neon, romance, a little rain.` },
      { side: 'b', action: 'counter', pick: ['The Raid', 'Smokehouse 41', 'Burna Boy'], say: (n) => `Respectfully, no subtitles tonight. ${n.b} counters with The Raid, brisket at Smokehouse 41 and Burna Boy loud enough to feel.` },
      { side: 'a', action: 'counter', pick: ['Chungking Express', 'Brass Lantern Noodle Bar', 'Khruangbin'], struck: (n) => `offer below ${n.a}'s minimum`, say: (n) => `${n.a} can meet you partway.` },
      { side: 'b', action: 'counter', pick: ['Baby Driver', 'Kisa Izakaya', 'Khruangbin'], say: (n) => `Khruangbin we can share. Swap the arthouse for Baby Driver and ${n.b} will trade the brisket for Kisa Izakaya.` },
      { side: 'a', action: 'counter', pick: ['Drive', 'Brass Lantern Noodle Bar', 'Frank Ocean'], say: (n) => `Same getaway car, better film: Drive. Noodles at Brass Lantern, Frank Ocean after. That's ${n.a} giving ground on two of three.` },
      { side: 'b', action: 'counter', pick: ['Drive', 'Kisa Izakaya', 'Khruangbin'], say: (n) => `Drive, done. But Kisa over Brass Lantern, and Khruangbin over Frank Ocean. That's ${n.b}'s last offer.` },
      { side: 'a', action: 'accept', say: (n) => `Fine. Drive, Kisa, Khruangbin. ${n.a} picks the seats.` },
    ],
  },
  {
    opener: 'b',
    turns: [
      { side: 'b', action: 'counter', pick: ['The Raid', 'Smokehouse 41', 'Burna Boy'], say: (n) => `${n.b} opens with The Raid, brisket at Smokehouse 41 and Burna Boy. Big, loud, no subtitles.` },
      { side: 'a', action: 'counter', pick: ['Chungking Express', 'Osteria Lume', 'Massive Attack'], say: (n) => `${n.a} has the ledger's ear tonight. Chungking Express, Osteria Lume, Massive Attack.` },
      { side: 'b', action: 'counter', pick: ['Edge of Tomorrow', 'Neon Taquería', 'Rosalía'], say: (n) => `Edge of Tomorrow is basically a romance if you squint. Tacos at Neon, Rosalía after. ${n.b} is being generous.` },
      { side: 'a', action: 'counter', pick: ['Arrival', 'Café Meridian', 'Frank Ocean'], say: () => `Arrival is a film about listening, which feels relevant. Café Meridian, then Frank Ocean.` },
      { side: 'b', action: 'counter', pick: ['Baby Driver', 'Neon Taquería', 'Khruangbin'], struck: () => `unknown film "F9"`, say: (n) => `${n.b} can meet you partway.` },
      { side: 'a', action: 'counter', pick: ['Arrival', 'Brass Lantern Noodle Bar', 'Frank Ocean'], say: (n) => `Arrival, Brass Lantern, Frank Ocean. ${n.a} won't go further than this tonight.` },
      { side: 'b', action: 'decline', say: (n) => `Two of three are ${n.a}'s picks. ${n.b} would rather the referee called it.` },
    ],
  },
];

const scriptFor = (doneBefore: number) => SCRIPTS[doneBefore % SCRIPTS.length]!;

interface Seeds {
  names: Record<Slot, string[]>;
  has: Record<Slot, boolean>;
}

function seedsOf(input: SideInput): Seeds {
  const names = bySlot((s) => input.seeds[s].map((x) => x.name));
  const has = bySlot((s) => names[s].length > 0);
  return { names, has };
}

function becauseLines(seeds: Seeds, slot: Slot, itemName: string): string[] {
  const own = seeds.names[slot];
  const rest = SLOTS.filter((s) => s !== slot).flatMap((s) => seeds.names[s]);
  const ordered = [...own, ...rest];
  if (!ordered.length) return [];
  const h = hashOf(`${slot}:${itemName}:${ordered.join()}`);
  const first = ordered[h % Math.min(ordered.length, own.length || ordered.length)]!;
  const second = ordered.find((n, i) => n !== first && i === (h >> 5) % ordered.length) ?? ordered.find((n) => n !== first);
  if (!second) return [`${first} (100%)`];
  const lead = 46 + (h % 30);
  return [`${first} (${lead}%)`, `${second} (${Math.round((100 - lead) * 0.7)}%)`];
}

interface Built {
  items: Record<Slot, CardItem[]>;
  indifferent: Record<Side, Record<Slot, boolean>>;
}

function buildPool(sides: Record<Side, SideInput>, location: string): Built {
  const seeds = { a: seedsOf(sides.a), b: seedsOf(sides.b) };
  const indifferent = {
    a: bySlot((s) => !seeds.a.has[s]),
    b: bySlot((s) => !seeds.b.has[s]),
  };
  const items = bySlot((slot) =>
      POOL[slot].map(([name, origins, a, b]): CardItem => {
        const e = byName(slot, name);
        const facts = { ...e.facts };
        if (slot === 'restaurant' && location.trim().toLowerCase() !== 'manhattan') facts.neighborhood = location.trim();
        return {
          id: e.id,
          slot,
          name: e.name,
          disambiguation: slot === 'restaurant' && facts.neighborhood === location.trim() ? null : e.disambiguation,
          imageUrl: e.imageUrl,
          blurb: e.blurb,
          facts,
          scores: { a: indifferent.a[slot] ? 50 : a, b: indifferent.b[slot] ? 50 : b },
          origins,
          because: { a: becauseLines(seeds.a, slot, name), b: becauseLines(seeds.b, slot, name) },
        };
      }),
  );
  return { items, indifferent };
}

function normalize(w: SideInput['weights']): Record<Slot, number> {
  const total = SLOTS.reduce((t, s) => t + Math.max(0, w[s]), 0);
  return bySlot((s) => (total > 0 ? Math.max(0, w[s]) / total : 1 / 3));
}

interface Scored {
  bundle: Bundle;
  a: number;
  b: number;
}

function scorer(items: Record<Slot, CardItem[]>, sides: Record<Side, SideInput>) {
  const weights = { a: normalize(sides.a.weights), b: normalize(sides.b.weights) };
  const score = (side: Side, bundle: Bundle) =>
    SLOTS.reduce((t, s) => t + weights[side][s] * ((items[s].find((i) => i.id === bundle[s])?.scores[side] ?? 0) / 100), 0);
  const all: Scored[] = [];
  for (const f of items.film)
    for (const r of items.restaurant)
      for (const m of items.music) {
        const bundle = { film: f.id, restaurant: r.id, music: m.id };
        all.push({ bundle, a: score('a', bundle), b: score('b', bundle) });
      }
  return { score, all };
}

const same = (x: Bundle, y: Bundle) => SLOTS.every((s) => x[s] === y[s]);

function nash(all: Scored[], alphaA: number): Scored {
  const value = (x: Scored) => alphaA * Math.log(x.a + 1e-6) + (1 - alphaA) * Math.log(x.b + 1e-6);
  return all.reduce((best, x) => (value(x) > value(best) + 1e-12 ? x : best));
}

function betterForBoth(all: Scored[], offer: Scored): Scored | null {
  let best: Scored | null = null;
  for (const x of all) {
    const dominates = x.a >= offer.a - 1e-12 && x.b >= offer.b - 1e-12 && x.a + x.b > offer.a + offer.b + 0.01;
    if (dominates && (!best || x.a + x.b > best.a + best.b)) best = x;
  }
  return best;
}

export interface Timed {
  at: number;
  event: StreamEvent;
}

interface TimelineInput {
  mode: Mode;
  names: Names;
  location: string;
  sides: Record<Side, SideInput>;
  alphaA: number;
  doneBefore: number;
  brain: 'claude' | 'rules';
  ledgerAfter: (concession: Record<Side, number>) => Extract<StreamEvent, { type: 'ledger' }>;
}

/** The whole truce, with each event's delay from the start in ms. */
export function buildTimeline(input: TimelineInput): { timeline: Timed[]; result: TruceResult } {
  const { names, sides, alphaA, brain } = input;
  const script = scriptFor(input.doneBefore);
  const pool = buildPool(sides, input.location);
  const { score, all } = scorer(pool.items, sides);
  const idOf = (slot: Slot, name: string) => pool.items[slot].find((i) => i.name === name)!.id;
  const bundleOf = (p: Pick): Bundle => ({ film: idOf('film', p[0]), restaurant: idOf('restaurant', p[1]), music: idOf('music', p[2]) });

  const timeline: Timed[] = [];
  let at = 0;
  const push = (delay: number, event: StreamEvent) => {
    at += delay;
    timeline.push({ at, event });
  };

  push(0, { type: 'status', phase: 'scouting', brain });
  push(4000, { type: 'pool', items: pool.items, indifferent: pool.indifferent });
  push(150, { type: 'status', phase: 'negotiating', brain });
  push(250, { type: 'start', opener: script.opener, turns: 6, alphaA });

  let onTable: Bundle | null = null;
  let agreed: Bundle | null = null;
  for (const [i, t] of script.turns.entries()) {
    const turn = i + 1;
    push(350, { type: 'thinking', side: t.side, turn });
    let moveBrain: string = brain;
    if (t.struck) {
      push(1300, { type: 'rejected', turn, side: t.side, reason: t.struck(names) });
      moveBrain = 'rules';
    }
    const delay = t.struck ? 1100 : 1900;
    if (t.action === 'decline') {
      push(delay, { type: 'declined', turn, side: t.side, message: t.say(names), brain: moveBrain });
      continue;
    }
    const bundle: Bundle = t.action === 'accept' ? onTable! : bundleOf(t.pick!);
    push(delay, {
      type: 'move',
      turn,
      side: t.side,
      action: t.action,
      bundle,
      message: t.say(names),
      scores: { a: Math.round(score('a', bundle) * 100), b: Math.round(score('b', bundle) * 100) },
      evidence: SLOTS.map((slot) => ({
        slot,
        itemId: bundle[slot],
        because: pool.items[slot].find((x) => x.id === bundle[slot])?.because[t.side] ?? [],
      })),
      brain: moveBrain,
    });
    if (t.action === 'accept') {
      agreed = bundle;
      push(80, { type: 'agreement', turn, bundle });
    }
    onTable = bundle;
  }

  const fair = nash(all, alphaA);
  let final: Bundle = agreed ?? fair.bundle;
  if (!agreed) push(900, { type: 'ruling', bundle: final });
  const current = all.find((x) => same(x.bundle, final))!;
  const better = betterForBoth(all, current);
  if (better) {
    push(1000, { type: 'polish', from: final, to: better.bundle });
    final = better.bundle;
  }
  const scored = all.find((x) => same(x.bundle, final))!;
  const best = { a: Math.max(...all.map((x) => x.a)), b: Math.max(...all.map((x) => x.b)) };
  const result: TruceResult = {
    bundle: final,
    how: agreed ? 'agreed' : 'ruled',
    polished: Boolean(better),
    turnsUsed: script.turns.length,
    utilities: { a: scored.a, b: scored.b },
    best,
    concession: { a: Math.max(0, best.a - scored.a), b: Math.max(0, best.b - scored.b) },
    fair,
  };
  push(700, { type: 'done', result });
  push(500, input.ledgerAfter(result.concession));
  return { timeline, result };
}
