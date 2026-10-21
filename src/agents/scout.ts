/**
 * The scouting round: before the negotiation, each agent gets Qloo as a tool
 * and goes looking for evenings that could work for its person and the
 * others, then puts up to SCOUT_ADDS finds on the table with a reason
 * everyone sees.
 *
 * It is a short tool loop on Claude Haiku 5.5 with two tools: `search_qloo`
 * (recommendations steered by named favourites, optional taste words, and for
 * restaurants the group's taste hotspot) and `add_to_table`. The code keeps
 * it honest: searches respect the group's vetoes and opening hours, only
 * items the agent actually found can be added, and the agent never sees
 * anyone's scores. Everything added is scored for everyone afterwards, and
 * the pool is frozen before bargaining, so scouting can widen the table but
 * cannot tilt the maths. Scouting is optional: if an agent fails, the truce
 * goes on with what it has.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { ScoutEvent, ScoutFind, Seed } from '../contract';
import type { QlooClient } from '../qloo/client';
import { recommend, tasteHotspot, type PlaceFilter } from '../qloo/queries';
import { NO_CONSTRAINTS, admissible, slotQuery, toPoolItem, type Candidates, type PoolItem, type PoolOptions } from '../truce/pool';
import { SLOTS, at, type PerSide, type Side, type Slot, type Weights } from '../truce/types';
import type { AgentBrief, Mode } from './brain';
import { AGENT_MODEL, briefLines, lovesOf, toneOf, usageOf, voiceRules, type UsageReport } from './claude-brain';
import { tasteTag } from './brief';

/** Finds each agent may put on the table. */
export const SCOUT_ADDS = 2;
/** Model calls per agent, at most. */
const MAX_ROUNDS = 6;
const SEARCHES = 2;
/** How far around the taste hotspot to look for restaurants, in metres. */
const HOTSPOT_RADIUS_M = 1500;

export interface Hotspot {
  /** The neighbourhood it falls in, as Qloo names it, else "the hotspot". */
  name: string;
  lat: number;
  lon: number;
}

export interface ScoutSetup {
  qloo: QlooClient;
  anthropic: Anthropic;
  mode: Mode;
  members: Side[];
  names: PerSide<string>;
  /** The city the restaurant is in, as the pair gave it. */
  location: string;
  options: PoolOptions;
  seeds: PerSide<Record<Slot, Seed[]>>;
  portraits: PerSide<string[]>;
  briefs: PerSide<AgentBrief | null>;
  weights: PerSide<Weights>;
  /** The gathered pool: shown to the agents, and never offered again as a find. */
  candidates: Candidates;
  /** Where the group's taste concentrates in the city; computed once, on first use. */
  hotspot: () => Promise<Hotspot | null>;
  /** Ids already added by any agent (the agents scout at the same time). */
  taken: Set<string>;
  /** Places left per slot on the table, shared by every agent. */
  room: Record<Slot, number>;
  emit: (e: ScoutEvent) => void;
  onUsage?: (u: UsageReport) => void;
}

/** The group's taste hotspot in a city, named after the neighbourhood of its nearest restaurant. */
export async function findHotspot(qloo: QlooClient, seeds: readonly string[], place: PlaceFilter): Promise<Hotspot | null> {
  const point = await tasteHotspot(qloo, seeds, place.locationQuery);
  if (!point) return null;
  const [nearest] = await recommend(qloo, {
    kind: 'place',
    seeds,
    take: 1,
    place: { locationQuery: place.locationQuery, point: { ...point, radiusM: 600 } },
  });
  return { ...point, name: nearest?.facts.neighborhood ?? 'the hotspot' };
}

const searchInput = z.object({
  slot: z.enum(SLOTS),
  like: z.array(z.string()),
  words: z.array(z.string()),
  area: z.enum(['city', 'taste_hotspot']),
});
const addInput = z.object({ slot: z.enum(SLOTS), name: z.string(), why: z.string() });

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_qloo',
    description:
      'Find options for one slot in Qloo\'s taste graph. "like": names from the lists you were given (anyone\'s favourites or items on the table) to steer by; name favourites of more than one person to find middle ground. "words": up to two plain taste words to require, e.g. "cozy", "comedy", "jazz"; may be empty. "area" (restaurants only): "taste_hotspot" looks where the group\'s combined taste concentrates in the city, "city" looks citywide. Returns up to five options not yet on the table.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        slot: { type: 'string', enum: [...SLOTS] },
        like: { type: 'array', items: { type: 'string' } },
        words: { type: 'array', items: { type: 'string' } },
        area: { type: 'string', enum: ['city', 'taste_hotspot'] },
      },
      required: ['slot', 'like', 'words', 'area'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_to_table',
    description: `Put one option you found with search_qloo on the table for the negotiation. "name" exactly as the search listed it. "why": one short reason everyone will read, at most 120 characters, following the voice rules. You may add ${SCOUT_ADDS} options in all.`,
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        slot: { type: 'string', enum: [...SLOTS] },
        name: { type: 'string' },
        why: { type: 'string' },
      },
      required: ['slot', 'name', 'why'],
      additionalProperties: false,
    },
  },
];

const preview = (e: PoolItem): ScoutFind => ({ id: e.id, name: e.name, imageUrl: e.imageUrl, disambiguation: e.disambiguation });

function factLine(e: PoolItem, slot: Slot): string {
  const f = e.facts;
  const parts =
    slot === 'film' ? [f.genres, f.tone] : slot === 'restaurant' ? [f.cuisineType, f.neighborhood, f.price, f.ambience] : [f.genres, f.sound];
  return parts.filter(Boolean).join(' | ');
}

function systemPrompt(setup: ScoutSetup, side: Side): string {
  const name = at(setup.names, side);
  const others = setup.members.filter((s) => s !== side);
  const otherNames = others.map((s) => at(setup.names, s));
  const seedNames = (s: Side) =>
    Object.fromEntries(SLOTS.map((slot) => [slot, at(setup.seeds, s)[slot].map((x) => x.name)])) as Record<Slot, string[]>;
  const portrait = (s: Side) => (setup.portraits[s]?.length ? `\nQloo's words for ${at(setup.names, s)}'s taste: ${at(setup.portraits, s).join(', ')}` : '');
  const weights = SLOTS.map((s) => `${s} ${Math.round(at(setup.weights, side)[s] * 100)}%`).join(', ');
  const table = SLOTS.map(
    (slot) =>
      `${slot.toUpperCase()}: ${setup.candidates[slot].map((i) => `${i.name}${i.origins.includes('joint') ? ' (bridge)' : ''}`).join('; ') || '(nothing yet)'}`,
  ).join('\n');
  const brief = briefLines(name, setup.briefs[side] ?? null);

  return `You are ${name}'s agent in Truce. The agents are about to negotiate one shared evening for ${[name, ...otherNames].join(', ')}: one film, one restaurant in ${setup.location}, and one music artist. ${toneOf(setup.mode, setup.members.length)}

Before the negotiation you scout: search Qloo for options that could work for ${name} and the others, and put up to ${SCOUT_ADDS} on the table. You never see anyone's scores; Qloo scores everything on the table for everyone afterwards.

How to scout
- Good finds connect people: in search_qloo, steer by favourites from ${name} and from someone else together, especially for the slot that matters most to ${name} (${weights}).
- Words are for what someone asked for in a brief (say "cozy") or a plain genre, cuisine or mood ("comedy", "italian", "jazz"); leave them empty otherwise. Qloo's taste words below are for understanding people, not for searching.
- For the restaurant, try area "taste_hotspot": it looks where the group's combined taste concentrates in ${setup.location}.
- Add only finds you'd be glad to argue for. If the table already has good options, adding one is enough.
- Be quick: at most ${SEARCHES} searches, then add, then stop.
- When you are done, reply with one sentence for the other agents (at most 160 characters) about what you brought and why. If you added nothing, say so in a few words.

Voice, for your reasons and your sentence
${voiceRules(name, otherNames)}
- Never mention scores, codes or this process.

${name} loves
${lovesOf(seedNames(side))}${portrait(side)}
${brief ? `\n${brief}\n` : ''}
${others.map((s) => `${at(setup.names, s)} told the group they love\n${lovesOf(seedNames(s))}${portrait(s)}`).join('\n\n')}

Already on the table
${table}`;
}

/** Shortens text to whole sentences within `max` characters, or to whole words with an ellipsis. */
export function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (end > max / 3) return head.slice(0, end + 1);
  return `${head.slice(0, head.lastIndexOf(' ')).replace(/[,;:]$/, '')}…`;
}

/** One agent's scouting round. Returns the items it added, by slot; never throws. */
export async function scout(setup: ScoutSetup, side: Side): Promise<{ slot: Slot; item: PoolItem }[]> {
  const { qloo, emit } = setup;
  const added: { slot: Slot; item: PoolItem }[] = [];
  let message = '';
  emit({ type: 'scout', side, step: 'start' });

  // Names the agent may steer by: everyone's favourites and everything on the table.
  const known = new Map<string, string>();
  for (const s of setup.members) for (const slot of SLOTS) for (const seed of at(setup.seeds, s)[slot]) known.set(seed.name.toLowerCase(), seed.id);
  for (const slot of SLOTS) for (const item of setup.candidates[slot]) known.set(item.name.toLowerCase(), item.id);
  const everyone = [...new Set(setup.members.flatMap((s) => SLOTS.flatMap((slot) => at(setup.seeds, s)[slot].map((x) => x.id))))];
  const found = new Map<string, { slot: Slot; item: PoolItem }>();
  let searches = 0;

  async function search(input: z.infer<typeof searchInput>): Promise<string> {
    if (searches >= SEARCHES) return 'You have used your searches. Add what you found, or stop.';
    searches++;
    const { slot } = input;
    const like = input.like.slice(0, 4).filter((n) => known.has(n.toLowerCase()));
    const seeds = like.length ? like.map((n) => known.get(n.toLowerCase())!) : everyone;
    const wordTags = (
      await Promise.all(input.words.slice(0, 2).map(async (w) => [w, await tasteTag(qloo, w, slot)] as const))
    ).filter((x): x is readonly [string, NonNullable<(typeof x)[1]>] => x[1] !== null);
    const onTable = setup.candidates[slot].map((i) => i.id);
    const query = slotQuery(slot, setup.options, [...everyone, ...onTable, ...setup.taken]);

    let area: string | null = null;
    if (query.place) {
      const hotspot = input.area === 'taste_hotspot' ? await setup.hotspot() : null;
      if (hotspot) query.place = { ...query.place, point: { lat: hotspot.lat, lon: hotspot.lon, radiusM: HOTSPOT_RADIUS_M } };
      area = hotspot?.name ?? setup.location;
    }
    const run = async (tags: string[]) =>
      (await recommend(qloo, { ...query, seeds, tags, take: 10 }))
        .filter((e) => admissible(e, slot, setup.options.constraints ?? NO_CONSTRAINTS, setup.options.weekday))
        .slice(0, 5)
        .map((e) => toPoolItem(e, 'scout'));
    let matched = wordTags.map(([, t]) => t.name);
    let items = await run(wordTags.map(([, t]) => t.id));
    let note = '';
    if (!items.length && wordTags.length) {
      items = await run([]);
      note = ` Nothing matched ${matched.join(' and ')} there, so these are without it.`;
      matched = [];
    }
    for (const item of items) found.set(item.name.toLowerCase(), { slot, item });
    emit({ type: 'scout', side, step: 'search', slot, like, words: input.words.slice(0, 2), matched, area, found: items.map(preview) });
    if (!items.length) return 'Qloo found nothing new for that. Try other favourites or no words.';
    return `Found${area ? ` in ${area}` : ''}:${note}\n${items.map((e, i) => `${i + 1}. ${e.name}${factLine(e, slot) ? ` | ${factLine(e, slot)}` : ''}`).join('\n')}`;
  }

  function add(input: z.infer<typeof addInput>): string {
    if (added.length >= SCOUT_ADDS) return `You have added ${SCOUT_ADDS} already. Reply with your sentence for the other agents.`;
    const hit = found.get(input.name.trim().toLowerCase());
    if (!hit || hit.slot !== input.slot) return `"${input.name}" isn't among your ${input.slot} finds. Use a name exactly as search_qloo listed it.`;
    if (setup.taken.has(hit.item.id)) return `${hit.item.name} is already on the table.`;
    if (setup.room[hit.slot] <= 0) return `The table is full for ${hit.slot}. Add for another slot, or stop.`;
    setup.taken.add(hit.item.id);
    setup.room[hit.slot]--;
    const why = clip(input.why, 160);
    const item: PoolItem = { ...hit.item, scoutedBy: side, scoutWhy: why };
    added.push({ slot: hit.slot, item });
    emit({ type: 'scout', side, step: 'add', slot: hit.slot, item: preview(item), why });
    return added.length >= SCOUT_ADDS
      ? 'Added. That was your last add: reply with your sentence for the other agents.'
      : `Added. You may add ${SCOUT_ADDS - added.length} more, or stop.`;
  }

  try {
    const system = systemPrompt(setup, side);
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: 'Scout now.' }];
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await setup.anthropic.messages.create(
        {
          model: AGENT_MODEL,
          max_tokens: 2000,
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          tools: TOOLS,
          messages,
          output_config: { effort: 'low' },
        },
        { timeout: 30_000 },
      );
      setup.onUsage?.(usageOf(response.usage));
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join(' ')
        .trim();
      const calls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || !calls.length) {
        message = text;
        break;
      }
      messages.push({ role: 'assistant', content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of calls) {
        let content: string;
        if (call.name === 'search_qloo') {
          const parsed = searchInput.safeParse(call.input);
          content = parsed.success ? await search(parsed.data) : 'Invalid input for search_qloo.';
        } else if (call.name === 'add_to_table') {
          const parsed = addInput.safeParse(call.input);
          content = parsed.success ? add(parsed.data) : 'Invalid input for add_to_table.';
        } else {
          content = `No tool named ${call.name}.`;
        }
        results.push({ type: 'tool_result', tool_use_id: call.id, content });
      }
      messages.push({ role: 'user', content: results });
    }
  } catch (err) {
    console.warn(`scouting for side ${side} stopped: ${(err as Error).message}`);
  }
  emit({ type: 'scout', side, step: 'done', message: clip(message, 260) });
  return added;
}
