/*
 * Pass the phone (/p/:pairId/handoff), between the two sides in same-phone mode.
 *
 * Inventory: who to hand to, the promise that the first picks are hidden, one
 * primary action for the second person. Nothing of the first person's picks
 * is on this screen or reachable from it. Fits one viewport at both sizes:
 * a big Caslon line top-left, the sealed envelope mark beside it, the action under.
 * Icons: eye-off (hidden), arrow-right.
 */
import { ButtonLink, Icon, Page, Seal, Skeleton } from '@/ui';
import { withPass } from '@/lib/flow';
import { monograms, possessive } from '@/lib/people';
import { usePair } from '@/lib/usePair';
import { NotFound } from './NotFound';

export function Handoff({ pairId }: { pairId: string }) {
  const { pair, error } = usePair(pairId);
  if (error?.status === 404) return <NotFound what="pair" />;
  const names = pair?.names;
  const letters = names ? monograms(names) : null;

  return (
    <Page title="Pass the phone" className="handoff">
      <div className="handoff__body">
        <div className="handoff__mark" aria-hidden="true">
          {letters && <Seal letters={[letters.a]} kind="sealed" size={144} stamp delay={150} />}
        </div>
        <p className="eyebrow">Same phone</p>
        <h1 className="display-xl handoff__title">
          {names ? (
            <>
              Pass the phone
              <br />
              to {names.b}.
            </>
          ) : (
            <Skeleton h="1em" w="8ch" />
          )}
        </h1>
        <p className="lede handoff__lede">
          <Icon name="eye-off" size={20} />
          <span>{names ? `${possessive(names.a)} picks are sealed. ${names.b} won’t see them.` : ' '}</span>
        </p>
        {names && (
          <ButtonLink variant="primary" iconEnd="arrow-right" href={withPass(`/p/${pairId}/b`, true)}>
            {`I’m ${names.b}. Start my picks`}
          </ButtonLink>
        )}
      </div>
    </Page>
  );
}
