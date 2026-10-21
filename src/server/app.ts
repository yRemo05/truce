/**
 * The HTTP API (see src/contract.ts for the shapes) and the static web app.
 * Every input is validated with zod, every action is rate-limited per
 * client, and bodies are capped; the demo is public.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { BRIEF_MAX, groundBrief, readBrief, type InterpretedBrief } from '../agents/brief';
import { usageOf } from '../agents/claude-brain';
import { foodsFor } from '../agents/food';
import type {
  ApiError,
  CardItem,
  PairView,
  SearchHit,
  SearchResult,
  SideSaved,
  StreamEvent,
  TruceView,
} from '../contract';
import { QlooError, type QlooClient } from '../qloo/client';
import { FOOD_FAMILIES, locate, searchEntities, type Locality } from '../qloo/queries';
import { KIND_OF_SLOT, MAX_PEOPLE, MIN_PEOPLE, SIDES, SLOTS, perSide, type Side, type Slot } from '../truce/types';
import { eveningIcs } from './calendar';
import { INTERRUPTED, type Store } from './db';
import { createDemos } from './demo';
import { clientOf, createLimiter, type Action } from './limits';
import { costOf, newId, pairLedger, UserFacingError, type Runner } from './runner';

const slot = z.enum(SLOTS);
const side = z.enum(SIDES);
const name = z.string().trim().min(1).max(24);
const location = z.string().trim().min(2).max(60);

const pairInput = z
  .object({
    mode: z.enum(['couple', 'bff']),
    names: z.array(name).min(MIN_PEOPLE).max(MAX_PEOPLE),
    location,
  })
  .refine((p) => p.mode !== 'couple' || p.names.length === 2, 'A couple is two people.')
  .refine((p) => new Set(p.names.map((n) => n.toLowerCase())).size === p.names.length, 'Give everyone a different name.');

const seed = z.object({
  id: z.string().regex(/^[0-9A-Fa-f-]{36}$/, 'not a Qloo entity id'),
  name: z.string().trim().min(1).max(120),
});
// A food's tags go into Qloo queries as filters, so only food tags pass.
const foodTag = z
  .string()
  .max(120)
  .regex(/^urn:tag:[a-z0-9_:.-]+$/, 'not a Qloo tag')
  .refine((id) => FOOD_FAMILIES.some((f) => id.startsWith(f)), 'not a food tag');
const food = z.object({
  name: z.string().trim().min(1).max(60),
  tags: z.array(foodTag).min(1).max(6),
  kind: z.enum(['cuisine', 'dish']),
});
const sideInput = z
  .object({
    seeds: z.object({ film: z.array(seed).max(3), restaurant: z.array(seed).max(3), music: z.array(seed).max(3) }),
    weights: z.object({ film: z.number().min(0).max(100), restaurant: z.number().min(0).max(100), music: z.number().min(0).max(100) }),
    foods: z.array(food).max(3).optional(),
    brief: z.string().trim().max(BRIEF_MAX).optional(),
  })
  // Qloo needs a film, artist or place to read someone's taste from; a food alone isn't one.
  .refine((v) => SLOTS.some((s) => v.seeds[s].length > 0), 'Pick at least one film, artist or restaurant you love.')
  .refine((v) => v.seeds.restaurant.length + (v.foods?.length ?? 0) <= 3, 'Up to three restaurants and foods together.');

const rating = z.enum(['loved', 'fine', 'not_for_me']);
const checkinInput = z.object({
  went: z.boolean(),
  ratings: z.object({ film: rating.optional(), restaurant: rating.optional(), music: rating.optional() }),
});
const demoInput = z.object({ kind: z.enum(['couple', 'friends']).default('couple') });

/** Search hits below this popularity percentile are listed after the rest. */
const OBSCURE = 0.2;

export interface AppDeps {
  store: Store;
  qloo: QlooClient;
  runner: Runner;
  anthropic: Anthropic | null;
  webDir?: string;
}

export function createApp({ store, qloo, runner, anthropic, webDir = 'web/dist' }: AppDeps) {
  const app = new Hono();
  const limiter = createLimiter();
  const demos = createDemos(qloo, anthropic);
  demos.warm();

  const fail = (c: Context, status: number, code: string, message: string, retryAfterSeconds?: number) =>
    c.json<ApiError>({ error: { code, message, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) } }, status as 400);

  const limited = (c: Context, action: Action) => {
    const client = clientOf(c.req.header('x-forwarded-for'), 'local');
    const wait = limiter.hit(action, client);
    return wait ? fail(c, 429, 'rate_limited', 'Slow down a little and try again shortly.', wait) : null;
  };

  app.use('/api/*', bodyLimit({ maxSize: 16 * 1024, onError: (c) => fail(c, 413, 'too_large', 'That request is too large.') }));
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
    // The page is always revalidated, so a deploy reaches open tabs on their next load.
    if (c.res.headers.get('Content-Type')?.startsWith('text/html')) c.header('Cache-Control', 'no-cache');
  });

  app.onError((err, c) => {
    if (err instanceof UserFacingError) return fail(c, err.status, err.code, err.message);
    if (err instanceof z.ZodError) return fail(c, 400, 'invalid', err.issues[0]?.message ?? 'Invalid request.');
    if (err instanceof QlooError && (err.status === 429 || err.retryable)) {
      return fail(c, 503, 'qloo_busy', 'Qloo is busy right now. Try again in a moment.');
    }
    console.error(err);
    return fail(c, 500, 'server_error', 'Something went wrong on our side.');
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  // Place names resolved to a Qloo locality, kept for the process's life. A
  // place Qloo doesn't know is kept as null; a failed lookup is not kept.
  const localities = new Map<string, Promise<Locality | null>>();
  const localityOf = (place: string): Promise<Locality | null> => {
    const key = place.toLocaleLowerCase();
    let found = localities.get(key);
    if (!found) {
      if (localities.size >= 500) localities.clear();
      found = locate(qloo, place).catch((err) => {
        localities.delete(key);
        console.warn(`locating "${place}" failed: ${(err as Error).message}`);
        return null;
      });
      localities.set(key, found);
    }
    return found;
  };

  app.get('/api/search', async (c) => {
    const blocked = limited(c, 'search');
    if (blocked) return blocked;
    const { slot: s, q, near } = z
      .object({ slot, q: z.string().trim().min(1).max(80), near: location.optional() })
      .parse({ slot: c.req.query('slot'), q: c.req.query('q'), near: c.req.query('near') || undefined });
    // A restaurant you love counts most when it is in the city you're going
    // out in, so with `near` the search keeps to it. A place Qloo doesn't know
    // falls back to a worldwide search, and `near: null` says so.
    const area = s === 'restaurant' && near ? await localityOf(near) : null;
    // Qloo ranks by name match only; near-unknown titles ("Moonlight Soul",
    // popularity 0) would crowd out the one people mean, so they go last.
    // A restaurant search also looks for foods: "Lazanya" is a dish, not a place.
    const [found, foods] = await Promise.all([
      searchEntities(qloo, q, KIND_OF_SLOT[s], 8, area ?? undefined),
      s === 'restaurant'
        ? foodsFor(qloo, anthropic, q, (u) => console.log(`food name read, ≈$${costOf([usageOf(u)]).toFixed(5)}`)).catch((err) => {
            console.warn(`foods for "${q}" failed: ${(err as Error).message}`);
            return [];
          })
        : [],
    ]);
    const known = (e: (typeof found)[number]) => (e.popularity ?? 0) >= OBSCURE;
    const hits = [...found.filter(known), ...found.filter((e) => !known(e))].slice(0, 6);
    return c.json<SearchResult>({
      near: area?.name ?? null,
      foods,
      hits: hits.map(
        (e): SearchHit => ({
          id: e.id,
          name: e.name,
          disambiguation: e.disambiguation,
          imageUrl: e.imageUrl,
          blurb: e.blurb,
          year: e.year,
          popularity: e.popularity,
        }),
      ),
    });
  });

  app.post('/api/pairs', async (c) => {
    const blocked = limited(c, 'pair');
    if (blocked) return blocked;
    const input = pairInput.parse(await c.req.json());
    const id = newId();
    store.createPair(id, input);
    return c.json({ id }, 201);
  });

  const pairView = (pairId: string): PairView | null => {
    const pair = store.pair(pairId);
    if (!pair) return null;
    const sides = store.sides(pair.id);
    const last = store.trucesOf(pair.id).filter((t) => !t.earlier).at(-1);
    const said = last ? store.checkinsOf(last.id) : [];
    return {
      id: pair.id,
      mode: pair.mode,
      members: pair.members,
      names: pair.names,
      location: pair.location,
      ready: perSide(pair.members, (s) => Boolean(sides[s])),
      ledger: pairLedger(store, pair),
      lastTruceId: last?.id ?? null,
      lastTruce: last ? { id: last.id, status: last.status, checkedIn: perSide(pair.members, (s) => said.some((x) => x.side === s)) } : null,
    };
  };

  const memberOf = (pairId: string, raw: string): Side => {
    const s = side.parse(raw);
    if (!store.pair(pairId)?.members.includes(s)) throw new UserFacingError('Nobody sits there in this group.', 404, 'not_found');
    return s;
  };

  app.get('/api/pairs/:id', (c) => {
    const view = pairView(c.req.param('id'));
    return view ? c.json<PairView>(view) : fail(c, 404, 'not_found', 'This truce link does not exist.');
  });

  app.patch('/api/pairs/:id', async (c) => {
    const blocked = limited(c, 'side');
    if (blocked) return blocked;
    const pair = store.pair(c.req.param('id'));
    if (!pair) return fail(c, 404, 'not_found', 'This truce link does not exist.');
    const body = z.object({ location }).parse(await c.req.json());
    store.setLocation(pair.id, body.location);
    return c.json<PairView>(pairView(pair.id)!);
  });

  /** Reads and grounds a brief; null without a model. A failed reading keeps the words for the agent. */
  async function interpret(text: string, place: string): Promise<InterpretedBrief | null> {
    if (!anthropic) return null;
    try {
      let usage: Anthropic.Usage | null = null;
      const intent = await readBrief(anthropic, text, (u) => (usage = u));
      const brief = await groundBrief(qloo, text, intent, await localityOf(place));
      if (usage) console.log(`brief read, ≈$${costOf([usageOf(usage)]).toFixed(5)}`);
      return brief;
    } catch (err) {
      console.warn(`reading a brief failed: ${(err as Error).message}`);
      return {
        view: { text, wishes: [], vetoes: [], note: null, unmatched: [] },
        rules: { wishTags: { film: [], restaurant: [], music: [] }, excludeTags: { film: [], restaurant: [], music: [] }, excludeEntities: [], maxPrice: null },
      };
    }
  }

  app.put('/api/pairs/:id/sides/:side', async (c) => {
    const blocked = limited(c, 'side');
    if (blocked) return blocked;
    const pair = store.pair(c.req.param('id'));
    if (!pair) return fail(c, 404, 'not_found', 'This truce link does not exist.');
    const s = memberOf(pair.id, c.req.param('side'));
    const input = sideInput.parse(await c.req.json());
    const text = input.brief?.trim() || undefined;
    const brief = text ? await interpret(text, pair.location) : null;
    store.saveSide(pair.id, s, { ...input, brief: text }, brief);
    const sides = store.sides(pair.id);
    return c.json<SideSaved>({ ready: perSide(pair.members, (x) => Boolean(sides[x])), brief: brief?.view ?? null });
  });

  app.post('/api/pairs/:id/truces', (c) => {
    const blocked = limited(c, 'truce');
    if (blocked) return blocked;
    const pair = store.pair(c.req.param('id'));
    if (!pair) return fail(c, 404, 'not_found', 'This truce link does not exist.');
    return c.json({ truceId: runner.start(pair.id) }, 201);
  });

  app.post('/api/demo', async (c) => {
    const blocked = limited(c, 'demo');
    if (blocked) return blocked;
    const raw = await c.req.text();
    const { kind } = demoInput.parse(raw ? JSON.parse(raw) : {});
    const pairId = await demos.create(store, kind);
    return c.json({ pairId, truceId: runner.start(pairId) }, 201);
  });

  app.get('/api/truces/:id', (c) => {
    const truce = store.truce(c.req.param('id'));
    if (!truce) return fail(c, 404, 'not_found', 'This truce does not exist.');
    const pair = store.pair(truce.pairId)!;
    const said = store.checkinsOf(truce.id);
    // A failed truce from before restarts closed their logs still ends, for the page, in the interruption.
    const last = truce.events.at(-1)?.type;
    const events = truce.status === 'failed' && last !== 'error' && last !== 'ledger' ? [...truce.events, INTERRUPTED] : truce.events;
    return c.json<TruceView>({
      id: truce.id,
      pairId: truce.pairId,
      status: truce.status,
      mode: pair.mode,
      members: pair.members,
      names: pair.names,
      location: pair.location,
      createdAt: truce.createdAt,
      endedAt: truce.finishedAt,
      checkedIn: perSide(pair.members, (s) => said.some((x) => x.side === s)),
      events,
    });
  });

  app.get('/api/truces/:id/calendar.ics', (c) => {
    const truce = store.truce(c.req.param('id'));
    if (!truce?.result) return fail(c, 404, 'not_found', 'This evening is not planned yet.');
    const pool = truce.events.find((e): e is Extract<StreamEvent, { type: 'pool' }> => e.type === 'pool');
    // Truces from before plans existed have no `tonight` to put in a calendar.
    if (!pool?.tonight) return fail(c, 404, 'not_found', 'This evening has no date to add to a calendar.');
    const items = Object.fromEntries(
      SLOTS.map((s) => [s, pool.items[s].find((i) => i.id === truce.result!.bundle[s])]),
    ) as Record<Slot, CardItem | undefined>;
    if (SLOTS.some((s) => !items[s])) return fail(c, 404, 'not_found', 'This evening is not planned yet.');
    const host = new URL(c.req.url).host;
    const ics = eveningIcs({ truceId: truce.id, tonight: pool.tonight, items: items as Record<Slot, CardItem>, host });
    return c.body(ics, 200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="truce-evening.ics"',
    });
  });

  app.put('/api/truces/:id/checkins/:side', async (c) => {
    const blocked = limited(c, 'checkin');
    if (blocked) return blocked;
    const truce = store.truce(c.req.param('id'));
    if (!truce) return fail(c, 404, 'not_found', 'This truce does not exist.');
    const s = memberOf(truce.pairId, c.req.param('side'));
    const input = checkinInput.parse(await c.req.json());
    return c.json(runner.checkin(truce.id, s, input));
  });

  app.get('/api/truces/:id/stream', (c) => {
    const id = c.req.param('id');
    const truce = store.truce(id);
    if (!truce) return fail(c, 404, 'not_found', 'This truce does not exist.');
    // Resume point: ?from=n, else the browser's Last-Event-ID + 1, else the start.
    const fromQuery = Number(c.req.query('from'));
    const lastId = Number(c.req.header('last-event-id'));
    const from = Number.isInteger(fromQuery) && fromQuery >= 0 ? fromQuery : Number.isInteger(lastId) ? lastId + 1 : 0;

    return streamSSE(c, async (stream) => {
      // Each event's id is its index in the truce's log.
      let next = 0;
      const send = async (e: StreamEvent) => {
        const id = next++;
        if (id >= from) await stream.writeSSE({ id: String(id), data: JSON.stringify(e) });
      };
      const queue: StreamEvent[] = [];
      let wake: (() => void) | null = null;
      const following = runner.follow(id, (e) => {
        queue.push(e);
        wake?.();
      });
      if (!following) {
        // Finished (or cut off): replay what was stored and close. A log that
        // doesn't end the way a truce ends gets the interruption, so no page waits on it.
        const events = store.truce(id)!.events;
        for (const e of events) await send(e);
        const last = events.at(-1)?.type;
        if (last !== 'ledger' && last !== 'error') await send(INTERRUPTED);
        return;
      }
      stream.onAbort(() => following.stop());
      const ping = setInterval(() => void stream.write(': ping\n\n'), 15_000);
      try {
        for (const e of following.past) await send(e);
        let ended = following.past.some((e) => e.type === 'ledger' || e.type === 'error');
        while (!ended && !stream.aborted) {
          if (!queue.length) await new Promise<void>((r) => (wake = r));
          wake = null;
          while (queue.length) {
            const e = queue.shift()!;
            await send(e);
            if (e.type === 'ledger' || e.type === 'error') ended = true;
          }
        }
      } finally {
        clearInterval(ping);
        following.stop();
      }
    });
  });

  app.all('/api/*', (c) => fail(c, 404, 'not_found', 'No such endpoint.'));

  // The web app: static files, and index.html for client-side routes. Built
  // assets carry a content hash, so they are cached for good; the page itself
  // is always revalidated, and a missing asset is a 404 rather than the page
  // (after a redeploy, a stale tab must not get HTML where it asked for code).
  if (existsSync(webDir)) {
    const index = readFileSync(`${webDir}/index.html`, 'utf8');
    app.use('/assets/*', async (c, next) => {
      await next();
      if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable');
    });
    app.use('/*', serveStatic({ root: webDir }));
    app.get('/assets/*', (c) => c.text('Not found', 404));
    app.get('*', (c) => c.html(index));
  }

  return app;
}
