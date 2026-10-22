import type { SwapsView, SwapStatus, SwapView } from '@contract';
import { Button, ButtonLink, cx, Icon, InfoTip, type IconName } from '@/ui';
import { EXPLAIN } from '@/lib/glossary';
import { nameOf } from '@/lib/people';
import { agentVoteLine, outcomeLine, reasonLabel, scoreChange, tallyLine } from '@/lib/swaps';
import { SLOT_NOUN } from '@/lib/truce';
import { useTruceCtx } from './context';
import { FromTo } from './RefereeNote';

const GLYPH: Record<SwapStatus, IconName> = {
  open: 'hourglass',
  swapped: 'exchange',
  kept: 'check',
  no_alternative: 'warning',
  replanned: 'retry',
  cancelled: 'x',
};

/** "Deniz swapped the restaurant: Eataly – Flatiron → IPPUDO NY · Booked or closed". */
function SwappedLine({ swap }: { swap: SwapView }) {
  const { names } = useTruceCtx();
  return (
    <p className="swaplog__line">
      {nameOf(names, swap.side)} swapped the {swap.slot && SLOT_NOUN[swap.slot]}: <FromTo from={swap.from?.name} to={swap.to?.name} />
      {swap.slot && swap.reason && <span className="muted"> · {reasonLabel(swap.slot, swap.reason)}</span>}
    </p>
  );
}

interface EntryProps {
  swap: SwapView;
  /** The latest request found no fair replacement: offer to plan again without it. */
  replan: { now: boolean; onReplan: () => void } | null;
}

function Entry({ swap, replan }: EntryProps) {
  const { members, names } = useTruceCtx();
  const change = swap.status === 'swapped' && swap.scores ? scoreChange(swap.scores, members, names) : null;
  const agents = members.filter((s) => swap.votes[s]?.by === 'agent');
  return (
    <li className={cx('swaplog__item', swap.status === 'cancelled' && 'is-muted')}>
      <Icon name={GLYPH[swap.status]} size={16} className="swaplog__icon" />
      <div className="swaplog__text">
        {swap.status === 'swapped' ? <SwappedLine swap={swap} /> : <p className="swaplog__line">{outcomeLine(swap, members, names)}</p>}
        {change && <p className="small muted num">{change}</p>}
        {swap.status === 'swapped' && swap.needed > 0 && <p className="small muted">{tallyLine(swap, members)}.</p>}
        {agents.map((s) => (
          <p key={s} className="small muted">
            {agentVoteLine(s, swap.votes[s]!, names)}
          </p>
        ))}
        {replan && (
          <Button size="sm" icon="retry" className="swaplog__action" onClick={replan.onReplan}>
            {replan.now ? 'Plan again now' : 'Ask the group to plan again'}
          </Button>
        )}
        {swap.status === 'replanned' && swap.truceId && (
          <ButtonLink size="sm" variant="ghost" iconEnd="arrow-right" href={`/t/${swap.truceId}`} className="swaplog__action swaplog__action--link">
            See the new plan
          </ButtonLink>
        )}
      </div>
    </li>
  );
}

/** Every request that is no longer open, oldest first, in plain words. */
export function SwapHistory({ view, onReplan }: { view: SwapsView; onReplan: () => void }) {
  const done = view.swaps.filter((s) => s.status !== 'open');
  if (!done.length) return null;
  const last = done[done.length - 1]!;
  // Only the latest request can still lead somewhere, and only while the evening takes requests.
  const offer = last.status === 'no_alternative' && view.lock === null ? last.id : null;
  return (
    <div className="decision__block">
      <h3 className="plan__label">
        Swaps
        <InfoTip label="About swaps">{EXPLAIN.swap}</InfoTip>
      </h3>
      <ol className="swaplog">
        {done.map((s) => (
          <Entry key={s.id} swap={s} replan={s.id === offer ? { now: view.replanNow, onReplan } : null} />
        ))}
      </ol>
    </div>
  );
}
