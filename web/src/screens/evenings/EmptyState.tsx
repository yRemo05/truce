import type { ShowcaseView } from '@contract';
import { useEffect, useState } from 'react';
import { api } from '@/api';
import { Button, ButtonLink, cx, ErrorNotice, Poster, Skeleton } from '@/ui';
import { useDemo } from '@/lib/demo';
import { groupNames } from '@/lib/people';
import { SLOTS } from '@/lib/truce';

/** The recorded couple demo's evening, for a picture of what a plan looks like; null when there's none (404) or it fails. */
function useShowcase() {
  const [view, setView] = useState<ShowcaseView | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    api
      .showcase('couple')
      .then((v) => alive && setView(v))
      .catch(() => alive && setView(null));
    return () => {
      alive = false;
    };
  }, []);
  return view;
}

/** First visit: a real evening's posters, and the two ways in. */
export function EmptyState() {
  const demo = useDemo();
  const showcase = useShowcase();
  const preview = showcase !== null;

  return (
    <section className={cx('card empty', preview && 'empty--preview')} aria-labelledby="empty-title">
      <div className="empty__copy">
        <h2 id="empty-title" className="h2">
          Your evenings will gather here
        </h2>
        <div className="empty__actions">
          <Button variant="primary" icon="heart" busy={demo.busyFor('couple', true)} disabled={demo.busy} onClick={() => void demo.run('couple', true)}>
            Try the couple demo
          </Button>
          <ButtonLink variant="outline" icon="plus" href="/new">
            Start your own
          </ButtonLink>
        </div>
        {demo.error && <ErrorNotice error={demo.error} title="The demo didn't open" />}
      </div>

      {preview && (
        <figure className="empty__preview">
          <ul className="empty__posters">
            {SLOTS.map((slot, i) => {
              const item = showcase?.plan[slot];
              return (
                <li key={slot} style={{ ['--i' as string]: i }}>
                  {item ? (
                    <Poster slot={slot} name={item.name} imageUrl={item.imageUrl} />
                  ) : (
                    <span className="poster" aria-hidden="true">
                      <span className="thumb thumb--fill skeleton" />
                      <Skeleton w="75%" h="0.875rem" delay={i * 60} />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <figcaption className="small muted">
            {showcase ? `From the couple demo: ${groupNames(showcase.names, showcase.members)} in ${showcase.location}.` : <Skeleton w="60%" h="0.875rem" />}
          </figcaption>
        </figure>
      )}
    </section>
  );
}
