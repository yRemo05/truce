/**
 * What the landing shows: the couple demo's recorded run (GET /api/showcase/couple),
 * or, when there's none yet or the server can't be reached, a synthetic one in
 * the style of the old landing specimen: public titles, an invented restaurant,
 * invented scores, no pictures (the Thumb-style stand-ins fill in). Never Qloo data.
 */
import type { CardItem, PerSide, ShowcaseView, Side, Slot } from '@contract';
import { useEffect, useState } from 'react';
import { api } from '@/api';
import { monograms, type Names } from '@/lib/people';
import type { TruceCtx } from '@/truce/context';

export type PoolItem = ShowcaseView['pool'][Slot][number];

export interface Story {
  /** True when it's the recorded run; false for the synthetic stand-in, which the page says is an example. */
  real: boolean;
  members: Side[];
  names: Names;
  letters: Names;
  location: string;
  how: ShowcaseView['how'];
  plan: Record<Slot, CardItem>;
  pool: ShowcaseView['pool'];
  moves: ShowcaseView['moves'];
}

const item = (id: string, slot: Slot, name: string, disambiguation: string, scores: PerSide<number>, because: PerSide<string[]> = {}): CardItem => ({
  id,
  slot,
  name,
  disambiguation,
  imageUrl: null,
  blurb: null,
  facts: {},
  scores,
  origins: ['joint'],
  because,
  scout: null,
  links: [],
  hours: null,
  address: null,
  serves: {},
  venue: null,
});

const pooled = (slot: Slot, name: string, disambiguation: string, a: number, b: number): PoolItem => ({ slot, name, disambiguation, imageUrl: null, scores: { a, b } });

const SYNTHETIC: Omit<Story, 'letters'> = {
  real: false,
  members: ['a', 'b'],
  names: { a: 'Maya', b: 'Deniz' },
  location: 'Manhattan',
  how: 'agreed',
  plan: {
    film: item('x-film', 'film', 'Paddington 2', '2017', { a: 84, b: 71 }, { a: ['Lost in Translation'], b: ['John Wick'] }),
    restaurant: item('x-place', 'restaurant', 'Noodle House No. 9', 'East Village', { a: 91, b: 74 }, { a: ['In the Mood for Love', 'Radiohead'], b: ['Mad Max: Fury Road'] }),
    music: item('x-music', 'music', 'Khruangbin', 'Texan instrumental trio', { a: 80, b: 88 }, { a: ['Radiohead'], b: ['Bad Bunny'] }),
  },
  pool: {
    film: [
      pooled('film', 'Chungking Express', '1994', 97, 9),
      pooled('film', 'Paterson', '2016', 88, 31),
      pooled('film', 'Paddington 2', '2017', 84, 71),
      pooled('film', 'Baby Driver', '2017', 38, 93),
      pooled('film', 'The Raid', '2011', 6, 99),
    ],
    restaurant: [],
    music: [],
  },
  moves: [
    { side: 'a', action: 'counter', message: 'Chungking Express is gentle and a little melancholy, and Noodle House No. 9 does the ramen Maya loves. Khruangbin keeps it unhurried.' },
    { side: 'b', action: 'counter', message: 'Baby Driver has the pace Deniz wants, and it still fits a cosy night in. Keeping the ramen and Khruangbin.' },
    { side: 'a', action: 'counter', message: 'Paddington 2 is warm and funny, a bridge that suits both of them. Same ramen, same Khruangbin.' },
    { side: 'b', action: 'accept', message: 'Paddington 2 has enough action for Deniz and nothing on this plan is pricey. Deniz can say yes to that.' },
  ],
};

const withLetters = (s: Omit<Story, 'letters'>): Story => ({ ...s, letters: monograms(s.names, s.members) });

export const syntheticStory = withLetters(SYNTHETIC);

/** The recorded run, or the synthetic one when there's none; null while it loads. */
export function useStory(): Story | null {
  const [story, setStory] = useState<Story | null>(null);
  useEffect(() => {
    let live = true;
    api.showcase('couple').then(
      (v) => live && setStory(withLetters({ real: true, members: v.members, names: v.names, location: v.location, how: v.how, plan: v.plan, pool: v.pool, moves: v.moves })),
      () => live && setStory(syntheticStory),
    );
    return () => {
      live = false;
    };
  }, []);
  return story;
}

/** The truce context the app's own components (ScoreRow, Venue, Hours…) read, over the story's plan. */
export const ctxOf = (s: Story): TruceCtx => ({
  members: s.members,
  mine: null,
  names: s.names,
  letters: s.letters,
  location: s.location,
  items: Object.fromEntries(Object.values(s.plan).map((i) => [i.id, i])),
  turns: 9,
  brain: 'claude',
});

/**
 * Five of the pool's films ordered from the first person's taste to the
 * second's, with the one both score highest (the best worst score) marked:
 * the "same shortlist, two tastes" picture.
 */
export function spectrum(pool: readonly PoolItem[], [a, b]: [Side, Side]): { rows: PoolItem[]; bridge: PoolItem | null } {
  const s = (i: PoolItem, side: Side) => i.scores[side] ?? 0;
  const lean = (i: PoolItem) => s(i, a) - s(i, b);
  const bridge = [...pool].sort((x, y) => Math.min(s(y, a), s(y, b)) - Math.min(s(x, a), s(x, b)) || s(y, a) + s(y, b) - (s(x, a) + s(x, b)))[0] ?? null;
  const rest = pool.filter((i) => i !== bridge).sort((x, y) => lean(y) - lean(x));
  const rows = [...rest.slice(0, 2), ...(bridge ? [bridge] : []), ...rest.slice(2).slice(-2)].sort((x, y) => lean(y) - lean(x));
  return { rows, bridge };
}
