/**
 * Swaps: the referee's replacement (minimums, the talks first, fairness),
 * the agents' answers, majorities, and the whole flow on a real store with a
 * made-up evening: facts, votes, deadlines, limits, locks, the ledger and
 * replans. Synthetic data only; no network, no model.
 * Run with `npm run test:swap`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CardItem, SideInput, StreamEvent } from '../src/contract';
import { openStore } from '../src/server/db';
import { createRunner, dislikedOf, ledgerOf, type Runner } from '../src/server/runner';
import { createSwaps } from '../src/server/swaps';
import type { TruceResult } from '../src/truce/negotiate';
import { agentVote, fairAlternative, majority, tally, type Evening } from '../src/truce/swap';
import { SLOTS, type Bundle, type Side, type Slot } from '../src/truce/types';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}

// --- A made-up evening for two -------------------------------------------------------
// Scores (0–100) per item for Maya (a) and Deniz (b); equal weights. Tonight: F2, R1, M1.
const SCORES: Record<Slot, Record<string, [number, number]>> = {
  film: { F1: [100, 40], F2: [60, 80], F3: [20, 100], F4: [90, 0] },
  restaurant: { R1: [50, 50], R2: [70, 60], R3: [30, 90], R4: [0, 10] },
  music: { M1: [80, 80], M2: [50, 100] },
};
const TONIGHT: Bundle = { film: 'F2', restaurant: 'R1', music: 'M1' };
const third = { film: 1 / 3, restaurant: 1 / 3, music: 1 / 3 };
const u = (side: 0 | 1, b: Bundle) => SLOTS.reduce((t, s) => t + SCORES[s][b[s]]![side] / 300, 0);
// The fair evening gives Maya 0.65 and Deniz 0.70: minimums 0.55 and 0.60.
const FAIR = { a: 0.65, b: 0.7 };

const evening = (talked: Partial<Record<Slot, string[]>> = {}): Evening => ({
  members: ['a', 'b'],
  weights: { a: third, b: third },
  alpha: { a: 0.5, b: 0.5 },
  utilities: {
    a: Object.fromEntries(SLOTS.map((s) => [s, Object.fromEntries(Object.entries(SCORES[s]).map(([id, v]) => [id, v[0] / 100]))])) as Record<Slot, Record<string, number>>,
    b: Object.fromEntries(SLOTS.map((s) => [s, Object.fromEntries(Object.entries(SCORES[s]).map(([id, v]) => [id, v[1] / 100]))])) as Record<Slot, Record<string, number>>,
  },
  items: Object.fromEntries(SLOTS.map((s) => [s, Object.keys(SCORES[s])])) as Record<Slot, string[]>,
  fair: FAIR,
  fairBundle: TONIGHT,
  talked: Object.fromEntries(SLOTS.map((s) => [s, new Set(talked[s] ?? [])])) as Record<Slot, Set<string>>,
});

// --- The rules on their own ------------------------------------------------------
check('majority: 2→2, 3→2, 4→3, 5→3', [2, 3, 4, 5].map(majority).join() === '2,2,3,3');
check('tally: enough yeses pass', tally(['a', 'b', 'c'], { a: 'yes', b: 'yes' }, 2) === 'passed');
check('tally: fails once the rest cannot reach it', tally(['a', 'b', 'c', 'd'], { a: 'yes', b: 'no', c: 'no' }, 3) === 'failed');
check('tally: open while it still could pass', tally(['a', 'b', 'c', 'd'], { a: 'yes', b: 'no' }, 3) === 'open');

{
  const e = evening();
  const none = new Set<string>();
  const r = fairAlternative(e, TONIGHT, 'restaurant', none, false);
  check('referee: the fairest place that keeps both above their minimum (R2 over R3; R4 sinks Maya)', r?.id === 'R2' && !r.belowMinimum);
  const talked = fairAlternative(evening({ restaurant: ['R3'] }), TONIGHT, 'restaurant', none, false);
  check('referee: an item argued for in the talks comes first, if it keeps everyone above their minimum', talked?.id === 'R3');
  const sinks = fairAlternative(evening({ restaurant: ['R4'] }), TONIGHT, 'restaurant', none, false);
  check('referee: … but never one below someone\'s minimum', sinks?.id === 'R2');
  check('referee: what was swapped away stays out', fairAlternative(e, TONIGHT, 'restaurant', new Set(['R2']), false)?.id === 'R3');
  check('referee: a taste swap with no fair film left has no alternative', fairAlternative(e, TONIGHT, 'film', none, false) === null);
  const forced = fairAlternative(e, TONIGHT, 'film', none, true);
  check('referee: a film that can\'t happen still changes, to the fairest left (F1), flagged below a minimum', forced?.id === 'F1' && forced.belowMinimum);
  check('referee: nothing left at all is null', fairAlternative(e, TONIGHT, 'music', new Set(['M2']), true) === null);

  const alt = fairAlternative(e, TONIGHT, 'restaurant', none, false);
  check('agent: yes when the swap costs its person nothing', agentVote(e, 'swap', 'b', TONIGHT, alt).why === 'no_worse');
  const costly = fairAlternative(evening({ restaurant: ['R3'] }), TONIGHT, 'restaurant', none, false);
  const maya = agentVote(e, 'swap', 'a', TONIGHT, costly);
  check('agent: no when it costs its person more than the tolerance (Maya, R3: −7 points)', maya.vote === 'no' && maya.why === 'too_costly');
  check('agent: no when nothing fair is left', agentVote(e, 'swap', 'a', TONIGHT, null).why === 'nothing_fair');
  check('agent: a replan is a yes for someone at or under their fair share', agentVote(e, 'replan', 'a', TONIGHT, null).vote === 'yes');
  const lowFair = { film: 'F3', restaurant: 'R1', music: 'M1' }; // Maya 50 there, 63 tonight
  check('agent: … and a no for someone doing better than fair', agentVote({ ...e, fairBundle: lowFair }, 'replan', 'a', TONIGHT, null).vote === 'no');
  // Tonight is the fair evening, but the stored exact utility sits a rounding above the menu one.
  check('agent: compares with the fair evening on the menu scale, not a rounding off', agentVote({ ...e, fair: { a: 0.6301, b: 0.7 } }, 'replan', 'a', TONIGHT, null).vote === 'yes');
}

// --- The whole flow on a real store ---------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'truce-swap-'));
const store = openStore(dir);
let clock = Date.parse('2026-10-22T20:00:00Z'); // 16:00 in New York, on the evening's date
const started: { pairId: string; exclude: readonly string[]; replaces?: string }[] = [];
const runner = {
  capacity: () => null,
  start(pairId: string, opts: { exclude?: readonly string[]; replaces?: string } = {}) {
    const id = `replan-${started.length + 1}`;
    started.push({ pairId, exclude: opts.exclude ?? [], replaces: opts.replaces });
    if (opts.replaces) store.setReplacedBy(opts.replaces, id);
    store.createTruce(id, pairId, 'rules', { a: 0.5, b: 0.5 }, 'a');
    return id;
  },
} as unknown as Runner;
const swaps = createSwaps({ store, runner, now: () => clock, log: () => {} });

const card = (slot: Slot, id: string): CardItem => ({
  id, slot, name: `${id} name`, disambiguation: null, imageUrl: null, blurb: null, facts: {},
  scores: { a: SCORES[slot][id]![0], b: SCORES[slot][id]![1] }, origins: ['joint'], because: {}, scout: null, serves: {},
  links: [], hours: null, address: null,
});
const side: SideInput = { seeds: { film: [{ id: 'S', name: 'Seed' }], restaurant: [], music: [] }, weights: { film: 1, restaurant: 1, music: 1 } };
let n = 0;
function decided(talked: Bundle[] = []): { pairId: string; truceId: string } {
  n++;
  const pairId = `pair-${n}`;
  const truceId = `truce-${n}`;
  store.createPair(pairId, { mode: 'couple', names: ['Maya', 'Deniz'], location: 'Manhattan' });
  store.saveSide(pairId, 'a', side, null);
  store.saveSide(pairId, 'b', side, null);
  store.createTruce(truceId, pairId, 'claude', { a: 0.5, b: 0.5 }, 'a');
  finish(truceId, talked);
  return { pairId, truceId };
}
/** Gives a created truce (a replan's, say) the made-up decided evening. */
function finish(truceId: string, talked: Bundle[] = []) {
  const events: StreamEvent[] = [
    {
      type: 'pool',
      items: Object.fromEntries(SLOTS.map((s) => [s, Object.keys(SCORES[s]).map((id) => card(s, id))])) as Record<Slot, CardItem[]>,
      indifferent: {},
      tonight: { date: '2026-10-22', weekday: 'thursday', timeZone: 'America/New_York' },
    },
    ...talked.map(
      (bundle, i): StreamEvent => ({
        type: 'move', turn: i + 1, side: 'a', action: 'counter', bundle, message: '', scores: {}, evidence: [], brain: 'test',
        acceptedBy: ['a'], shortlisted: false,
      }),
    ),
  ];
  store.saveEvents(truceId, events);
  const result: TruceResult = {
    bundle: TONIGHT,
    how: 'agreed',
    polished: false,
    turnsUsed: 4,
    utilities: { a: u(0, TONIGHT), b: u(1, TONIGHT) },
    best: { a: 0.9, b: 0.9 },
    concession: { a: 0.9 - u(0, TONIGHT), b: 0.9 - u(1, TONIGHT) },
    items: {
      a: { film: 0.6, restaurant: 0.5, music: 0.8 },
      b: { film: 0.8, restaurant: 0.5, music: 0.8 },
    },
    weights: { a: third, b: third },
    fair: { bundle: TONIGHT, u: FAIR },
  };
  store.finishTruce(truceId, result, { film: 'F2 name', restaurant: 'R1 name', music: 'M1 name' });
}
/** created_at comes from the system clock, which on Windows can tick only every ~16 ms: wait past that, so a later truce is later. */
const tick = () => {
  const t = Date.now();
  while (Date.now() <= t + 20);
};
const refused = (fn: () => unknown, code: string) => {
  try {
    fn();
    return false;
  } catch (err) {
    return (err as { code?: string }).code === code;
  }
};

{
  const { pairId, truceId } = decided();
  const first = swaps.view(truceId);
  check('view: a decided evening is open to swaps', first.lock === null && first.needed === 2 && first.canAsk.a === true && first.scores?.a === 63);

  const v = swaps.ask(truceId, { kind: 'swap', side: 'a', slot: 'restaurant', reason: 'unavailable' });
  const s = v.swaps[0]!;
  check('fact: swaps at once, to the referee\'s pick', s.status === 'swapped' && s.to?.id === 'R2' && v.bundle?.restaurant === 'R2');
  check('fact: before and after scores', s.scores?.before.a === 63 && s.scores?.after?.a === 70 && v.scores?.b === 73);
  check('fact: the concession as the ledger counts it', Math.abs(v.concession!.a! - (0.9 - 0.7)) < 1e-9);
  const t = store.truce(truceId)!;
  check('fact: the stored evening is updated (names, utilities, items)', t.evening?.restaurant === 'R2 name' && Math.abs(t.result!.utilities.a! - 0.7) < 1e-9 && t.result!.items.a!.restaurant === 0.7);
  check('fact: teaches the asker nothing', store.sides(pairId).a!.learned.avoided.length === 0);
  check('fact: doesn\'t use up the taste swap', swaps.view(truceId).canAsk.a === true);
}

{
  const { pairId, truceId } = decided();
  const asked = swaps.ask(truceId, { kind: 'swap', side: 'a', slot: 'restaurant', reason: 'not_feeling' });
  const open = asked.swaps[0]!;
  check('taste: opens a vote with the asker\'s yes in', open.status === 'open' && open.votes.a?.vote === 'yes' && open.needed === 2 && asked.lock === 'open');
  check('taste: the deadline is ten minutes out', Date.parse(open.deadline!) - clock === 10 * 60_000);
  check('taste: one request at a time', refused(() => swaps.ask(truceId, { kind: 'swap', side: 'b', slot: 'film', reason: 'unavailable' }), 'swap_open'));
  check('vote: the asker can\'t vote again', refused(() => swaps.vote(truceId, open.id, 'a', 'yes'), 'not_voter'));
  const after = swaps.vote(truceId, open.id, 'b', 'yes');
  const s = after.swaps[0]!;
  check('vote: a couple passes on the partner\'s yes; the referee swaps in R2', s.status === 'swapped' && after.bundle?.restaurant === 'R2' && after.lock === null);
  check('taste: the asker\'s disliked item joins their avoided picks', store.sides(pairId).a!.learned.avoided.some((x) => x.id === 'R1'));
  check('taste: one per person per evening', refused(() => swaps.ask(truceId, { kind: 'swap', side: 'a', slot: 'film', reason: 'seen' }), 'swap_used'));
  check('taste: a fact still swaps after it', swaps.ask(truceId, { kind: 'swap', side: 'a', slot: 'music', reason: 'unavailable' }).bundle?.music === 'M2');
}

{
  const { pairId, truceId } = decided();
  const v = swaps.ask(truceId, { kind: 'swap', side: 'a', slot: 'film', reason: 'seen' });
  const kept = swaps.vote(truceId, v.swaps[0]!.id, 'b', 'no');
  check('vote: the partner\'s no keeps the film', kept.swaps[0]!.status === 'kept' && kept.bundle?.film === 'F2');
  const truces = store.trucesOf(pairId);
  const plain = ledgerOf(['a', 'b'], truces, new Map());
  const counted = ledgerOf(['a', 'b'], truces, new Map(), store.swapsOfPair(pairId));
  check('ledger: a swap asked for and not granted counts as ground given', counted.entries[0]!.concession.a! > plain.entries[0]!.concession.a! + 0.05);
  check('ledger: only for the one who asked', Math.abs(counted.entries[0]!.concession.b! - plain.entries[0]!.concession.b!) < 1e-9);
  check('ledger: dislikedOf names the slot', dislikedOf(store.swapsOf(truceId), store.truce(truceId)!.result!.bundle).a?.join() === 'film');
  check('kept: the swap keeps its before scores', swaps.view(truceId).swaps[0]!.scores?.before.a === 63);
  const view = swaps.view(truceId);
  check(
    'view: the concession is the ledger\'s, refused swap included',
    Math.abs(view.concession!.a! - counted.entries[0]!.concession.a!) < 1e-9 && view.concession!.a! > store.truce(truceId)!.result!.concession.a! + 0.05,
  );
  check('taste: the kept film is avoided from now on', store.sides(pairId).a!.learned.avoided.some((x) => x.id === 'F2'));
  createRunner({ store, qloo: null as never, anthropic: null, dailyCap: 0, log: () => {} }).checkin(truceId, 'a', { went: true, ratings: { film: 'loved' } });
  check('check-in: loved after all, the film is no longer avoided', !store.sides(pairId).a!.learned.avoided.some((x) => x.id === 'F2'));
  const own = ledgerOf(['a', 'b'], store.trucesOf(pairId), store.checkinsOfPair(pairId), store.swapsOfPair(pairId));
  check('ledger: the person\'s own check-in rating wins over the inferred one', own.entries[0]!.concession.a! < counted.entries[0]!.concession.a!);
  check('lock: a check-in settles the evening', refused(() => swaps.ask(truceId, { kind: 'swap', side: 'b', slot: 'music', reason: 'unavailable' }), 'locked'));
}

{
  const { truceId } = decided();
  const v = swaps.ask(truceId, { kind: 'swap', side: 'b', slot: 'restaurant', reason: 'not_feeling' });
  clock += 10 * 60_000 + 1;
  const closed = swaps.view(truceId);
  const s = closed.swaps[0]!;
  check('deadline: the silent person\'s agent answers, with a reason', s.votes.a?.by === 'agent' && s.votes.a.vote === 'yes' && /Maya/.test(s.votes.a.why ?? ''));
  check('deadline: and the vote is settled by it', s.status === 'swapped' && closed.bundle?.restaurant === 'R2' && v.swaps[0]!.id === s.id);
  clock -= 10 * 60_000 + 1;
}

{
  const { truceId } = decided([{ film: 'F2', restaurant: 'R3', music: 'M1' }]);
  swaps.ask(truceId, { kind: 'swap', side: 'b', slot: 'restaurant', reason: 'not_feeling' });
  clock += 10 * 60_000 + 1;
  const s = swaps.view(truceId).swaps[0]!;
  check('deadline: an agent says no when the swap would cost its person too much (R3 from the talks)', s.votes.a?.vote === 'no' && s.status === 'kept');
  clock -= 10 * 60_000 + 1;
}

{
  const { truceId } = decided();
  const v = swaps.ask(truceId, { kind: 'swap', side: 'a', slot: 'film', reason: 'not_feeling' });
  check('cancel: only the asker can withdraw', refused(() => swaps.cancel(truceId, v.swaps[0]!.id, 'b'), 'not_voter'));
  const c = swaps.cancel(truceId, v.swaps[0]!.id, 'a');
  check('cancel: withdrawn, and the taste swap is theirs again', c.swaps[0]!.status === 'cancelled' && c.swaps[0]!.cancelled === 'withdrawn' && c.canAsk.a === true && c.lock === null);
  const passed = swaps.vote(truceId, swaps.ask(truceId, { kind: 'swap', side: 'a', slot: 'film', reason: 'not_feeling' }).swaps[1]!.id, 'b', 'yes');
  check('no alternative: the group is OK with it, but no film keeps both above their minimum', passed.swaps[1]!.status === 'no_alternative' && passed.bundle?.film === 'F2');
  check('no alternative: a taste dead end needs a vote to replan', passed.replanNow === false);
}

{
  const { pairId, truceId } = decided();
  // Booked, booked, booked, booked: the last one leaves no restaurant at all.
  swaps.ask(truceId, { kind: 'swap', side: 'a', slot: 'restaurant', reason: 'unavailable' });
  swaps.ask(truceId, { kind: 'swap', side: 'a', slot: 'restaurant', reason: 'unavailable' });
  const third = swaps.ask(truceId, { kind: 'swap', side: 'a', slot: 'restaurant', reason: 'unavailable' });
  check('fact: once nothing fair is left, the fairest place left goes in anyway', third.bundle?.restaurant === 'R4');
  check('fact: three per person', refused(() => swaps.ask(truceId, { kind: 'swap', side: 'a', slot: 'restaurant', reason: 'unavailable' }), 'too_many'));
  const fourth = swaps.ask(truceId, { kind: 'swap', side: 'b', slot: 'restaurant', reason: 'unavailable' });
  check('fact: with no restaurant left, nothing to swap in', fourth.swaps.at(-1)!.status === 'no_alternative' && fourth.replanNow);
  const re = swaps.ask(truceId, { kind: 'replan', side: 'b' });
  const r = re.swaps.at(-1)!;
  check('replan: starts at once after a fact dead end, without what was swapped away', r.status === 'replanned' && r.truceId === 'replan-1' && started[0]!.exclude.join() === 'R1,R2,R3,R4');
  check('replan: the evening is marked replaced and locked', re.replacedBy === 'replan-1' && re.lock === 'replanned');
  const ledger = ledgerOf(['a', 'b'], store.trucesOf(pairId), new Map(), store.swapsOfPair(pairId));
  check('replan: the replaced evening leaves the ledger', ledger.entries.length === 0);
}

{
  const { truceId } = decided();
  const asked = swaps.ask(truceId, { kind: 'replan', side: 'a' });
  check('replan: otherwise it goes to a vote', asked.swaps[0]!.status === 'open' && asked.swaps[0]!.needed === 2);
  const done = swaps.vote(truceId, asked.swaps[0]!.id, 'b', 'yes');
  check('replan: a passed vote plans again', done.swaps[0]!.status === 'replanned' && done.replacedBy !== null);
  check('replan: the replaced evening takes no more requests', refused(() => swaps.ask(truceId, { kind: 'replan', side: 'b' }), 'locked'));
}

{
  const { truceId } = decided();
  const asked = swaps.ask(truceId, { kind: 'replan', side: 'a' });
  const kept = swaps.vote(truceId, asked.swaps[0]!.id, 'b', 'no');
  check('replan: voted down, tonight stays', kept.swaps[0]!.status === 'kept' && kept.replacedBy === null && kept.lock === null);
  check('replan: one ask per person per evening', refused(() => swaps.ask(truceId, { kind: 'replan', side: 'a' }), 'swap_used'));
  check('replan: the other person may still ask', swaps.ask(truceId, { kind: 'replan', side: 'b' }).swaps[1]!.status === 'open');
}

{
  const { truceId } = decided();
  clock += 2 * 86_400_000;
  check('lock: an evening whose date has passed', swaps.view(truceId).lock === 'past');
  clock -= 2 * 86_400_000;
  check('lock: an unknown truce is not found', refused(() => swaps.view('nope'), 'not_found'));
}

{
  // A dislike counts only while the disliked item is still in the evening.
  const { pairId, truceId } = decided();
  const v = swaps.ask(truceId, { kind: 'swap', side: 'a', slot: 'restaurant', reason: 'not_feeling' });
  swaps.vote(truceId, v.swaps[0]!.id, 'b', 'no');
  swaps.ask(truceId, { kind: 'swap', side: 'b', slot: 'restaurant', reason: 'unavailable' });
  const truces = store.trucesOf(pairId);
  const plain = ledgerOf(['a', 'b'], truces, new Map());
  const counted = ledgerOf(['a', 'b'], truces, new Map(), store.swapsOfPair(pairId));
  check('ledger: a dislike no longer counts once a later swap replaced the item', Math.abs(counted.entries[0]!.concession.a! - plain.entries[0]!.concession.a!) < 1e-9);
}

{
  // A newer evening planned since locks this one, and calls off its open vote.
  const { pairId, truceId } = decided();
  const v = swaps.ask(truceId, { kind: 'swap', side: 'a', slot: 'film', reason: 'not_feeling' });
  tick();
  store.createTruce('newer-1', pairId, 'rules', { a: 0.5, b: 0.5 }, 'b');
  const after = swaps.view(truceId);
  check('superseded: a newer truce locks the older evening', after.lock === 'superseded');
  check('superseded: and its open vote is called off, saying why', after.swaps[0]!.status === 'cancelled' && after.swaps[0]!.cancelled === 'superseded' && after.swaps[0]!.id === v.swaps[0]!.id);
  store.failTruce('newer-1');
  check('superseded: … unless the newer truce failed', swaps.view(truceId).lock === null);
}

{
  // A replan of a replan leaves out what was swapped away from both evenings.
  const { pairId, truceId } = decided();
  swaps.ask(truceId, { kind: 'swap', side: 'a', slot: 'restaurant', reason: 'unavailable' });
  const first = swaps.vote(truceId, swaps.ask(truceId, { kind: 'replan', side: 'a' }).swaps.at(-1)!.id, 'b', 'yes').replacedBy!;
  finish(first);
  swaps.ask(first, { kind: 'swap', side: 'b', slot: 'music', reason: 'unavailable' });
  swaps.vote(first, swaps.ask(first, { kind: 'replan', side: 'b' }).swaps.at(-1)!.id, 'a', 'yes');
  const last = started.at(-1)!;
  check('replan chain: the second replan leaves out both evenings\' swapped-away items', last.pairId === pairId && last.exclude.includes('R1') && last.exclude.includes('M1'));
}

{
  // A replan cut off by a restart gives the evening back.
  const { truceId } = decided();
  const replanned = swaps.vote(truceId, swaps.ask(truceId, { kind: 'replan', side: 'a' }).swaps[0]!.id, 'b', 'yes');
  check('replan: marked replaced while the new truce runs', replanned.replacedBy !== null);
  const reopened = openStore(dir);
  check('restart: a replan cut off by a restart gives the evening back', reopened.truce(truceId)!.replacedBy === null);
  reopened.close();
  check('restart: the evening takes requests again', swaps.view(truceId).lock === null && swaps.view(truceId).replacedBy === null);
  check('restart: and the failed replan doesn\'t use up the ask', swaps.ask(truceId, { kind: 'replan', side: 'a' }).swaps.at(-1)!.status === 'open');
}

store.close();
rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
