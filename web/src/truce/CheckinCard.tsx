import type { PerSide, Side } from '@contract';
import type { ReactNode } from 'react';
import { Badge, ButtonLink, cx, InfoTip, PersonRow, SectionHeader } from '@/ui';
import { EXPLAIN } from '@/lib/glossary';
import { nameOf, type Names } from '@/lib/people';

interface CheckinCardProps {
  members: readonly Side[];
  names: Names;
  letters: Names;
  truceId: string;
  checkedIn: PerSide<boolean>;
  title: string;
  meta: string;
  /** Anything under the list, e.g. a link back to the plan. */
  footer?: ReactNode;
  className?: string;
}

/** Each person's way to tell the ledger how the evening really went, and who already has. */
export function CheckinCard({ members, names, letters, truceId, checkedIn, title, meta, footer, className }: CheckinCardProps) {
  return (
    <section className={cx('card checkin-card', className)} aria-labelledby="checkin-title">
      <SectionHeader icon="heart" id="checkin-title" title={title} info={<InfoTip label="What a check-in does">{EXPLAIN.checkin}</InfoTip>} meta={meta} />
      <ul className="people">
        {members.map((side) => {
          const name = nameOf(names, side);
          const done = Boolean(checkedIn[side]);
          return (
            <PersonRow
              key={side}
              side={side}
              letters={nameOf(letters, side)}
              name={name}
              status={
                done ? (
                  <Badge variant="success" icon="check">
                    Answered
                  </Badge>
                ) : (
                  <Badge variant="secondary">Not yet</Badge>
                )
              }
              actions={
                !done && (
                  <ButtonLink size="sm" iconEnd="arrow-right" href={`/truces/${truceId}/checkin/${side}`} aria-label={`Check in as ${name}`}>
                    Check in
                  </ButtonLink>
                )
              }
            />
          );
        })}
      </ul>
      {footer}
    </section>
  );
}
