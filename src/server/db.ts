/**
 * Storage: one SQLite file. A pair is the group (two to four people) and a
 * place; each person's favourites, brief and what their check-ins taught
 * their agent wait in `sides`; a truce keeps its whole event log, so a page
 * opened later replays it exactly; check-ins say how an evening really went,
 * and swaps how it changed after the deal (kept apart from the log, which
 * ends with the deal).
 * Qloo responses are cached here too (private, server-side; never exported).
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { InterpretedBrief } from '../agents/brief';
import type { CheckinInput, Mode, PairInput, Seed, SideInput, StreamEvent, SwapReason, SwapStatus, SwapVote } from '../contract';
import type { QlooCache } from '../qloo/client';
import type { TruceResult } from '../truce/negotiate';
import { membersOf, type PerSide, type Side, type Slot } from '../truce/types';

const VERSION = 3;

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
  finished_at text,
  replaced_by text
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
create table if not exists swaps (
  id text primary key,
  truce_id text not null references truces(id) on delete cascade,
  kind text not null check (kind in ('swap', 'replan')),
  side text not null check (side in ('a', 'b', 'c', 'd')),
  slot text check (slot in ('film', 'restaurant', 'music')),
  reason text check (reason in ('unavailable', 'seen', 'not_feeling')),
  status text not null check (status in ('open', 'swapped', 'kept', 'no_alternative', 'replanned', 'cancelled')),
  needed integer not null,
  votes text not null default '{}',
  from_item text,
  to_item text,
  scores text,
  new_truce text,
  deadline text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at text
);
create index if not exists swaps_by_truce on swaps (truce_id, created_at);
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

/** Version 2 to 3: truces can be replaced by a replan; the swaps table comes with the schema. */
function migrateFrom2(db: Database.Database) {
  db.exec('alter table truces add column replaced_by text');
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
  /** The truce that planned this evening again; the ledger then counts that one instead. */
  replacedBy: string | null;
}

export type SwapItem = { id: string; name: string };

export interface SwapRow {
  id: string;
  truceId: string;
  kind: 'swap' | 'replan';
  side: Side;
  slot: Slot | null;
  reason: SwapReason | null;
  status: SwapStatus;
  needed: number;
  votes: PerSide<SwapVote>;
  from: SwapItem | null;
  to: SwapItem | null;
  scores: { before: PerSide<number>; after: PerSide<number> | null } | null;
  /** A replan's new truce. */
  newTruce: string | null;
  deadline: string | null;
  createdAt: string;
  resolvedAt: string | null;
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
  const hasTruces = (db.prepare("select 1 from sqlite_master where type = 'table' and name = 'truces'").get() as unknown) !== undefined;
  const hasReplaced = (db.prepare("select 1 from pragma_table_info('truces') where name = 'replaced_by'").get() as unknown) !== undefined;
  if (hasTruces && !hasReplaced) migrateFrom2(db);
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
    setResult: db.prepare('update truces set result = ?, evening = ? where id = ?'),
    setReplacedBy: db.prepare('update truces set replaced_by = ? where id = ?'),
    replacedOf: db.prepare('select id from truces where replaced_by = ?'),
    unreplace: db.prepare('update truces set replaced_by = null where replaced_by = ?'),
    insertSwap: db.prepare(
      `insert into swaps (id, truce_id, kind, side, slot, reason, status, needed, votes, from_item, scores, deadline)
       values (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
    ),
    swap: db.prepare('select * from swaps where id = ?'),
    swapsOf: db.prepare('select * from swaps where truce_id = ? order by created_at, rowid'),
    swapsOfPair: db.prepare(
      'select s.* from swaps s join truces t on t.id = s.truce_id where t.pair_id = ? order by s.created_at, s.rowid',
    ),
    openSwaps: db.prepare("select * from swaps where status = 'open'"),
    setVotes: db.prepare("update swaps set votes = ? where id = ? and status = 'open'"),
    resolveSwap: db.prepare(
      `update swaps set status = ?, to_item = ?, scores = coalesce(?, scores), new_truce = ?,
         resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = ? and status = 'open'`,
    ),
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
    replacedBy: r.replaced_by ?? null,
  });
  const toSwap = (r: any): SwapRow => ({
    id: r.id,
    truceId: r.truce_id,
    kind: r.kind,
    side: r.side,
    slot: r.slot,
    reason: r.reason,
    status: r.status,
    needed: r.needed,
    votes: JSON.parse(r.votes),
    from: r.from_item ? JSON.parse(r.from_item) : null,
    to: r.to_item ? JSON.parse(r.to_item) : null,
    scores: r.scores ? JSON.parse(r.scores) : null,
    newTruce: r.new_truce,
    deadline: r.deadline,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
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
  // A replan cut off that way gives the evening it was replacing back.
  for (const r of q.running.all() as { id: string; events: string }[]) {
    q.setEvents.run(JSON.stringify([...JSON.parse(r.events), INTERRUPTED]), r.id);
    q.fail.run(r.id);
    q.unreplace.run(r.id);
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
    /** A decided evening as it now stands, after a swap. */
    updateResult(id: string, result: TruceResult, evening: Record<Slot, string>) {
      q.setResult.run(JSON.stringify(result), JSON.stringify(evening), id);
    },
    setReplacedBy(id: string, by: string | null) {
      q.setReplacedBy.run(by, id);
    },
    /** The truce a replan replaced, if this one is a replan. */
    replacedOf: (id: string): string | null => (q.replacedOf.get(id) as { id: string } | undefined)?.id ?? null,
    createSwap(row: Pick<SwapRow, 'id' | 'truceId' | 'kind' | 'side' | 'slot' | 'reason' | 'needed' | 'votes' | 'from' | 'scores' | 'deadline'>) {
      q.insertSwap.run(
        row.id,
        row.truceId,
        row.kind,
        row.side,
        row.slot,
        row.reason,
        row.needed,
        JSON.stringify(row.votes),
        row.from ? JSON.stringify(row.from) : null,
        row.scores ? JSON.stringify(row.scores) : null,
        row.deadline,
      );
    },
    swap: (id: string): SwapRow | null => {
      const r = q.swap.get(id);
      return r ? toSwap(r) : null;
    },
    /** Oldest first. */
    swapsOf: (truceId: string): SwapRow[] => (q.swapsOf.all(truceId) as any[]).map(toSwap),
    /** Every swap of a pair's truces, by truce id, oldest first. */
    swapsOfPair(pairId: string): Map<string, SwapRow[]> {
      const out = new Map<string, SwapRow[]>();
      for (const s of (q.swapsOfPair.all(pairId) as any[]).map(toSwap)) {
        const list = out.get(s.truceId) ?? [];
        list.push(s);
        out.set(s.truceId, list);
      }
      return out;
    },
    openSwaps: (): SwapRow[] => (q.openSwaps.all() as any[]).map(toSwap),
    /** Only while the swap is open; false when it was settled meanwhile. */
    setSwapVotes: (id: string, votes: PerSide<SwapVote>): boolean => q.setVotes.run(JSON.stringify(votes), id).changes === 1,
    /** Settles an open swap once; false when it was settled meanwhile. */
    resolveSwap(
      id: string,
      status: Exclude<SwapStatus, 'open'>,
      fields: { to?: SwapItem | null; scores?: SwapRow['scores']; newTruce?: string | null } = {},
    ): boolean {
      return (
        q.resolveSwap.run(
          status,
          fields.to ? JSON.stringify(fields.to) : null,
          fields.scores ? JSON.stringify(fields.scores) : null,
          fields.newTruce ?? null,
          id,
        ).changes === 1
      );
    },
    /** Model-run truces since a UTC instant, for the daily cap. */
    claudeTrucesSince: (iso: string): number => (q.trucesSince.get(iso) as { n: number }).n,
    qlooCache: {
      get: (key: string) => (q.cacheGet.get(key) as { body: string } | undefined)?.body,
      set: (key: string, body: string) => void q.cacheSet.run(key, body),
    } satisfies QlooCache,
  };
}
