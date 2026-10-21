/**
 * A full live truce through the real server pipeline: a demo group (with its
 * briefs and earlier evenings), Qloo candidates, the scouting round, two to
 * three Claude Haiku 5.5 agents, the referee and the ledger, then a check-in.
 * Prints the event stream as it happens and what it cost. Uses the network,
 * the Qloo key and the Anthropic key; keeps its own database in data/live.
 * Run with `npm run live -- [couple|friends]`.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { StreamEvent } from '../src/contract';
import { createQlooClient } from '../src/qloo/client';
import { openStore } from '../src/server/db';
import { createDemos } from '../src/server/demo';
import { createRunner } from '../src/server/runner';
import { SLOTS, at, type PerSide, type Side } from '../src/truce/types';

const kind = (process.argv[2] ?? 'couple') as 'couple' | 'friends';
const store = openStore('data/live');
const qloo = createQlooClient({
  baseUrl: process.env.QLOO_BASE_URL ?? 'https://hackathon.api.qloo.com',
  apiKey: process.env.QLOO_API_KEY ?? '',
  cache: store.qlooCache,
});
const anthropic = new Anthropic();
const runner = createRunner({ store, qloo, anthropic, dailyCap: 1000 });
const demos = createDemos(qloo, anthropic);

const t0 = Date.now();
const pairId = await demos.create(store, kind);
const pair = store.pair(pairId)!;
const who = (s: Side) => at(pair.names, s);
const scores = (x: PerSide<number>) => pair.members.map((s) => `${who(s)} ${x[s]}`).join(' · ');
console.log(`${kind}: ${pair.members.map(who).join(', ')} in ${pair.location}`);
for (const s of pair.members) {
  const brief = store.sides(pairId)[s]?.brief;
  if (brief) console.log(`  ${who(s)}'s brief: "${brief.view.text}" → wishes ${brief.view.wishes.map((u) => u.matched).join(', ') || '-'} · vetoes ${brief.view.vetoes.map((u) => u.matched).join(', ') || '-'}${brief.view.unmatched.length ? ` · unmatched ${brief.view.unmatched.join(', ')}` : ''}`);
}

const truceId = runner.start(pairId);
let names: Record<string, string> = {};
const evening = (b: Record<string, string>) => SLOTS.map((s) => names[b[s]!] ?? b[s]).join(' · ');
const dt = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

await new Promise<void>((resolve) => {
  const print = (e: StreamEvent) => {
    if (e.type === 'status') console.log(`\n[${dt()}] ${e.phase} (${e.brain})`);
    else if (e.type === 'tastes') {
      for (const s of pair.members) console.log(`  ${who(s)}: ${e.portraits[s]?.join(', ') || '-'}`);
      if (e.vetoes.length) console.log(`  vetoes: ${e.vetoes.join(' · ')}`);
    } else if (e.type === 'scout') {
      if (e.step === 'search') console.log(`  ${who(e.side)}'s agent searched ${e.slot} like [${e.like.join(', ')}] words [${e.words.join(', ')}→${e.matched.join(', ')}]${e.area ? ` in ${e.area}` : ''}: ${e.found.map((f) => f.name).join(' / ') || 'nothing'}`);
      if (e.step === 'add') console.log(`  + ${who(e.side)}'s agent added ${e.item.name} (${e.slot}): "${e.why}"`);
      if (e.step === 'done' && e.message) console.log(`  ${who(e.side)}'s agent: "${e.message}"`);
    } else if (e.type === 'pool') {
      names = Object.fromEntries(SLOTS.flatMap((s) => e.items[s].map((i) => [i.id, i.name])));
      console.log(`  pool: ${SLOTS.map((s) => `${e.items[s].length} ${s}`).join(', ')} · tonight ${e.tonight.weekday} ${e.tonight.date} (${e.tonight.timeZone})`);
      const closed = e.items.restaurant.filter((i) => i.hours?.openTonight === false).length;
      console.log(`  restaurants with hours today: ${e.items.restaurant.filter((i) => i.hours?.today).length}/${e.items.restaurant.length}, closed tonight: ${closed}`);
    } else if (e.type === 'start') console.log(`  order ${e.order.map(who).join(' → ')}, ${e.turns} turns, weights ${pair.members.map((s) => `${who(s)} ${e.alpha[s]?.toFixed(2)}`).join(' · ')}`);
    else if (e.type === 'move') {
      console.log(`\n[${dt()}] turn ${e.turn} ${who(e.side)}'s agent ${e.action === 'accept' ? 'ACCEPTS' : 'offers'}: ${evening(e.bundle)}  (yes: ${e.acceptedBy.map(who).join(', ')})`);
      console.log(`   "${e.message}"`);
      console.log(`   ${scores(e.scores)}   (${e.brain})`);
    } else if (e.type === 'rejected') console.log(`   ! referee rejected ${who(e.side)}'s move: ${e.reason}`);
    else if (e.type === 'declined') console.log(`\n[${dt()}] last call: ${who(e.side)}'s agent declines: "${e.message}"`);
    else if (e.type === 'ruling') console.log(`\nReferee rules: ${evening(e.bundle)}  ${scores(e.scores)}`);
    else if (e.type === 'polish') console.log(`\nReferee polish: ${evening(e.from)} -> ${evening(e.to)}`);
    else if (e.type === 'done') console.log(`\nEvening: ${evening(e.result.bundle)} (${e.result.how}${e.result.polished ? ', polished' : ''}, ${e.result.turnsUsed} turns)`);
    else if (e.type === 'ledger') console.log(`Ledger: next weights ${pair.members.map((s) => `${who(s)} ${e.after.alpha[s]?.toFixed(2)}`).join(' · ')}, owed ${e.after.owed ? who(e.after.owed) : 'nobody'}`);
    else if (e.type === 'error') console.log(`ERROR ${e.code}: ${e.message}`);
    if (e.type === 'ledger' || e.type === 'error') resolve();
  };
  const following = runner.follow(truceId, print);
  following?.past.forEach(print);
});

const truce = store.truce(truceId)!;
if (truce.result) {
  // The first person loved the film; the last didn't care for the restaurant.
  const first = pair.members[0]!;
  const last = pair.members.at(-1)!;
  runner.checkin(truceId, first, { went: true, ratings: { film: 'loved' } });
  const out = runner.checkin(truceId, last, { went: true, ratings: { restaurant: 'not_for_me' } });
  console.log(`\nCheck-ins: ${who(first)} loved the film; ${who(last)} didn't like the restaurant.`);
  console.log(`  learned for ${who(last)}: avoid ${out.learned.avoided.map((x) => x.name).join(', ')}`);
  console.log(`  next weights ${pair.members.map((s) => `${who(s)} ${out.ledger.alpha[s]?.toFixed(2)}`).join(' · ')}`);
}
console.log(`\n${dt()} total · qloo quota left ${qloo.quota().monthRemaining ?? '?'} (cost is in the runner's log line above)`);
store.close();
