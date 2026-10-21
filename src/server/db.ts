/**
 * Storage: one SQLite file. A pair is two people and a place; each side's
 * seeds wait in `sides` until both are ready; a truce keeps its whole event
 * log, so a page opened later replays it exactly. Qloo responses are cached
 * here too (private, server-side; never exported).
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Mode, PairInput, SideInput, StreamEvent } from '../contract';
import type { QlooCache } from '../qloo/client';
import type { TruceResult } from '../truce/negotiate';
import type { Side } from '../truce/types';

const SCHEMA = `
create table if not exists pairs (
  id text primary key,
  mode text not null check (mode in ('couple', 'bff')),
  name_a text not null,
  name_b text not null,
  location text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create table if not exists sides (
  pair_id text not null references pairs(id) on delete cascade,
  side text not null check (side in ('a', 'b')),
  input text not null,
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  primary key (pair_id, side)
);
create table if not exists truces (
  id text primary key,
  pair_id text not null references pairs(id) on delete cascade,
  status text not null check (status in ('running', 'done', 'failed')),
  brain text not null,
  alpha_a real not null,
  opener text not null check (opener in ('a', 'b')),
  events text not null default '[]',
  result text,
  concession_a real,
  concession_b real,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at text
);
create index if not exists truces_by_pair on truces (pair_id, created_at);
create table if not exists qloo_cache (
  key text primary key,
  body text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`;

export interface PairRow {
  id: string;
  mode: Mode;
  names: Record<Side, string>;
  location: string;
  createdAt: string;
}

export interface TruceRow {
  id: string;
  pairId: string;
  status: 'running' | 'done' | 'failed';
  brain: string;
  alphaA: number;
  opener: Side;
  events: StreamEvent[];
  result: TruceResult | null;
  concession: Record<Side, number> | null;
  createdAt: string;
}

export type Store = ReturnType<typeof openStore>;

export function openStore(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, 'truce.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  const q = {
    insertPair: db.prepare('insert into pairs (id, mode, name_a, name_b, location) values (?, ?, ?, ?, ?)'),
    pair: db.prepare('select * from pairs where id = ?'),
    upsertSide: db.prepare(
      `insert into sides (pair_id, side, input) values (?, ?, ?)
       on conflict (pair_id, side) do update set input = excluded.input,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ),
    sides: db.prepare('select side, input from sides where pair_id = ?'),
    insertTruce: db.prepare('insert into truces (id, pair_id, status, brain, alpha_a, opener) values (?, ?, ?, ?, ?, ?)'),
    truce: db.prepare('select * from truces where id = ?'),
    trucesOfPair: db.prepare('select * from truces where pair_id = ? order by created_at'),
    runningOfPair: db.prepare("select id from truces where pair_id = ? and status = 'running' limit 1"),
    setEvents: db.prepare('update truces set events = ? where id = ?'),
    finish: db.prepare(
      `update truces set status = 'done', result = ?, concession_a = ?, concession_b = ?,
         finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = ?`,
    ),
    fail: db.prepare(
      "update truces set status = 'failed', finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = ?",
    ),
    failRunning: db.prepare("update truces set status = 'failed' where status = 'running'"),
    trucesSince: db.prepare("select count(*) as n from truces where brain = 'claude' and created_at >= ?"),
    cacheGet: db.prepare('select body from qloo_cache where key = ?'),
    cacheSet: db.prepare('insert or replace into qloo_cache (key, body) values (?, ?)'),
  };

  const toPair = (r: any): PairRow => ({
    id: r.id,
    mode: r.mode,
    names: { a: r.name_a, b: r.name_b },
    location: r.location,
    createdAt: r.created_at,
  });
  const toTruce = (r: any): TruceRow => ({
    id: r.id,
    pairId: r.pair_id,
    status: r.status,
    brain: r.brain,
    alphaA: r.alpha_a,
    opener: r.opener,
    events: JSON.parse(r.events),
    result: r.result ? JSON.parse(r.result) : null,
    concession: r.concession_a === null ? null : { a: r.concession_a, b: r.concession_b },
    createdAt: r.created_at,
  });

  // A truce still "running" when the process starts was cut off by a restart.
  q.failRunning.run();

  return {
    close: () => db.close(),
    createPair(id: string, input: PairInput) {
      q.insertPair.run(id, input.mode, input.names.a, input.names.b, input.location);
    },
    pair: (id: string): PairRow | null => {
      const r = q.pair.get(id);
      return r ? toPair(r) : null;
    },
    saveSide(pairId: string, side: Side, input: SideInput) {
      q.upsertSide.run(pairId, side, JSON.stringify(input));
    },
    sides(pairId: string): Partial<Record<Side, SideInput>> {
      const out: Partial<Record<Side, SideInput>> = {};
      for (const r of q.sides.all(pairId) as { side: Side; input: string }[]) out[r.side] = JSON.parse(r.input);
      return out;
    },
    createTruce(id: string, pairId: string, brain: string, alphaA: number, opener: Side) {
      q.insertTruce.run(id, pairId, 'running', brain, alphaA, opener);
    },
    truce: (id: string): TruceRow | null => {
      const r = q.truce.get(id);
      return r ? toTruce(r) : null;
    },
    trucesOf: (pairId: string): TruceRow[] => (q.trucesOfPair.all(pairId) as any[]).map(toTruce),
    runningTruceOf: (pairId: string): string | null => (q.runningOfPair.get(pairId) as { id: string } | undefined)?.id ?? null,
    saveEvents(id: string, events: StreamEvent[]) {
      q.setEvents.run(JSON.stringify(events), id);
    },
    finishTruce(id: string, result: TruceResult) {
      q.finish.run(JSON.stringify(result), result.concession.a, result.concession.b, id);
    },
    failTruce(id: string) {
      q.fail.run(id);
    },
    /** Model-run truces since a UTC instant, for the daily cap. */
    claudeTrucesSince: (iso: string): number => (q.trucesSince.get(iso) as { n: number }).n,
    qlooCache: {
      get: (key: string) => (q.cacheGet.get(key) as { body: string } | undefined)?.body,
      set: (key: string, body: string) => void q.cacheSet.run(key, body),
    } satisfies QlooCache,
  };
}
