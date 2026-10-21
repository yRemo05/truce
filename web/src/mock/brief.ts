/**
 * A keyword reading of a brief, standing in for the model the server asks.
 * It knows the handful of things the examples suggest (cosy, vegetarian, a
 * laugh, no horror, a price cap, a film already seen) and passes anything
 * else on as words Qloo couldn't match.
 */
import type { BriefView, Understood } from '@contract';
import { CATALOG } from './catalog';

interface Rule {
  test: RegExp;
  as: 'wish' | 'veto' | 'note';
  understood: Omit<Understood, 'said'>;
}

const RULES: Rule[] = [
  { test: /\b(cos(y|ie)|cozy|snug|intimate)\b/i, as: 'wish', understood: { slot: 'restaurant', matched: 'Cozy', kind: 'taste' } },
  { test: /\b(vegetarian|veggie|vegan|plant)/i, as: 'wish', understood: { slot: 'restaurant', matched: 'Vegetarian friendly', kind: 'taste' } },
  { test: /\b(laugh|funny|comedy|light)/i, as: 'wish', understood: { slot: 'film', matched: 'Comedy', kind: 'taste' } },
  { test: /\b(horror|scary|scare)/i, as: 'veto', understood: { slot: 'film', matched: 'Horror', kind: 'taste' } },
  { test: /\b(pricey|expensive|cheap|budget|spend)/i, as: 'veto', understood: { slot: null, matched: 'Up to $$', kind: 'price' } },
  { test: /\bearly\b/i, as: 'note', understood: { slot: null, matched: 'an early night', kind: 'taste' } },
];

const FILLER = /^(please|thanks|thank you|tonight|and|but|so|i|we|x+)$/i;

const tidy = (s: string) => s.trim().replace(/^(and|but|also)\s+/i, '').replace(/[.!?]+$/, '');

export function understand(text: string): BriefView {
  const view: BriefView = { text, wishes: [], vetoes: [], note: null, unmatched: [] };
  for (const raw of text.split(/[,.;!?\n]+/)) {
    const said = tidy(raw);
    if (!said || FILLER.test(said)) continue;
    let used = false;

    const seen = /\b(seen|watched)\s+(.+)$/i.exec(said);
    if (seen) {
      const title = seen[2]!.toLocaleLowerCase();
      const film = CATALOG.film.find((f) => title.includes(f.name.toLocaleLowerCase()));
      if (film) {
        view.vetoes.push({ slot: 'film', said, matched: film.year ? `${film.name} (${film.year})` : film.name, kind: 'title' });
        used = true;
      }
    }
    for (const rule of RULES) {
      if (!rule.test.test(said)) continue;
      used = true;
      if (rule.as === 'note') view.note = rule.understood.matched;
      else (rule.as === 'wish' ? view.wishes : view.vetoes).push({ ...rule.understood, said });
    }
    if (!used) view.unmatched.push(said);
  }
  return view;
}

/** The vetoes as everyone may see them: "No Horror", "Not Past Lives (2023)", "Up to $$". */
export const vetoLabel = (v: Understood) => (v.kind === 'price' ? v.matched : v.kind === 'title' ? `Not ${v.matched}` : `No ${v.matched}`);
