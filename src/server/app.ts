/**
 * The HTTP API (see src/contract.ts for the shapes) and the static web app.
 * Every input is validated with zod, every action is rate-limited per
 * client, and bodies are capped; the demo is public.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
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
  SwapsView,
  TruceView,
  DemoStarted,
  ReceiptsView,
} from '../contract';
import { QlooError, type QlooClient } from '../qloo/client';
import { FOOD_FAMILIES, locate, searchEntities, type Locality } from '../qloo/queries';
import { KIND_OF_SLOT, MAX_PEOPLE, MIN_PEOPLE, SIDES, SLOTS, perSide, type Side, type Slot } from '../truce/types';
import { eveningIcs } from './calendar';
import { INTERRUPTED, type SideRow, type Store } from './db';
import { createDemos } from './demo';
import { clientOf, createDaily, createLimiter, type Action } from './limits';
import { costOf, newId, pairLedger, readyOf, tonightDueOf, UserFacingError, type Runner } from './runner';
import { createSwaps } from './swaps';

const slot = z.enum(SLOTS);
const side = z.enum(SIDES);
// People's words go into other people's screens and agents: no control or invisible formatting characters.
const plain = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\p{Cc}\p{Cf}]+$/u, 'Use plain text, please.');
const name = plain(24);
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
  name: plain(120),
});
// A food's tags go into Qloo queries as filters, so only food tags pass.
const foodTag = z
  .string()
  .max(120)
  .regex(/^urn:tag:[a-z0-9_:.-]+$/, 'not a Qloo tag')
  .refine((id) => FOOD_FAMILIES.some((f) => id.startsWith(f)), 'not a food tag');
const food = z.object({
  name: plain(60),
  tags: z.array(foodTag).min(1).max(6),
  kind: z.enum(['cuisine', 'dish']),
});
const sideFields = z.object({
  seeds: z.object({ film: z.array(seed).max(3), restaurant: z.array(seed).max(3), music: z.array(seed).max(3) }),
  weights: z.object({ film: z.number().min(0).max(100), restaurant: z.number().min(0).max(100), music: z.number().min(0).max(100) }),
  foods: z.array(food).max(3).optional(),
  brief: z.string().trim().max(BRIEF_MAX).optional(),
});
const sideInput = sideFields
  // Qloo needs a film, artist or place to read someone's taste from; a food alone isn't one.
  .refine((v) => SLOTS.some((s) => v.seeds[s].length > 0), 'Pick at least one film, artist or restaurant you love.')
  .refine((v) => v.seeds.restaurant.length + (v.foods?.length ?? 0) <= 3, 'Up to three restaurants and foods together.');
const tonightInput = sideFields.omit({ seeds: true });

const rating = z.enum(['loved', 'fine', 'not_for_me']);
const checkinInput = z.object({
  went: z.boolean(),
  ratings: z.object({ film: rating.optional(), restaurant: rating.optional(), music: rating.optional() }),
});
const demoInput = z.object({ kind: z.enum(['couple', 'friends']).default('couple'), replay: z.boolean().optional() });
const swapInput = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('swap'), side, slot, reason: z.enum(['unavailable', 'seen', 'not_feeling']) })
    .refine((v) => v.reason !== 'seen' || v.slot === 'film', '"Seen it" is for the film.'),
  z.object({ kind: z.literal('replan'), side }),
]);
const voteInput = z.object({ vote: z.enum(['yes', 'no']) });
const cancelInput = z.object({ side });

/** Search hits below this popularity percentile are listed after the rest. */
const OBSCURE = 0.2;

/** Qloo calls (cache misses) search and briefs may make per UTC day, all clients together. */
const SIDE_QLOO_DAILY = 3000;
/** Model calls search (reading a food) and briefs may make per UTC day. */
const SIDE_MODEL_DAILY = 2000;
/** Instant replays per UTC day, all clients together (each copies about 80 KB), and how long their copies stay. */
const REPLAYS_DAILY = 3000;
const REPLAY_DAYS = 3;

/** The page loads only its own scripts; images come from Qloo's CDNs, fonts from Google. */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' https: data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

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
  const swaps = createSwaps({ store, runner });
  swaps.resume();
  // Instant-replay copies are a visitor's to play with for a few days, then they go, so they can't fill the disk.
  const prune = () => {
    const gone = store.pruneReplays(new Date(Date.now() - REPLAY_DAYS * 86_400_000).toISOString());
    if (gone) console.log(`pruned ${gone} replayed demo groups`);
  };
  prune();
  setInterval(prune, 60 * 60_000).unref();
  const replaysToday = createDaily(REPLAYS_DAILY);

  const fail = (c: Context, status: number, code: string, message: string, retryAfterSeconds?: number) =>
    c.json<ApiError>({ error: { code, message, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) } }, status as 400);

  const demoLocked = (c: Context) => fail(c, 403, 'demo', 'The demo’s people keep their picks. Make your own group to choose yours.');

  /** Rate-limits one client on each of `actions`; the first one over its limit answers 429. */
  const limited = (c: Context, ...actions: Action[]) => {
    const client = clientOf(c.req.header('x-forwarded-for'), 'local');
    for (const action of actions) {
      const wait = limiter.hit(action, client);
      if (wait) return fail(c, 429, 'rate_limited', 'Slow down a little and try again shortly.', wait);
    }
    return null;
  };

  // Search and briefs spend outside truces: a daily budget of each, and Qloo
  // keeps twice the truces' reserve back from them, so they can't starve a truce.
  const qlooSide = createDaily(SIDE_QLOO_DAILY);
  const modelSide = createDaily(SIDE_MODEL_DAILY);
  const sideQloo: QlooClient = {
    quota: () => qloo.quota(),
    async get(path, params, info) {
      const left = qloo.quota().monthRemaining;
      if (qlooSide.left() <= 0 || (left !== null && left < 2 * runner.status().limits.qlooReserve)) {
        throw new UserFacingError('Search is resting for today. Recorded demos still work.', 503, 'capacity');
      }
      const seen: { cached?: boolean } = info ?? {};
      const body = await qloo.get(path, params, seen);
      if (!seen.cached) qlooSide.add();
      return body;
    },
  };
  /** The model for search and briefs, while today's budget lasts; without it, both fall back to plain words. */
  const sideModel = () => (modelSide.left() > 0 ? anthropic : null);

  // A page on another site can't make a visitor's browser post here (a form or text/plain post skips CORS).
  // Behind Railway's proxy the request URL says http, so the origin is matched by host.
  app.use('/api/*', csrf({ origin: (origin, c) => URL.canParse(origin) && new URL(origin).host === c.req.header('host') }));
  app.use('/api/*', bodyLimit({ maxSize: 16 * 1024, onError: (c) => fail(c, 413, 'too_large', 'That request is too large.') }));
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
    c.header('X-Frame-Options', 'DENY');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (c.res.headers.get('Content-Type')?.startsWith('text/html')) {
      c.header('Content-Security-Policy', CSP);
      // The page is always revalidated, so a deploy reaches open tabs on their next load.
      c.header('Cache-Control', 'no-cache');
    }
  });

  app.onError((err, c) => {
    if (err instanceof UserFacingError) return fail(c, err.status, err.code, err.message);
    if (err instanceof z.ZodError) return fail(c, 400, 'invalid', err.issues[0]?.message ?? 'Invalid request.');
    if (err instanceof SyntaxError) return fail(c, 400, 'invalid', 'That request isn’t valid JSON.');
    // Hono's own refusals (a cross-site post, say) keep their status.
    if (err instanceof HTTPException && err.status < 500) return fail(c, err.status, 'forbidden', 'That request isn’t allowed.');
    if (err instanceof QlooError && (err.status === 429 || err.retryable)) {
      return fail(c, 503, 'qloo_busy', 'Qloo is busy right now. Try again in a moment.');
    }
    console.error(err);
    return fail(c, 500, 'server_error', 'Something went wrong on our side.');
  });

  // How busy the server is and how close to its limits; nothing secret.
  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      ...runner.status(),
      replays: { couple: store.showcaseOf('couple') !== null, friends: store.showcaseOf('friends') !== null },
    }),
  );

  // Place names resolved to a Qloo locality, kept for the process's life. A
  // place Qloo doesn't know is kept as null; a failed lookup is not kept.
  const localities = new Map<string, Promise<Locality | null>>();
  const localityOf = (place: string): Promise<Locality | null> => {
    const key = place.toLocaleLowerCase();
    let found = localities.get(key);
    if (!found) {
      if (localities.size >= 500) localities.clear();
      found = locate(sideQloo, place).catch((err) => {
        localities.delete(key);
        console.warn(`locating "${place}" failed: ${(err as Error).message}`);
        return null;
      });
      localities.set(key, found);
    }
    return found;
  };

  app.get('/api/search', async (c) => {
    const blocked = limited(c, 'search', 'searchDay');
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
      searchEntities(sideQloo, q, KIND_OF_SLOT[s], 8, area ?? undefined),
      s === 'restaurant'
        ? foodsFor(sideQloo, sideModel(), q, (u) => {
            modelSide.add();
            console.log(`food name read, ≈$${costOf([usageOf(u)]).toFixed(5)}`);
          }).catch((err) => {
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
      ready: readyOf(store, pair, sides),
      tonightDue: tonightDueOf(store, pair, sides),
      demo: pair.demo,
      ledger: pairLedger(store, pair),
      lastTruceId: last?.id ?? null,
      lastTruce: last
        ? {
            id: last.id,
            status: last.status,
            checkedIn: perSide(pair.members, (s) => said.some((x) => x.side === s)),
            openSwap: (() => {
              const open = swaps.openOf(last.id);
              if (!open) return null;
              const waiting = pair.members.filter((s) => s !== open.side && !open.votes[s]);
              return { id: open.id, kind: open.kind, side: open.side, slot: open.slot, deadline: open.deadline, waiting };
            })(),
          }
        : null,
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
    if (pair.demo) return demoLocked(c);
    const body = z.object({ location }).parse(await c.req.json());
    store.setLocation(pair.id, body.location);
    return c.json<PairView>(pairView(pair.id)!);
  });

  /**
   * Reads and grounds a brief; null without a model. A failed reading (or
   * one past today's budget) keeps the words for the agent. The same words
   * as last time keep last time's reading, at no cost.
   */
  async function interpret(text: string, place: string, before?: SideRow): Promise<InterpretedBrief | null> {
    if (before?.brief && before.input.brief === text) return before.brief;
    const model = sideModel();
    if (!model) return anthropic ? wordsOnly(text) : null;
    try {
      let usage: Anthropic.Usage | null = null;
      modelSide.add();
      const intent = await readBrief(model, text, (u) => (usage = u));
      const brief = await groundBrief(sideQloo, text, intent, await localityOf(place));
      if (usage) console.log(`brief read, ≈$${costOf([usageOf(usage)]).toFixed(5)}`);
      return brief;
    } catch (err) {
      console.warn(`reading a brief failed: ${(err as Error).message}`);
      return wordsOnly(text);
    }
  }
  const wordsOnly = (text: string): InterpretedBrief => ({
    view: { text, wishes: [], vetoes: [], note: null, unmatched: [] },
    rules: { wishTags: { film: [], restaurant: [], music: [] }, excludeTags: { film: [], restaurant: [], music: [] }, excludeEntities: [], maxPrice: null },
  });

  app.put('/api/pairs/:id/sides/:side', async (c) => {
    const blocked = limited(c, 'side');
    if (blocked) return blocked;
    const pair = store.pair(c.req.param('id'));
    if (!pair) return fail(c, 404, 'not_found', 'This truce link does not exist.');
    if (pair.demo) return demoLocked(c);
    const s = memberOf(pair.id, c.req.param('side'));
    const input = sideInput.parse(await c.req.json());
    const text = input.brief?.trim() || undefined;
    const brief = text ? await interpret(text, pair.location, store.sides(pair.id)[s]) : null;
    store.saveSide(pair.id, s, { ...input, brief: text }, brief);
    return c.json<SideSaved>({ ready: readyOf(store, pair, store.sides(pair.id)), brief: brief?.view ?? null });
  });

  app.put('/api/pairs/:id/sides/:side/tonight', async (c) => {
    const blocked = limited(c, 'side');
    if (blocked) return blocked;
    const pair = store.pair(c.req.param('id'));
    if (!pair) return fail(c, 404, 'not_found', 'This truce link does not exist.');
    if (pair.demo) return demoLocked(c);
    const s = memberOf(pair.id, c.req.param('side'));
    const saved = store.sides(pair.id)[s];
    if (!saved) return fail(c, 409, 'not_ready', 'Pick your favourites first.');
    const input = tonightInput.parse(await c.req.json());
    if (saved.input.seeds.restaurant.length + (input.foods?.length ?? 0) > 3) {
      return fail(c, 400, 'invalid', 'Up to three restaurants and foods together.');
    }
    const text = input.brief?.trim() || undefined;
    const brief = text ? await interpret(text, pair.location, saved) : null;
    // Favourites stay; tonight's answers are replaced, an empty one included.
    store.saveSide(pair.id, s, { seeds: saved.input.seeds, weights: input.weights, ...(input.foods?.length ? { foods: input.foods } : {}), brief: text }, brief);
    return c.json<SideSaved>({ ready: readyOf(store, pair, store.sides(pair.id)), brief: brief?.view ?? null });
  });

  app.post('/api/pairs/:id/truces', (c) => {
    const blocked = limited(c, 'truce', 'truceDay');
    if (blocked) return blocked;
    const pair = store.pair(c.req.param('id'));
    if (!pair) return fail(c, 404, 'not_found', 'This truce link does not exist.');
    return c.json({ truceId: runner.start(pair.id) }, 201);
  });

  app.post('/api/demo', async (c) => {
    const blocked = limited(c, 'demo');
    if (blocked) return blocked;
    const raw = await c.req.text();
    const { kind, replay } = demoInput.parse(raw ? JSON.parse(raw) : {});
    // A recorded run when asked for, or when a live one can't start now; live when there's no recording yet.
    const full = runner.capacity();
    if (replay || full) {
      if (replaysToday.left() <= 0) return fail(c, 503, 'capacity', 'The demo is resting for today. Try again tomorrow.');
      const copy = demos.replay(store, kind);
      if (copy) {
        replaysToday.add();
        return c.json<DemoStarted>({ ...copy, replay: true }, 201);
      }
    }
    const daily = limited(c, 'truceDay');
    if (daily) return daily;
    const pairId = await demos.create(store, kind);
    const truceId = runner.start(pairId);
    // Only a live demo run, on the demo's own picks, may become the recording others replay.
    store.markShowcase(truceId);
    return c.json<DemoStarted>({ pairId, truceId, replay: false }, 201);
  });

  app.get('/api/truces/:id/receipts', (c) => {
    const truce = store.truce(c.req.param('id'));
    if (!truce) return fail(c, 404, 'not_found', 'This truce does not exist.');
    const receipts = runner.receipts(truce.id) ?? { calls: [], example: null };
    return c.json<ReceiptsView>({
      calls: receipts.calls,
      totals: {
        calls: receipts.calls.length,
        cached: receipts.calls.filter((x) => x.cached).length,
        ms: receipts.calls.reduce((t, x) => t + x.ms, 0),
      },
      example: receipts.example,
    });
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
      replacedBy: truce.replacedBy,
      replaces: store.replacedOf(truce.id),
      replay: truce.replayOf ? { recordedAt: store.truce(truce.replayOf)?.createdAt ?? truce.createdAt } : null,
      demo: pair.demo,
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
    // A check-in settles the evening, so it waits for a vote in progress rather than cutting it off.
    if (swaps.openOf(truce.id)) return fail(c, 409, 'swap_open', 'A swap is waiting for votes. Check in once it is settled.');
    return c.json(runner.checkin(truce.id, s, input));
  });

  app.get('/api/truces/:id/swaps', (c) => c.json<SwapsView>(swaps.view(c.req.param('id'))));

  app.post('/api/truces/:id/swaps', async (c) => {
    const blocked = limited(c, 'swap');
    if (blocked) return blocked;
    const input = swapInput.parse(await c.req.json());
    return c.json<SwapsView>(swaps.ask(c.req.param('id'), input), 201);
  });

  app.put('/api/truces/:id/swaps/:swapId/votes/:side', async (c) => {
    const blocked = limited(c, 'vote');
    if (blocked) return blocked;
    const { vote } = voteInput.parse(await c.req.json());
    return c.json<SwapsView>(swaps.vote(c.req.param('id'), c.req.param('swapId'), side.parse(c.req.param('side')), vote));
  });

  app.post('/api/truces/:id/swaps/:swapId/cancel', async (c) => {
    const blocked = limited(c, 'vote');
    if (blocked) return blocked;
    const input = cancelInput.parse(await c.req.json());
    return c.json<SwapsView>(swaps.cancel(c.req.param('id'), c.req.param('swapId'), input.side));
  });

  app.get('/api/truces/:id/stream', (c) => {
    const blocked = limited(c, 'stream');
    if (blocked) return blocked;
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
      // Wakes the loop too, so it ends and its ping stops with the connection.
      stream.onAbort(() => {
        following.stop();
        wake?.();
      });
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
