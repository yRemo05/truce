import type { Side } from '@contract';
import { Avatar } from '@/ui';
import { nameOf, type Names } from '@/lib/people';
import { Section } from './Section';

/** Illustrative: whose evening each of the last eight Fridays was. */
const FRIDAYS: Side[] = ['b', 'b', 'a', 'b', 'b', 'b', 'b', 'b'];

/** "I don't mind, you pick": why plans for two keep going one way. */
export function Problem({ names, letters }: { names: Names; letters: Names }) {
  const count = (s: Side) => FRIDAYS.filter((x) => x === s).length;
  const a = nameOf(names, 'a');
  const b = nameOf(names, 'b');
  return (
    <Section
      id="problem"
      className="l-problem"
      title="“I don’t mind, you pick.”"
      lede={
        <>
          Recommenders are built for one person. A plan for two gets made by whoever gives in least, and it&rsquo;s the same person every
          time. Nobody notices until one of you stops enjoying the evenings.
        </>
      }
    >
      <figure className="card l-surface l-tally">
        <figcaption className="l-tally__head">
          <span className="l-tally__title">Whose evening it was, the last eight Fridays</span>
          <span className="small muted">Illustrative</span>
        </figcaption>
        <ol className="l-tally__row" aria-label={`${b}’s choice ${count('b')} times, ${a}’s ${count('a')}`}>
          {FRIDAYS.map((s, i) => (
            <li key={i} className={`l-tally__night p-${s}`} aria-hidden="true">
              <Avatar side={s} letters={nameOf(letters, s)} size="md" />
            </li>
          ))}
        </ol>
        <p className="l-tally__sum">
          <strong className="num">{count('b')}</strong> of 8 went {b}&rsquo;s way. {a} said &ldquo;I don&rsquo;t mind&rdquo; seven times.
        </p>
      </figure>
    </Section>
  );
}
