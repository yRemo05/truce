import { Chip, InfoTip, SectionHeader, TextArea } from '@/ui';
import { EXPLAIN } from '@/lib/glossary';

const MAX_BRIEF = 280;
const EXAMPLES = ['Something cosy', 'No horror', 'Not too pricey', 'I’ve seen Dune', 'Vegetarian'];

const lower = (s: string) => s.toLocaleLowerCase();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Adds an example to the end of the note, or takes it out again. */
function toggle(text: string, example: string): string {
  const has = lower(text).includes(lower(example));
  if (has) {
    return text
      .replace(new RegExp(`\\s*,?\\s*${escape(example)}`, 'i'), '')
      .replace(/^\s*,\s*/, '')
      .trim();
  }
  // "No horror" reads "…, no horror" mid-sentence; "I’ve seen Dune" keeps its capital.
  const tail = /^I[\s’']/.test(example) ? example : lower(example.charAt(0)) + example.slice(1);
  const add = text.trim() ? `${text.trim().replace(/[,.]$/, '')}, ${tail}` : example;
  return add.length <= MAX_BRIEF ? add : text;
}

/** "Anything your agent should know about tonight?": free text, with examples to tap. */
export function BriefField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <section className="card brief" aria-labelledby="brief-title">
      <SectionHeader
        icon="quote"
        id="brief-title"
        title="Anything your agent should know about tonight?"
        info={<InfoTip label="What the note does">{EXPLAIN.brief}</InfoTip>}
        meta="Optional and private: only your agent reads it."
      />
      <TextArea
        label="Note for your agent"
        hideLabel
        name="brief"
        rows={3}
        maxLength={MAX_BRIEF}
        value={value}
        placeholder="Something cosy, no horror, not too pricey"
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="examples brief__examples" role="group" aria-label="Examples to add">
        {EXAMPLES.map((ex) => (
          <Chip key={ex} pressed={lower(value).includes(lower(ex))} onClick={() => onChange(toggle(value, ex))}>
            {ex}
          </Chip>
        ))}
      </div>
    </section>
  );
}
