/*
 * Pass the phone (/p/:pairId/handoff/:side), between people in same-phone mode.
 *
 * Inventory: who to hand to, the promise that the favourites so far are hidden,
 * one primary action for the next person. Nothing anyone picked is on this
 * screen. One card, one viewport at both sizes.
 * Icons: eye-off (hidden), arrow-right.
 */
import type { Side } from '@contract';
import { Avatar, ButtonLink, Icon, Page, Skeleton } from '@/ui';
import { withPass } from '@/lib/flow';
import { listNames, monograms, nameOf, possessive } from '@/lib/people';
import { usePair } from '@/lib/usePair';
import { NotFound } from './NotFound';

export function Handoff({ pairId, side }: { pairId: string; side: Side }) {
  const { pair, error } = usePair(pairId);
  if (error?.status === 404) return <NotFound what="pair" />;
  if (pair && !pair.members.includes(side)) return <NotFound what="pair" />;
  const name = pair ? nameOf(pair.names, side) : '';
  const done = pair ? pair.members.filter((s) => s !== side && pair.ready[s]).map((s) => possessive(nameOf(pair.names, s))) : [];

  return (
    <Page title="Pass the phone" className="handoff">
      <div className="card handoff__card">
        {pair ? <Avatar side={side} letters={nameOf(monograms(pair.names, pair.members), side)} size="lg" /> : <Skeleton w="2.5rem" h="2.5rem" round />}
        <h1 className="h2">{pair ? `Pass the phone to ${name}` : <Skeleton w="12ch" h="1.5rem" />}</h1>
        <p className="handoff__note muted">
          <Icon name="eye-off" size={16} />
          <span>{done.length ? `${listNames(done)} favourites are saved and hidden.` : ' '}</span>
        </p>
        {pair && (
          <ButtonLink variant="primary" iconEnd="arrow-right" href={withPass(`/p/${pairId}/${side}`, true)}>
            {`I’m ${name}, let’s go`}
          </ButtonLink>
        )}
      </div>
    </Page>
  );
}
