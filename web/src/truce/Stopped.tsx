import { useState, type FormEvent } from 'react';
import { useLocation } from 'wouter';
import { api } from '@/api';
import { Button, ButtonLink, ErrorNotice, Notice, TextField } from '@/ui';
import { useDemo, type DemoKind } from '@/lib/demo';
import type { EventOf } from '@/lib/truce';
import { useAction, useStartTruce } from '@/lib/useAction';

/**
 * A truce that stopped early, with the way forward its error code points to.
 * A live demo run that stopped also offers a recorded run of the same demo.
 */
export function Stopped({ error, pairId, location, demo }: { error: EventOf<'error'>; pairId: string; location: string; demo: DemoKind | null }) {
  const [, navigate] = useLocation();
  const again = useStartTruce(pairId);
  const recorded = useDemo();
  const [place, setPlace] = useState(location);
  const move = useAction(async () => {
    await api.setLocation(pairId, place.trim());
    const { truceId } = await api.startTruce(pairId);
    navigate(`/t/${truceId}`);
  });

  if (demo) {
    return (
      <div className="stopped">
        <Notice
          tone="error"
          live
          title="This demo run stopped early"
          action={
            <span className="notice__buttons">
              <Button size="sm" variant="primary" icon="play" busy={recorded.busy} onClick={() => void recorded.run(demo, true)}>
                See a recorded run instead
              </Button>
              <Button size="sm" icon="retry" busy={again.busy} disabled={recorded.busy} onClick={() => void again.run()}>
                Try again live
              </Button>
            </span>
          }
        >
          {error.message}
        </Notice>
        {recorded.error && <ErrorNotice error={recorded.error} title="The recorded run didn't open" />}
        {again.error && <ErrorNotice error={again.error} title="Couldn't start again" />}
      </div>
    );
  }

  const pairLink = (
    <ButtonLink size="sm" variant="ghost" icon="arrow-left" href={`/p/${pairId}`}>
      Group page
    </ButtonLink>
  );

  if (error.code === 'no_restaurants') {
    const submit = (e: FormEvent) => {
      e.preventDefault();
      if (place.trim().length >= 2) void move.run();
    };
    return (
      <div className="stopped">
        <Notice tone="warn" live title="No restaurants there">
          {error.message}
        </Notice>
        <form className="stopped__form" onSubmit={submit}>
          <TextField label="Where to eat" icon="pin" value={place} maxLength={60} onChange={(e) => setPlace(e.target.value)} />
          <span className="stopped__actions">
            <Button type="submit" variant="primary" icon="retry" busy={move.busy} disabled={place.trim().length < 2}>
              Try there
            </Button>
            {pairLink}
          </span>
        </form>
        {move.error && <ErrorNotice error={move.error} title="Couldn't start again" />}
      </div>
    );
  }

  return (
    <div className="stopped">
      <Notice
        tone="error"
        live
        title="This truce stopped early"
        action={
          <span className="notice__buttons">
            {error.code === 'no_options' ? (
              <ButtonLink size="sm" icon="pencil" href={`/p/${pairId}`}>
                Change picks or note
              </ButtonLink>
            ) : (
              <Button size="sm" icon="retry" busy={again.busy} onClick={() => void again.run()}>
                Try again
              </Button>
            )}
            {error.code !== 'no_options' && pairLink}
          </span>
        }
      >
        {error.message}
      </Notice>
      {again.error && <ErrorNotice error={again.error} title="Couldn't start again" />}
    </div>
  );
}
