// One-off probe of the live Qloo hackathon API: records every raw response
// under .qloo-cache/probe/ (gitignored: Qloo data must stay out of the public
// repo) and prints only the shape of each body, so we learn what the API
// actually returns before building on the docs.
// Usage: node --env-file=.env scripts/probe.mjs
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = process.env.QLOO_BASE_URL ?? 'https://hackathon.api.qloo.com';
const KEY = process.env.QLOO_API_KEY;
if (!KEY) throw new Error('QLOO_API_KEY is empty in .env');

const OUT = '.qloo-cache/probe';
await mkdir(OUT, { recursive: true });

let n = 0;
async function call(name, path, params) {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, String(v));
  const started = Date.now();
  const res = await fetch(url, { headers: { 'X-Api-Key': KEY } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  const headers = Object.fromEntries(
    [...res.headers].filter(([h]) => /rate|limit|quota|remaining|retry|request-id/i.test(h)),
  );
  const file = `${OUT}/${String(++n).padStart(2, '0')}-${name}.json`;
  await writeFile(file, JSON.stringify({ url: url.pathname + url.search, status: res.status, ms: Date.now() - started, headers, body }, null, 2));
  console.log(`\n## ${n} ${name}  ${res.status}  ${Date.now() - started}ms  ${url.pathname}${url.search}`);
  if (Object.keys(headers).length) console.log('headers', headers);
  console.log(shape(body).join('\n'));
  return body;
}

// Key paths with types; arrays show their length and the union of their first items' shapes.
function shape(v, path = '$', out = [], depth = 0) {
  if (depth > 7) return out;
  if (Array.isArray(v)) {
    out.push(`${path}: array(${v.length})`);
    const seen = new Set();
    for (const item of v.slice(0, 3)) for (const line of shape(item, `${path}[]`, [], depth + 1)) if (!seen.has(line)) { seen.add(line); out.push(line); }
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) shape(x, `${path}.${k}`, out, depth + 1);
  } else {
    const sample = typeof v === 'string' ? JSON.stringify(v.length > 40 ? v.slice(0, 40) + '…' : v) : String(v);
    out.push(`${path}: ${v === null ? 'null' : typeof v} = ${sample}`);
  }
  return out;
}

const first = (body) => (body?.results?.entities ?? body?.results ?? [])[0];
const ids = (body) => (body?.results?.entities ?? body?.results ?? []).map((e) => e.entity_id).filter(Boolean);

// Entity search across the three Truce slots, plus Turkish coverage.
const movie = first(await call('search-movie', '/search', { query: 'In the Mood for Love', types: 'urn:entity:movie', take: 3 }));
const movie2 = first(await call('search-movie-2', '/search', { query: 'Mad Max: Fury Road', types: 'urn:entity:movie', take: 3 }));
const artist = first(await call('search-artist', '/search', { query: 'Radiohead', types: 'urn:entity:artist', take: 3 }));
const artist2 = first(await call('search-artist-2', '/search', { query: 'Bad Bunny', types: 'urn:entity:artist', take: 3 }));
await call('search-artist-tr', '/search', { query: 'Tarkan', types: 'urn:entity:artist', take: 3 });
await call('search-movie-tr', '/search', { query: 'Kuru Otlar Üstüne', types: 'urn:entity:movie', take: 3 });
const place = first(await call('search-place', '/search', { query: 'Carbone', types: 'urn:entity:place', take: 3 }));

const A = [movie?.entity_id, artist?.entity_id].filter(Boolean).join(',');
const B = [movie2?.entity_id, artist2?.entity_id].filter(Boolean).join(',');

// Same-domain and cross-domain insights from one person's seeds.
const recA = await call('insights-movie-A', '/v2/insights', { 'filter.type': 'urn:entity:movie', 'signal.interests.entities': A, take: 5 });
const recB = await call('insights-movie-B', '/v2/insights', { 'filter.type': 'urn:entity:movie', 'signal.interests.entities': B, take: 5 });
await call('insights-movie-A-explain', '/v2/insights', { 'filter.type': 'urn:entity:movie', 'signal.interests.entities': A, take: 3, 'feature.explainability': 'true' });
await call('insights-artist-from-A', '/v2/insights', { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': A, take: 5 });
await call('insights-place-nyc-A', '/v2/insights', { 'filter.type': 'urn:entity:place', 'signal.interests.entities': A, 'filter.location.query': 'New York', take: 5 });
await call('insights-place-ist-A', '/v2/insights', { 'filter.type': 'urn:entity:place', 'signal.interests.entities': A, 'filter.location.query': 'Istanbul', take: 5 });

// Shortlist scoring: does filter.results.entities score a fixed pool for each person?
const pool = [...new Set([...ids(recA), ...ids(recB)])].slice(0, 8).join(',');
if (pool) {
  await call('shortlist-for-A', '/v2/insights', { 'filter.type': 'urn:entity:movie', 'signal.interests.entities': A, 'filter.results.entities': pool, take: 10 });
  await call('shortlist-for-B', '/v2/insights', { 'filter.type': 'urn:entity:movie', 'signal.interests.entities': B, 'filter.results.entities': pool, take: 10 });
}

// Population prior (no signal), tags, entity lookup, taste analysis, compare.
await call('insights-movie-nosignal', '/v2/insights', { 'filter.type': 'urn:entity:movie', take: 5 });
await call('tags-cozy', '/v2/tags', { 'filter.query': 'cozy', take: 5 });
await call('tags-italian', '/v2/tags', { 'filter.query': 'italian', take: 5 });
if (movie?.entity_id) await call('entities-by-id', '/entities', { entity_ids: movie.entity_id });
await call('taste-analysis-A', '/v2/insights', { 'filter.type': 'urn:tag', 'signal.interests.entities': A, take: 5 });
if (A && B) await call('compare-A-B', '/v2/analysis/compare', { 'a.signal.interests.entities': A, 'b.signal.interests.entities': B, take: 5 });
if (place?.entity_id) await call('entities-place', '/entities', { entity_ids: place.entity_id });

console.log(`\n${n} calls, raw bodies in ${OUT}/`);
