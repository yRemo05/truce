/**
 * A whole truce for the mock, replayed through the real StreamEvent shapes:
 * gathering, each agent's scouting, the pool, the turns and the ending.
 *
 * Everyone gets a made-up taste by seat (four archetypes, invented scores),
 * so a couple or a group of four in any city gets a pool where people pull
 * in different directions. The agents follow a simple rule: say yes when the
 * offer on the table clears what you'd settle for by now, otherwise counter
 * with the fairest evening that still does; what each person settles for
 * falls from their best evening toward the fair one over their three moves.
 * A "hardline" truce falls only halfway, so it ends in Truce's call.
 * Briefs count: vetoes keep things out of the pool, wishes show up in what
 * the agents say. Every number on screen comes out of the same sums.
 */
import type { BriefView, CardItem, Link, Mode, PerSide, ScoutFind, Side, SideInput, Slot, StreamEvent, Tonight, TruceResult } from '@contract';
import { agentOf, listNames, perSide, possessive, type Names } from '@/lib/people';
import { bySlot, SLOTS, type Bundle } from '@/lib/truce';
import { vetoLabel } from './brief';
import { byName, hashOf } from './catalog';

type Arch = [number, number, number, number];

/** Invented scores for the four archetypes: romantic, high-octane, whimsical, moody. */
const FILMS: [string, Arch][] = [
  ['Chungking Express', [100, 31, 70, 85]],
  ['Drive', [88, 84, 55, 90]],
  ['The Raid', [0, 100, 20, 45]],
  ['Past Lives', [91, 9, 60, 70]],
  ['Baby Driver', [61, 92, 75, 60]],
  ['Arrival', [83, 70, 62, 95]],
  ['Portrait of a Lady on Fire', [96, 0, 50, 80]],
  ['The Grand Budapest Hotel', [80, 45, 92, 70]],
  ['Moonrise Kingdom', [85, 20, 88, 55]],
];

const MUSIC: [string, Arch][] = [
  ['Massive Attack', [100, 40, 55, 90]],
  ['Rosalía', [70, 89, 75, 60]],
  ['Burna Boy', [18, 100, 60, 40]],
  ['Khruangbin', [86, 78, 90, 80]],
  ['Frank Ocean', [90, 80, 70, 85]],
  ['Björk', [95, 0, 70, 75]],
  ['Rauw Alejandro', [0, 97, 40, 30]],
  ['The xx', [92, 21, 65, 88]],
  ['Fleetwood Mac', [72, 60, 82, 65]],
];

type City = 'manhattan' | 'istanbul';

const RESTAURANTS: Record<City, [string, Arch][]> = {
  manhattan: [
    ['Osteria Lume', [100, 12, 60, 70]],
    ['Kisa Izakaya', [66, 86, 80, 75]],
    ['Smokehouse 41', [6, 100, 40, 30]],
    ['Brass Lantern Noodle Bar', [81, 77, 85, 60]],
    ['Café Meridian', [88, 25, 55, 80]],
    ['Neon Taquería', [35, 94, 70, 40]],
    ['Ostra & Pine', [93, 0, 40, 85]],
    ['Golden Hour Diner', [0, 86, 65, 20]],
    ['Dumpling Society', [55, 70, 90, 50]],
  ],
  istanbul: [
    ['Yeşil Masa', [96, 18, 64, 60]],
    ['Moda İskele Meyhanesi', [74, 80, 72, 70]],
    ['Ocakbaşı Kömür', [10, 98, 52, 60]],
    ['Galata Mantı Evi', [60, 66, 90, 55]],
    ['Bostan Sofrası', [90, 35, 58, 60]],
    ['Mangal House', [22, 92, 60, 50]],
    ['Balat Kahvaltı Evi', [70, 40, 94, 60]],
    ['Tünel Pide Salonu', [62, 78, 76, 50]],
    ['Nişantaşı Steak Club', [5, 100, 30, 40]],
  ],
};

/** Listed hours that don't cover the evening, so the plan's warning has something to show. */
const CLOSED_TONIGHT = new Set(['Smokehouse 41', 'Ocakbaşı Kömür']);

const PORTRAITS: string[][] = [
  ['romantic', 'slow-burn', 'candlelit'],
  ['high-octane', 'crowd-pleasing', 'loud'],
  ['whimsical', 'playful', 'warm'],
  ['moody', 'cerebral', 'late-night'],
];

const FLAVOUR = ['Slow, warm, a little romantic.', 'Big, loud, no small talk.', 'Something to laugh at, then somewhere fun.', 'Moody, and out late.'];

interface Who {
  name: string;
  /** Everyone else's names. */
  others: string[];
}

interface ScoutPlan {
  slot: Slot;
  item: string;
  scores: Arch;
  words: string[];
  matched: string[];
  /** Restaurants: the group's taste hotspot. */
  area: string | null;
  /** Other things the search turned up. */
  found: string[];
  why: (w: Who) => string;
  done: (w: Who) => string;
}

/** What each seat's agent finds while scouting, per city. */
const SCOUTS: Record<City, ScoutPlan[]> = {
  manhattan: [
    {
      slot: 'restaurant',
      item: 'Lantern & Lark',
      scores: [92, 74, 70, 65],
      words: ['cosy'],
      matched: ['Cozy'],
      area: 'West Village',
      found: ['Osteria Lume', 'Café Meridian', 'Trattoria Sole', 'Kisa Izakaya'],
      why: (w) => `Cosy and candlelit for ${w.name}, with a burger on the menu for ${w.others[0]}.`,
      done: (w) => `I found ${w.name} somewhere cosy that ${listNames(w.others)} won’t mind: Lantern & Lark.`,
    },
    {
      slot: 'film',
      item: 'Top Gun: Maverick',
      scores: [55, 96, 60, 40],
      words: ['high-octane'],
      matched: ['Action'],
      area: null,
      found: ['Edge of Tomorrow', 'Heat', 'The Raid'],
      why: (w) => `Big and loud for ${w.name}, with enough heart for ${listNames(w.others)}.`,
      done: (w) => `Top Gun: Maverick is on the table. ${w.name} gets the jets, everyone gets a story.`,
    },
    {
      slot: 'film',
      item: 'Paddington 2',
      scores: [80, 62, 98, 50],
      words: ['funny'],
      matched: ['Comedy'],
      area: null,
      found: ['The Grand Budapest Hotel', 'Ratatouille', 'Moonrise Kingdom'],
      why: (w) => `Gentle and funny: an easy yes for ${w.name} and the group.`,
      done: () => 'I added Paddington 2. Nobody has ever said no to Paddington.',
    },
    {
      slot: 'music',
      item: 'Daft Punk',
      scores: [55, 95, 85, 60],
      words: ['danceable'],
      matched: ['Dance'],
      area: null,
      found: ['LCD Soundsystem', 'Khruangbin', 'Rosalía'],
      why: () => 'Something everyone can dance to after dinner.',
      done: () => 'Daft Punk for after dinner, so the evening ends on a high.',
    },
  ],
  istanbul: [
    {
      slot: 'restaurant',
      item: 'Cihangir Sofrası',
      scores: [93, 76, 78, 60],
      words: ['vegetarian', 'cosy'],
      matched: ['Vegetarian friendly', 'Cozy'],
      area: 'Cihangir',
      found: ['Yeşil Masa', 'Bostan Sofrası', 'Karaköy Lokanta Evi', 'Galata Mantı Evi', 'Tünel Pide Salonu'],
      why: (w) => `Vegetable mezze for ${w.name} and a charcoal grill for ${w.others[0]}.`,
      done: (w) => `Cihangir Sofrası is my find: vegetarian plates for ${w.name}, a grill for ${listNames(w.others)}.`,
    },
    {
      slot: 'music',
      item: 'Daft Punk',
      scores: [55, 95, 85, 60],
      words: ['energetic'],
      matched: ['Dance'],
      area: null,
      found: ['Duman', 'LCD Soundsystem', 'Burna Boy'],
      why: (w) => `Loud enough for ${w.name}, fun enough for everyone.`,
      done: (w) => `Daft Punk is on the table. ${w.name} wants volume; this way everyone dances.`,
    },
    {
      slot: 'film',
      item: 'Paddington 2',
      scores: [80, 62, 98, 50],
      words: ['funny'],
      matched: ['Comedy'],
      area: null,
      found: ['The Grand Budapest Hotel', 'Ratatouille', 'Amélie'],
      why: (w) => `${w.name} wants to laugh tonight, and a bear in prison is hard to argue with.`,
      done: (w) => `${w.name} asked for a laugh, so I brought Paddington 2.`,
    },
    {
      slot: 'film',
      item: 'Top Gun: Maverick',
      scores: [55, 96, 60, 40],
      words: ['high-octane'],
      matched: ['Action'],
      area: null,
      found: ['Heat', 'Inception', 'The Dark Knight'],
      why: (w) => `Big and loud for ${w.name}, with enough heart for ${listNames(w.others)}.`,
      done: () => 'Top Gun: Maverick is on the table, for the action fans.',
    },
  ],
};

const cityOf = (location: string): City => (/istanbul|i̇stanbul|kad[iı]k[oö]y|beyo[gğ]lu|cihangir/i.test(location) ? 'istanbul' : 'manhattan');

const TIME_ZONE: [RegExp, string][] = [
  [/istanbul|i̇stanbul/i, 'Europe/Istanbul'],
  [/london/i, 'Europe/London'],
  [/paris/i, 'Europe/Paris'],
  [/manhattan|brooklyn|new york|queens/i, 'America/New_York'],
];

export function tonightIn(location: string, now = new Date()): Tonight {
  const timeZone = TIME_ZONE.find(([re]) => re.test(location))?.[1] ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long' }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, weekday: part('weekday').toLowerCase(), timeZone };
}

const enc = encodeURIComponent;

function linksFor(slot: Slot, name: string, address: string | null, nyc: boolean): Link[] {
  if (slot === 'film')
    return [
      { kind: 'imdb', label: 'IMDb', url: `https://www.imdb.com/find/?q=${enc(name)}` },
      { kind: 'letterboxd', label: 'Letterboxd', url: `https://letterboxd.com/search/${enc(name)}/` },
    ];
  if (slot === 'music') return [{ kind: 'spotify', label: 'Spotify', url: `https://open.spotify.com/search/${enc(name)}` }];
  const links: Link[] = [{ kind: 'maps', label: 'Map', url: `https://www.google.com/maps/search/?api=1&query=${enc([name, address].filter(Boolean).join(', '))}` }];
  // 555-01xx numbers are reserved for fiction.
  if (nyc) links.push({ kind: 'phone', label: 'Call', url: `tel:+1212555${String(100 + (hashOf(name) % 100)).padStart(4, '0')}` });
  return links;
}

const HOURS = ['17:00–23:30', '12:00–00:00', '18:00–01:00', '11:30–23:00'];

function hoursFor(name: string): CardItem['hours'] {
  if (CLOSED_TONIGHT.has(name)) return { today: '11:00–16:00', openTonight: false };
  return { today: HOURS[hashOf(name) % HOURS.length]!, openTonight: true };
}

/** Qloo-style "because" lines: the person's own favourites that drive a score, strongest first. */
function becauseLines(seeds: Record<Slot, string[]>, slot: Slot, itemName: string): string[] {
  const own = seeds[slot];
  const ordered = [...own, ...SLOTS.filter((s) => s !== slot).flatMap((s) => seeds[s])];
  if (!ordered.length) return [];
  const h = hashOf(`${slot}:${itemName}:${ordered.join()}`);
  const first = ordered[h % Math.max(own.length, 1)] ?? ordered[0]!;
  const second = ordered.find((n) => n !== first);
  if (!second) return [`${first} (100%)`];
  const lead = 46 + (h % 30);
  return [`${first} (${lead}%)`, `${second} (${Math.round((100 - lead) * 0.7)}%)`];
}

interface Row {
  slot: Slot;
  name: string;
  scores: Arch;
  scout: { side: Side; why: string } | null;
}

function vetoed(row: { slot: Slot; name: string }, briefs: PerSide<BriefView | null>, members: readonly Side[]): boolean {
  const e = byName(row.slot, row.name);
  return members.some((s) =>
    (briefs[s]?.vetoes ?? []).some((v) => {
      if (v.kind === 'price') return row.slot === 'restaurant' && (e.facts.price?.length ?? 0) > v.matched.replace(/[^$]/g, '').length;
      if (v.kind === 'title') return row.slot === 'film' && v.matched.startsWith(e.name);
      return v.slot === row.slot && (e.facts.genres ?? '').toLowerCase().includes(v.matched.toLowerCase());
    }),
  );
}

interface Scored {
  bundle: Bundle;
  u: PerSide<number>;
}

export interface Timed {
  at: number;
  event: StreamEvent;
}

interface TimelineInput {
  mode: Mode;
  members: Side[];
  names: Names;
  location: string;
  sides: PerSide<SideInput>;
  briefs: PerSide<BriefView | null>;
  alpha: PerSide<number>;
  opener: Side;
  /** A hardline truce never reaches a deal, so the referee rules. */
  variant: 'deal' | 'hardline';
  /** The turn whose first try the referee strikes, if any. */
  strikeAt: number | null;
  brain: 'claude' | 'rules';
  ledgerAfter: (concession: PerSide<number>) => Extract<StreamEvent, { type: 'ledger' }>;
}

const MOVES_PER_PERSON = 3;

const get = <T>(m: PerSide<T>, s: Side): T => m[s] as T;

function normalize(w: SideInput['weights']): Record<Slot, number> {
  const total = SLOTS.reduce((t, s) => t + Math.max(0, w[s]), 0);
  return bySlot((s) => (total > 0 ? Math.max(0, w[s]) / total : 1 / 3));
}

/** The whole truce, with each event's delay from the start in ms. */
export function buildTimeline(input: TimelineInput): { timeline: Timed[]; result: TruceResult; items: Record<Slot, CardItem[]> } {
  const { members, names, sides, briefs, alpha, brain } = input;
  const n = members.length;
  const city = cityOf(input.location);
  const name = (s: Side) => names[s] ?? '';
  const who = (s: Side): Who => ({ name: name(s), others: members.filter((o) => o !== s).map(name) });
  const seat = (s: Side) => members.indexOf(s);
  const seeds = perSide(members, (s) => bySlot((slot) => get(sides, s).seeds[slot].map((x) => x.name)));

  const timeline: Timed[] = [];
  let at = 0;
  const push = (delay: number, event: StreamEvent) => {
    at += delay;
    timeline.push({ at, event });
  };

  // Gathering: everyone's tastes, and the vetoes everyone's briefs put in place.
  push(0, { type: 'status', phase: 'gathering', brain });
  const vetoes = [...new Set(members.flatMap((s) => (briefs[s]?.vetoes ?? []).map(vetoLabel)))];
  push(2400, { type: 'tastes', portraits: perSide(members, (s) => PORTRAITS[seat(s)]!), vetoes });

  // Scouting: each agent searches once and adds one find, interleaved as they run at the same time.
  const base: Row[] = [
    ...FILMS.map(([nm, scores]): Row => ({ slot: 'film', name: nm, scores, scout: null })),
    ...RESTAURANTS[city].map(([nm, scores]): Row => ({ slot: 'restaurant', name: nm, scores, scout: null })),
    ...MUSIC.map(([nm, scores]): Row => ({ slot: 'music', name: nm, scores, scout: null })),
  ].filter((r) => !vetoed(r, briefs, members) && !members.some((s) => seeds[s]?.[r.slot].includes(r.name)));
  // Scouting needs the model: a rule-based truce goes straight from tastes to the pool.
  const plans =
    brain === 'rules'
      ? []
      : members.map((s) => ({ side: s, plan: SCOUTS[city][seat(s)]! })).filter(({ plan }) => !vetoed({ slot: plan.slot, name: plan.item }, briefs, members));

  if (plans.length) push(300, { type: 'status', phase: 'scouting', brain });
  for (const { side } of plans) push(250, { type: 'scout', side, step: 'start' });
  const find = (slot: Slot, nm: string): ScoutFind => {
    const e = byName(slot, nm);
    return { id: e.id, name: e.name, imageUrl: e.imageUrl, disambiguation: e.disambiguation };
  };
  for (const { side, plan } of plans) {
    const own = seeds[side]?.[plan.slot] ?? [];
    push(1100, {
      type: 'scout',
      side,
      step: 'search',
      slot: plan.slot,
      like: own.length ? own.slice(0, 2) : (seeds[side]?.film.slice(0, 1) ?? []),
      words: plan.words,
      matched: plan.matched,
      area: plan.area,
      found: [plan.item, ...plan.found].slice(0, 5).map((nm) => find(plan.slot, nm)),
    });
  }
  const scouted: Row[] = [];
  for (const { side, plan } of plans) {
    const why = plan.why(who(side));
    push(900, { type: 'scout', side, step: 'add', slot: plan.slot, item: find(plan.slot, plan.item), why });
    scouted.push({ slot: plan.slot, name: plan.item, scores: plan.scores, scout: { side, why } });
  }
  for (const { side, plan } of plans) push(500, { type: 'scout', side, step: 'done', message: plan.done(who(side)) });

  // The pool, scored for everyone and frozen before the talks.
  const indifferent = perSide(members, (s) => bySlot((slot) => get(sides, s).seeds[slot].length === 0));
  const card = (row: Row): CardItem => {
    const e = byName(row.slot, row.name);
    const scores = perSide(members, (s) => (get(indifferent, s)[row.slot] ? 50 : row.scores[seat(s)]!));
    const values = members.map((s) => get(scores, s));
    const fans = members.filter((s) => get(scores, s) >= 88);
    const origins: CardItem['origins'] = row.scout ? ['scout'] : Math.min(...values) >= 62 || !fans.length ? ['joint', ...fans] : fans;
    const restaurant = row.slot === 'restaurant';
    const address = restaurant ? e.disambiguation : null;
    return {
      id: e.id,
      slot: row.slot,
      name: e.name,
      disambiguation: restaurant ? e.facts.neighborhood ?? null : e.disambiguation,
      imageUrl: e.imageUrl,
      blurb: e.blurb,
      facts: e.facts,
      scores,
      origins,
      because: perSide(members, (s) => becauseLines(get(seeds, s), row.slot, e.name)),
      scout: row.scout,
      links: linksFor(row.slot, e.name, address, city === 'manhattan'),
      hours: restaurant ? hoursFor(e.name) : null,
      address,
    };
  };
  const rows = [...base, ...scouted];
  const items = bySlot((slot) => rows.filter((r) => r.slot === slot).map(card));
  const byId = new Map(SLOTS.flatMap((s) => items[s].map((i) => [i.id, i] as const)));
  push(1200, { type: 'pool', items, indifferent, tonight: tonightIn(input.location) });
  push(150, { type: 'status', phase: 'negotiating', brain });

  // Everyone's value for every possible evening.
  const weights = perSide(members, (s) => normalize(get(sides, s).weights));
  const value = (s: Side, b: Bundle) => SLOTS.reduce((t, slot) => t + get(weights, s)[slot] * ((get(byId.get(b[slot])!.scores, s) ?? 0) / 100), 0);
  const all: Scored[] = [];
  for (const f of items.film)
    for (const r of items.restaurant)
      for (const m of items.music) {
        const bundle = { film: f.id, restaurant: r.id, music: m.id };
        all.push({ bundle, u: perSide(members, (s) => value(s, bundle)) });
      }
  const nash = (x: Scored) => members.reduce((t, s) => t + (alpha[s] ?? 1 / n) * Math.log(get(x.u, s) + 1e-6), 0);
  const fair = all.reduce((best, x) => (nash(x) > nash(best) + 1e-12 ? x : best));
  const best = perSide(members, (s) => Math.max(...all.map((x) => get(x.u, s))));
  const scoresOf = (b: Bundle) => perSide(members, (s) => Math.round(value(s, b) * 100));
  const same = (x: Bundle, y: Bundle) => SLOTS.every((s) => x[s] === y[s]);
  const nameOfId = (id: string) => byId.get(id)?.name ?? '';

  // What each person settles for after k moves: from their best toward the fair evening.
  const moves = perSide(members, () => 0);
  const reach = input.variant === 'deal' ? 1 : 0.55;
  const settleFor = (s: Side) => {
    const k = Math.min(get(moves, s), MOVES_PER_PERSON - 1);
    return get(best, s) - (get(best, s) - get(fair.u, s)) * ((k + 1) / MOVES_PER_PERSON) * reach - 1e-9;
  };

  const lowest = (s: Side) => get(best, s) - (get(best, s) - get(fair.u, s)) * reach - 1e-9;
  const inZone = (b: Bundle) => members.every((s) => value(s, b) >= lowest(s));

  const order = [...members.slice(seat(input.opener)), ...members.slice(0, seat(input.opener))];
  const turns = MOVES_PER_PERSON * n;
  push(250, { type: 'start', opener: input.opener, order, turns, alpha });

  // Each agent mentions its person's wish once, the first time an offer meets it.
  const wished = new Set<Side>();
  const wishLine = (s: Side, b: Bundle, changed: readonly Slot[]) => {
    if (wished.has(s)) return '';
    const line = wishFor(s, b, changed);
    if (line) wished.add(s);
    return line;
  };
  const wishFor = (s: Side, b: Bundle, changed: readonly Slot[]) => {
    const wishes = (briefs[s]?.wishes ?? []).map((w) => w.matched);
    const restaurant = byId.get(b.restaurant)!;
    const film = byId.get(b.film)!;
    if (changed.includes('restaurant') && wishes.includes('Vegetarian friendly') && /vegetarian|vegetable|mezze/i.test(`${restaurant.facts.cuisineType} ${restaurant.blurb}`))
      return ` Good vegetarian food, as ${name(s)} asked.`;
    if (changed.includes('restaurant') && wishes.includes('Cozy') && /cosy/i.test(restaurant.facts.ambience ?? '')) return ` Cosy, as ${name(s)} asked.`;
    if (changed.includes('film') && wishes.includes('Comedy') && /comedy/i.test(film.facts.genres ?? '')) return ` And a comedy, as ${name(s)} asked.`;
    return '';
  };

  const counterLine = (s: Side, b: Bundle, table: Bundle | null, mine: Bundle | null) => {
    const nm = name(s);
    if (!table) return `${nm} would start with ${nameOfId(b.film)}, dinner at ${nameOfId(b.restaurant)} and ${nameOfId(b.music)} after. ${FLAVOUR[seat(s)]}${wishLine(s, b, SLOTS)}`;
    const changed = SLOTS.filter((slot) => b[slot] !== table[slot]);
    const kept = SLOTS.filter((slot) => b[slot] === table[slot]).map((slot) => nameOfId(b[slot]));
    const gives = mine !== null && value(s, b) < value(s, mine) - 0.01;
    const swaps = changed.map((slot) => `${nameOfId(b[slot])} instead of ${nameOfId(table[slot])}`);
    const body =
      changed.length === 3
        ? `${nm} counters with ${nameOfId(b.film)}, ${nameOfId(b.restaurant)} and ${nameOfId(b.music)}.`
        : `Keep ${listNames(kept)}, but ${listNames(swaps)}.`;
    return `${body} ${gives ? `That’s ${nm} giving ground.` : `That suits ${nm} much better.`}${wishLine(s, b, changed)}`;
  };

  let offer: { bundle: Bundle; by: Side; acceptedBy: Side[] } | null = null;
  const lastOwn = perSide<Bundle | null>(members, () => null);
  let agreed: Bundle | null = null;
  let turnsUsed = 0;

  const moveEvent = (turn: number, s: Side, action: 'accept' | 'counter', bundle: Bundle, message: string, moveBrain: string): StreamEvent => ({
    type: 'move',
    turn,
    side: s,
    action,
    bundle,
    message,
    scores: scoresOf(bundle),
    evidence: SLOTS.map((slot) => ({ slot, itemId: bundle[slot], because: get(byId.get(bundle[slot])!.because, s) ?? [] })),
    brain: moveBrain,
    acceptedBy: [...offer!.acceptedBy],
    // In the final round the referee shows the mover evenings everyone could still accept.
    shortlisted: action === 'counter' && turn > turns - n && inZone(bundle),
  });

  const accept = (turn: number, s: Side, lastCall: boolean) => {
    offer!.acceptedBy.push(s);
    const pending = members.filter((o) => !offer!.acceptedBy.includes(o));
    const b = offer!.bundle;
    const message = lastCall
      ? `It’s not ${possessive(name(s))} first choice, but ${name(s)} says yes.`
      : `${nameOfId(b.film)}, ${nameOfId(b.restaurant)} and ${nameOfId(b.music)}: ${name(s)} can say yes to that.${pending.length ? ` Over to ${listNames(pending.map((o) => agentOf(name(o))))}.` : ''}`;
    push(1700, moveEvent(turn, s, 'accept', b, message, brain));
    if (!pending.length) {
      agreed = b;
      push(80, { type: 'agreement', turn, bundle: b, by: [...offer!.acceptedBy] });
    }
  };

  for (let turn = 1; turn <= turns && !agreed; turn++) {
    const s = order[(turn - 1) % n]!;
    turnsUsed = turn;
    push(350, { type: 'thinking', side: s, turn });
    if (offer && offer.by !== s && value(s, offer.bundle) >= settleFor(s)) accept(turn, s, false);
    else {
      const floor = settleFor(s);
      // The fairest evening that still clears what they'd settle for, other than what's on the table or their own last offer.
      const mine: Bundle | null = get(lastOwn, s);
      const fresh = (x: Scored): boolean => !(offer && same(x.bundle, offer.bundle)) && !(mine && same(x.bundle, mine));
      const pick: Scored = all
        .filter((x) => get(x.u, s) >= floor && fresh(x))
        .reduce<Scored | null>((top, x) => (!top || nash(x) > nash(top) + 1e-12 ? x : top), null) ?? fair;
      let moveBrain: string = brain;
      if (input.strikeAt === turn) {
        push(1300, { type: 'rejected', turn, side: s, code: 'below_minimum', reason: `offer below ${possessive(name(s))} minimum` });
        moveBrain = 'rules';
      }
      const message = counterLine(s, pick.bundle, offer?.bundle ?? null, mine);
      offer = { bundle: pick.bundle, by: s, acceptedBy: [s] };
      lastOwn[s] = pick.bundle;
      push(moveBrain === 'rules' ? 1100 : 1900, moveEvent(turn, s, 'counter', pick.bundle, message, moveBrain));
    }
    moves[s] = get(moves, s) + 1;
  }

  // Last calls: everyone yet to say yes, in seat order after the offer's maker. One no, and the referee rules.
  if (!agreed && offer) {
    const o = offer as { bundle: Bundle; by: Side; acceptedBy: Side[] };
    const from = order.indexOf(o.by);
    const pending = [...order.slice(from + 1), ...order.slice(0, from)].filter((s) => !o.acceptedBy.includes(s));
    turnsUsed = turns + 1;
    for (const s of pending) {
      push(400, { type: 'thinking', side: s, turn: turns + 1 });
      if (value(s, o.bundle) >= settleFor(s)) {
        accept(turns + 1, s, true);
        if (agreed) break;
      } else {
        push(1800, { type: 'declined', turn: turns + 1, side: s, message: `${name(s)} has given enough ground lately. Let the referee decide.`, brain });
        break;
      }
    }
  }

  let final: Bundle = agreed ?? fair.bundle;
  if (!agreed) push(900, { type: 'ruling', bundle: final, scores: scoresOf(final) });
  const current = all.find((x) => same(x.bundle, final))!;
  const better = all.reduce<Scored | null>((top, x) => {
    const dominates = members.every((s) => get(x.u, s) >= get(current.u, s) - 1e-12) && members.reduce((t, s) => t + get(x.u, s) - get(current.u, s), 0) > 0.01;
    const total = (y: Scored) => members.reduce((t, s) => t + get(y.u, s), 0);
    return dominates && (!top || total(x) > total(top)) ? x : top;
  }, null);
  if (better) {
    push(1000, { type: 'polish', from: final, to: better.bundle, scores: { from: scoresOf(final), to: scoresOf(better.bundle) } });
    final = better.bundle;
  }
  const got = all.find((x) => same(x.bundle, final))!;
  const result: TruceResult = {
    bundle: final,
    how: agreed ? 'agreed' : 'ruled',
    polished: Boolean(better),
    turnsUsed,
    utilities: got.u,
    best,
    concession: perSide(members, (s) => Math.max(0, get(best, s) - get(got.u, s))),
    items: perSide(members, (s) => bySlot((slot) => (get(byId.get(final[slot])!.scores, s) ?? 0) / 100)),
    weights,
    fair,
  };
  push(700, { type: 'done', result });
  push(500, input.ledgerAfter(result.concession));
  return { timeline, result, items };
}

