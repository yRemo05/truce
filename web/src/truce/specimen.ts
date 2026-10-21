/**
 * The sample move on the landing page, which teaches how to read a truce.
 * Public titles, invented scores; not Qloo data.
 */
import type { CardItem } from '@contract';
import type { MoveEvent } from '@/lib/truce';
import type { TruceCtx } from './context';

const card = (id: string, slot: CardItem['slot'], name: string, disambiguation: string | null, scores: [number, number], because: [string[], string[]], facts: Record<string, string> = {}): CardItem => ({
  id,
  slot,
  name,
  disambiguation,
  imageUrl: null,
  blurb: null,
  facts,
  scores: { a: scores[0], b: scores[1] },
  origins: ['joint'],
  because: { a: because[0], b: because[1] },
});

const items = [
  card('s-film', 'film', 'Drive', '2011', [78, 84], [['Lost in Translation (64%)', 'In the Mood for Love (21%)'], ['John Wick (58%)', 'Mad Max: Fury Road (30%)']]),
  card('s-place', 'restaurant', 'Kisa Izakaya', '12 Bond St, New York', [66, 86], [['Trattoria Sole (52%)', 'Lost in Translation (25%)'], ['Patty Wagon (61%)', 'Bad Bunny (22%)']], { neighborhood: 'NoHo' }),
  card('s-music', 'music', 'Khruangbin', 'Texan instrumental trio', [86, 78], [['Radiohead (57%)', 'In the Mood for Love (24%)'], ['Bad Bunny (49%)', 'Mad Max: Fury Road (28%)']]),
];

export const specimenCtx: TruceCtx = {
  names: { a: 'Maya', b: 'Deniz' },
  letters: { a: 'M', b: 'D' },
  location: 'Manhattan',
  items: Object.fromEntries(items.map((i) => [i.id, i])),
  turns: 6,
  brain: 'claude',
};

export const specimenMove: MoveEvent = {
  type: 'move',
  turn: 6,
  side: 'b',
  action: 'counter',
  bundle: { film: 's-film', restaurant: 's-place', music: 's-music' },
  message: 'Drive, done. But Kisa over Brass Lantern, and Khruangbin over Frank Ocean. That’s Deniz’s last offer.',
  scores: { a: 77, b: 84 },
  evidence: [],
  brain: 'claude',
};
