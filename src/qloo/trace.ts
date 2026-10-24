/**
 * Receipts: a Qloo client that writes down every call it makes for one truce,
 * so anyone can see what Qloo contributed to the evening. Each call keeps its
 * endpoint and parameters (ids, tags, filters and place names: nothing about
 * a person, and never the key, which travels in a header), how long it took,
 * whether the private cache answered, and how many results came back. The
 * responses themselves aren't kept.
 */
import type { Params, QlooClient } from './client';

export type CallPhase = 'gathering' | 'scouting' | 'scoring';

export interface QlooCall {
  phase: CallPhase;
  /** In plain words: "Restaurants in Manhattan for 3 favourites". */
  what: string;
  endpoint: string;
  params: Record<string, string>;
  ms: number;
  cached: boolean;
  /** Results in the answer; null when the call failed. */
  results: number | null;
}

const KIND: Record<string, string> = {
  'urn:entity:movie': 'Films',
  'urn:entity:artist': 'Artists',
  'urn:entity:place': 'Places',
};

const count = (v: string | undefined) => (v ? v.split(',').length : 0);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** One call in plain words, from its endpoint and parameters alone. */
export function describeCall(endpoint: string, p: Record<string, string>): string {
  if (endpoint === '/search') return `Search for "${p.query}"`;
  if (endpoint === '/v2/tags') return `Tags matching "${p['filter.query']}"`;
  const type = p['filter.type'];
  const where = p['filter.location.query'] ? ` in ${p['filter.location.query']}` : p['filter.location'] ? ' around a point' : '';
  const seeds = count(p['signal.interests.entities']);
  if (type === 'urn:heatmap') return `Where ${plural(seeds, 'favourite')}' taste concentrates${where}`;
  if (type === 'urn:tag') return `Taste words for ${plural(seeds, 'favourite')}`;
  const kind = KIND[type ?? ''] ?? 'Entities';
  if (p['filter.results.entities']) {
    return `Score ${plural(count(p['filter.results.entities']), kind.toLowerCase().replace(/s$/, ''))} against ${plural(seeds, 'favourite')}${p['feature.explainability'] ? ', with reasons' : ''}`;
  }
  // A locality lookup: one restaurant, just to learn where the place name points.
  if (!seeds && p['filter.location.query']) return `Find "${p['filter.location.query']}" on the map`;
  const food = p['operator.filter.tags'] === 'union' ? ' serving a food' : '';
  return `${kind}${food}${where} for ${plural(seeds, 'favourite')}`;
}

function resultsOf(body: unknown): number | null {
  const r = (body as { results?: unknown } | null)?.results;
  if (Array.isArray(r)) return r.length;
  if (r && typeof r === 'object') {
    for (const k of ['entities', 'tags', 'heatmap']) {
      const v = (r as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v.length;
    }
  }
  return null;
}

const MAX_VALUE = 400;

/** A client for one truce: the same calls, each recorded under the current phase. */
export function traced(qloo: QlooClient, phase: () => CallPhase, record: (call: QlooCall) => void): QlooClient {
  return {
    quota: () => qloo.quota(),
    async get(path: string, params: Params, info?: { cached?: boolean }) {
      const shown = Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v).slice(0, MAX_VALUE)]),
      );
      const seen: { cached?: boolean } = {};
      const started = Date.now();
      const done = (results: number | null) =>
        record({ phase: phase(), what: describeCall(path, shown), endpoint: path, params: shown, ms: Date.now() - started, cached: seen.cached ?? false, results });
      try {
        const body = await qloo.get(path, params, seen);
        if (info) info.cached = seen.cached;
        done(resultsOf(body));
        return body;
      } catch (err) {
        done(null);
        throw err;
      }
    },
  };
}
