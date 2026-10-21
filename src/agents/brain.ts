/**
 * What an agent sees and what it may answer.
 *
 * An agent knows only its own person: their seeds, their brief, how much
 * each slot matters to them, and a menu of every pool item with their own
 * score for it (0–100) and which of their seeds Qloo says drives that score.
 * It never sees anyone else's scores; it learns them only from the other
 * agents' offers and words, like a real negotiation.
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
  /** Qloo found it from everyone's tastes together: the likeliest middle ground. */
  bridge: boolean;
  /** The agent who added it while scouting, if one did. */
  scoutedBy: Side | null;
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

/** What a person told their own agent about tonight, as the agent reads it. */
export interface AgentBrief {
  /** Their words, trimmed. */
  text: string;
  /** What they'd like, as Qloo understood it ("Cozy (restaurant)"). */
  wishes: string[];
  /** What they ruled out; the referee already keeps these out of the pool. */
  vetoes: string[];
}

export interface OtherPerson {
  side: Side;
  nickname: string;
  /** What they said they love: shared with the group, unlike their scores. */
  seedNames: Record<Slot, string[]>;
  /** Qloo's words for their taste, also shared. */
  portrait: string[];
}

export interface AgentView {
  side: Side;
  nickname: string;
  /** Everyone else taking part, in turn order. */
  others: OtherPerson[];
  mode: Mode;
  turn: number;
  turns: number;
  weights: Weights;
  seedNames: Record<Slot, string[]>;
  portrait: string[];
  brief: AgentBrief | null;
  menu: MenuItem[];
  /** Their best possible evening, 0–100. */
  best: number;
  /** The least they may accept or offer this turn, 0–100. */
  minimum: number;
  /**
   * The offer on the table, with this person's score for it, whose it is,
   * and who else has already said yes to it.
   */
  onTable: { bundle: Bundle; score: number; from: Side; acceptedBy: Side[] } | null;
  history: PublicMove[];
  /**
   * Final round only: evenings the referee has checked that every agent can
   * accept by the last call and that clear this agent's own minimum, best
   * for its person first. Empty before the final round.
   */
  shortlist: Bundle[];
  /** The closing round after the last offer: accept it or decline; no counters. */
  lastCall: boolean;
}

/**
 * An agent's answer, in item codes. Counters are in preference order; each
 * may carry its own message, so whichever one the referee plays comes with
 * words about that evening. `message` is for an accept or a decline.
 */
export interface RawMove {
  action: 'accept' | 'counter';
  counters: { film: string; restaurant: string; music: string; message?: string }[];
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

/** Everyone else's names, for prompts and messages: "Ecrin", "Ecrin and Deniz", "Ecrin, Deniz and Lina". */
export function othersPhrase(view: Pick<AgentView, 'others'>, suffix = ''): string {
  const names = view.others.map((o) => `${o.nickname}${suffix}`);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * What the others seem to want, from their offers alone: an item they put on
 * the table counts for them, recent offers more than old ones.
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
 * A rule-based agent: accepts what clears its minimum; otherwise offers the
 * referee's shortlist pick in the final round, and before it, of the bundles
 * that clear its minimum, the one most like what the others have been asking
 * for. Uses only what the agent can see. Drives the tests and stands in when
 * the model is unavailable.
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
    if (view.shortlist[0]) {
      const pick = view.shortlist[0];
      return {
        action: 'counter',
        counters: [{ film: codeOf(view, pick.film), restaurant: codeOf(view, pick.restaurant), music: codeOf(view, pick.music) }],
        message: `This should work for everyone, ${view.nickname} included.`,
      };
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
    if (!pick) return { action: 'counter', counters: [], message: `Nothing here works for ${view.nickname} yet.` };
    return {
      action: 'counter',
      counters: [{ film: codeOf(view, pick.film), restaurant: codeOf(view, pick.restaurant), music: codeOf(view, pick.music) }],
      message: view.history.length ? `${view.nickname} can meet you partway.` : `Here is where ${view.nickname} would start.`,
    };
  }
}
