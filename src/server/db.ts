/**
 * Storage: one SQLite file. A pair is the group (two to four people) and a
 * place; each person's favourites, brief and what their check-ins taught
 * their agent wait in `sides`; a truce keeps its whole event log, so a page
 * opened later replays it exactly; check-ins say how an evening really went.
 * Qloo responses are cached here too (private, server-side; never exported).
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { InterpretedBrief } from '../agents/brief';
import type { CheckinInput, Mode, PairInput, Seed, SideInput, StreamEvent } from '../contract';
import type { QlooCache } from '../qloo/client';
import type { TruceResult } from '../truce/negotiate';
import { membersOf, type PerSide, type Side, type Slot } from '../truce/types';

const VERSION = 2;

/** The last event of a truce cut off by a restart, so every reader sees it end. */
export const INTERRUPTED: StreamEvent = {
  type: 'error',
  code: 'interrupted',
  message: 'This truce was interrupted. Please start a new one.',
  retryable: true,
};

const SCHEMA = `
create table if not exists pairs (
  id text primary key,
  mode text not null check (mode in ('couple', 'bff')),
  names text not null,
  location text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create table if not exists sides (
  pair_id text not null references pairs(id) on delete cascade,
  side text not null check (side in ('a', 'b', 'c', 'd')),
  input text not null,
  brief text,
  learned text not null default '{"loved":{"film":[],"restaurant":[],"music":[]},"avoided":[]}',
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  primary key (pair_id, side)
);
create table if not exists truces (
  id text primary key,
  pair_id text not null references pairs(id) on delete cascade,
  status text not null check (status in ('running', 'done', 'failed')),
  brain text not null,
  alpha text not null,
  opener text not null check (opener in ('a', 'b', 'c', 'd')),
  events text not null default '[]',
  result text,
  evening text,
  earlier integer not null default 0,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at text
);
create index if not exists truces_by_pair on truces (pair_id, created_at);
create table if not exists checkins (
  truce_id text not null references truces(id) on delete cascade,
  side text not null check (side in ('a', 'b', 'c', 'd')),
  went integer not null,
  ratings text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  primary key (truce_id, side)
);
create table if not exists qloo_cache (
  key text primary key,
  body text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`;

/**
 * Version 1 (two people, columns per side) to 2: rebuild the three tables
 * with per-side JSON, keeping every row.
 */
function migrateFrom1(db: Database.Database) {
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      alter table pairs rename to pairs_v1;
      alter table sides rename to sides_v1;
      alter table truces rename to truces_v1;
      drop index if exists truces_by_pair;
    `);
    db.exec(SCHEMA);
    db.exec(`
      insert into pairs (id, mode, names, location, created_at)
        select id, mode, json_array(name_a, name_b), location, created_at from pairs_v1;
      insert into sides (pair_id, side, input, updated_at)
        select pair_id, side, input, updated_at from sides_v1;
      insert into truces (id, pair_id, status, brain, alpha, opener, events, result, created_at, finished_at)
        select id, pair_id, status, brain, json_object('a', alpha_a, 'b', 1 - alpha_a), opener, events, result, created_at, finished_at
        from truces_v1;
      drop table truces_v1;
      drop table sides_v1;
      drop table pairs_v1;
    `);
  })();
  db.pragma('foreign_keys = ON');
}

export interface PairRow {
  id: string;
  mode: Mode;
  members: Side[];
  names: PerSide<string>;
  location: string;
  createdAt: string;
}

export interface TruceRow {
  id: string;
  pairId: string;
  status: 'running' | 'done' | 'failed';
  brain: string;
  alpha: PerSide<number>;
  opener: Side;
  events: StreamEvent[];
  result: TruceResult | null;
  /** The chosen items' names, kept apart from the event log. */
  evening: Record<Slot, string> | null;
  /** A made-up earlier evening a demo group starts with. */
  earlier: boolean;
  createdAt: string;
  finishedAt: string | null;
}

export interface Learned {
  /** Picks the person loved in a check-in: they join their favourites. */
  loved: Record<Slot, Seed[]>;
  /** Picks they didn't like: kept off the table from then on. */
  avoided: Seed[];
}

export interface CheckinRow extends CheckinInput {
  side: Side;
  createdAt: string;
}

export type Store = ReturnType<typeof openStore>;

export function openStore(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, 'truce.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const hasV1 = (db.prepare("select 1 from pragma_table_info('pairs') where name = 'name_a'").get() as unknown) !== undefined;
  if (hasV1) migrateFrom1(db);
  db.exec(SCHEMA);
  db.pragma(`user_version = ${VERSION}`);

  const q = {
    insertPair: db.prepare('insert into pairs (id, mode, names, location) values (?, ?, ?, ?)'),
    pair: db.prepare('select * from pairs where id = ?'),
    setLocation: db.prepare('update pairs set location = ? where id = ?'),
    upsertSide: db.prepare(
      `insert into sides (pair_id, side, input, brief) values (?, ?, ?, ?)
       on conflict (pair_id, side) do update set input = excluded.input, brief = excluded.brief,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ),
    sides: db.prepare('select side, input, brief, learned from sides where pair_id = ?'),
    setLearned: db.prepare('update sides set learned = ? where pair_id = ? and side = ?'),
    insertTruce: db.prepare('insert into truces (id, pair_id, status, brain, alpha, opener) values (?, ?, ?, ?, ?, ?)'),
    insertEarlier: db.prepare(
      `insert into truces (id, pair_id, status, brain, alpha, opener, result, evening, earlier, created_at, finished_at)
       values (?, ?, 'done', 'history', ?, ?, ?, ?, 1, ?, ?)`,
    ),
    truce: db.prepare('select * from truces where id = ?'),
    trucesOfPair: db.prepare('select * from truces where pair_id = ? order by created_at'),
    runningOfPair: db.prepare("select id from truces where pair_id = ? and status = 'running' limit 1"),
    setEvents: db.prepare('update truces set events = ? where id = ?'),
    finish: db.prepare(
      `update truces set status = 'done', result = ?, evening = ?,
         finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = ?`,
    ),
    fail: db.prepare(
      "update truces set status = 'failed', finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = ?",
    ),
    running: db.prepare("select id, events from truces where status = 'running'"),
    trucesSince: db.prepare("select count(*) as n from truces where brain = 'claude' and created_at >= ?"),
    upsertCheckin: db.prepare(
      `insert into checkins (truce_id, side, went, ratings) values (?, ?, ?, ?)
       on conflict (truce_id, side) do update set went = excluded.went, ratings = excluded.ratings,
         created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ),
    checkinsOf: db.prepare('select * from checkins where truce_id = ?'),
    checkinsOfPair: db.prepare(
      'select c.* from checkins c join truces t on t.id = c.truce_id where t.pair_id = ?',
    ),
    cacheGet: db.prepare('select body from qloo_cache where key = ?'),
    cacheSet: db.prepare('insert or replace into qloo_cache (key, body) values (?, ?)'),
  };

  const toPair = (r: any): PairRow => {
    const list = JSON.parse(r.names) as string[];
    const members = membersOf(list.length);
    return {
      id: r.id,
      mode: r.mode,
      members,
      names: Object.fromEntries(members.map((s, i) => [s, list[i]])),
      location: r.location,
      createdAt: r.created_at,
    };
  };
  const toTruce = (r: any): TruceRow => ({
    id: r.id,
    pairId: r.pair_id,
    status: r.status,
    brain: r.brain,
    alpha: JSON.parse(r.alpha),
    opener: r.opener,
    events: JSON.parse(r.events),
    result: r.result ? JSON.parse(r.result) : null,
    evening: r.evening ? JSON.parse(r.evening) : null,
    earlier: r.earlier === 1,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  });
  const toCheckin = (r: any): CheckinRow & { truceId: string } => ({
    truceId: r.truce_id,
    side: r.side,
    went: r.went === 1,
    ratings: JSON.parse(r.ratings),
    createdAt: r.created_at,
  });
  const emptyLearned = (): Learned => ({ loved: { film: [], restaurant: [], music: [] }, avoided: [] });

  // A truce still "running" when the process starts was cut off by a restart:
  // it fails, and its log ends with the interruption so pages stop waiting.
  for (const r of q.running.all() as { id: string; events: string }[]) {
    q.setEvents.run(JSON.stringify([...JSON.parse(r.events), INTERRUPTED]), r.id);
    q.fail.run(r.id);
  }

  return {
    close: () => db.close(),
    createPair(id: string, input: PairInput) {
      q.insertPair.run(id, input.mode, JSON.stringify(input.names), input.location);
    },
    pair: (id: string): PairRow | null => {
      const r = q.pair.get(id);
      return r ? toPair(r) : null;
    },
    setLocation(pairId: string, location: string) {
      q.setLocation.run(location, pairId);
    },
    saveSide(pairId: string, side: Side, input: SideInput, brief: InterpretedBrief | null) {
      q.upsertSide.run(pairId, side, JSON.stringify(input), brief ? JSON.stringify(brief) : null);
    },
    sides(pairId: string): PerSide<{ input: SideInput; brief: InterpretedBrief | null; learned: Learned }> {
      const out: PerSide<{ input: SideInput; brief: InterpretedBrief | null; learned: Learned }> = {};
      for (const r of q.sides.all(pairId) as { side: Side; input: string; brief: string | null; learned: string }[]) {
        out[r.side] = {
          input: JSON.parse(r.input),
          brief: r.brief ? JSON.parse(r.brief) : null,
          learned: { ...emptyLearned(), ...JSON.parse(r.learned) },
        };
      }
      return out;
    },
    setLearned(pairId: string, side: Side, learned: Learned) {
      q.setLearned.run(JSON.stringify(learned), pairId, side);
    },
    createTruce(id: string, pairId: string, brain: string, alpha: PerSide<number>, opener: Side) {
      q.insertTruce.run(id, pairId, 'running', brain, JSON.stringify(alpha), opener);
    },
    /** A made-up finished evening, for a demo group's history. */
    createEarlier(id: string, pairId: string, alpha: PerSide<number>, opener: Side, result: TruceResult, evening: Record<Slot, string>, at: string) {
      q.insertEarlier.run(id, pairId, JSON.stringify(alpha), opener, JSON.stringify(result), JSON.stringify(evening), at, at);
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
    finishTruce(id: string, result: TruceResult, evening: Record<Slot, string>) {
      q.finish.run(JSON.stringify(result), JSON.stringify(evening), id);
    },
    failTruce(id: string) {
      q.fail.run(id);
    },
    saveCheckin(truceId: string, side: Side, input: CheckinInput) {
      q.upsertCheckin.run(truceId, side, input.went ? 1 : 0, JSON.stringify(input.ratings));
    },
    checkinsOf: (truceId: string): CheckinRow[] => (q.checkinsOf.all(truceId) as any[]).map(toCheckin),
    /** Every check-in of a pair's truces, by truce id. */
    checkinsOfPair(pairId: string): Map<string, CheckinRow[]> {
      const out = new Map<string, CheckinRow[]>();
      for (const c of (q.checkinsOfPair.all(pairId) as any[]).map(toCheckin)) {
        const list = out.get(c.truceId) ?? [];
        list.push(c);
        out.set(c.truceId, list);
      }
      return out;
    },
    /** Model-run truces since a UTC instant, for the daily cap. */
    claudeTrucesSince: (iso: string): number => (q.trucesSince.get(iso) as { n: number }).n,
    qlooCache: {
      get: (key: string) => (q.cacheGet.get(key) as { body: string } | undefined)?.body,
      set: (key: string, body: string) => void q.cacheSet.run(key, body),
    } satisfies QlooCache,
  };
}
