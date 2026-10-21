/**
 * The referee: runs the turns, checks every move, and decides the evening.
 *
 * Agents alternate for up to `turns` moves. Each move is checked in code:
 * items must come from the pool, an agent may neither accept nor offer below
 * its person's minimum for that turn (see bargain.ts › reservation), and an
 * invalid or failed move is replaced by the rule-based agent's move, so a
 * model's mistake costs a sentence, never the evening. With no agreement
 * after the last turn, the referee rules the weighted Nash bundle. Either
 * way, if another evening is better for both, the referee upgrades to it
 * (the "polish") — nobody loses by it.
 */
import {
  RuleBrain,
  scoreOf,
  type AgentBrain,
  type AgentView,
  type MenuItem,
  type Mode,
  type PublicMove,
  type RawMove,
} from '../agents/brain';
import {
  betterForBoth,
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
import { SLOTS, other, sameBundle, type Bundle, type Side, type Slot, type Weights } from './types';

export interface TruceSetup {
  mode: Mode;
  names: Record<Side, string>;
  weights: Record<Side, Weights>;
  /** Display names of every seed id, for "because" lines. */
  seedNames: Record<string, string>;
  /** The seed ids each side named, per slot. */
  seeds: Record<Side, Record<Slot, string[]>>;
  /** A's bargaining weight from the ledger; B's is 1 − alphaA. */
  alphaA: number;
  opener: Side;
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
  | { type: 'start'; opener: Side; turns: number; alphaA: number }
  | { type: 'thinking'; side: Side; turn: number }
  | {
      type: 'move';
      turn: number;
      side: Side;
      action: 'accept' | 'counter';
      bundle: Bundle;
      message: string;
      /** Both people's scores for the bundle, 0–100 (the audience sees both; agents see their own). */
      scores: Record<Side, number>;
      evidence: SlotEvidence[];
      brain: string;
    }
  | { type: 'rejected'; turn: number; side: Side; reason: string }
  /** The last call was declined: the referee will rule. */
  | { type: 'declined'; turn: number; side: Side; message: string; brain: string }
  | { type: 'agreement'; turn: number; bundle: Bundle }
  | { type: 'ruling'; bundle: Bundle }
  | { type: 'polish'; from: Bundle; to: Bundle }
  | { type: 'done'; result: TruceResult };

export interface TruceResult {
  bundle: Bundle;
  how: 'agreed' | 'ruled';
  polished: boolean;
  turnsUsed: number;
  /** 0–1 on each person's own scale. */
  utilities: Record<Side, number>;
  best: Record<Side, number>;
  concession: Record<Side, number>;
  fair: Scored;
}

const DEFAULT_TURNS = 6;
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
      score: Math.round((pool.utilities[side][slot][item.id] ?? 0) * 100),
      because: (pool.drivers[side][slot][item.id] ?? [])
        .filter((d) => seedNames[d.seedId])
        .sort((x, y) => y.share - x.share)
        .slice(0, 2)
        .map((d) => `${seedNames[d.seedId]} (${Math.round(d.share * 100)}%)`),
      bridge: item.origins.includes('joint'),
      blurb: item.blurb,
      facts: item.facts,
    })),
  );
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

type Checked =
  | { ok: true; action: 'accept' | 'counter'; bundle: Bundle }
  | { ok: true; action: 'decline' }
  | { ok: false; reason: string };

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
    if (!view.onTable) return { ok: false, reason: 'accepted with nothing on the table' };
    if (scoreOf(view, view.onTable.bundle) < view.minimum - tolerance) {
      return { ok: false, reason: `accepted below ${view.nickname}'s minimum` };
    }
    return { ok: true, action: 'accept', bundle: view.onTable.bundle };
  }
  // On the last call there is nothing left to counter with: anything but yes is no.
  if (view.lastCall) return { ok: true, action: 'decline' };
  const problems: string[] = [];
  for (const c of raw.counters) {
    const picked = { film: c.film, restaurant: c.restaurant, music: c.music };
    const bundle = {} as Bundle;
    let valid = true;
    for (const s of SLOTS) {
      const item = byCode.get(String(picked[s]).trim().toUpperCase());
      if (!item || item.slot !== s) {
        valid = false;
        problems.push(`unknown ${s} "${picked[s]}"`);
        break;
      }
      bundle[s] = item.id;
    }
    if (!valid) continue;
    if (scoreOf(view, bundle) < view.minimum - tolerance) {
      problems.push(`offer below ${view.nickname}'s minimum`);
      continue;
    }
    // Offering exactly what is on the table is accepting it.
    if (view.onTable && sameBundle(bundle, view.onTable.bundle)) return { ok: true, action: 'accept', bundle };
    return { ok: true, action: 'counter', bundle };
  }
  return { ok: false, reason: problems[0] ?? 'no counter offered' };
}

export async function negotiate(
  pool: Pool,
  setup: TruceSetup,
  brains: Record<Side, AgentBrain>,
  emit: (e: TruceEvent) => void = () => {},
  fallback: AgentBrain = new RuleBrain(),
): Promise<TruceResult> {
  const turns = setup.turns ?? DEFAULT_TURNS;
  const timeout = setup.moveTimeoutMs ?? DEFAULT_MOVE_TIMEOUT;
  const pools = Object.fromEntries(SLOTS.map((s) => [s, pool.items[s].map((i) => i.id)])) as Record<Slot, string[]>;
  const scored = scoreBundles(enumerateBundles(pools), {
    a: { utilities: pool.utilities.a, weights: setup.weights.a },
    b: { utilities: pool.utilities.b, weights: setup.weights.b },
  });
  const best = { a: Math.max(...scored.map((x) => x.a)), b: Math.max(...scored.map((x) => x.b)) };
  const fair = nashBundle(scored, setup.alphaA);
  const alpha: Record<Side, number> = { a: setup.alphaA, b: 1 - setup.alphaA };
  const floor: Record<Side, number> = { a: floorOf(fair.a), b: floorOf(fair.b) };
  const menus: Record<Side, MenuItem[]> = { a: menuFor(pool, 'a', setup.seedNames), b: menuFor(pool, 'b', setup.seedNames) };
  const utilityOf = (side: Side, bundle: Bundle) => scoreOf({ menu: menus[side], weights: setup.weights[side] }, bundle) / 100;
  const seedNames = (side: Side) =>
    Object.fromEntries(SLOTS.map((s) => [s, setup.seeds[side][s].map((id) => setup.seedNames[id] ?? id)])) as Record<Slot, string[]>;

  emit({ type: 'start', opener: setup.opener, turns, alphaA: setup.alphaA });

  const history: PublicMove[] = [];
  // A holder, not a `let`: `record` sets it from inside a closure.
  const deal: { agreed: { bundle: Bundle; turn: number } | null } = { agreed: null };
  let turnsUsed = 0;

  /** One agent's move: ask it, check it, and fall back to the rule-based agent if it fails. */
  async function play(turn: number, side: Side, lastCall: boolean) {
    const last = history[history.length - 1];
    const onTableBundle = last && last.side !== side && last.action === 'counter' ? last.bundle : null;
    // By the last call every side's minimum has come down to its floor.
    const minimum =
      100 *
      reservation({ turn: Math.min(turn, turns), turns, best: best[side], floor: floor[side], eagerness: eagerness(alpha[side]) });
    const view: AgentView = {
      side,
      nickname: setup.names[side],
      otherNickname: setup.names[other(side)],
      mode: setup.mode,
      turn,
      turns,
      weights: setup.weights[side],
      seedNames: seedNames(side),
      otherSeedNames: seedNames(other(side)),
      menu: menus[side],
      best: Math.round(best[side] * 100),
      minimum,
      onTable: onTableBundle ? { bundle: onTableBundle, score: utilityOf(side, onTableBundle) * 100 } : null,
      history: [...history],
      lastCall,
    };

    emit({ type: 'thinking', side, turn });
    let brainName = brains[side].name;
    let raw: RawMove | null = null;
    try {
      raw = await withTimeout(brains[side].move(view), timeout);
    } catch (err) {
      emit({ type: 'rejected', turn, side, reason: `agent failed: ${(err as Error).message}` });
    }
    let checked: Checked = raw ? checkMove(view, raw) : { ok: false, reason: 'no move' };
    let message = raw?.message ?? '';
    if (!checked.ok) {
      if (raw) emit({ type: 'rejected', turn, side, reason: checked.reason });
      const backup = await fallback.move(view);
      checked = checkMove(view, backup);
      message = backup.message;
      brainName = fallback.name;
      if (!checked.ok) throw new Error(`referee: the fallback agent also failed (${checked.reason})`);
    }
    return { checked, message, brainName };
  }

  function record(turn: number, side: Side, action: 'accept' | 'counter', bundle: Bundle, message: string, brain: string) {
    const move: PublicMove = { turn, side, action, bundle, message };
    history.push(move);
    emit({
      type: 'move',
      ...move,
      scores: { a: Math.round(utilityOf('a', bundle) * 100), b: Math.round(utilityOf('b', bundle) * 100) },
      evidence: SLOTS.map((slot) => ({
        slot,
        itemId: bundle[slot],
        because: menus[side].find((m) => m.slot === slot && m.id === bundle[slot])?.because ?? [],
      })),
      brain,
    });
    if (action === 'accept') {
      deal.agreed = { bundle, turn };
      emit({ type: 'agreement', turn, bundle });
    }
  }

  for (let turn = 1; turn <= turns && !deal.agreed; turn++) {
    turnsUsed = turn;
    const side = turn % 2 === 1 ? setup.opener : other(setup.opener);
    const { checked, message, brainName } = await play(turn, side, false);
    if (checked.action === 'decline') throw new Error('referee: a decline outside the last call');
    record(turn, side, checked.action, checked.bundle, message, brainName);
  }

  // Last call: whoever did not make the final offer may still take it.
  const finalOffer = history[history.length - 1];
  if (!deal.agreed && finalOffer?.action === 'counter') {
    const turn = turns + 1;
    const side = other(finalOffer.side);
    turnsUsed = turn;
    const { checked, message, brainName } = await play(turn, side, true);
    if (checked.action === 'decline') emit({ type: 'declined', turn, side, message, brain: brainName });
    else record(turn, side, checked.action, checked.bundle, message, brainName);
  }

  let bundle = deal.agreed?.bundle ?? fair.bundle;
  if (!deal.agreed) emit({ type: 'ruling', bundle });

  const current = scored.find((x) => sameBundle(x.bundle, bundle))!;
  const better = betterForBoth(scored, current);
  const polished = better !== null && better.a + better.b - (current.a + current.b) > 0.01;
  if (polished) {
    emit({ type: 'polish', from: bundle, to: better!.bundle });
    bundle = better!.bundle;
  }

  const final = scored.find((x) => sameBundle(x.bundle, bundle))!;
  const result: TruceResult = {
    bundle,
    how: deal.agreed ? 'agreed' : 'ruled',
    polished,
    turnsUsed,
    utilities: { a: final.a, b: final.b },
    best,
    concession: { a: concession(best.a, final.a), b: concession(best.b, final.b) },
    fair,
  };
  emit({ type: 'done', result });
  return result;
}
