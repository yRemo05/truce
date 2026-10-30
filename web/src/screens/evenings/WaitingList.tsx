import { useState } from 'react';
import { Button, ButtonLink, Icon, SectionHeader, Skeleton } from '@/ui';
import type { WaitItem } from './derive';

/** The most urgent, before "Show N more". */
const FIRST = 4;

/** Everything the remembered groups wait for that someone here can do, most urgent first. */
export function WaitingList({ items, loading }: { items: WaitItem[]; loading: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, FIRST);
  const more = items.length - shown.length;
  return (
    <section className="card waiting" aria-labelledby="waiting-title">
      <SectionHeader icon="hourglass" id="waiting-title" title="Waiting on you" />
      {items.length > 0 ? (
        <>
          <ul className="waiting__list" id="waiting-list">
            {shown.map((item) => (
              <li key={item.key} className="waiting__item">
                <Icon name={item.icon} size={20} className="waiting__icon" />
                <div className="waiting__text">
                  <p className="waiting__title">{item.title}</p>
                  <p className="small muted waiting__detail">{item.detail}</p>
                </div>
                <div className="waiting__actions">
                  {item.actions.map((a) => (
                    <ButtonLink key={a.href} size="sm" iconEnd="arrow-right" href={a.href} aria-label={a.aria}>
                      {a.label}
                    </ButtonLink>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {items.length > FIRST && (
            <Button size="sm" variant="ghost" icon={all ? 'chevron-down' : 'chevron-right'} aria-expanded={all} aria-controls="waiting-list" className="waiting__more" onClick={() => setAll((a) => !a)}>
              {all ? 'Show fewer' : `Show ${more} more`}
            </Button>
          )}
        </>
      ) : loading ? (
        <div className="waiting__list" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="waiting__item">
              <Skeleton w="1.25rem" h="1.25rem" round delay={i * 80} />
              <div className="waiting__text">
                <Skeleton w="70%" h="1rem" delay={i * 80} />
                <Skeleton w="45%" h="0.875rem" delay={i * 80 + 40} />
              </div>
              <Skeleton w="5.5rem" h="var(--control-h-sm)" delay={i * 80} />
            </div>
          ))}
        </div>
      ) : (
        <p className="waiting__none icon-line small muted">
          <Icon name="check-circle" size={16} />
          Nothing’s waiting on you right now.
        </p>
      )}
    </section>
  );
}
