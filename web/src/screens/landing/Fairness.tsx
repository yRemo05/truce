import type { CSSProperties, ReactNode } from 'react';
import { Icon, InfoTip, type IconName } from '@/ui';
import { EXPLAIN } from '@/lib/glossary';
import type { Names } from '@/lib/people';
import { LedgerChart } from './LedgerChart';
import { Section } from './Section';

function Rule({ icon, title, i, children }: { icon: IconName; title: ReactNode; i: number; children: ReactNode }) {
  return (
    <li className="l-rule" data-reveal style={{ '--d': `${i * 90}ms` } as CSSProperties}>
      <span className="l-rule__icon" aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>
      <div>
        <h3 className="l-rule__title">{title}</h3>
        <p className="small muted">{children}</p>
      </div>
    </li>
  );
}

/** The referee's rules, the swap vote, and the ledger over time: the part nothing else does. */
export function Fairness({ names }: { names: Names }) {
  return (
    <Section
      id="fairness"
      title="Fair tonight, and fair over time"
      lede="The agents argue, a referee in plain code rules, and the ledger remembers who gave ground."
    >
      <div className="l-fair">
        <ul className="l-rules">
          <Rule i={0} icon="ban" title="Vetoes are absolute">
            A vetoed option never reaches the table.
          </Rule>
          <Rule i={1} icon="scale" title="Nobody goes below a fair minimum">
            No agent can offer or accept less for its person.
          </Rule>
          <Rule
            i={2}
            icon="gavel"
            title={
              <>
                Deadlock ends in a fair ruling <InfoTip label="What the weighted Nash bargaining solution is">{EXPLAIN.nash}</InfoTip>
              </>
            }
          >
            No deal? The referee picks the weighted Nash bargaining solution.
          </Rule>
          <Rule i={3} icon="exchange" title="Swaps go to a vote">
            Anyone can ask. A majority decides; the referee picks a fair replacement.
          </Rule>
        </ul>

        <figure className="card l-surface l-ledger" data-reveal>
          <figcaption className="l-card-head">
            <span className="l-card-head__title">
              <Icon name="scale" size={20} className="muted" />
              The fairness ledger
              <InfoTip label="What the fairness ledger is">{EXPLAIN.ledger}</InfoTip>
            </span>
            <span className="small muted">Illustrative</span>
          </figcaption>
          <LedgerChart names={names} />
        </figure>
      </div>
    </Section>
  );
}
