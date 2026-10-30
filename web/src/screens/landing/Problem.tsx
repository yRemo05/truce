import type { Side } from '@contract';
import type { CSSProperties } from 'react';
import { Avatar, Icon } from '@/ui';
import { nameOf, type Names } from '@/lib/people';
import { Photo } from './Photo';
import { Section } from './Section';

/** Illustrative: whose evening each of the last eight Fridays was. */
const FRIDAYS: Side[] = ['b', 'b', 'a', 'b', 'b', 'b', 'b', 'b'];

/** "I don't mind, you pick": why plans for two keep going one way. A couple stuck on their phones, the tally laid over the photo. */
export function Problem({ names, letters }: { names: Names; letters: Names }) {
  const count = (s: Side) => FRIDAYS.filter((x) => x === s).length;
  const a = nameOf(names, 'a');
  const b = nameOf(names, 'b');
  return (
    <Section
      id="problem"
      className="l-problem"
      title="“I don’t mind, you pick.”"
      lede="Recommenders are built for one person. With two, the same person gives in every time."
    >
      <div className="l-problem__stage">
        <Photo src="/img/problem.webp" width={1200} height={900} className="l-problem__photo" />
        <figure className="card l-surface l-tally" data-reveal style={{ '--d': '180ms' } as CSSProperties}>
          <figcaption className="l-card-head">
            <span className="l-tally__title">
              <Icon name="calendar" size={20} className="muted" />
              Whose evening, the last eight Fridays
            </span>
            <span className="small muted">Illustrative</span>
          </figcaption>
          <ol className="l-tally__row" aria-label={`${b}’s choice ${count('b')} times, ${a}’s ${count('a')}`}>
            {FRIDAYS.map((s, i) => (
              <li key={i} className={`l-tally__night p-${s}`} aria-hidden="true" style={{ '--i': i } as CSSProperties}>
                <Avatar side={s} letters={nameOf(letters, s)} size="md" />
              </li>
            ))}
          </ol>
          <p className="l-tally__sum">
            <strong className="num">{count('b')}</strong> of 8 went {b}&rsquo;s way.
          </p>
        </figure>
      </div>
    </Section>
  );
}
