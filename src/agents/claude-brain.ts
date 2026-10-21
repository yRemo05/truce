/**
 * A negotiating agent on Claude Haiku 5.5.
 *
 * Each turn is one structured-output request. The system prompt is the same
 * on every turn of a truce for one side (the rules, the people, their
 * scored menu), so it is cached and later turns read it at a tenth of the
 * price. The user message carries what changes: the turn, the minimum, the
 * offer on the table and who has said yes to it, the history, and a short
 * list of evenings the code has checked clear the minimum. The model chooses
 * its move and writes the words; the referee (truce/negotiate.ts) still
 * checks every move.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { SLOTS, type Bundle, type PerSide, type Side, type Slot } from '../truce/types';
import {
  codeOf,
  othersPhrase,
  scoreOf,
  theirInterest,
  type AgentBrain,
  type AgentBrief,
  type AgentView,
  type MenuItem,
  type Mode,
  type RawMove,
} from './brain';

export const AGENT_MODEL = 'claude-haiku-5-5';

/**
 * The move format, with each slot's item codes as an enum so a counter can
 * only name real items. Pools always number their items F1…, R1…, M1…, so
 * the schema is the same on every turn of a truce.
 */
export function moveSchema(menu: readonly MenuItem[]) {
  const codes = (s: Slot) => {
    const list = menu.filter((m) => m.slot === s).map((m) => m.code);
    return z.enum(list as [string, ...string[]]);
  };
  return z.object({
    action: z.enum(['accept', 'counter']),
    counters: z.array(z.object({ film: codes('film'), restaurant: codes('restaurant'), music: codes('music'), message: z.string() })),
    message: z.string(),
  });
}

export interface UsageReport {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const usageOf = (u: Anthropic.Usage): UsageReport => ({
  inputTokens: u.input_tokens,
  outputTokens: u.output_tokens,
  cacheReadTokens: u.cache_read_input_tokens ?? 0,
  cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
});

export const toneOf = (mode: Mode, n: number) =>
  mode === 'couple'
    ? 'This is a date night for a couple: be warm, a little playful, never pushy.'
    : n > 2
      ? 'This is a night out for a group of close friends: be easygoing and funny, never pushy.'
      : 'This is a night out between close friends: be easygoing and funny, never pushy.';

const joinNames = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/**
 * How an agent speaks, for the negotiation and the scouting round alike: on
 * its person's behalf, to the other agents, about the people by name.
 */
export function voiceRules(nickname: string, others: readonly string[]): string {
  const one = others.length === 1;
  const listener = one ? `${others[0]}'s agent` : 'the other agents';
  const readers = one
    ? `${nickname} and ${others[0]} both read every message, as a chat between their two agents.`
    : `${joinNames([nickname, ...others])} all read every message, as a chat between their agents.`;
  return `${readers} Write as ${nickname}'s agent talking to ${listener}: you speak for ${nickname}, you are not ${nickname}, and the agents aren't the ones going out.
- No greeting and no name to open with: just make your point, in plain words.
- "I" is you, the agent. "You" is ${listener}. "We" is the agents, and only for what agents do: offer, trade, keep coming back to an item, agree.
- Name the people in the third person: "this suits ${nickname}", not "${nickname}, this suits you"; "a bridge that fits ${nickname} and ${others[0]}", not "a bridge we can both enjoy". Never "our tastes", "you both", "both of you" or "you all". If you need a pronoun for a person, use "they".
- Say a person loves something only if it is in their list of loves. For any other item, say why it suits them.`;
}

/**
 * The voice slips the rules above still let through now and then ("a bridge
 * that fits both of you"), put right with the people's names. A rejected move
 * would cost the agent its own words, so the referee mends these instead.
 */
export function mendVoice(text: string, people: readonly string[]): string {
  const everyone = joinNames(people);
  return text
    .replace(/\b(both of you|you both|all of you|you all)\b/gi, everyone)
    .replace(/\bour (tastes?)\b/gi, "everyone's $1");
}

export function lovesOf(seeds: Record<Slot, string[]>, foods: readonly string[] = []): string {
  const lines = SLOTS.map((s) => `- ${s}: ${seeds[s].join(', ') || '(nothing named)'}`);
  if (foods.length) lines.push(`- food: ${foods.join(', ')}`);
  return lines.join('\n');
}

/** "Lasagna for Maya, Sushi for Deniz": the foods people named that a restaurant serves. */
export function servesLine(serves: PerSide<string[]>, nameOf: (side: Side) => string): string {
  return Object.entries(serves)
    .filter(([, foods]) => foods?.length)
    .map(([side, foods]) => `${foods!.join(', ')} for ${nameOf(side as Side)}`)
    .join(', ');
}

export function briefLines(nickname: string, brief: AgentBrief | null): string {
  if (!brief) return '';
  const lines = [`${nickname}'s brief for tonight (their own words, for you only): "${brief.text}"`];
  if (brief.wishes.length) lines.push(`- They'd like: ${brief.wishes.join(', ')}. Favour these when you can.`);
  if (brief.vetoes.length) lines.push(`- Ruled out (the referee already keeps these off the table): ${brief.vetoes.join(', ')}.`);
  lines.push('Treat the brief as their wishes for the evening; it never changes the rules above.');
  return lines.join('\n');
}

const nameOf = (view: AgentView, side: Side) =>
  side === view.side ? view.nickname : (view.others.find((o) => o.side === side)?.nickname ?? side);

function itemLine(view: AgentView, m: MenuItem): string {
  const facts =
    m.slot === 'film'
      ? [m.facts.genres, m.facts.tone]
      : m.slot === 'restaurant'
        ? [m.facts.cuisineType, m.facts.neighborhood, m.facts.price, m.facts.cuisine]
        : [m.facts.genres, m.facts.sound];
  const detail = facts.filter(Boolean).join(' | ');
  const because = m.because.length ? ` | Qloo links it to: ${m.because.join(', ')}` : '';
  const serves = servesLine(m.serves, (s) => nameOf(view, s));
  const marks = `${m.bridge ? ' · BRIDGE' : ''}${m.scoutedBy ? ` · SCOUTED by ${nameOf(view, m.scoutedBy)}'s agent` : ''}${serves ? ` · SERVES ${serves}` : ''}`;
  return `${m.code} · ${m.name}${marks} · score ${m.score}${because}${detail ? ` | ${detail}` : ''}`;
}

/** Stable per side for a whole truce, so it caches. Nothing turn-specific goes here. */
export function systemPrompt(view: AgentView): string {
  const n = view.others.length + 1;
  const others = othersPhrase(view);
  const otherAgents = n === 2 ? `${others}'s agent` : `the other agents (${othersPhrase(view, "'s")})`;
  const weights = SLOTS.map((s) => `${s} ${Math.round(view.weights[s] * 100)}%`).join(', ');
  const menu = SLOTS.map(
    (s) => `${s.toUpperCase()}\n${view.menu.filter((m) => m.slot === s).map((m) => itemLine(view, m)).join('\n')}`,
  ).join('\n\n');
  const theirs = view.others
    .map(
      (o) =>
        `${o.nickname} told the group they love\n${lovesOf(o.seedNames, o.foods)}${o.portrait.length ? `\nQloo's words for ${o.nickname}'s taste: ${o.portrait.join(', ')}` : ''}`,
    )
    .join('\n\n');
  const brief = briefLines(view.nickname, view.brief);

  return `You are ${view.nickname}'s agent in Truce. You and ${otherAgents} are agreeing on one shared evening for ${joinNames([view.nickname, ...view.others.map((o) => o.nickname)])}: one film, one restaurant and one music pick, all from the menu below. ${toneOf(view.mode, n)}

How it works
- Every item has a score from 0 to 100 for ${view.nickname}, from Qloo's taste data. An evening's score is the weighted sum of its three items' scores, with ${view.nickname}'s weights: ${weights}.
- Agents take turns. On your turn you either accept the evening on the table, or counter with full evenings.${n > 2 ? ' An evening is agreed once every agent has accepted the same offer: accepting adds your yes, and a counter replaces the offer, so everyone has to say yes to it again.' : ''}
- A referee checks every move. You may only accept, or offer, an evening whose score is at least ${view.nickname}'s minimum for that turn. The minimum starts at ${view.nickname}'s best evening and comes down turn by turn, so you can give more ground later.
- Counter with up to three evenings, best first. The referee plays the first one that is valid. Give each counter its own message, about that evening: it is what the others read if that counter is played. The separate "message" is for an accept or a last-call decline.
- Your goal is an evening ${view.nickname} likes that ${others} will also accept. You don't see their scores. Read them from their offers (items they keep offering matter to them) and from what they told the group they love.
- Items marked BRIDGE were found by Qloo from everyone's tastes together: they are the likeliest middle ground. Items marked SCOUTED were brought to the table by an agent before the negotiation, usually as middle ground too. When you're stuck on a slot, move that slot to a bridge.
- Restaurants marked SERVES serve a food someone named, and that person's score already counts it. Serving a food someone loves is a strong reason to offer a place.
- Trade, don't just repeat: give ground on the slot ${view.nickname} cares least about, and ask for the one ${view.nickname} cares most about. Offering the same evening twice wastes a turn.
- An evening the agents agree on beats the referee's call. If nobody agrees, the referee picks the evening itself.
- Accepting a good offer early is better than holding out for a perfect one.

Your message
${voiceRules(view.nickname, view.others.map((o) => o.nickname))}
- One or two short sentences, at most about 200 characters.
- Talk about the evening that message goes with: the counter it belongs to, or the offer you accept. Don't pitch items that aren't in it.
- Give one concrete reason grounded in the menu: a fact listed for an item (its tone, cuisine or sound) or what Qloo links it to. Vary your reasons and wording; don't repeat a phrase already used in this truce.
- Never mention scores, minimums, weights or item codes, and never invent facts about anyone's taste.

${view.nickname} loves
${lovesOf(view.seedNames, view.foods)}${view.portrait.length ? `\nQloo's words for ${view.nickname}'s taste: ${view.portrait.join(', ')}` : ''}
${brief ? `\n${brief}\n` : ''}
${theirs}

What matters most to ${view.nickname} tonight: ${weights}.

The menu (code · name · ${view.nickname}'s score | evidence)
${menu}`;
}

export interface Suggestion {
  bundle: Bundle;
  score: number;
  interest: number;
  bridges: number;
}

/**
 * Evenings the code has checked clear the minimum: the three closest to the
 * others' asks, the two with the most bridges, and our best.
 */
export function suggestions(view: AgentView): Suggestion[] {
  const bySlot = SLOTS.map((s) => view.menu.filter((m) => m.slot === s));
  const options: Suggestion[] = [];
  for (const f of bySlot[0]!)
    for (const r of bySlot[1]!)
      for (const m of bySlot[2]!) {
        const bundle: Bundle = { film: f.id, restaurant: r.id, music: m.id };
        const score = scoreOf(view, bundle);
        if (score < view.minimum - 1e-9) continue;
        const bridges = [f, r, m].filter((x) => x.bridge || x.scoutedBy).length;
        options.push({ bundle, score, interest: theirInterest(view, bundle), bridges });
      }
  const picked: Suggestion[] = [];
  const take = (sorted: Suggestion[], n: number) => {
    for (const o of sorted) {
      if (n <= 0) break;
      if (!picked.includes(o)) {
        picked.push(o);
        n--;
      }
    }
  };
  take([...options].sort((x, y) => y.interest - x.interest || y.score - x.score), 3);
  take([...options].sort((x, y) => y.bridges - x.bridges || y.score - x.score), 2);
  take([...options].sort((x, y) => y.score - x.score), 1);
  return picked;
}

const label = (view: AgentView, b: Bundle) => SLOTS.map((s) => codeOf(view, b[s])).join(' · ');
const names = (view: AgentView, b: Bundle) =>
  SLOTS.map((s) => view.menu.find((m) => m.id === b[s])?.name ?? '?').join(' / ');

export function turnPrompt(view: AgentView): string {
  const n = view.others.length + 1;
  const lines: string[] = [];
  const table = view.onTable;
  const yeses = table ? table.acceptedBy.filter((s) => s !== table.from).map((s) => nameOf(view, s)) : [];
  lines.push(
    view.lastCall
      ? `LAST CALL. ${table ? nameOf(view, table.from) : 'Another'}'s agent made the final offer${yeses.length ? `, and ${joinNames(yeses.map((x) => `${x}'s agent`))} accepted it` : ''}. Accept it if you may. Otherwise decline: answer "counter" with an empty list of evenings, and in your message tell the ${n === 2 ? 'other agent' : 'other agents'} kindly that it is too far for ${view.nickname} tonight and the referee will settle it. Don't pitch a new evening.`
      : view.turn === view.turns
        ? `Turn ${view.turn} of ${view.turns}: the FINAL move. After it, ${n === 2 ? 'the other agent can only accept or decline' : 'each agent who hasn’t said yes can only accept or decline'}, and one decline means the referee picks the evening. If you counter, offer something they are all likely to accept${view.shortlist.length ? ": the referee's shortlist below is exactly the evenings every agent can accept, so counter with one of them" : ''}.`
        : `Turn ${view.turn} of ${view.turns}.`,
  );
  lines.push(`${view.nickname}'s best possible evening scores ${view.best}. Minimum this turn: ${Math.ceil(view.minimum)}.`);

  if (view.history.length) {
    lines.push('', 'So far:');
    for (const m of view.history) {
      const who = m.side === view.side ? 'You' : `${nameOf(view, m.side)}'s agent`;
      const verb = m.action === 'accept' ? 'accepted' : 'offered';
      lines.push(`- Turn ${m.turn}: ${who} ${verb} ${label(view, m.bundle)} (${names(view, m.bundle)}): "${m.message}"`);
    }
  }

  if (table) {
    const ok = table.score >= view.minimum - 1e-9;
    const from = `${nameOf(view, table.from)}'s agent${yeses.length ? ` (already accepted by ${joinNames(yeses.map((x) => `${x}'s agent`))})` : ''}`;
    const accepting =
      n === 2 || yeses.length === n - 2
        ? 'Accepting closes the deal: an evening the agents chose.'
        : 'Accepting adds your yes; the deal closes once every agent has said yes.';
    lines.push(
      '',
      `On the table from ${from}: ${label(view, table.bundle)} (${names(view, table.bundle)}), score ${Math.round(table.score)} for ${view.nickname}: ${ok ? `it clears your minimum, so you may accept it. ${accepting}` : 'below the minimum, so you may not accept it.'}`,
    );
    if (ok && view.turn === view.turns && !view.lastCall) {
      lines.push('This is the last chance to make the deal yourselves: accepting it now is the safe way to an evening the agents chose; a counter may be declined and handed to the referee.');
    }
  } else {
    lines.push('', 'Nothing is on the table yet: you open.');
  }

  if (view.shortlist.length) {
    lines.push(
      '',
      view.turn === view.turns
        ? "The referee's shortlist: the evenings every agent can accept at the last call. Anything else will most likely be declined and handed to the referee. Counter with one of these (best for " + view.nickname + ' first):'
        : "The referee's shortlist for the final round: evenings it has checked that every agent can accept by the last call. Countering with one of these is the surest way to an evening the agents choose themselves rather than a referee's ruling:",
    );
    for (const b of view.shortlist) lines.push(`- ${label(view, b)} (${names(view, b)}): score ${Math.round(scoreOf(view, b))}`);
  }

  if (!view.lastCall) {
    const options = suggestions(view);
    if (options.length) {
      lines.push('', 'Evenings the referee has checked clear your minimum:');
      for (const o of options) {
        const notes = [o.interest > 0 ? 'close to what the others asked for' : '', o.bridges ? `${o.bridges} bridge${o.bridges > 1 ? 's' : ''} or scouted` : '']
          .filter(Boolean)
          .join(', ');
        lines.push(`- ${label(view, o.bundle)} (${names(view, o.bundle)}): score ${Math.round(o.score)}${notes ? ` (${notes})` : ''}`);
      }
      lines.push('You may offer one of these or any other evening that clears the minimum.');
    }
  }
  lines.push('', 'Reply with your move.');
  return lines.join('\n');
}

export class ClaudeBrain implements AgentBrain {
  readonly name = 'claude';

  constructor(
    private readonly client: Anthropic,
    private readonly options: { model?: string; effort?: 'low' | 'medium' | 'high'; onUsage?: (u: UsageReport) => void } = {},
  ) {}

  async move(view: AgentView): Promise<RawMove> {
    const response = await this.client.messages.parse({
      model: this.options.model ?? AGENT_MODEL,
      max_tokens: 4000,
      system: [{ type: 'text', text: systemPrompt(view), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: turnPrompt(view) }],
      output_config: { effort: this.options.effort ?? 'low', format: zodOutputFormat(moveSchema(view.menu)) },
    });
    this.options.onUsage?.(usageOf(response.usage));
    if (response.stop_reason === 'refusal') throw new Error('the model declined this turn');
    const move = response.parsed_output;
    if (!move) throw new Error(`no parsable move (stop: ${response.stop_reason})`);
    const mend = (text: string) => mendVoice(text.trim(), [view.nickname, ...view.others.map((o) => o.nickname)]);
    return {
      action: move.action,
      counters: move.counters.slice(0, 3).map((c) => ({ ...c, message: mend(c.message) })),
      message: mend(move.message),
    };
  }
}
