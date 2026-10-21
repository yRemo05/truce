/**
 * The ready-made groups behind "Try the demo": tastes far enough apart to
 * make a real negotiation, a brief each, and a made-up earlier evening or two
 * so the ledger has a history to show (marked as such everywhere it appears).
 *
 * Their favourites and briefs are resolved once (warmed at boot, then kept),
 * so starting a demo is instant.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { groundBrief, readBrief, type InterpretedBrief } from '../agents/brief';
import type { DemoInput, PairInput, Seed, SideInput } from '../contract';
import type { QlooClient } from '../qloo/client';
import { locate, searchEntities } from '../qloo/queries';
import type { TruceResult } from '../truce/negotiate';
import { KIND_OF_SLOT, SLOTS, membersOf, perSide, type Slot } from '../truce/types';
import { normalizeWeights } from '../truce/utility';
import type { Store } from './db';
import { newId } from './runner';

interface DemoPerson {
  loves: Record<Slot, string[]>;
  weights: Record<Slot, number>;
  brief: string;
}

interface Earlier {
  daysAgo: number;
  evening: Record<Slot, string>;
  /** Per person in seat order: their best evening then, and what they got (0–1). */
  best: number[];
  got: number[];
}

interface DemoGroup {
  pair: PairInput;
  people: DemoPerson[];
  earlier: Earlier[];
}

export const DEMOS: Record<DemoInput['kind'], DemoGroup> = {
  couple: {
    pair: { mode: 'couple', names: ['Maya', 'Deniz'], location: 'Manhattan' },
    people: [
      {
        loves: { film: ['In the Mood for Love', 'Lost in Translation'], restaurant: ['Carbone New York'], music: ['Radiohead'] },
        weights: { film: 50, restaurant: 25, music: 25 },
        brief: "Something cosy tonight. I've already seen Past Lives.",
      },
      {
        loves: { film: ['Mad Max: Fury Road', 'John Wick'], restaurant: ['Shake Shack Madison Square Park'], music: ['Bad Bunny'] },
        weights: { film: 25, restaurant: 50, music: 25 },
        brief: 'No horror please, and nothing too pricey.',
      },
    ],
    // Two evenings that went Deniz's way, so the ledger starts out owing Maya.
    earlier: [
      { daysAgo: 14, evening: { film: 'Top Gun: Maverick', restaurant: "Joe's Pizza", music: 'Daft Punk' }, best: [0.9, 0.88], got: [0.52, 0.83] },
      { daysAgo: 7, evening: { film: 'Dune: Part Two', restaurant: "Katz's Delicatessen", music: 'The Weeknd' }, best: [0.86, 0.9], got: [0.6, 0.81] },
    ],
  },
  friends: {
    pair: { mode: 'bff', names: ['Ada', 'Kerem', 'Lina'], location: 'Istanbul' },
    people: [
      {
        loves: { film: ['Amélie', 'Before Sunrise'], restaurant: ['Çiya Sofrası'], music: ['Norah Jones'] },
        weights: { film: 40, restaurant: 40, music: 20 },
        brief: 'Vegetarian options, please.',
      },
      {
        loves: { film: ['The Dark Knight', 'Inception'], restaurant: ['Nusr-Et Steakhouse'], music: ['Duman'] },
        weights: { film: 30, restaurant: 30, music: 40 },
        brief: 'Nothing too pricey this week.',
      },
      {
        loves: { film: ['Spirited Away', 'Everything Everywhere All at Once'], restaurant: ['Karaköy Lokantası'], music: ['Tame Impala'] },
        weights: { film: 50, restaurant: 25, music: 25 },
        brief: 'No horror, I want to laugh.',
      },
    ],
    // One evening that went against Lina.
    earlier: [
      { daysAgo: 6, evening: { film: 'Oppenheimer', restaurant: 'Nusr-Et Steakhouse', music: 'Duman' }, best: [0.85, 0.9, 0.88], got: [0.7, 0.88, 0.55] },
    ],
  },
};

interface Resolved {
  seeds: Record<Slot, Seed[]>[];
  briefs: (InterpretedBrief | null)[];
}

export function createDemos(qloo: QlooClient, anthropic: Anthropic | null) {
  const resolved = new Map<DemoInput['kind'], Promise<Resolved>>();

  const resolve = (kind: DemoInput['kind']) => {
    let ready = resolved.get(kind);
    if (!ready) {
      const group = DEMOS[kind];
      ready = (async (): Promise<Resolved> => {
        const near = await locate(qloo, group.pair.location);
        const seeds = await Promise.all(
          group.people.map(async (p) => {
            const out = { film: [], restaurant: [], music: [] } as Record<Slot, Seed[]>;
            for (const slot of SLOTS) {
              for (const title of p.loves[slot]) {
                const kindOf = KIND_OF_SLOT[slot];
                const [top] = await searchEntities(qloo, title, kindOf, 1, kindOf === 'place' && near ? near : undefined);
                if (top) out[slot].push({ id: top.id, name: top.name });
              }
            }
            return out;
          }),
        );
        const briefs = await Promise.all(
          group.people.map(async (p) => {
            if (!anthropic) return null;
            const intent = await readBrief(anthropic, p.brief);
            return groundBrief(qloo, p.brief, intent, near);
          }),
        );
        return { seeds, briefs };
      })().catch((err) => {
        resolved.delete(kind); // try again on the next request
        throw err;
      });
      resolved.set(kind, ready);
    }
    return ready;
  };

  return {
    /** Starts resolving every demo in the background. */
    warm() {
      for (const kind of Object.keys(DEMOS) as DemoInput['kind'][]) {
        void resolve(kind).catch((err) => console.warn(`demo "${kind}" not ready: ${(err as Error).message}`));
      }
    },

    /** Creates a fresh demo group with its earlier evenings; returns its id. */
    async create(store: Store, kind: DemoInput['kind']): Promise<string> {
      const group = DEMOS[kind];
      const { seeds, briefs } = await resolve(kind);
      const pairId = newId();
      store.createPair(pairId, group.pair);
      const members = membersOf(group.people.length);
      members.forEach((side, i) => {
        const p = group.people[i]!;
        const input: SideInput = { seeds: seeds[i]!, weights: p.weights, brief: p.brief };
        store.saveSide(pairId, side, input, briefs[i] ?? null);
      });
      const even = perSide(members, () => 1 / members.length);
      group.earlier.forEach((e, k) => {
        const result: TruceResult = {
          bundle: { film: `earlier-${k}-film`, restaurant: `earlier-${k}-restaurant`, music: `earlier-${k}-music` },
          how: 'agreed',
          polished: false,
          turnsUsed: 2 * members.length,
          utilities: perSide(members, (s) => e.got[members.indexOf(s)]!),
          best: perSide(members, (s) => e.best[members.indexOf(s)]!),
          concession: perSide(members, (s) => Math.max(0, e.best[members.indexOf(s)]! - e.got[members.indexOf(s)]!)),
          items: perSide(members, (s) => Object.fromEntries(SLOTS.map((slot) => [slot, e.got[members.indexOf(s)]!])) as Record<Slot, number>),
          weights: perSide(members, (s) => normalizeWeights(group.people[members.indexOf(s)]!.weights)),
          fair: { bundle: { film: '', restaurant: '', music: '' }, u: perSide(members, (s) => e.got[members.indexOf(s)]!) },
        };
        const at = new Date(Date.now() - e.daysAgo * 86_400_000).toISOString();
        store.createEarlier(newId(), pairId, even, members[k % members.length]!, result, e.evening, at);
      });
      return pairId;
    },
  };
}
