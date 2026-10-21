/**
 * The HTTP contract between the Truce server and the web app. Types only:
 * the web app imports them with `import type`, so nothing here is bundled.
 *
 *   GET  /api/search?slot=film&q=moonlight     → SearchResult
 *        [&near=Istanbul]                        (restaurants only: keep to places near there)
 *   POST /api/pairs            body PairInput   → { id }
 *   GET  /api/pairs/:id                         → PairView
 *   PATCH /api/pairs/:id       { location }     → PairView   (fix the place after "no restaurants found")
 *   PUT  /api/pairs/:id/sides/:side  SideInput  → { ready: Record<Side, boolean> }
 *   POST /api/pairs/:id/truces                  → { truceId }   (409 until both sides are ready)
 *   POST /api/demo                              → { pairId, truceId }   (a ready-made pair, truce started)
 *   GET  /api/truces/:id                        → TruceView
 *   GET  /api/truces/:id/stream[?from=n]        → server-sent events, one StreamEvent per `data:` line,
 *                                                 each with `id:` = its index in the truce's log. Replays
 *                                                 from `from` (or from Last-Event-ID + 1, or from 0) and
 *                                                 closes after `ledger` or `error`.
 *
 * Errors are `{ error: { code, message } }` with a 4xx/5xx status;
 * `code: 'rate_limited'` comes with a `retryAfterSeconds`.
 */
import type { TruceEvent } from './truce/negotiate';
import type { Mode } from './agents/brain';
import type { Side, Slot } from './truce/types';

export type { Mode, Side, Slot, TruceEvent };
export type { TruceResult, SlotEvidence, StrikeCode } from './truce/negotiate';

export interface SearchHit {
  id: string;
  name: string;
  /** Qloo's hint: a year for films, an address for restaurants. */
  disambiguation: string | null;
  imageUrl: string | null;
  blurb: string | null;
  year: number | null;
  /** 0–1 percentile of fame within its domain. */
  popularity: number | null;
}

export interface SearchResult {
  hits: SearchHit[];
  /**
   * The place the hits were kept near, as Qloo names it ("Istanbul"). Null
   * when the search ran worldwide: no `near`, not a restaurant, or a place
   * Qloo doesn't know.
   */
  near: string | null;
}

export interface PairInput {
  mode: Mode;
  names: Record<Side, string>;
  /** Where the restaurant should be: a Qloo locality such as "Manhattan" or "Istanbul". */
  location: string;
}

export interface Seed {
  id: string;
  name: string;
}

export interface SideInput {
  /** 1–3 confirmed Qloo entities per slot (at least one slot must have one). */
  seeds: Record<Slot, Seed[]>;
  /** How much each slot matters tonight; any positive numbers, normalised by the server. */
  weights: Record<Slot, number>;
}

export interface LedgerEntry {
  truceId: string;
  at: string;
  /** How far each person fell short of their own best evening, 0–1. */
  concession: Record<Side, number>;
  evening: Record<Slot, string>;
}

export interface LedgerView {
  /** Positive: A has given more ground; negative: B has. */
  balance: number;
  /** A's bargaining weight in the next truce (B's is 1 − alphaA). */
  alphaA: number;
  /** The same pull on a −1…1 scale: −1 is the most the ledger can favour B, 1 the most for A. */
  tilt: number;
  owed: Side | null;
  entries: LedgerEntry[];
}

export interface PairView {
  id: string;
  mode: Mode;
  names: Record<Side, string>;
  location: string;
  ready: Record<Side, boolean>;
  ledger: LedgerView;
  lastTruceId: string | null;
  lastTruce: { id: string; status: TruceView['status'] } | null;
}

/** One pool item as the audience sees it: both people's scores and what drives them. */
export interface CardItem {
  id: string;
  slot: Slot;
  name: string;
  disambiguation: string | null;
  imageUrl: string | null;
  blurb: string | null;
  facts: Record<string, string>;
  /** Each person's score, 0–100. */
  scores: Record<Side, number>;
  /** Which recommendation surfaced it: A's taste, B's taste, or both together (a bridge). */
  origins: ('a' | 'b' | 'joint')[];
  /** Each person's seeds behind their score, e.g. "In the Mood for Love (56%)". */
  because: Record<Side, string[]>;
}

export type StreamEvent =
  | { type: 'status'; phase: 'scouting' | 'negotiating'; brain: 'claude' | 'rules' }
  | { type: 'pool'; items: Record<Slot, CardItem[]>; indifferent: Record<Side, Record<Slot, boolean>> }
  | TruceEvent
  | {
      type: 'ledger';
      before: { balance: number; alphaA: number; tilt: number };
      after: { balance: number; alphaA: number; tilt: number; owed: Side | null };
    }
  | { type: 'error'; code: StreamErrorCode; message: string; retryable: boolean };

/**
 * Why a truce stopped. `no_restaurants`: fix the pair's location (PATCH) and
 * start again. `no_options`: add favourites. `interrupted` / `internal`: try again.
 */
export type StreamErrorCode = 'no_restaurants' | 'no_options' | 'interrupted' | 'internal';

export interface TruceView {
  id: string;
  pairId: string;
  status: 'running' | 'done' | 'failed';
  mode: Mode;
  names: Record<Side, string>;
  location: string;
  createdAt: string;
  endedAt: string | null;
  events: StreamEvent[];
}

export interface ApiError {
  error: { code: string; message: string; retryAfterSeconds?: number };
}
