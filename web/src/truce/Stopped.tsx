import { useState, type FormEvent } from 'react';
import { useLocation } from 'wouter';
import { api } from '@/api';
import { Button, ButtonLink, ErrorNotice, Notice, TextField } from '@/ui';
import type { EventOf } from '@/lib/truce';
import { useAction, useStartTruce } from '@/lib/useAction';

/** A truce that stopped early, with the way forward its error code points to. */
export function Stopped({ error, pairId, location }: { error: EventOf<'error'>; pairId: string; location: string }) {
  const [, navigate] = useLocation();
  const again = useStartTruce(pairId);
  const [place, setPlace] = useState(location);
  const move = useAction(async () => {
    await api.setLocation(pairId, place.trim());
    const { truceId } = await api.startTruce(pairId);
    navigate(`/t/${truceId}`);
  });
  const pairLink = (
    <ButtonLink size="sm" variant="quiet" icon="arrow-left" href={`/p/${pairId}`}>
      Pair page
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
                Add favourites
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
