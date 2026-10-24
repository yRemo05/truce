/**
 * The HTTP contract between the Truce server and the web app. Types only:
 * the web app imports them with `import type`, so nothing here is bundled.
 *
 * A "pair" is the group planning together: a couple (two people) or two to
 * four friends. Each person is a side, a–d, in the order their names were
 * given; per-person values are `PerSide` maps over `members`.
 *
 *   GET  /api/search?slot=film&q=moonlight     → SearchResult
 *        [&near=Istanbul]                        (restaurants only: keep to places near there;
 *                                                 restaurant searches also return foods)
 *   POST /api/pairs            body PairInput   → { id }
 *   GET  /api/pairs/:id                         → PairView
 *   PATCH /api/pairs/:id       { location }     → PairView   (fix the place after "no restaurants found")
 *   PUT  /api/pairs/:id/sides/:side  SideInput  → SideSaved  (with the brief as the agent understood it)
 *   POST /api/pairs/:id/truces                  → { truceId }   (409 until everyone is ready)
 *   POST /api/demo             body DemoInput   → DemoStarted   (a ready-made group: a live truce, or an instant replay)
 *   GET  /api/truces/:id                        → TruceView
 *   GET  /api/truces/:id/receipts               → ReceiptsView   (every Qloo call the truce made)
 *   GET  /api/truces/:id/stream[?from=n]        → server-sent events, one StreamEvent per `data:` line,
 *                                                 each with `id:` = its index in the truce's log. Replays
 *                                                 from `from` (or from Last-Event-ID + 1, or from 0) and
 *                                                 closes after `ledger` or `error`.
 *   GET  /api/truces/:id/calendar.ics           → the evening as a calendar event (text/calendar)
 *   PUT  /api/truces/:id/checkins/:side  CheckinInput → CheckinResult   (how the evening went)
 *   GET  /api/truces/:id/swaps                  → SwapsView   (the evening as it stands, and its swaps)
 *   POST /api/truces/:id/swaps       SwapInput  → SwapsView   (ask to swap one item, or to plan again)
 *   PUT  /api/truces/:id/swaps/:swapId/votes/:side  VoteInput → SwapsView
 *   POST /api/truces/:id/swaps/:swapId/cancel  { side }      → SwapsView   (the asker withdraws an open request)
 *
 * Errors are `{ error: { code, message } }` with a 4xx/5xx status;
 * `code: 'rate_limited'` comes with a `retryAfterSeconds`.
 */
import type { Mode } from './agents/brain';
import type { Rating } from './truce/ledger';
import type { TruceEvent } from './truce/negotiate';
/** One Qloo call a truce made, as its receipts show it; the responses themselves aren't kept. */
import type { QlooCall } from './qloo/trace';
import type { PerSide, Side, Slot } from './truce/types';

export type { Mode, PerSide, QlooCall, Rating, Side, Slot, TruceEvent };
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

/** A food or cuisine someone loves, as Qloo's tags name it. */
export interface Food {
  /** As Qloo names it, in English when it has the English name: "Lasagna", "Italian". */
  name: string;
  /** Every Qloo food tag with that name (cuisine, dish, menu highlight): opaque to the web app. */
  tags: string[];
  kind: 'cuisine' | 'dish';
}

export interface SearchResult {
  hits: SearchHit[];
  /** Restaurant searches only: foods and cuisines the words name ("Lazanya" → Lasagna). Empty otherwise. */
  foods: Food[];
  /**
   * The place the hits were kept near, as Qloo names it ("Istanbul"). Null
   * when the search ran worldwide: no `near`, not a restaurant, or a place
   * Qloo doesn't know.
   */
  near: string | null;
}

export interface PairInput {
  /** A couple is exactly two people; friends are two to four. */
  mode: Mode;
  /** Everyone's first name, in seat order: they become sides a, b, c, d. */
  names: string[];
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
  /**
   * Foods they love, from a restaurant search. They count toward the
   * restaurant's three: restaurant seeds plus foods are at most 3.
   */
  foods?: Food[];
  /** How much each slot matters tonight; any positive numbers, normalised by the server. */
  weights: Record<Slot, number>;
  /** Anything the person wants their agent to know about tonight, in their own words (≤ 280 characters). */
  brief?: string;
}

/** One thing the agent took from a brief, and what Qloo matched it to. */
export interface Understood {
  /** The slot it applies to; null when it applies to the whole evening (a price cap). */
  slot: Slot | null;
  /** The person's own words for it: "nothing scary", "seen Dune". */
  said: string;
  /** What it became: a Qloo taste ("Horror"), a title ("Dune (2021)"), or a price ("Up to $$"). */
  matched: string;
  kind: 'taste' | 'title' | 'price';
}

/** A brief as the agent understood it. Private: only the person who wrote it sees it. */
export interface BriefView {
  text: string;
  /** What they'd like tonight. Soft: their agent goes looking for it while scouting. */
  wishes: Understood[];
  /** What they ruled out. Hard: kept out of the evening entirely. */
  vetoes: Understood[];
  /** Anything else, in a few words for their agent: "an early night". */
  note: string | null;
  /** Words nothing in Qloo matched; the agent still reads them. */
  unmatched: string[];
}

export interface SideSaved {
  ready: PerSide<boolean>;
  /** Null when no brief was given (or no model is configured to read one). */
  brief: BriefView | null;
}

export interface LedgerEntry {
  truceId: string;
  at: string;
  /** How far each person fell short of their own best evening, 0–1, after any check-ins. */
  concession: PerSide<number>;
  /** Who has said how the evening went. */
  checkedIn: PerSide<boolean>;
  evening: Record<Slot, string>;
  /** A made-up earlier evening the demo groups start with, so the ledger has a history to show. */
  earlier: boolean;
}

export interface LedgerView {
  members: Side[];
  /** Per person: positive when they have given more ground than the group's average. */
  balance: PerSide<number>;
  /** Each person's bargaining weight in the next truce; they sum to 1 (0.5 each for a couple). */
  alpha: PerSide<number>;
  /** The same on a −1…1 scale per person: 1 is the most say the ledger can give, −1 the least. */
  tilt: PerSide<number>;
  /** Who the ledger favours most next time; null when it is even. */
  owed: Side | null;
  entries: LedgerEntry[];
}

export interface PairView {
  id: string;
  mode: Mode;
  members: Side[];
  names: PerSide<string>;
  location: string;
  ready: PerSide<boolean>;
  ledger: LedgerView;
  lastTruceId: string | null;
  lastTruce: {
    id: string;
    status: TruceView['status'];
    checkedIn: PerSide<boolean>;
    /** A swap or replan waiting for votes on that evening, if any. */
    openSwap: (Pick<SwapView, 'id' | 'kind' | 'side' | 'slot' | 'deadline'> & { /** Who hasn't answered yet. */ waiting: Side[] }) | null;
  } | null;
}

export type LinkKind = 'imdb' | 'letterboxd' | 'netflix' | 'spotify' | 'maps' | 'website' | 'menu' | 'phone' | 'resy' | 'opentable';

/** A restaurant's standing, from Qloo's outside data: what the plan card can show as badges. */
export interface VenueView {
  /** The best-known rating out of 5: Tripadvisor or Resy with its review count, else Qloo's business rating (source null). */
  rating: { value: number; count: number | null; source: 'Tripadvisor' | 'Resy' | null } | null;
  michelin: boolean;
  /** Whether Resy takes bookings for a party this group's size; null when Qloo doesn't say. */
  fitsGroup: boolean | null;
}

/** Somewhere to act on a pick: watch, listen, find, book. Always http(s) or tel:. */
export interface Link {
  kind: LinkKind;
  label: string;
  url: string;
}

/** Where a pool item came from: one person's taste, everyone's together (a bridge), or an agent's scouting. */
export type Origin = Side | 'joint' | 'scout';

/** One pool item as the audience sees it: everyone's scores and what drives them. */
export interface CardItem {
  id: string;
  slot: Slot;
  name: string;
  disambiguation: string | null;
  imageUrl: string | null;
  blurb: string | null;
  facts: Record<string, string>;
  /** Each person's score, 0–100. */
  scores: PerSide<number>;
  origins: Origin[];
  /** Each person's seeds behind their score, e.g. "In the Mood for Love (56%)". */
  because: PerSide<string[]>;
  /** The agent who brought it to the table while scouting, and why. */
  scout: { side: Side; why: string } | null;
  /** Restaurants only: the foods each person named that it serves ({ a: ["Lasagna"] }). Empty otherwise. */
  serves: PerSide<string[]>;
  /** Restaurants only, when Qloo knows any of it: rating, Michelin Guide, whether it takes a party this size. */
  venue: VenueView | null;
  links: Link[];
  /** Restaurants only: today's opening hours where they are ("17:00–01:00"), and whether they cover the evening. */
  hours: { today: string | null; openTonight: boolean | null } | null;
  address: string | null;
}

/** The evening being planned, in the restaurant city's own time. */
export interface Tonight {
  /** YYYY-MM-DD. */
  date: string;
  weekday: string;
  timeZone: string;
}

/** An item an agent found or added while scouting. */
export interface ScoutFind {
  id: string;
  name: string;
  imageUrl: string | null;
  disambiguation: string | null;
}

/** What each agent does in the scouting round, before the pool is scored and frozen. */
export type ScoutEvent =
  | { type: 'scout'; side: Side; step: 'start' }
  | {
      type: 'scout';
      side: Side;
      step: 'search';
      slot: Slot;
      /** The favourites or items it steered by. */
      like: string[];
      /** The taste words it asked for, and the Qloo tastes they matched. */
      words: string[];
      matched: string[];
      /** Restaurants: where it looked ("Istanbul", or the group's taste hotspot such as "Cihangir"). */
      area: string | null;
      found: ScoutFind[];
    }
  | { type: 'scout'; side: Side; step: 'add'; slot: Slot; item: ScoutFind; why: string }
  /** Its one line to the group about what it brought; empty if it found nothing worth adding. */
  | { type: 'scout'; side: Side; step: 'done'; message: string };

export type StreamEvent =
  | { type: 'status'; phase: 'gathering' | 'scouting' | 'negotiating'; brain: 'claude' | 'rules' }
  /** Qloo's words for each person's taste, and the vetoes everyone's briefs put in place. */
  | { type: 'tastes'; portraits: PerSide<string[]>; vetoes: string[] }
  | ScoutEvent
  | {
      type: 'pool';
      items: Record<Slot, CardItem[]>;
      indifferent: PerSide<Record<Slot, boolean>>;
      tonight: Tonight;
    }
  | TruceEvent
  | {
      type: 'ledger';
      before: { alpha: PerSide<number>; tilt: PerSide<number> };
      after: { alpha: PerSide<number>; tilt: PerSide<number>; owed: Side | null };
    }
  | { type: 'error'; code: StreamErrorCode; message: string; retryable: boolean };

/**
 * Why a truce stopped. `no_restaurants`: fix the pair's location (PATCH) and
 * start again. `no_options`: add favourites or loosen a veto. `interrupted` /
 * `internal`: try again.
 */
export type StreamErrorCode = 'no_restaurants' | 'no_options' | 'interrupted' | 'internal';

export interface TruceView {
  id: string;
  pairId: string;
  status: 'running' | 'done' | 'failed';
  mode: Mode;
  members: Side[];
  names: PerSide<string>;
  location: string;
  createdAt: string;
  endedAt: string | null;
  checkedIn: PerSide<boolean>;
  events: StreamEvent[];
  /** The truce that planned this evening again, if a replan replaced it. */
  replacedBy: string | null;
  /** The truce this one planned again, if it is a replan. */
  replaces: string | null;
  /**
   * An instant replay: a copy of a recorded live run, moved to today, which
   * the viewer can swap and check in on like their own. Null for a live truce.
   */
  replay: { recordedAt: string } | null;
  /** Which ready-made demo group this is, live or replayed; null for a group people made. */
  demo: 'couple' | 'friends' | null;
}

export interface ReceiptsView {
  /** In the order they were made. Empty for truces from before receipts were kept. */
  calls: QlooCall[];
  totals: { calls: number; cached: number; ms: number };
  /**
   * One request and what came back: the first person's restaurant scores,
   * the top three with Qloo's affinity and the favourites behind it.
   * Null while the truce runs, or if it stopped before scoring.
   */
  example: {
    side: Side;
    slot: Slot;
    call: QlooCall;
    top: { name: string; affinity: number; because: string[] }[];
  } | null;
}

export interface CheckinInput {
  /** False when the evening didn't happen: nothing changes. */
  went: boolean;
  /** Per slot, how it was; a slot left out stays as Qloo predicted. */
  ratings: Partial<Record<Slot, Rating>>;
}

export interface CheckinResult {
  ledger: LedgerView;
  /** What the check-in taught this person's agent: loved picks become favourites, the rest stay off the table. */
  learned: { loved: Seed[]; avoided: Seed[] };
}

/**
 * Swaps: changing one item of a decided evening.
 *
 * Every swap goes to the group: a strict majority, the asker included, must
 * be OK with an alternative they don't see beforehand. That holds for a fact
 * ("unavailable": booked or closed, can't watch it, can't play it) as much as
 * for a taste ("seen" for a film, "not_feeling"), so a fact can't stand in for
 * a taste swap. Whoever hasn't answered when the vote closes is answered for
 * by their agent, which takes a fact on the asker's word. The referee picks
 * the replacement: the fairest item left in that slot that keeps everyone
 * above their minimum, preferring items argued for in the talks; for a fact,
 * the fairest left even below someone's minimum, since the item has to go
 * and the ledger makes up for it. With none left,
 * the group can plan again without what it swapped away ("replan"). A
 * replan needs the same majority, unless an item that can't happen left no
 * way around it.
 *
 * One request is open at a time. Each person may ask for one taste swap per
 * evening. Once anyone checks in, the evening is over and swaps stop.
 */
export type SwapReason = 'unavailable' | 'seen' | 'not_feeling';

export type SwapInput = { kind: 'swap'; side: Side; slot: Slot; reason: SwapReason } | { kind: 'replan'; side: Side };

export interface VoteInput {
  vote: 'yes' | 'no';
}

/**
 * open: votes being collected. swapped: the referee replaced the item.
 * kept: not enough people were OK with it, so nothing changed. no_alternative:
 * the group was OK with a swap, but no fair replacement was left. replanned:
 * a new truce is planning the evening again. cancelled: the asker withdrew it.
 */
export type SwapStatus = 'open' | 'swapped' | 'kept' | 'no_alternative' | 'replanned' | 'cancelled';

export interface SwapVote {
  vote: 'yes' | 'no';
  /** The person, or their agent once the vote closed without them. */
  by: 'person' | 'agent';
  /** An agent's reason, in a few words ("The new film costs Ecrin little."). Null for a person. */
  why: string | null;
}

export interface SwapView {
  id: string;
  kind: 'swap' | 'replan';
  /** Who asked. */
  side: Side;
  /** Swaps only: the slot and why. */
  slot: Slot | null;
  reason: SwapReason | null;
  status: SwapStatus;
  createdAt: string;
  /** When an open vote closes and the agents answer for anyone silent. Null when no vote is needed. */
  deadline: string | null;
  resolvedAt: string | null;
  /** Yes votes needed, the asker's included (a strict majority); 0 when no vote is needed. */
  needed: number;
  /** Everyone who has answered so far. The asker's yes is there from the start. */
  votes: PerSide<SwapVote>;
  /** Swaps: the item asked to go, and what replaced it once swapped. */
  from: { id: string; name: string } | null;
  to: { id: string; name: string } | null;
  /** Swaps: everyone's evening score (0–100) before, and after once swapped. */
  scores: { before: PerSide<number>; after: PerSide<number> | null } | null;
  /** Replans: the new truce, once it has started. */
  truceId: string | null;
  /** Cancelled only: the asker withdrew it, or a newer evening took this one's place and called it off. */
  cancelled: 'withdrawn' | 'superseded' | null;
}

/** Why no new request can be made on an evening, or null if one can. */
export type SwapLock =
  | 'not_done' // still being planned, or it stopped
  | 'history' // a made-up earlier evening
  | 'replanned' // a replan replaced it
  | 'superseded' // the group has planned a newer evening since
  | 'checked_in' // someone already said how it went
  | 'past' // the evening's date has passed where it happens
  | 'open'; // a request is waiting for votes

export interface SwapsView {
  /** The evening as it stands, after any swaps: an item id per slot, each one in the truce's pool. Null until decided. */
  bundle: Record<Slot, string> | null;
  /** Everyone's evening score now, 0–100. */
  scores: PerSide<number> | null;
  /**
   * How far each person's evening now falls short of their own best, 0–1,
   * exactly as the ledger counts it: with any swap they asked for and didn't
   * get, and any check-in. An evening a replan replaced isn't in the ledger;
   * then it's the plain prediction.
   */
  concession: PerSide<number> | null;
  /** The ledger as it stands with this evening as it is now: next time's weights and who is owed. */
  ledger: { alpha: PerSide<number>; tilt: PerSide<number>; owed: Side | null };
  /** Oldest first. */
  swaps: SwapView[];
  lock: SwapLock | null;
  /** Per person: whether they still have their taste swap for this evening. */
  canAsk: PerSide<boolean>;
  /** Yes votes a vote needs in this group, the asker's included. */
  needed: number;
  /** How long a vote stays open before the agents answer for anyone silent, in minutes. */
  voteMinutes: number;
  /** Whether a replan would go ahead at once: the item in the way can't happen and nothing can replace it. */
  replanNow: boolean;
  /** The truce that planned this evening again, if one did. */
  replacedBy: string | null;
}

export interface DemoInput {
  /** "couple": Maya and Deniz in Manhattan. "friends": three friends in Istanbul. */
  kind: 'couple' | 'friends';
  /**
   * True: a recorded run, replayed at once instead of a live one (about a
   * minute). The server also replays when it can't start a live truce now;
   * with no recording yet, it runs live.
   */
  replay?: boolean;
}

export interface DemoStarted {
  pairId: string;
  truceId: string;
  /** Whether this is an instant replay rather than a live run. */
  replay: boolean;
}

export interface ApiError {
  error: { code: string; message: string; retryAfterSeconds?: number };
}
