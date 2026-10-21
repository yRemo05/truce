/**
 * Foods for a restaurant search: what someone typed ("Lazanya", "mantı",
 * "sushi") as the Qloo food tags it names. Qloo has some local names as tags
 * ("lazanya") but far more English ones ("lasagna" is a menu highlight at ten
 * Istanbul places), so Haiku first gives the English name of the food, and
 * both names are looked up. A word that isn't a food finds no food tags.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { QlooClient } from '../qloo/client';
import { findFoods, type FoodTags } from '../qloo/queries';
import { AGENT_MODEL } from './claude-brain';

const englishSchema = z.object({ english: z.string().nullable() });

const SYSTEM = `Someone typed a word into a restaurant search. If it names a food, dish or cuisine in any language, reply with its usual English name in lowercase, one to three words, as a menu would say it: "Lazanya" → "lasagna", "mantı" → "manti", "balık" → "fish", "Italyan" → "italian", "sushi" → "sushi". If it is not a food (a restaurant's name, a place, a person), reply null.`;

/**
 * English names already asked for, by lowercased query, kept for the
 * process's life: null is "not a food", undefined "couldn't tell" (not kept).
 */
const englishCache = new Map<string, Promise<string | null | undefined>>();
const CACHE_MAX = 1000;

function englishOf(anthropic: Anthropic, query: string, onUsage?: (u: Anthropic.Usage) => void): Promise<string | null | undefined> {
  const key = query.toLocaleLowerCase();
  let found = englishCache.get(key);
  if (!found) {
    if (englishCache.size >= CACHE_MAX) englishCache.clear();
    found = anthropic.messages
      .parse({
        model: AGENT_MODEL,
        max_tokens: 100,
        system: SYSTEM,
        messages: [{ role: 'user', content: query }],
        output_config: { effort: 'low', format: zodOutputFormat(englishSchema) },
      })
      .then((r) => {
        onUsage?.(r.usage);
        return r.parsed_output?.english?.trim().slice(0, 40) || null;
      })
      .catch((err) => {
        // Not kept: a failed call may work next time. The search goes on with the word as typed.
        englishCache.delete(key);
        console.warn(`food name for "${query}" failed: ${(err as Error).message}`);
        return undefined;
      });
    englishCache.set(key, found);
  }
  return found;
}

/** The foods a restaurant search names, best first; empty when it names none. */
export async function foodsFor(
  qloo: QlooClient,
  anthropic: Anthropic | null,
  query: string,
  onUsage?: (u: Anthropic.Usage) => void,
): Promise<FoodTags[]> {
  if (query.trim().length < 3) return [];
  const english = anthropic ? await englishOf(anthropic, query, onUsage) : undefined;
  // Not a food ("Kör Agop"): no food tags to look for. Couldn't tell: the word as typed.
  if (english === null) return [];
  return findFoods(qloo, english ? [query, english] : [query]);
}
