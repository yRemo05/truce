/**
 * The sample message on the landing page: one move from the friends demo
 * (Ada, Kerem and Lina in Istanbul). Public titles, an invented restaurant,
 * invented scores; not Qloo data.
 */
import type { CardItem, PerSide } from '@contract';
import type { MoveEvent } from '@/lib/truce';
import type { TruceCtx } from './context';

const card = (id: string, slot: CardItem['slot'], name: string, disambiguation: string | null, scores: PerSide<number>, because: PerSide<string[]>): CardItem => ({
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
});

const items = [
  card('s-film', 'film', 'Paddington 2', '2017', { a: 80, b: 62, c: 98 }, { a: ['Amélie'], b: ['Inception'], c: ['Spirited Away'] }),
  card('s-place', 'restaurant', 'Cihangir Sofrası', 'Cihangir, Istanbul', { a: 93, b: 76, c: 78 }, { a: ['Kuzguncuk Bostan'], b: ['Etçi Mehmet'], c: ['Karaköy Lokanta Evi'] }),
  card('s-music', 'music', 'Khruangbin', 'Texan instrumental trio', { a: 86, b: 78, c: 90 }, { a: ['Norah Jones'], b: ['Duman'], c: ['Tame Impala'] }),
];

export const specimenCtx: TruceCtx = {
  members: ['a', 'b', 'c'],
  names: { a: 'Ada', b: 'Kerem', c: 'Lina' },
  letters: { a: 'A', b: 'K', c: 'L' },
  location: 'Istanbul',
  items: Object.fromEntries(items.map((i) => [i.id, i])),
  turns: 9,
  brain: 'claude',
};

export const specimenMove: MoveEvent = {
  type: 'move',
  turn: 8,
  side: 'b',
  action: 'accept',
  bundle: { film: 's-film', restaurant: 's-place', music: 's-music' },
  message: 'Cihangir Sofrası has a charcoal grill, and nothing on this plan breaks the bank. Kerem can say yes to that. Over to Lina’s agent.',
  scores: { a: 86, b: 73, c: 91 },
  evidence: [],
  brain: 'claude',
  acceptedBy: ['a', 'b'],
  shortlisted: false,
};
