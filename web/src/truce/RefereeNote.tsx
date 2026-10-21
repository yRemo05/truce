import type { Side, TruceResult } from '@contract';
import { memo, type ReactNode } from 'react';
import { cx, Icon, pullSentence } from '@/ui';
import { capitalise, spelled } from '@/lib/format';
import { agentOf } from '@/lib/people';
import { isLastCall, SLOT_ICON, SLOT_LABEL, SLOTS, strikeReason, type EventOf, type FeedEntry } from '@/lib/truce';
import { useTruceCtx } from './context';

/** The referee speaks between rules, centred, like a stage direction. Code, not a model. */
function Frame({ tone = 'plain', title, children, live }: { tone?: 'plain' | 'strike' | 'deal'; title: string; children: ReactNode; live: boolean }) {
  return (
    <aside className={cx('referee', `referee--${tone}`, live && 'enter')}>
      <p className="referee__label">
        <Icon name="gavel" size={16} />
        <span>Referee</span>
      </p>
      <p className="referee__title">{title}</p>
      <div className="referee__text">{children}</div>
    </aside>
  );
}

function PolishNote({ event, result, before, live }: { event: EventOf<'polish'>; result: TruceResult | null; before: Record<Side, number> | null; live: boolean }) {
  const { names, items } = useTruceCtx();
  const swaps = SLOTS.filter((s) => event.from[s] !== event.to[s]);
  const after = result && { a: Math.round(result.utilities.a * 100), b: Math.round(result.utilities.b * 100) };
  return (
    <Frame tone="deal" title="Polished" live={live}>
      <p>The referee found an evening you both like at least as much, so it swapped:</p>
      <ul className="referee__swaps">
        {swaps.map((slot) => (
          <li key={slot}>
            <Icon name={SLOT_ICON[slot]} size={16} />
            <span className="visually-hidden">{SLOT_LABEL[slot]}: </span>
            <s>{items[event.from[slot]]?.name}</s>
            <Icon name="arrow-right" size={16} />
            <strong>{items[event.to[slot]]?.name}</strong>
          </li>
        ))}
      </ul>
      {before && after && (
        <p className="data referee__delta">
          {names.a} {before.a} → {after.a} · {names.b} {before.b} → {after.b}
        </p>
      )}
    </Frame>
  );
}

interface RefereeNoteProps {
  entry: Exclude<FeedEntry, { kind: 'move' | 'declined' }>;
  /** Only the polish note uses these: the scores before and after it. */
  result?: TruceResult | null;
  before?: Record<Side, number> | null;
}

export const RefereeNote = memo(function RefereeNote({ entry, result = null, before = null }: RefereeNoteProps) {
  const { names, turns } = useTruceCtx();
  const { live } = entry;
  switch (entry.kind) {
    case 'start':
      return (
        <Frame title="The referee seats the agents" live={live}>
          <p>
            {agentOf(names[entry.event.opener])} opens. {capitalise(spelled(entry.event.turns))} turns, then a last call.{' '}
            {pullSentence(entry.event.alphaA, names, 'tonight')}
          </p>
        </Frame>
      );
    case 'rejected':
      return (
        <Frame tone="strike" title="Struck from the record" live={live}>
          <p>{strikeReason(entry.event.reason, names[entry.event.side])} A by-the-book move stands in for it.</p>
        </Frame>
      );
    case 'agreement': {
      const accepter = entry.accepted?.side;
      const when = isLastCall(entry.event.turn, turns) ? 'on the last call' : `on turn ${entry.event.turn}`;
      return (
        <Frame tone="deal" title="Agreed" live={live}>
          <p>{accepter ? `${agentOf(names[accepter])} accepted ${when}.` : `Both agents agreed ${when}.`}</p>
        </Frame>
      );
    }
    case 'ruling':
      return (
        <Frame tone="deal" title="No deal, so the referee rules" live={live}>
          <p>
            The referee picks the fairest evening in the pool: the one that does best by both of you at once, weighted by
            the ledger.
          </p>
        </Frame>
      );
    case 'polish':
      return <PolishNote event={entry.event} result={result} before={before} live={live} />;
  }
});
