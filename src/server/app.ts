/**
 * The HTTP API (see src/contract.ts for the shapes) and the static web app.
 * Every input is validated with zod, every action is rate-limited per
 * client, and bodies are capped; the demo is public.
 */
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import type { ApiError, PairView, SearchHit, SideInput, StreamEvent, TruceView } from '../contract';
import { QlooError, type QlooClient } from '../qloo/client';
import { searchEntities } from '../qloo/queries';
import { KIND_OF_SLOT, SLOTS, type Side } from '../truce/types';
import type { Store } from './db';
import { clientOf, createLimiter, type Action } from './limits';
import { ledgerOf, newId, UserFacingError, type Runner } from './runner';

const slot = z.enum(SLOTS);
const side = z.enum(['a', 'b']);
const name = z.string().trim().min(1).max(24);

const pairInput = z.object({
  mode: z.enum(['couple', 'bff']),
  names: z.object({ a: name, b: name }),
  location: z.string().trim().min(2).max(60),
});

const seed = z.object({
  id: z.string().regex(/^[0-9A-Fa-f-]{36}$/, 'not a Qloo entity id'),
  name: z.string().trim().min(1).max(120),
});
const sideInput = z
  .object({
    seeds: z.object({ film: z.array(seed).max(3), restaurant: z.array(seed).max(3), music: z.array(seed).max(3) }),
    weights: z.object({ film: z.number().min(0).max(100), restaurant: z.number().min(0).max(100), music: z.number().min(0).max(100) }),
  })
  .refine((v) => SLOTS.some((s) => v.seeds[s].length > 0), 'Pick at least one thing you love.');

/** Search hits below this popularity percentile are listed after the rest. */
const OBSCURE = 0.2;

/** The ready-made pair behind "Try the demo": tastes far enough apart to make a real negotiation. */
const DEMO = {
  pair: { mode: 'couple' as const, names: { a: 'Maya', b: 'Deniz' }, location: 'Manhattan' },
  loves: {
    a: { film: ['In the Mood for Love', 'Lost in Translation'], restaurant: ['Carbone New York'], music: ['Radiohead'] },
    b: { film: ['Mad Max: Fury Road', 'John Wick'], restaurant: ['Shake Shack Madison Square Park'], music: ['Bad Bunny'] },
  },
  weights: { a: { film: 50, restaurant: 25, music: 25 }, b: { film: 25, restaurant: 50, music: 25 } },
};

export interface AppDeps {
  store: Store;
  qloo: QlooClient;
  runner: Runner;
  webDir?: string;
}

export function createApp({ store, qloo, runner, webDir = 'web/dist' }: AppDeps) {
  const app = new Hono();
  const limiter = createLimiter();

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
  });

  app.onError((err, c) => {
    if (err instanceof UserFacingError) return fail(c, err.status, 'not_ready', err.message);
    if (err instanceof z.ZodError) return fail(c, 400, 'invalid', err.issues[0]?.message ?? 'Invalid request.');
    if (err instanceof QlooError && (err.status === 429 || err.retryable)) {
      return fail(c, 503, 'qloo_busy', 'Qloo is busy right now. Try again in a moment.');
    }
    console.error(err);
    return fail(c, 500, 'server_error', 'Something went wrong on our side.');
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/search', async (c) => {
    const blocked = limited(c, 'search');
    if (blocked) return blocked;
    const { slot: s, q } = z
      .object({ slot, q: z.string().trim().min(1).max(80) })
      .parse({ slot: c.req.query('slot'), q: c.req.query('q') });
    // Qloo ranks by name match only; near-unknown titles ("Moonlight Soul",
    // popularity 0) would crowd out the one people mean, so they go last.
    const found = await searchEntities(qloo, q, KIND_OF_SLOT[s], 8);
    const known = (e: (typeof found)[number]) => (e.popularity ?? 0) >= OBSCURE;
    const hits = [...found.filter(known), ...found.filter((e) => !known(e))].slice(0, 6);
    return c.json({
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

  app.get('/api/pairs/:id', (c) => {
    const pair = store.pair(c.req.param('id'));
    if (!pair) return fail(c, 404, 'not_found', 'This truce link does not exist.');
    const sides = store.sides(pair.id);
    const truces = store.trucesOf(pair.id);
    return c.json<PairView>({
      id: pair.id,
      mode: pair.mode,
      names: pair.names,
      location: pair.location,
      ready: { a: Boolean(sides.a), b: Boolean(sides.b) },
      ledger: ledgerOf(truces),
      lastTruceId: truces.at(-1)?.id ?? null,
    });
  });

  app.put('/api/pairs/:id/sides/:side', async (c) => {
    const blocked = limited(c, 'side');
    if (blocked) return blocked;
    const pair = store.pair(c.req.param('id'));
    if (!pair) return fail(c, 404, 'not_found', 'This truce link does not exist.');
    const s = side.parse(c.req.param('side'));
    const input: SideInput = sideInput.parse(await c.req.json());
    store.saveSide(pair.id, s, input);
    const sides = store.sides(pair.id);
    return c.json({ ready: { a: Boolean(sides.a), b: Boolean(sides.b) } });
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
    const pairId = newId();
    store.createPair(pairId, DEMO.pair);
    for (const s of ['a', 'b'] as const) {
      const seeds = {} as SideInput['seeds'];
      for (const sl of SLOTS) {
        seeds[sl] = [];
        for (const title of DEMO.loves[s][sl]) {
          const [top] = await searchEntities(qloo, title, KIND_OF_SLOT[sl], 1);
          if (top) seeds[sl].push({ id: top.id, name: top.name });
        }
      }
      store.saveSide(pairId, s, { seeds, weights: DEMO.weights[s] });
    }
    return c.json({ pairId, truceId: runner.start(pairId) }, 201);
  });

  app.get('/api/truces/:id', (c) => {
    const truce = store.truce(c.req.param('id'));
    if (!truce) return fail(c, 404, 'not_found', 'This truce does not exist.');
    const pair = store.pair(truce.pairId)!;
    return c.json<TruceView>({
      id: truce.id,
      pairId: truce.pairId,
      status: truce.status,
      mode: pair.mode,
      names: pair.names,
      location: pair.location,
      events: truce.events,
    });
  });

  app.get('/api/truces/:id/stream', (c) => {
    const id = c.req.param('id');
    const truce = store.truce(id);
    if (!truce) return fail(c, 404, 'not_found', 'This truce does not exist.');
    return streamSSE(c, async (stream) => {
      const send = (e: StreamEvent) => stream.writeSSE({ data: JSON.stringify(e) });
      const queue: StreamEvent[] = [];
      let wake: (() => void) | null = null;
      const following = runner.follow(id, (e) => {
        queue.push(e);
        wake?.();
      });
      if (!following) {
        // Finished (or cut off by a restart): replay what was stored and close.
        for (const e of store.truce(id)!.events) await send(e);
        if (truce.status === 'running') await send({ type: 'error', message: 'This truce was interrupted. Please start a new one.' });
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

  // The web app: static files, and index.html for client-side routes.
  if (existsSync(webDir)) {
    const index = readFileSync(`${webDir}/index.html`, 'utf8');
    app.use('/*', serveStatic({ root: webDir }));
    app.get('*', (c) => c.html(index));
  }

  return app;
}
