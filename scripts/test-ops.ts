/**
 * Running a public demo: Qloo receipts (every call recorded, in plain
 * words, cache hits marked), instant replays of a recorded demo (a private
 * copy moved to today, the right recording picked), and the limits that keep
 * a busy or overspent server from starting truces. Synthetic data only; no
 * network, no model.
 * Run with `npm run test:ops`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CardItem, SideInput, StreamEvent } from '../src/contract';
import { createQlooClient, type QlooCache, type QlooClient } from '../src/qloo/client';
import { describeCall, traced, type QlooCall } from '../src/qloo/trace';
import { openStore } from '../src/server/db';
import { createDemos, showcaseOf } from '../src/server/demo';
import { clientOf, createDaily } from '../src/server/limits';
import { createRunner, readyOf, tonightDueOf } from '../src/server/runner';
import type { TruceResult } from '../src/truce/negotiate';
import { SLOTS, type Slot } from '../src/truce/types';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}

// --- Receipts --------------------------------------------------------------------------
check('describe: a search', describeCall('/search', { query: 'Inception' }) === 'Search for "Inception"');
check(
  'describe: a pool query',
  describeCall('/v2/insights', { 'filter.type': 'urn:entity:place', 'signal.interests.entities': 'A,B,C', 'filter.location.query': 'Manhattan' }) ===
    'Places in Manhattan for 3 favourites',
);
check(
  'describe: scoring with reasons',
  describeCall('/v2/insights', {
    'filter.type': 'urn:entity:movie',
    'signal.interests.entities': 'A,B',
    'filter.results.entities': 'X,Y,Z',
    'feature.explainability': 'true',
  }) === 'Score 3 films against 2 favourites, with reasons',
);
check('describe: finding the city', describeCall('/v2/insights', { 'filter.type': 'urn:entity:place', 'filter.location.query': 'Istanbul', take: '1' }) === 'Find "Istanbul" on the map');

{
  const memory = new Map<string, string>();
  const cache: QlooCache = { get: (k) => memory.get(k), set: (k, v) => void memory.set(k, v) };
  let fetched = 0;
  const fake = (async () => {
    fetched++;
    return new Response(JSON.stringify({ results: { entities: [{}, {}] } }), { status: 200 });
  }) as typeof fetch;
  const qloo = createQlooClient({ baseUrl: 'https://qloo.test', apiKey: 'secret-key', fetch: fake, cache });
  const calls: QlooCall[] = [];
  let phase: QlooCall['phase'] = 'gathering';
  const q = traced(qloo, () => phase, (c) => calls.push(c));
  await q.get('/v2/insights', { 'filter.type': 'urn:entity:movie', 'signal.interests.entities': 'A', take: 5, unset: undefined });
  phase = 'scoring';
  await q.get('/v2/insights', { 'filter.type': 'urn:entity:movie', 'signal.interests.entities': 'A', take: 5 });
  check('receipts: every call recorded, in its phase', calls.length === 2 && calls[0]!.phase === 'gathering' && calls[1]!.phase === 'scoring');
  check('receipts: the second came from the cache, and only one went out', !calls[0]!.cached && calls[1]!.cached && fetched === 1);
  check('receipts: results counted, empty params dropped', calls[0]!.results === 2 && !('unset' in calls[0]!.params));
  check('receipts: the key is never in them', !JSON.stringify(calls).includes('secret-key'));
}

// --- Replays and limits on a real store ------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'truce-ops-'));
const store = openStore(dir);
const stubQloo: QlooClient = { get: async () => ({}), quota: () => ({ monthLimit: 50_000, monthRemaining: 40_000 }) };
const demos = createDemos(stubQloo, null);

const card = (slot: Slot, id: string): CardItem => ({
  id, slot, name: `${id} name`, disambiguation: null, imageUrl: null, blurb: null, facts: {}, scores: { a: 50, b: 50 },
  origins: ['joint'], because: {}, scout: null, serves: {}, venue: null, links: [], hours: null, address: null,
});
const side: SideInput = { seeds: { film: [{ id: 'S', name: 'Seed' }], restaurant: [], music: [] }, weights: { film: 1, restaurant: 1, music: 1 } };
const result = (how: TruceResult['how']): TruceResult => ({
  bundle: { film: 'F1', restaurant: 'R1', music: 'M1' }, how, polished: false, turnsUsed: 4,
  utilities: { a: 0.5, b: 0.5 }, best: { a: 0.9, b: 0.9 }, concession: { a: 0.4, b: 0.4 },
  items: { a: { film: 0.5, restaurant: 0.5, music: 0.5 }, b: { film: 0.5, restaurant: 0.5, music: 0.5 } },
  weights: { a: { film: 1 / 3, restaurant: 1 / 3, music: 1 / 3 }, b: { film: 1 / 3, restaurant: 1 / 3, music: 1 / 3 } },
  fair: { bundle: { film: 'F1', restaurant: 'R1', music: 'M1' }, u: { a: 0.5, b: 0.5 } },
});
let n = 0;
/** A finished live demo run, recorded, with one made-up earlier evening. */
function recorded(how: TruceResult['how'], opts: { receipts?: boolean; live?: boolean } = {}): string {
  n++;
  const pairId = `pair-${n}`;
  const truceId = `truce-${n}`;
  store.createPair(pairId, { mode: 'couple', names: ['Maya', 'Deniz'], location: 'Manhattan' }, 'couple');
  store.saveSide(pairId, 'a', side, null);
  store.saveSide(pairId, 'b', side, null);
  store.createEarlier(`earlier-${n}`, pairId, { a: 0.5, b: 0.5 }, 'a', result('agreed'), { film: 'Old', restaurant: 'Old', music: 'Old' }, '2026-10-01T00:00:00.000Z');
  store.createTruce(truceId, pairId, 'claude', { a: 0.5, b: 0.5 }, 'b');
  if (opts.live !== false) store.markShowcase(truceId);
  const events: StreamEvent[] = [
    {
      type: 'pool',
      items: Object.fromEntries(SLOTS.map((s) => [s, [card(s, `${s[0]!.toUpperCase()}1`)]])) as Record<Slot, CardItem[]>,
      indifferent: {},
      tonight: { date: '2020-01-01', weekday: 'wednesday', timeZone: 'America/New_York' },
    },
  ];
  store.saveEvents(truceId, events);
  store.finishTruce(truceId, result(how), { film: 'F1 name', restaurant: 'R1 name', music: 'M1 name' });
  if (opts.receipts !== false) store.saveReceipts(truceId, { calls: [{ phase: 'gathering', what: 'x', endpoint: '/search', params: {}, ms: 1, cached: false, results: 1 }], example: null });
  return truceId;
}
const tick = () => {
  const t = Date.now();
  while (Date.now() <= t + 20);
};

check('replay: nothing to replay before a live run has finished', demos.replay(store, 'couple') === null);
recorded('agreed', { receipts: false });
check('replay: a run from before receipts were kept is not a recording', demos.replay(store, 'couple') === null);
tick();
const agreed = recorded('agreed');
tick();
recorded('ruled');
check('replay: a deal is preferred over a later ruling', store.showcaseOf('couple') === agreed);
tick();
recorded('agreed', { live: false });
check('replay: a demo group\'s truce that wasn\'t a live demo run (someone\'s own picks) is never the recording', store.showcaseOf('couple') === agreed);

{
  const copy = demos.replay(store, 'couple')!;
  const t = store.truce(copy.truceId)!;
  check('replay: a fresh group and truce, marked as a copy of the recording', copy.pairId !== 'pair-2' && t.replayOf === agreed && t.status === 'done');
  check('replay: the group is the demo\'s, with its people and earlier evening', store.pair(copy.pairId)?.demo === 'couple' && Object.keys(store.sides(copy.pairId)).length === 2 && store.trucesOf(copy.pairId).filter((x) => x.earlier).length === 1);
  const pool = t.events.find((e): e is Extract<StreamEvent, { type: 'pool' }> => e.type === 'pool')!;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const weekday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', weekday: 'long' }).format(new Date()).toLowerCase();
  check('replay: the evening moves to today where it happens', pool.tonight.date === today && pool.tonight.weekday === weekday);
  check('replay: the receipts come along', (store.receiptsOf(copy.truceId) as { calls: unknown[] }).calls.length === 1);
  check('replay: a copy is never itself picked as the recording', store.showcaseOf('couple') === agreed);
  check('replay: copies don\'t count as truces started', store.startedSince('2000-01-01T00:00:00.000Z') === 4);
  check('replay: … nor against the daily model cap', store.claudeTrucesSince('2000-01-01T00:00:00.000Z') === 4);
  check('prune: copies younger than the cutoff stay', store.pruneReplays('2000-01-01T00:00:00.000Z') === 0 && store.pair(copy.pairId) !== null);
  check('prune: older copies go, whole groups', store.pruneReplays('2999-01-01T00:00:00.000Z') === 1 && store.pair(copy.pairId) === null && store.truce(copy.truceId) === null);
  check('prune: the recording itself stays', store.truce(agreed) !== null && store.showcaseOf('couple') === agreed);
}

{
  const view = showcaseOf(store, 'couple');
  check('showcase: the recording\'s people, plan and pool', view !== null && view.names.a === 'Maya' && SLOTS.every((s) => view.plan[s].id === store.truce(agreed)!.result!.bundle[s]) && view.pool.film.length === 1);
  check('showcase: no id that would let anyone act on the recording', !JSON.stringify(view).includes(agreed) && !JSON.stringify(view).includes(store.truce(agreed)!.pairId));
  check('showcase: none for a demo without a recording', showcaseOf(store, 'friends') === null);
}

{
  // A new evening asks tonight's questions again; a demo group keeps its answers.
  store.createPair('own', { mode: 'couple', names: ['Ömer', 'Ceren'], location: 'Istanbul' });
  store.saveSide('own', 'a', side, null);
  store.saveSide('own', 'b', side, null);
  const pair = store.pair('own')!;
  check('tonight: nothing due before the first evening', !tonightDueOf(store, pair, store.sides('own')).a && readyOf(store, pair, store.sides('own')).b === true);
  tick();
  store.createTruce('own-1', 'own', 'rules', { a: 0.5, b: 0.5 }, 'a');
  store.finishTruce('own-1', result('agreed'), { film: 'F1 name', restaurant: 'R1 name', music: 'M1 name' });
  tick();
  check('tonight: due for everyone once the group has had an evening', tonightDueOf(store, pair, store.sides('own')).a === true && readyOf(store, pair, store.sides('own')).a === false);
  store.saveSide('own', 'a', side, null);
  check('tonight: answering again makes that person ready', readyOf(store, pair, store.sides('own')).a === true && readyOf(store, pair, store.sides('own')).b === false);
  let code = '';
  try {
    createRunner({ store, qloo: stubQloo, anthropic: null, dailyCap: 0, log: () => {} }).start('own');
  } catch (err) {
    code = (err as { code?: string }).code ?? '';
  }
  check('tonight: a new evening won\'t start until everyone has answered', code === 'not_ready');
  const demoPair = store.pair('pair-2')!;
  check('tonight: a demo group never asks again', !Object.values(tonightDueOf(store, demoPair, store.sides('pair-2'))).some(Boolean));
}

{
  check('client: an IPv4 address is itself', clientOf('203.0.113.7, 10.0.0.1', 'x') === '203.0.113.7');
  check('client: an IPv6 address counts by its /64', clientOf('2001:db8:1:2:3:4:5:6', 'x') === '2001:db8:1:2' && clientOf('2001:db8:1:2:ffff::1', 'x') === '2001:db8:1:2');
  check('client: anything else shares the fallback', clientOf('not-an-ip', 'x') === 'x' && clientOf(undefined, 'x') === 'x');
  let t = Date.parse('2026-10-24T23:59:00Z');
  const daily = createDaily(2, () => t);
  daily.add();
  daily.add();
  const spent = daily.left() === 0;
  t += 2 * 60_000;
  check('daily: a budget runs out, and starts again the next UTC day', spent && daily.left() === 2);
}

{
  store.createSwap({
    id: 'sw', truceId: agreed, kind: 'swap', side: 'a', slot: 'film', reason: 'unavailable', needed: 0,
    votes: {}, from: null, scores: null, deadline: null,
  });
  check('replay: a recording someone has since swapped on is no longer picked', store.showcaseOf('couple') !== agreed);
}

{
  const busy = createRunner({ store, qloo: stubQloo, anthropic: null, dailyCap: 0, limits: { dailyTotal: 3 }, log: () => {} });
  check('limits: the daily total stops new truces', busy.capacity() === 'daily');
  const low = createRunner({
    store, qloo: { ...stubQloo, quota: () => ({ monthLimit: 50_000, monthRemaining: 900 }) }, anthropic: null, dailyCap: 0, log: () => {},
  });
  check('limits: so does a low Qloo allowance', low.capacity() === 'quota');
  let code = '';
  try {
    busy.start('pair-1');
  } catch (err) {
    code = (err as { code?: string }).code ?? '';
  }
  check('limits: starting then fails with a capacity error', code === 'capacity');
  const fine = createRunner({ store, qloo: stubQloo, anthropic: null, dailyCap: 0, log: () => {} });
  check('limits: room left means no capacity problem', fine.capacity() === null && fine.status().limits.concurrency === 6);
}

store.close();
rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
