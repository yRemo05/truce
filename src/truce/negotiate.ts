/**
 * The referee: runs the turns, checks every move, and decides the evening.
 *
 * Agents take turns round the table for up to `turns` moves. On its turn an
 * agent either says yes to the offer on the table or replaces it with its own
 * counter; the evening is agreed once every agent has said yes to the same
 * offer. With two people that is plain alternating offers.
 *
 * Each move is checked in code: items must come from the pool, an agent may
 * neither accept nor offer below its person's minimum for that turn (see
 * bargain.ts › reservation), and an invalid or failed move is replaced by the
 * rule-based agent's move, so a model's mistake costs a sentence, never the
 * evening. After the last turn, everyone who hasn't yet said yes to the final
 * offer gets a last call; one "no" and the referee rules the weighted Nash
 * bundle. Either way, if another evening is better for everyone, the referee
 * upgrades to it (the "polish") — nobody loses by it.
 *
 * In the final round (each agent's last turn) the referee mediates: it shows
 * the agent whose turn it is a shortlist of evenings it has checked that
 * every agent can accept by the last call (the zone of agreement). The agent
 * still chooses its move and still needs everyone's yes; it just no longer
 * has to guess where that zone is. Without it, groups of three or more rarely
 * found an offer that cleared everyone's floor in time.
 */
import {
  RuleBrain,
  scoreOf,
  type AgentBrain,
  type AgentBrief,
  type AgentView,
  type MenuItem,
  type Mode,
  type PublicMove,
  type RawMove,
} from '../agents/brain';
import {
  betterForAll,
  eagerness,
  enumerateBundles,
  floorOf,
  nashBundle,
  reservation,
  scoreBundles,
  type Scored,
} from './bargain';
import { concession } from './ledger';
import type { Pool } from './pool';
import { SLOTS, at, perSide, sameBundle, type Bundle, type PerSide, type Side, type Slot, type Weights } from './types';

export interface TruceSetup {
  mode: Mode;
  /** Who takes part, in seat order. */
  members: Side[];
  names: PerSide<string>;
  weights: PerSide<Weights>;
  /** Display names of every seed id, for "because" lines. */
  seedNames: Record<string, string>;
  /** The seed ids each person named, per slot. */
  seeds: PerSide<Record<Slot, string[]>>;
  /** Qloo's words for each person's taste. */
  portraits?: PerSide<string[]>;
  /** What each person told their own agent. */
  briefs?: PerSide<AgentBrief | null>;
  /** Each person's bargaining weight from the ledger; they sum to 1. */
  alpha: PerSide<number>;
  opener: Side;
  /** Moves before the last call; three per person by default. */
  turns?: number;
  /** Per-move time limit for an agent before the rule-based move stands in. */
  moveTimeoutMs?: number;
}

export interface SlotEvidence {
  slot: Slot;
  itemId: string;
  /** The mover's seeds that drive their score for this item (Qloo explainability). */
  because: string[];
}

export type TruceEvent =
  | { type: 'start'; opener: Side; order: Side[]; turns: number; alpha: PerSide<number> }
  | { type: 'thinking'; side: Side; turn: number }
  | {
      type: 'move';
      turn: number;
      side: Side;
      action: 'accept' | 'counter';
      bundle: Bundle;
      message: string;
      /** Everyone's scores for the bundle, 0–100 (the audience sees all; agents see their own). */
      scores: PerSide<number>;
      evidence: SlotEvidence[];
      brain: string;
      /** Who has said yes to this offer so far, its maker first. */
      acceptedBy: Side[];
      /** A counter taken from the referee's final-round shortlist. */
      shortlisted: boolean;
    }
  | { type: 'rejected'; turn: number; side: Side; code: StrikeCode; reason: string }
  /** A last call was declined: the referee will rule. */
  | { type: 'declined'; turn: number; side: Side; message: string; brain: string }
  | { type: 'agreement'; turn: number; bundle: Bundle; by: Side[] }
  | { type: 'ruling'; bundle: Bundle; scores: PerSide<number> }
  | { type: 'polish'; from: Bundle; to: Bundle; scores: { from: PerSide<number>; to: PerSide<number> } }
  | { type: 'done'; result: TruceResult };

export interface TruceResult {
  bundle: Bundle;
  how: 'agreed' | 'ruled';
  polished: boolean;
  turnsUsed: number;
  /** 0–1 on each person's own scale. */
  utilities: PerSide<number>;
  best: PerSide<number>;
  concession: PerSide<number>;
  /** Each person's 0–1 utility for each item of the evening, and their weights: what a check-in is weighed against. */
  items: PerSide<Record<Slot, number>>;
  weights: PerSide<Weights>;
  fair: Scored;
}

const MOVES_PER_PERSON = 3;
const DEFAULT_MOVE_TIMEOUT = 25_000;
const LETTER: Record<Slot, string> = { film: 'F', restaurant: 'R', music: 'M' };

/** Each side's menu: every pool item with that person's score and what drives it. */
export function menuFor(pool: Pool, side: Side, seedNames: Record<string, string>): MenuItem[] {
  return SLOTS.flatMap((slot) =>
    pool.items[slot].map((item, i) => ({
      code: `${LETTER[slot]}${i + 1}`,
      id: item.id,
      slot,
      name: item.name,
      score: Math.round((at(pool.utilities, side)[slot][item.id] ?? 0) * 100),
      because: (at(pool.drivers, side)[slot][item.id] ?? [])
        .filter((d) => seedNames[d.seedId])
        .sort((x, y) => y.share - x.share)
        .slice(0, 2)
        .map((d) => `${seedNames[d.seedId]} (${Math.round(d.share * 100)}%)`),
      bridge: item.origins.includes('joint'),
      scoutedBy: item.scoutedBy,
      blurb: item.blurb,
      facts: item.facts,
    })),
  );
}

/** The seat order of a truce: the members, starting from the opener. */
export function seatOrder(members: readonly Side[], opener: Side): Side[] {
  const i = Math.max(0, members.indexOf(opener));
  return [...members.slice(i), ...members.slice(0, i)];
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no move within ${ms} ms`)), ms);
    p.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e)),
    );
  });
}

/** Why the referee struck a move; `reason` is the same in words, for logs. */
export type StrikeCode = 'nothing_to_accept' | 'below_minimum' | 'unknown_item' | 'no_counter' | 'agent_failed';

type Checked =
  | { ok: true; action: 'accept' | 'counter'; bundle: Bundle }
  | { ok: true; action: 'decline' }
  | { ok: false; code: StrikeCode; reason: string };

/** Referee check of one raw move against what the mover may do this turn. */
export function checkMove(view: AgentView, raw: RawMove): Checked {
  // Codes first; an exact item name is accepted too (models sometimes write the name).
  const byCode = new Map(view.menu.map((m) => [m.code.toUpperCase(), m]));
  for (const m of view.menu) {
    const key = m.name.trim().toUpperCase();
    if (!byCode.has(key)) byCode.set(key, m);
  }
  const tolerance = 1e-6;
  if (raw.action === 'accept') {
    if (!view.onTable) return { ok: false, code: 'nothing_to_accept', reason: 'accepted with nothing on the table' };
    if (scoreOf(view, view.onTable.bundle) < view.minimum - tolerance) {
      return { ok: false, code: 'below_minimum', reason: `accepted below ${view.nickname}'s minimum` };
    }
    return { ok: true, action: 'accept', bundle: view.onTable.bundle };
  }
  // On the last call there is nothing left to counter with: anything but yes is no.
  if (view.lastCall) return { ok: true, action: 'decline' };
  const problems: { code: StrikeCode; reason: string }[] = [];
  for (const c of raw.counters) {
    const picked = { film: c.film, restaurant: c.restaurant, music: c.music };
    const bundle = {} as Bundle;
    let valid = true;
    for (const s of SLOTS) {
      const item = byCode.get(String(picked[s]).trim().toUpperCase());
      if (!item || item.slot !== s) {
        valid = false;
        problems.push({ code: 'unknown_item', reason: `unknown ${s} "${picked[s]}"` });
        break;
      }
      bundle[s] = item.id;
    }
    if (!valid) continue;
    if (scoreOf(view, bundle) < view.minimum - tolerance) {
      problems.push({ code: 'below_minimum', reason: `offer below ${view.nickname}'s minimum` });
      continue;
    }
    // Offering exactly what is on the table is accepting it.
    if (view.onTable && sameBundle(bundle, view.onTable.bundle)) return { ok: true, action: 'accept', bundle };
    return { ok: true, action: 'counter', bundle };
  }
  return { ok: false, ...(problems[0] ?? { code: 'no_counter', reason: 'no counter offered' }) };
}

export async function negotiate(
  pool: Pool,
  setup: TruceSetup,
  brains: PerSide<AgentBrain>,
  emit: (e: TruceEvent) => void = () => {},
  fallback: AgentBrain = new RuleBrain(),
): Promise<TruceResult> {
  const { members } = setup;
  const n = members.length;
  const turns = setup.turns ?? MOVES_PER_PERSON * n;
  const timeout = setup.moveTimeoutMs ?? DEFAULT_MOVE_TIMEOUT;
  const order = seatOrder(members, setup.opener);
  const pools = Object.fromEntries(SLOTS.map((s) => [s, pool.items[s].map((i) => i.id)])) as Record<Slot, string[]>;
  const scored = scoreBundles(
    enumerateBundles(pools),
    members,
    perSide(members, (s) => ({ utilities: at(pool.utilities, s), weights: at(setup.weights, s) })),
  );
  const best = perSide(members, (s) => Math.max(...scored.map((x) => at(x.u, s))));
  const fair = nashBundle(scored, members, setup.alpha);
  const floor = perSide(members, (s) => floorOf(at(fair.u, s)));
  const menus = perSide(members, (s) => menuFor(pool, s, setup.seedNames));
  // Agents and the referee's checks see menu scores (whole numbers per item), so everything they act on uses those.
  const utilityOf = (side: Side, bundle: Bundle) =>
    scoreOf({ menu: at(menus, side), weights: at(setup.weights, side) }, bundle) / 100;
  // The zone of agreement: evenings every member may accept at the last call, with each one's menu utility.
  const zone = scored
    .map((x) => ({ bundle: x.bundle, u: perSide(members, (s) => utilityOf(s, x.bundle)) }))
    .filter((x) => members.every((s) => at(x.u, s) >= at(floor, s) - 1e-9));
  const scoresOf = (bundle: Bundle) => perSide(members, (s) => Math.round(utilityOf(s, bundle) * 100));
  const seedNames = (side: Side) =>
    Object.fromEntries(SLOTS.map((s) => [s, at(setup.seeds, side)[s].map((id) => setup.seedNames[id] ?? id)])) as Record<
      Slot,
      string[]
    >;

  emit({ type: 'start', opener: order[0]!, order, turns, alpha: setup.alpha });

  const history: PublicMove[] = [];
  // Holders, not `let`s: `record` sets them from inside a closure.
  const table: { offer: { bundle: Bundle; from: Side; acceptedBy: Side[] } | null } = { offer: null };
  const deal: { agreed: { bundle: Bundle; turn: number } | null } = { agreed: null };
  let turnsUsed = 0;

  /** One agent's move: ask it, check it, and fall back to the rule-based agent if it fails. */
  async function play(turn: number, side: Side, lastCall: boolean) {
    const offer = table.offer && table.offer.from !== side && !table.offer.acceptedBy.includes(side) ? table.offer : null;
    // By the last call every side's minimum has come down to its floor.
    const minimum =
      100 *
      reservation({
        turn: Math.min(turn, turns),
        turns,
        best: at(best, side),
        floor: at(floor, side),
        eagerness: eagerness(at(setup.alpha, side), n),
      });
    const view: AgentView = {
      side,
      nickname: at(setup.names, side),
      others: order
        .filter((s) => s !== side)
        .map((s) => ({ side: s, nickname: at(setup.names, s), seedNames: seedNames(s), portrait: setup.portraits?.[s] ?? [] })),
      mode: setup.mode,
      turn,
      turns,
      weights: at(setup.weights, side),
      seedNames: seedNames(side),
      portrait: setup.portraits?.[side] ?? [],
      brief: setup.briefs?.[side] ?? null,
      menu: at(menus, side),
      best: Math.round(at(best, side) * 100),
      minimum,
      onTable: offer
        ? { bundle: offer.bundle, score: utilityOf(side, offer.bundle) * 100, from: offer.from, acceptedBy: [...offer.acceptedBy] }
        : null,
      history: [...history],
      shortlist:
        !lastCall && turn > turns - n
          ? zone
              .filter((x) => at(x.u, side) * 100 >= minimum - 1e-9)
              .sort((x, y) => at(y.u, side) - at(x.u, side))
              .slice(0, 3)
              .map((x) => x.bundle)
          : [],
      lastCall,
    };

    emit({ type: 'thinking', side, turn });
    const brain = at(brains, side);
    let brainName = brain.name;
    let raw: RawMove | null = null;
    try {
      raw = await withTimeout(brain.move(view), timeout);
    } catch (err) {
      emit({ type: 'rejected', turn, side, code: 'agent_failed', reason: `agent failed: ${(err as Error).message}` });
    }
    let checked: Checked = raw ? checkMove(view, raw) : { ok: false, code: 'agent_failed', reason: 'no move' };
    let message = raw?.message ?? '';
    if (!checked.ok) {
      if (raw) emit({ type: 'rejected', turn, side, code: checked.code, reason: checked.reason });
      const backup = await fallback.move(view);
      checked = checkMove(view, backup);
      message = backup.message;
      brainName = fallback.name;
      if (!checked.ok) throw new Error(`referee: the fallback agent also failed (${checked.reason})`);
    }
    return { checked, message, brainName, shortlist: view.shortlist };
  }

  function record(turn: number, side: Side, action: 'accept' | 'counter', bundle: Bundle, message: string, brain: string, shortlist: Bundle[]) {
    if (action === 'counter' || !table.offer) table.offer = { bundle, from: side, acceptedBy: [side] };
    else table.offer.acceptedBy.push(side);
    const acceptedBy = [...table.offer.acceptedBy];
    const move: PublicMove = { turn, side, action, bundle, message };
    history.push(move);
    emit({
      type: 'move',
      ...move,
      scores: scoresOf(bundle),
      evidence: SLOTS.map((slot) => ({
        slot,
        itemId: bundle[slot],
        because: at(menus, side).find((m) => m.slot === slot && m.id === bundle[slot])?.because ?? [],
      })),
      brain,
      acceptedBy,
      shortlisted: action === 'counter' && shortlist.some((b) => sameBundle(b, bundle)),
    });
    if (acceptedBy.length === n) {
      deal.agreed = { bundle, turn };
      emit({ type: 'agreement', turn, bundle, by: acceptedBy });
    }
  }

  for (let turn = 1; turn <= turns && !deal.agreed; turn++) {
    turnsUsed = turn;
    const side = order[(turn - 1) % n]!;
    const { checked, message, brainName, shortlist } = await play(turn, side, false);
    if (checked.action === 'decline') throw new Error('referee: a decline outside the last call');
    record(turn, side, checked.action, checked.bundle, message, brainName, shortlist);
  }

  // Last call: everyone who hasn't said yes to the final offer may still take it, in seat order.
  if (!deal.agreed && table.offer) {
    const from = order.indexOf(table.offer.from);
    const pending = [...order.slice(from + 1), ...order.slice(0, from)].filter((s) => !table.offer!.acceptedBy.includes(s));
    const turn = turns + 1;
    turnsUsed = turn;
    for (const side of pending) {
      const { checked, message, brainName } = await play(turn, side, true);
      if (checked.action === 'decline') {
        emit({ type: 'declined', turn, side, message, brain: brainName });
        break;
      }
      record(turn, side, checked.action, checked.bundle, message, brainName, []);
    }
  }

  let bundle = deal.agreed?.bundle ?? fair.bundle;
  if (!deal.agreed) emit({ type: 'ruling', bundle, scores: scoresOf(bundle) });

  const current = scored.find((x) => sameBundle(x.bundle, bundle))!;
  const better = betterForAll(scored, current, members);
  const gain = better ? members.reduce((t, s) => t + at(better.u, s) - at(current.u, s), 0) : 0;
  const polished = better !== null && gain > 0.01;
  if (polished) {
    emit({ type: 'polish', from: bundle, to: better!.bundle, scores: { from: scoresOf(bundle), to: scoresOf(better!.bundle) } });
    bundle = better!.bundle;
  }

  const final = scored.find((x) => sameBundle(x.bundle, bundle))!;
  const result: TruceResult = {
    bundle,
    how: deal.agreed ? 'agreed' : 'ruled',
    polished,
    turnsUsed,
    utilities: final.u,
    best,
    concession: perSide(members, (s) => concession(at(best, s), at(final.u, s))),
    items: perSide(
      members,
      (s) => Object.fromEntries(SLOTS.map((slot) => [slot, at(pool.utilities, s)[slot][bundle[slot]] ?? 0])) as Record<Slot, number>,
    ),
    weights: setup.weights,
    fair,
  };
  emit({ type: 'done', result });
  return result;
}
