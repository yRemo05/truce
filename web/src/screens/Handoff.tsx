/*
 * Pass the phone (/p/:pairId/handoff), between the two sides in same-phone mode.
 *
 * Inventory: who to hand to, the promise that the first favourites are hidden,
 * one primary action for the second person. Nothing of the first person's
 * favourites is on this screen. One card, one viewport at both sizes.
 * Icons: eye-off (hidden), arrow-right.
 */
import { Avatar, ButtonLink, Icon, Page, Skeleton } from '@/ui';
import { withPass } from '@/lib/flow';
import { monograms, possessive } from '@/lib/people';
import { usePair } from '@/lib/usePair';
import { NotFound } from './NotFound';

export function Handoff({ pairId }: { pairId: string }) {
  const { pair, error } = usePair(pairId);
  if (error?.status === 404) return <NotFound what="pair" />;
  const names = pair?.names;

  return (
    <Page title="Pass the phone" className="handoff">
      <div className="card handoff__card">
        {names ? <Avatar side="b" letters={monograms(names).b} size="lg" /> : <Skeleton w="2.5rem" h="2.5rem" round />}
        <h1 className="h2">{names ? `Pass the phone to ${names.b}` : <Skeleton w="12ch" h="1.5rem" />}</h1>
        <p className="handoff__note muted">
          <Icon name="eye-off" size={16} />
          <span>{names ? `${possessive(names.a)} favourites are saved and hidden.` : ' '}</span>
        </p>
        {names && (
          <ButtonLink variant="primary" iconEnd="arrow-right" href={withPass(`/p/${pairId}/b`, true)}>
            {`I’m ${names.b}, let’s go`}
          </ButtonLink>
        )}
      </div>
    </Page>
  );
}
