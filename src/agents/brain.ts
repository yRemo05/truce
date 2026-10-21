/**
 * What an agent sees and what it may answer.
 *
 * An agent knows only its own person: their seeds, how much each slot
 * matters to them, and a menu of every pool item with their own score for
 * it (0–100) and which of their seeds Qloo says drives that score. It never
 * sees the other person's scores; it learns them only from the other side's
 * offers and words, like a real negotiation.
 *
 * Items are named by short codes (F1, R3, M2) rather than Qloo ids so a model
 * can't garble a UUID; the referee maps codes back.
 */
import { SLOTS, type Bundle, type Side, type Slot, type Weights } from '../truce/types';

export type Mode = 'couple' | 'bff';

export interface MenuItem {
  code: string;
  id: string;
  slot: Slot;
  name: string;
  /** This person's score for the item, 0–100. */
  score: number;
  /** Their seeds that drive the score, strongest first, e.g. "In the Mood for Love (56%)". */
  because: string[];
  blurb: string | null;
  facts: Record<string, string>;
}

export interface PublicMove {
  turn: number;
  side: Side;
  action: 'accept' | 'counter';
  bundle: Bundle;
  message: string;
}

export interface AgentView {
  side: Side;
  nickname: string;
  otherNickname: string;
  mode: Mode;
  turn: number;
  turns: number;
  weights: Weights;
  seedNames: Record<Slot, string[]>;
  menu: MenuItem[];
  /** Their best possible evening, 0–100. */
  best: number;
  /** The least they may accept or offer this turn, 0–100. */
  minimum: number;
  /** The offer on the table from the other side, with this person's score for it. */
  onTable: { bundle: Bundle; score: number } | null;
  history: PublicMove[];
  /** The closing turn after the last offer: accept it or decline; no counters. */
  lastCall: boolean;
}

/** An agent's answer, in item codes. Counters are in preference order. */
export interface RawMove {
  action: 'accept' | 'counter';
  counters: { film: string; restaurant: string; music: string }[];
  message: string;
}

export interface AgentBrain {
  readonly name: string;
  move(view: AgentView): Promise<RawMove>;
}

/** A bundle's score for this agent's person, 0–100, from the menu and weights. */
export function scoreOf(view: Pick<AgentView, 'menu' | 'weights'>, bundle: Bundle): number {
  let total = 0;
  for (const s of SLOTS) {
    const item = view.menu.find((m) => m.slot === s && m.id === bundle[s]);
    total += view.weights[s] * (item?.score ?? 0);
  }
  return total;
}

export const codeOf = (view: Pick<AgentView, 'menu'>, id: string) => view.menu.find((m) => m.id === id)?.code ?? id;

/**
 * What the other side seems to want, from their offers alone: an item they
 * put on the table counts for them, recent offers more than old ones.
 */
export function theirInterest(view: Pick<AgentView, 'history' | 'side'>, bundle: Bundle): number {
  const theirs = view.history.filter((m) => m.side !== view.side);
  let interest = 0;
  theirs.forEach((m, i) => {
    const recency = 0.6 ** (theirs.length - 1 - i);
    for (const s of SLOTS) if (m.bundle[s] === bundle[s]) interest += recency;
  });
  return interest;
}

/**
 * A rule-based agent: accepts what clears its minimum; otherwise offers, of
 * the bundles that clear its minimum, the one most like what the other side
 * has been asking for. Uses only what the agent can see. Drives the tests
 * and stands in when the model is unavailable.
 */
export class RuleBrain implements AgentBrain {
  readonly name = 'rules';

  async move(view: AgentView): Promise<RawMove> {
    if (view.onTable && view.onTable.score >= view.minimum - 1e-9) {
      return { action: 'accept', counters: [], message: `That works for ${view.nickname}.` };
    }
    if (view.lastCall) {
      return { action: 'counter', counters: [], message: `${view.nickname} can't go that far tonight.` };
    }
    const bySlot = SLOTS.map((s) => view.menu.filter((m) => m.slot === s));
    let best: { bundle: Bundle; interest: number; score: number } | null = null;
    for (const f of bySlot[0]!)
      for (const r of bySlot[1]!)
        for (const m of bySlot[2]!) {
          const bundle: Bundle = { film: f.id, restaurant: r.id, music: m.id };
          const score = scoreOf(view, bundle);
          if (score < view.minimum - 1e-9) continue;
          const interest = theirInterest(view, bundle);
          if (!best || interest > best.interest + 1e-9 || (Math.abs(interest - best.interest) <= 1e-9 && score > best.score)) {
            best = { bundle, interest, score };
          }
        }
    const pick = best?.bundle ?? null;
    if (!pick) return { action: 'counter', counters: [], message: 'Nothing here clears my minimum.' };
    return {
      action: 'counter',
      counters: [{ film: codeOf(view, pick.film), restaurant: codeOf(view, pick.restaurant), music: codeOf(view, pick.music) }],
      message: view.history.length ? `${view.nickname} can meet you partway.` : `Here is where ${view.nickname} would start.`,
    };
  }
}
