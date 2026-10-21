/**
 * A full live truce: the demo pair's pool from Qloo, two Claude Haiku 5.5
 * agents, the referee. Prints the transcript as it happens and what the
 * negotiation cost. Uses the network, the Qloo key and the Anthropic key.
 * Run with `npm run live -- [alphaA] [opener]`, e.g. `npm run live -- 0.65 b`.
 */
import Anthropic from '@anthropic-ai/sdk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ClaudeBrain, type UsageReport } from '../src/agents/claude-brain';
import { createQlooClient, type QlooCache } from '../src/qloo/client';
import { searchEntities } from '../src/qloo/queries';
import { negotiate } from '../src/truce/negotiate';
import { buildPool, type PersonSeeds } from '../src/truce/pool';
import { KIND_OF_SLOT, SLOTS, type Side, type Slot } from '../src/truce/types';
import { normalizeWeights } from '../src/truce/utility';

const CACHE_FILE = 'data/qloo-cache.json';
mkdirSync('data', { recursive: true });
const store: Record<string, string> = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, 'utf8')) : {};
const cache: QlooCache = {
  get: (k) => store[k],
  set: (k, v) => {
    store[k] = v;
    writeFileSync(CACHE_FILE, JSON.stringify(store));
  },
};
const qloo = createQlooClient({
  baseUrl: process.env.QLOO_BASE_URL ?? 'https://hackathon.api.qloo.com',
  apiKey: process.env.QLOO_API_KEY ?? '',
  cache,
});

const alphaA = Number(process.argv[2] ?? 0.5);
const opener = (process.argv[3] ?? 'a') as Side;
const names = { a: 'Maya', b: 'Deniz' };
const loves: Record<Side, Record<Slot, string>> = {
  a: { film: 'In the Mood for Love', restaurant: 'Carbone New York', music: 'Radiohead' },
  b: { film: 'Mad Max: Fury Road', restaurant: 'Shake Shack Madison Square Park', music: 'Bad Bunny' },
};

const seedNames: Record<string, string> = {};
async function resolve(side: Side): Promise<PersonSeeds> {
  const seeds = {} as PersonSeeds['seeds'];
  for (const slot of SLOTS) {
    const [top] = await searchEntities(qloo, loves[side][slot], KIND_OF_SLOT[slot], 1);
    seeds[slot] = top ? [top.id] : [];
    if (top) seedNames[top.id] = top.name;
  }
  return { seeds };
}

const people = { a: await resolve('a'), b: await resolve('b') };
const pool = await buildPool(qloo, people, { place: { locationQuery: 'Manhattan', priceMin: 2, popularityMin: 0.6 } });
const nameOf = (slot: Slot, id: string) => pool.items[slot].find((i) => i.id === id)?.name ?? id;
const evening = (b: Record<Slot, string>) => SLOTS.map((s) => nameOf(s, b[s])).join(' · ');

const usage: UsageReport[] = [];
const client = new Anthropic();
const brain = new ClaudeBrain(client, { onUsage: (u) => usage.push(u) });
const t0 = Date.now();
let lastTick = t0;

const result = await negotiate(
  pool,
  {
    mode: 'couple',
    names,
    weights: { a: normalizeWeights({}), b: normalizeWeights({}) },
    seedNames,
    seeds: { a: people.a.seeds, b: people.b.seeds },
    alphaA,
    opener,
  },
  { a: brain, b: brain },
  (e) => {
    const now = Date.now();
    const dt = `${((now - lastTick) / 1000).toFixed(1)}s`;
    lastTick = now;
    if (e.type === 'move') {
      console.log(`\n[turn ${e.turn}, ${dt}] ${names[e.side]}'s agent ${e.action === 'accept' ? 'ACCEPTS' : 'offers'}: ${evening(e.bundle)}`);
      console.log(`   "${e.message}"`);
      console.log(`   scores Maya ${e.scores.a} · Deniz ${e.scores.b}   (${e.brain})`);
    } else if (e.type === 'rejected') console.log(`   ! referee rejected ${names[e.side]}'s move: ${e.reason}`);
    else if (e.type === 'declined') console.log(`\n[last call, ${dt}] ${names[e.side]}'s agent declines: "${e.message}"`);
    else if (e.type === 'ruling') console.log(`\nReferee rules: ${evening(e.bundle)}`);
    else if (e.type === 'polish') console.log(`\nReferee polish: ${evening(e.from)} -> ${evening(e.to)}`);
    else if (e.type === 'start') console.log(`Truce starts: α_A=${e.alphaA}, ${names[e.opener]} opens, ${e.turns} turns`);
  },
);

console.log(`\nEvening: ${evening(result.bundle)}  (${result.how}${result.polished ? ', polished' : ''}, ${result.turnsUsed} turns, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
console.log(`Maya ${Math.round(result.utilities.a * 100)}/${Math.round(result.best.a * 100)} · Deniz ${Math.round(result.utilities.b * 100)}/${Math.round(result.best.b * 100)}  · fair was ${evening(result.fair.bundle)}`);

// Haiku 5.5 under 100K-token prompts: $0.10 / $0.50 per MTok; cache reads 0.1×, 5-minute cache writes 1.25×.
const sum = (k: keyof UsageReport) => usage.reduce((t, u) => t + u[k], 0);
const cost = (sum('inputTokens') * 0.1 + sum('cacheReadTokens') * 0.01 + sum('cacheWriteTokens') * 0.125 + sum('outputTokens') * 0.5) / 1e6;
console.log(
  `\nModel calls: ${usage.length} · input ${sum('inputTokens')} · cache read ${sum('cacheReadTokens')} · cache write ${sum('cacheWriteTokens')} · output ${sum('outputTokens')} · ≈ $${cost.toFixed(4)}`,
);
