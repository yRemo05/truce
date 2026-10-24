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
import { createDemos } from '../src/server/demo';
import { createRunner } from '../src/server/runner';
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
  origins: ['joint'], because: {}, scout: null, serves: {}, links: [], hours: null, address: null,
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
function recorded(how: TruceResult['how'], opts: { receipts?: boolean } = {}): string {
  n++;
  const pairId = `pair-${n}`;
  const truceId = `truce-${n}`;
  store.createPair(pairId, { mode: 'couple', names: ['Maya', 'Deniz'], location: 'Manhattan' }, 'couple');
  store.saveSide(pairId, 'a', side, null);
  store.saveSide(pairId, 'b', side, null);
  store.createEarlier(`earlier-${n}`, pairId, { a: 0.5, b: 0.5 }, 'a', result('agreed'), { film: 'Old', restaurant: 'Old', music: 'Old' }, '2026-10-01T00:00:00.000Z');
  store.createTruce(truceId, pairId, 'claude', { a: 0.5, b: 0.5 }, 'b');
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
  check('replay: copies don\'t count as truces started', store.startedSince('2000-01-01T00:00:00.000Z') === 3);
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
