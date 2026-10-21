/**
 * Live smoke run against Qloo: resolves a demo pair's seeds, builds the
 * shared pool, and prints each side's utilities, the fair evening at three
 * ledger tilts, and how often a tilt changes the evening. Uses the network
 * and the hackathon key; responses are cached in data/qloo-cache.json.
 * Run with `npm run smoke`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createQlooClient, type QlooCache } from '../src/qloo/client';
import { searchEntities, type SlotKind } from '../src/qloo/queries';
import { enumerateBundles, nashBundle, paretoFrontier, scoreBundles } from '../src/truce/bargain';
import { buildPool, type PersonSeeds } from '../src/truce/pool';
import { KIND_OF_SLOT, SLOTS, type Slot } from '../src/truce/types';
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

const demo: Record<'a' | 'b', Record<Slot, string>> = {
  a: { film: 'In the Mood for Love', restaurant: 'Carbone New York', music: 'Radiohead' },
  b: { film: 'Mad Max: Fury Road', restaurant: 'Shake Shack Madison Square Park', music: 'Bad Bunny' },
};

async function resolve(names: Record<Slot, string>): Promise<PersonSeeds> {
  const seeds = {} as PersonSeeds['seeds'];
  for (const slot of SLOTS) {
    const [top] = await searchEntities(qloo, names[slot], KIND_OF_SLOT[slot] as SlotKind, 1);
    seeds[slot] = top ? [top.id] : [];
    console.log(`  ${slot.padEnd(10)} "${names[slot]}" -> ${top ? `${top.name} (${top.disambiguation ?? ''})` : 'NOT FOUND'}`);
  }
  return { seeds };
}

console.log('Seeds A:');
const a = await resolve(demo.a);
console.log('Seeds B:');
const b = await resolve(demo.b);

const t0 = Date.now();
const pool = await buildPool(qloo, { a, b }, { place: { locationQuery: 'Manhattan', priceMin: 2, popularityMin: 0.6 } });
console.log(`\nPool built in ${Date.now() - t0} ms (cached calls are instant)`);

for (const slot of SLOTS) {
  console.log(`\n## ${slot}   indifferent: A=${pool.indifferent.a[slot]} B=${pool.indifferent.b[slot]}`);
  for (const item of pool.items[slot]) {
    const ua = pool.utilities.a[slot][item.id]!;
    const ub = pool.utilities.b[slot][item.id]!;
    const ra = pool.affinity.a[slot][item.id];
    const rb = pool.affinity.b[slot][item.id];
    console.log(
      `  ${item.name.slice(0, 34).padEnd(34)} uA=${ua.toFixed(2)} uB=${ub.toFixed(2)}  raw ${ra?.toFixed(3) ?? '—'}/${rb?.toFixed(3) ?? '—'}  from ${item.origins.join('+')}`,
    );
  }
}

const name = (slot: Slot, id: string) => pool.items[slot].find((i) => i.id === id)?.name ?? id;
const weightSets = {
  equal: { a: normalizeWeights({}), b: normalizeWeights({}) },
  'A film-first, B food-first': {
    a: normalizeWeights({ film: 0.6, restaurant: 0.2, music: 0.2 }),
    b: normalizeWeights({ film: 0.2, restaurant: 0.6, music: 0.2 }),
  },
};
const bundles = enumerateBundles(Object.fromEntries(SLOTS.map((s) => [s, pool.items[s].map((i) => i.id)])) as Record<Slot, string[]>);
for (const [label, w] of Object.entries(weightSets)) {
  const scored = scoreBundles(bundles, { a: { utilities: pool.utilities.a, weights: w.a }, b: { utilities: pool.utilities.b, weights: w.b } });
  console.log(`\n### weights: ${label}  (${bundles.length} bundles, ${paretoFrontier(scored).length} on the Pareto frontier)`);
  for (const alpha of [0.35, 0.5, 0.65]) {
    const fair = nashBundle(scored, alpha);
    console.log(
      `  α_A=${alpha}: UA=${fair.a.toFixed(2)} UB=${fair.b.toFixed(2)}  ${SLOTS.map((s) => name(s, fair.bundle[s])).join(' · ')}`,
    );
  }
}
console.log(`\nQloo quota left this month: ${qloo.quota().monthRemaining ?? 'unknown (all cached)'}`);
