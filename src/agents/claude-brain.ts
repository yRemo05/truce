/**
 * A negotiating agent on Claude Haiku 5.5.
 *
 * Each turn is one structured-output request. The system prompt is the same
 * on every turn of a truce for one side (the rules, the person, their scored
 * menu), so it is cached and later turns read it at a tenth of the price.
 * The user message carries what changes: the turn, the minimum, the offer on
 * the table, the history, and a short list of evenings the code has checked
 * clear the minimum. The model chooses its move and writes the words; the
 * referee (truce/negotiate.ts) still checks every move.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { SLOTS, type Bundle, type Slot } from '../truce/types';
import { codeOf, scoreOf, theirInterest, type AgentBrain, type AgentView, type MenuItem, type RawMove } from './brain';

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
    counters: z.array(z.object({ film: codes('film'), restaurant: codes('restaurant'), music: codes('music') })),
    message: z.string(),
  });
}

export interface UsageReport {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

const SLOT_WORD: Record<Slot, string> = { film: 'film', restaurant: 'restaurant', music: 'music' };

function itemLine(m: MenuItem): string {
  const facts =
    m.slot === 'film'
      ? [m.facts.genres, m.facts.tone]
      : m.slot === 'restaurant'
        ? [m.facts.cuisineType, m.facts.neighborhood, m.facts.price, m.facts.cuisine]
        : [m.facts.genres, m.facts.sound];
  const detail = facts.filter(Boolean).join(' | ');
  const because = m.because.length ? ` | Qloo links it to: ${m.because.join(', ')}` : '';
  return `${m.code} · ${m.name}${m.bridge ? ' · BRIDGE' : ''} · score ${m.score}${because}${detail ? ` | ${detail}` : ''}`;
}

/** Stable per side for a whole truce, so it caches. Nothing turn-specific goes here. */
export function systemPrompt(view: AgentView): string {
  const tone =
    view.mode === 'couple'
      ? 'This is a date night for a couple: be warm, a little playful, never pushy.'
      : 'This is a night out between close friends: be easygoing and funny, never pushy.';
  const lovesOf = (seeds: Record<Slot, string[]>) =>
    SLOTS.map((s) => `- ${SLOT_WORD[s]}: ${seeds[s].join(', ') || '(nothing named)'}`).join('\n');
  const loves = lovesOf(view.seedNames);
  const theirLoves = lovesOf(view.otherSeedNames);
  const weights = SLOTS.map((s) => `${SLOT_WORD[s]} ${Math.round(view.weights[s] * 100)}%`).join(', ');
  const menu = SLOTS.map(
    (s) => `${SLOT_WORD[s].toUpperCase()}\n${view.menu.filter((m) => m.slot === s).map(itemLine).join('\n')}`,
  ).join('\n\n');

  return `You are ${view.nickname}'s agent in Truce. You and ${view.otherNickname}'s agent are agreeing on one shared evening: one film, one restaurant and one music pick, all from the menu below. ${tone}

How it works
- Every item has a score from 0 to 100 for ${view.nickname}, from Qloo's taste data. An evening's score is the weighted sum of its three items' scores, with ${view.nickname}'s weights: ${weights}.
- Each turn you either accept the evening ${view.otherNickname}'s agent has on the table, or counter with full evenings.
- A referee checks every move. You may only accept, or offer, an evening whose score is at least ${view.nickname}'s minimum for that turn. The minimum starts at ${view.nickname}'s best evening and comes down turn by turn, so you can give more ground later.
- Counter with up to three evenings, best first. The referee takes the first one that is valid.
- Your goal is an evening ${view.nickname} likes that ${view.otherNickname} will also accept. You don't see ${view.otherNickname}'s scores. Read them from their offers (items they keep offering matter to them) and from what they told you they love.
- Items marked BRIDGE were found by Qloo from both people's tastes together: they are the likeliest middle ground. When the two of you are stuck on a slot, move that slot to a bridge.
- Trade, don't just repeat: give ground on the slot ${view.nickname} cares least about, and ask for the one ${view.nickname} cares most about. Offering the same evening twice wastes a turn.
- An evening you both choose beats the referee's call. If nobody agrees, the referee picks the evening itself.
- Accepting a good offer early is better than holding out for a perfect one.

Your message
- One or two short sentences, at most about 200 characters, spoken to ${view.otherNickname}'s side, in plain words.
- Talk about the evening you actually offer (your first counter) or accept. Don't pitch items that aren't in it.
- Give one concrete reason grounded in the menu, such as what Qloo links an item to or a fact listed for it.
- Never mention scores, minimums, weights or item codes, and never invent facts about ${view.otherNickname}'s taste.

${view.nickname} loves
${loves}

${view.otherNickname} told you they love
${theirLoves}

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
 * other side's asks, the two with the most bridges, and our best.
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
        const bridges = [f, r, m].filter((x) => x.bridge).length;
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
  const lines: string[] = [];
  lines.push(
    view.lastCall
      ? `LAST CALL. ${view.otherNickname}'s agent made the final offer. Accept it if you may. Otherwise decline: answer "counter" with an empty list of evenings, and in your message tell ${view.otherNickname} kindly that it is too far for ${view.nickname} tonight and the referee will settle it. Don't pitch a new evening.`
      : view.turn === view.turns
        ? `Turn ${view.turn} of ${view.turns}: your FINAL offer. After it, ${view.otherNickname}'s agent can only accept it or decline, and if they decline the referee picks the evening. Offer something they are likely to accept.`
        : `Turn ${view.turn} of ${view.turns}.`,
  );
  lines.push(`${view.nickname}'s best possible evening scores ${view.best}. Minimum this turn: ${Math.ceil(view.minimum)}.`);

  if (view.history.length) {
    lines.push('', 'So far:');
    for (const m of view.history) {
      const who = m.side === view.side ? 'You' : `${view.otherNickname}'s agent`;
      const verb = m.action === 'accept' ? 'accepted' : 'offered';
      lines.push(`- Turn ${m.turn}: ${who} ${verb} ${label(view, m.bundle)} (${names(view, m.bundle)}): "${m.message}"`);
    }
  }

  if (view.onTable) {
    const ok = view.onTable.score >= view.minimum - 1e-9;
    lines.push(
      '',
      `On the table from ${view.otherNickname}: ${label(view, view.onTable.bundle)} (${names(view, view.onTable.bundle)}), score ${Math.round(view.onTable.score)} for ${view.nickname}: ${ok ? 'it clears your minimum, so you may accept it. Accepting ends the truce with an evening you both chose.' : 'below the minimum, so you may not accept it'}.`,
    );
    if (ok && view.turn === view.turns && !view.lastCall) {
      lines.push('This is your last chance to make the deal yourselves: accepting it now is the safe way to an evening you both chose; a counter may be declined and handed to the referee.');
    }
  } else {
    lines.push('', 'Nothing is on the table yet: you open.');
  }

  if (!view.lastCall) {
    const options = suggestions(view);
    if (options.length) {
      lines.push('', 'Evenings the referee has checked clear your minimum:');
      for (const o of options) {
        const notes = [o.interest > 0 ? 'close to what they asked for' : '', o.bridges ? `${o.bridges} bridge${o.bridges > 1 ? 's' : ''}` : '']
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
    const u = response.usage;
    this.options.onUsage?.({
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    });
    if (response.stop_reason === 'refusal') throw new Error('the model declined this turn');
    const move = response.parsed_output;
    if (!move) throw new Error(`no parsable move (stop: ${response.stop_reason})`);
    return { action: move.action, counters: move.counters.slice(0, 3), message: move.message.trim() };
  }
}
