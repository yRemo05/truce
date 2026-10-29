import type { ReactNode } from 'react';
import { Icon, InfoTip, type IconName } from '@/ui';
import { EXPLAIN } from '@/lib/glossary';
import type { Names } from '@/lib/people';
import { LedgerChart } from './LedgerChart';
import { Section } from './Section';

const NASH =
  'A standard rule from game theory for a fair compromise: the evening that does best by everyone at once (it maximises the product of everyone’s fit), with a little extra weight for whoever the ledger favours.';

function Rule({ icon, title, children }: { icon: IconName; title: ReactNode; children: ReactNode }) {
  return (
    <li className="l-rule">
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
      lede="The agents argue; plain code decides what’s allowed. And Truce remembers who gave ground, so it isn’t the same person every time."
    >
      <div className="l-fair">
        <ul className="l-rules">
          <Rule icon="ban" title="Vetoes are absolute">
            &ldquo;No horror&rdquo; or &ldquo;I&rsquo;ve seen it&rdquo; ends the discussion. A vetoed option never reaches the table.
          </Rule>
          <Rule
            icon="scale"
            title={
              <>
                Nobody goes below a fair minimum <InfoTip label="What the minimum is">{EXPLAIN.minimum}</InfoTip>
              </>
            }
          >
            An agent can&rsquo;t offer or accept an evening that leaves its person worse off than their minimum for that turn.
          </Rule>
          <Rule
            icon="gavel"
            title={
              <>
                Deadlock ends in a fair ruling <InfoTip label="What the weighted Nash bargaining solution is">{NASH}</InfoTip>
              </>
            }
          >
            No deal by the last turn? The referee picks the weighted Nash bargaining solution.
          </Rule>
          <Rule icon="exchange" title="Swaps go to a vote">
            Anyone can ask to swap one item. The others say whether they&rsquo;re OK with <strong>an</strong> alternative before
            seeing it; a strict majority passes it, and the referee picks one that keeps everyone fair.
          </Rule>
        </ul>

        <figure className="card l-surface l-ledger">
          <figcaption className="l-card-head">
            <span className="l-card-head__title">
              <Icon name="scale" size={20} className="muted" />
              The fairness ledger
              <InfoTip label="What the fairness ledger is">{EXPLAIN.ledger}</InfoTip>
            </span>
            <span className="small muted">Whoever gave ground gets more say next time</span>
          </figcaption>
          <LedgerChart names={names} />
          <p className="l-note small muted">Illustrative: one couple over five evenings. A couple&rsquo;s split always stays between 35% and 65%.</p>
        </figure>
      </div>
    </Section>
  );
}
