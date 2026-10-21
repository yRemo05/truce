/**
 * Boots the Truce server: storage, the Qloo client (with its private cache
 * in SQLite), Claude when a key is set, the runner and the HTTP app.
 */
import Anthropic from '@anthropic-ai/sdk';
import { serve } from '@hono/node-server';
import { createQlooClient } from '../qloo/client';
import { createApp } from './app';
import { openStore } from './db';
import { createRunner } from './runner';

const env = (name: string, fallback?: string) => {
  const v = process.env[name]?.trim();
  if (v) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is not set`);
};

const store = openStore(env('DATA_DIR', 'data'));
const qloo = createQlooClient({
  baseUrl: env('QLOO_BASE_URL', 'https://hackathon.api.qloo.com'),
  apiKey: env('QLOO_API_KEY'),
  cache: store.qlooCache,
});
const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
const anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;
if (!anthropic) console.warn('ANTHROPIC_API_KEY is not set: agents run on rules only.');

const runner = createRunner({ store, qloo, anthropic, dailyCap: Number(env('DAILY_TRUCE_CAP', '400')) });
const app = createApp({ store, qloo, runner, webDir: env('WEB_DIR', 'web/dist') });

const port = Number(env('PORT', '8787'));
const server = serve({ fetch: app.fetch, port }, () => console.log(`Truce listening on http://localhost:${port}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    store.close();
    process.exit(0);
  });
}
