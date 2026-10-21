/**
 * A brief: what a person tells their own agent about tonight, in plain words
 * ("I'm tired, something cosy, no horror, I've seen Dune, nothing pricey").
 *
 * One structured-output request reads it into wishes (soft), vetoes (hard:
 * a taste to keep out, or a title already seen), a price cap and a note.
 * Then Qloo grounds each one: a taste word becomes the Qloo tag it stands for
 * in that slot ("cozy" → the Cozy ambience tag for restaurants), a title
 * becomes the entity it names. What could not be grounded is kept as words
 * the agent still reads. The person sees all of it before it counts.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { BriefView, Understood } from '../contract';
import type { QlooClient } from '../qloo/client';
import { findTags, searchEntities, type Locality, type QlooTag } from '../qloo/queries';
import { KIND_OF_SLOT, SLOTS, type Slot } from '../truce/types';
import type { AgentBrief } from './brain';
import { AGENT_MODEL } from './claude-brain';

export const BRIEF_MAX = 280;

/** The tag families a taste word may land in, per slot, best first (id prefixes). */
const WISH_FAMILIES: Record<Slot, string[]> = {
  film: ['urn:tag:genre:media:', 'urn:tag:subgenre:qloo:', 'urn:tag:theme:qloo:', 'urn:tag:style:qloo:', 'urn:tag:keyword:qloo:'],
  restaurant: [
    'urn:tag:ambience:qloo:',
    'urn:tag:genre:place:restaurant:',
    'urn:tag:dietary_option:qloo:',
    'urn:tag:cuisine:qloo:',
    'urn:tag:offerings:place:',
    'urn:tag:good_for:qloo:',
    'urn:tag:noise_level:qloo:',
  ],
  music: ['urn:tag:genre:music:'],
};
/** Vetoes stay to families that name a kind of thing, so "no horror" can't empty the pool via a stray keyword. */
const VETO_FAMILIES: Record<Slot, string[]> = {
  film: ['urn:tag:genre:media:', 'urn:tag:subgenre:qloo:'],
  restaurant: ['urn:tag:genre:place:restaurant:', 'urn:tag:cuisine:qloo:', 'urn:tag:ambience:qloo:', 'urn:tag:noise_level:qloo:'],
  music: ['urn:tag:genre:music:'],
};

const family = (tag: QlooTag, families: string[]) => families.findIndex((f) => tag.id.startsWith(f));

/** The tag a plain taste word stands for in a slot: an exact name match first, then by family order. */
export async function tasteTag(qloo: QlooClient, word: string, slot: Slot): Promise<QlooTag | null> {
  const tags = (await findTags(qloo, word)).filter((t) => family(t, WISH_FAMILIES[slot]) >= 0);
  const exact = (t: QlooTag) => (t.name.toLowerCase() === word.toLowerCase() ? 0 : 1);
  tags.sort((x, y) => exact(x) - exact(y) || family(x, WISH_FAMILIES[slot]) - family(y, WISH_FAMILIES[slot]));
  return tags[0] ?? null;
}

/** Every tag a vetoed word should keep out in a slot: same name, any veto family ("Horror" as genre and subgenre). */
async function vetoTags(qloo: QlooClient, word: string, slot: Slot): Promise<QlooTag[]> {
  const tags = (await findTags(qloo, word)).filter((t) => family(t, VETO_FAMILIES[slot]) >= 0);
  const name = (tags.find((t) => t.name.toLowerCase() === word.toLowerCase()) ?? tags[0])?.name.toLowerCase();
  return name ? tags.filter((t) => t.name.toLowerCase() === name) : [];
}

const slot = z.enum(SLOTS);
const intentSchema = z.object({
  wishes: z.array(z.object({ slot, said: z.string(), word: z.string() })),
  avoids: z.array(z.object({ slot, said: z.string(), word: z.string() })),
  skips: z.array(z.object({ slot, said: z.string(), title: z.string() })),
  maxPrice: z.number().nullable(),
  priceSaid: z.string().nullable(),
  note: z.string().nullable(),
});
export type BriefIntent = z.infer<typeof intentSchema>;

const SYSTEM = `You read what a person told their agent about tonight. The evening is one film, one restaurant and one music artist, chosen together with friends or a partner. Pull out only what they actually said:
- wishes: tastes they'd like, each as one or two plain English words Qloo's taste tags would use, with the slot it applies to. "something cosy" → restaurant "cozy"; "a light comedy" → film "comedy"; "veggie" → restaurant "vegetarian"; "chill music" → music "chill".
- avoids: kinds of thing they don't want, the same way. "nothing scary" → film "horror"; "no loud places" → restaurant "loud".
- skips: specific titles, places or artists they don't want (already seen, been there): "I've seen Dune" → film "Dune".
- maxPrice: if they set a budget, 1 to 4 ($ to $$$$): "cheap" 1, "not too pricey" 2, "a splurge is fine" null. priceSaid: their words for it.
- note: anything else that should shape the evening, at most 80 characters, about the person in the third person without a name ("Tired after work; wants an early night"). Null if nothing.
"said" is always the person's own words, shortened. Translate other languages to English words. Never invent anything they didn't say; empty lists are fine.`;

/** A brief, read and grounded. `view` goes back to the person; `rules` drive the pool and the agent. */
export interface InterpretedBrief {
  view: BriefView;
  rules: {
    /** Per slot, the tags the person would like (their agent scouts with them). */
    wishTags: Record<Slot, string[]>;
    excludeTags: Record<Slot, string[]>;
    excludeEntities: string[];
    maxPrice: number | null;
  };
}

const PRICE = ['$', '$$', '$$$', '$$$$'];

export async function readBrief(anthropic: Anthropic, text: string, onUsage?: (u: Anthropic.Usage) => void): Promise<BriefIntent> {
  const response = await anthropic.messages.parse({
    model: AGENT_MODEL,
    max_tokens: 1500,
    system: SYSTEM,
    messages: [{ role: 'user', content: `Their words:\n${text}` }],
    output_config: { effort: 'low', format: zodOutputFormat(intentSchema) },
  });
  onUsage?.(response.usage);
  if (!response.parsed_output) throw new Error(`brief: no parsable reading (stop: ${response.stop_reason})`);
  return response.parsed_output;
}

/** Grounds a reading in Qloo. Restaurants named as skips are looked up near the group's city. */
export async function groundBrief(qloo: QlooClient, text: string, intent: BriefIntent, near: Locality | null): Promise<InterpretedBrief> {
  const wishes: Understood[] = [];
  const vetoes: Understood[] = [];
  const unmatched: string[] = [];
  const rules: InterpretedBrief['rules'] = {
    wishTags: { film: [], restaurant: [], music: [] },
    excludeTags: { film: [], restaurant: [], music: [] },
    excludeEntities: [],
    maxPrice: null,
  };

  await Promise.all([
    ...intent.wishes.slice(0, 6).map(async (w) => {
      const tag = await tasteTag(qloo, w.word, w.slot);
      if (!tag) return unmatched.push(w.said);
      wishes.push({ slot: w.slot, said: w.said, matched: tag.name, kind: 'taste' });
      rules.wishTags[w.slot].push(tag.id);
    }),
    ...intent.avoids.slice(0, 6).map(async (a) => {
      const tags = await vetoTags(qloo, a.word, a.slot);
      if (!tags.length) return unmatched.push(a.said);
      vetoes.push({ slot: a.slot, said: a.said, matched: tags[0]!.name, kind: 'taste' });
      rules.excludeTags[a.slot].push(...tags.map((t) => t.id));
    }),
    ...intent.skips.slice(0, 6).map(async (s) => {
      const kind = KIND_OF_SLOT[s.slot];
      const [hit] = await searchEntities(qloo, s.title, kind, 1, kind === 'place' && near ? near : undefined);
      if (!hit) return unmatched.push(s.said);
      vetoes.push({ slot: s.slot, said: s.said, matched: hit.disambiguation && kind === 'movie' ? `${hit.name} (${hit.disambiguation})` : hit.name, kind: 'title' });
      rules.excludeEntities.push(hit.id);
    }),
  ]);

  const price = intent.maxPrice === null ? null : Math.min(4, Math.max(1, Math.round(intent.maxPrice)));
  if (price !== null) {
    rules.maxPrice = price;
    vetoes.push({ slot: null, said: intent.priceSaid ?? 'price', matched: `Up to ${PRICE[price - 1]}`, kind: 'price' });
  }
  const note = intent.note?.trim().slice(0, 120) || null;
  return { view: { text, wishes, vetoes, note, unmatched }, rules };
}

/** What a person's own agent reads of their brief. */
export function agentBriefOf(brief: InterpretedBrief | null): AgentBrief | null {
  if (!brief) return null;
  const label = (u: Understood) => (u.slot ? `${u.matched} (${u.slot})` : u.matched);
  // "Up to $$" reads as a ban on $$ when listed under vetoes; say what is ruled out instead.
  const veto = (u: Understood) => (u.kind === 'price' ? `restaurants pricier than ${u.matched.replace(/^Up to /, '')}` : label(u));
  return {
    text: brief.view.text,
    wishes: brief.view.wishes.map(label),
    vetoes: brief.view.vetoes.map(veto),
  };
}
