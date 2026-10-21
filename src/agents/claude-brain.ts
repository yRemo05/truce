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

const moveSchema = z.object({
  action: z.enum(['accept', 'counter']),
  counters: z.array(z.object({ film: z.string(), restaurant: z.string(), music: z.string() })),
  message: z.string(),
});

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
        ? [m.facts.neighborhood, m.facts.price, m.facts.cuisine]
        : [m.facts.genres, m.facts.sound];
  const detail = facts.filter(Boolean).join(' | ');
  const because = m.because.length ? ` | Qloo links it to: ${m.because.join(', ')}` : '';
  return `${m.code} · ${m.name} · score ${m.score}${because}${detail ? ` | ${detail}` : ''}`;
}

/** Stable per side for a whole truce, so it caches. Nothing turn-specific goes here. */
export function systemPrompt(view: AgentView): string {
  const tone =
    view.mode === 'couple'
      ? 'This is a date night for a couple: be warm, a little playful, never pushy.'
      : 'This is a night out between close friends: be easygoing and funny, never pushy.';
  const loves = SLOTS.map((s) => `- ${SLOT_WORD[s]}: ${view.seedNames[s].join(', ') || '(nothing named)'}`).join('\n');
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
- Your goal is an evening ${view.nickname} likes that ${view.otherNickname} will also accept. You don't see ${view.otherNickname}'s scores. Read them from their offers: items they keep offering matter to them. Trade the slot ${view.nickname} cares least about for the one they care most about.
- Accepting a good offer early is better than holding out for a perfect one.

Your message
- One or two short sentences, spoken to ${view.otherNickname}'s side, in plain words.
- Give one concrete reason grounded in the menu, such as what Qloo links an item to or a fact listed for it.
- Never mention scores, minimums, weights or item codes, and never invent facts about ${view.otherNickname}'s taste.

${view.nickname} loves
${loves}

What matters most to ${view.nickname} tonight: ${weights}.

The menu (code · name · ${view.nickname}'s score | evidence)
${menu}`;
}

/** Evenings the code has checked clear the minimum: the closest to the other side's asks, then the best for us. */
export function suggestions(view: AgentView, limit = 5): { bundle: Bundle; score: number; interest: number }[] {
  const bySlot = SLOTS.map((s) => view.menu.filter((m) => m.slot === s));
  const options: { bundle: Bundle; score: number; interest: number }[] = [];
  for (const f of bySlot[0]!)
    for (const r of bySlot[1]!)
      for (const m of bySlot[2]!) {
        const bundle: Bundle = { film: f.id, restaurant: r.id, music: m.id };
        const score = scoreOf(view, bundle);
        if (score >= view.minimum - 1e-9) options.push({ bundle, score, interest: theirInterest(view, bundle) });
      }
  options.sort((x, y) => y.interest - x.interest || y.score - x.score);
  const closest = options.slice(0, limit - 1);
  const best = [...options].sort((x, y) => y.score - x.score)[0];
  if (best && !closest.includes(best)) closest.push(best);
  return closest;
}

const label = (view: AgentView, b: Bundle) => SLOTS.map((s) => codeOf(view, b[s])).join(' · ');
const names = (view: AgentView, b: Bundle) =>
  SLOTS.map((s) => view.menu.find((m) => m.id === b[s])?.name ?? '?').join(' / ');

export function turnPrompt(view: AgentView): string {
  const lines: string[] = [];
  lines.push(
    view.lastCall
      ? `LAST CALL. ${view.otherNickname}'s agent made the final offer. Accept it, or decline (answer "counter" with no evenings) and the referee will decide the evening.`
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
      `On the table from ${view.otherNickname}: ${label(view, view.onTable.bundle)} (${names(view, view.onTable.bundle)}), score ${Math.round(view.onTable.score)} for ${view.nickname}: ${ok ? 'you may accept it' : 'below the minimum, so you may not accept it'}.`,
    );
  } else {
    lines.push('', 'Nothing is on the table yet: you open.');
  }

  if (!view.lastCall) {
    const options = suggestions(view);
    if (options.length) {
      lines.push('', 'Evenings the referee has checked clear your minimum (the first ones are closest to what the other side has asked for):');
      for (const o of options) lines.push(`- ${label(view, o.bundle)} (${names(view, o.bundle)}): score ${Math.round(o.score)}`);
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
      output_config: { effort: this.options.effort ?? 'low', format: zodOutputFormat(moveSchema) },
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
