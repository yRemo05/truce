/**
 * Sample evenings for the mock (`npm run dev:mock`, then /evenings?sample):
 * groups in every state, in the mock's store and in this browser's memory,
 * so My evenings shows populated without clicking through each flow.
 *
 * - Ömer & Ecrin (Istanbul, theirs): three evenings, check-ins with loved
 *   picks; Ömer (this browser) still to check in on the last one, and
 *   tonight's questions due.
 * - Maya & Deniz (the couple demo): a replay, Maya checked in, Deniz not.
 * - Ada, Kerem & Lina (the friends demo): a replay with Ada's swap of the
 *   restaurant waiting for Kerem (this browser) and Lina.
 * - Lea & Noor (Brooklyn): a truce running now.
 * - Jess, Sam, Priya & Tom (Manhattan): Priya and Tom still picking.
 * - A demo copy the server has deleted: answers 404 and drops quietly.
 */
import type { CheckinInput, Mode, Rating, Side, Slot } from '@contract';
import { groupInfo, rememberCheckin, rememberGroup, rememberPlan, type PlanPick } from '@/lib/evenings';
import { rememberSide } from '@/lib/mine';
import { membersOf, perSide } from '@/lib/people';
import { bySlot, SLOTS } from '@/lib/truce';
import { understand } from './brief';
import { internals, type DemoPerson, type MockPair, type MockTruce } from './server';

const DAY = 86_400_000;
const { read, write, start, demoPair, newId, seed, poolOf, bundleOf, endOf, DEMOS } = internals;

const infoOf = (pair: MockPair) => groupInfo({ ...pair, demo: pair.demo ?? null }, pair.id);

/** Moves a truce back so it ended `daysAgo` days ago. */
function finish(t: MockTruce, daysAgo: number) {
  t.createdAt = Date.now() - daysAgo * DAY - endOf(t) - 1000;
}

const picksOf = (t: MockTruce): PlanPick[] => {
  const pool = poolOf(t);
  const bundle = bundleOf(t);
  return SLOTS.flatMap((slot) => {
    const item = pool?.items[slot].find((i) => i.id === bundle[slot]);
    return item ? [{ slot, id: item.id, name: item.name, imageUrl: item.imageUrl }] : [];
  });
};

function checkin(pair: MockPair, t: MockTruce, side: Side, ratings: Partial<Record<Slot, Rating>>) {
  const input: CheckinInput = { went: true, ratings };
  t.checkins[side] = input;
  const picks = picksOf(t);
  const rated = (r: Rating) => picks.filter((p) => ratings[p.slot] === r).map((p) => ({ id: p.id, name: p.name }));
  rememberCheckin(infoOf(pair), t.id, side, input, picks, { loved: rated('loved'), avoided: rated('not_for_me') });
}

/** A group people made, with the first `saved` people's favourites saved `savedDaysAgo` days ago. */
function ownPair(names: string[], mode: Mode, location: string, people: DemoPerson[], savedDaysAgo: number, saved = names.length): MockPair {
  const members = membersOf(names.length);
  return {
    id: newId(),
    mode,
    members,
    names: perSide(members, (s) => names[members.indexOf(s)]!),
    location,
    earlier: [],
    sides: perSide(members.slice(0, saved), (s) => {
      const p = people[members.indexOf(s) % people.length]!;
      return {
        input: { seeds: bySlot((slot) => p.loves[slot].map((n) => seed(slot, n))), weights: p.weights, brief: p.brief },
        brief: understand(p.brief),
        savedAt: Date.now() - savedDaysAgo * DAY,
      };
    }),
  };
}

const truceOf = (pairId: string) => read().truces[start(read(), pairId)]!;

export function sampleEvenings() {
  const db = read();
  const couple = DEMOS.couple.people;
  const friends = DEMOS.friends.people;

  // Remembered first, so it sits last: a copy the server no longer has.
  rememberGroup({ pairId: 'deleted-demo-copy', mode: 'couple', members: ['a', 'b'], names: { a: 'Old', b: 'Copy' }, location: 'Manhattan', demo: null });

  // Four friends, two still picking.
  const four = ownPair(['Jess', 'Sam', 'Priya', 'Tom'], 'bff', 'Manhattan', [...friends, ...couple], 1, 2);
  db.pairs[four.id] = four;
  rememberGroup(infoOf(four));

  // A truce running now.
  const live = ownPair(['Lea', 'Noor'], 'couple', 'Brooklyn', couple, 1);
  db.pairs[live.id] = live;
  const running = truceOf(live.id);
  rememberGroup(infoOf(live));
  rememberSide(live.id, 'b');

  // The friends demo, with a swap waiting for votes.
  const trio = demoPair('friends');
  db.pairs[trio.id] = trio;
  const trioTruce = truceOf(trio.id);
  finish(trioTruce, 0);
  trioTruce.replay = { recordedAt: new Date(Date.now() - DAY).toISOString() };
  const bundle = bundleOf(trioTruce);
  const now = Date.now();
  trioTruce.swaps = [
    {
      id: newId(),
      kind: 'swap',
      side: 'a',
      slot: 'restaurant',
      reason: 'not_feeling',
      status: 'open',
      createdAt: new Date(now).toISOString(),
      deadline: new Date(now + 2 * 60 * 60_000).toISOString(),
      resolvedAt: null,
      needed: 2,
      votes: { a: { vote: 'yes', by: 'person', why: null } },
      from: { id: bundle.restaurant, name: picksOf(trioTruce).find((p) => p.slot === 'restaurant')?.name ?? '' },
      to: null,
      scores: null,
      truceId: null,
      cancelled: null,
    },
  ];
  rememberGroup(infoOf(trio));
  rememberPlan(trioTruce.id, trio.id, picksOf(trioTruce));
  rememberSide(trio.id, 'b');

  // The couple demo: Maya checked in, Deniz not yet.
  const demo = demoPair('couple');
  db.pairs[demo.id] = demo;
  const demoTruce = truceOf(demo.id);
  finish(demoTruce, 0);
  demoTruce.replay = { recordedAt: new Date(Date.now() - DAY).toISOString() };
  rememberGroup(infoOf(demo));
  rememberPlan(demoTruce.id, demo.id, picksOf(demoTruce));
  checkin(demo, demoTruce, 'a', { film: 'loved', restaurant: 'loved', music: 'fine' });

  // Ömer & Ecrin: three evenings of their own.
  const own = ownPair(['Ömer', 'Ecrin'], 'couple', 'Istanbul', [friends[2]!, friends[0]!], 12);
  db.pairs[own.id] = own;
  rememberGroup(infoOf(own));
  rememberSide(own.id, 'a');
  const evenings: { daysAgo: number; a?: Partial<Record<Slot, Rating>>; b?: Partial<Record<Slot, Rating>> }[] = [
    { daysAgo: 9, a: { film: 'loved', music: 'fine' }, b: { restaurant: 'loved', film: 'fine' } },
    { daysAgo: 5, a: { restaurant: 'loved', film: 'not_for_me' }, b: { music: 'loved', film: 'fine' } },
    { daysAgo: 2, b: { film: 'loved', music: 'loved', restaurant: 'fine' } },
  ];
  for (const e of evenings) {
    // Tonight's answers given just before each evening, so the next one can start.
    for (const s of own.members) own.sides[s]!.savedAt = Date.now() - (e.daysAgo + 0.5) * DAY;
    const t = truceOf(own.id);
    finish(t, e.daysAgo);
    rememberPlan(t.id, own.id, picksOf(t));
    if (e.a) checkin(own, t, 'a', e.a);
    if (e.b) checkin(own, t, 'b', e.b);
  }

  write(db);
  return { running: running.id };
}
