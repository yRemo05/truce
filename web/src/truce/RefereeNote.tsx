import type { Side } from '@contract';
import { memo, type ReactNode } from 'react';
import { cx, Icon, ScoreMeter, Voice } from '@/ui';
import { capitalise, spelled } from '@/lib/format';
import { agentOf, possessive, SIDES } from '@/lib/people';
import { isLastCall, SLOT_ICON, SLOT_LABEL, SLOTS, strikeReason, type EventOf, type FeedEntry } from '@/lib/truce';
import { useTruceCtx } from './context';
import { Evening } from './Evening';

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

/** Both people's fit for an evening the referee chose. */
function Scores({ scores }: { scores: Record<Side, number> }) {
  const { names } = useTruceCtx();
  return (
    <div className="referee__scores">
      {SIDES.map((side) => (
        <ScoreMeter key={side} side={side} name={names[side]} value={scores[side]} size="sm" />
      ))}
    </div>
  );
}

function PolishNote({ event, live }: { event: EventOf<'polish'>; live: boolean }) {
  const { names, items } = useTruceCtx();
  const swaps = SLOTS.filter((s) => event.from[s] !== event.to[s]);
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
      {event.scores && (
        <p className="data referee__delta">
          {names.a} {event.scores.from.a} → {event.scores.to.a} · {names.b} {event.scores.from.b} → {event.scores.to.b}
        </p>
      )}
    </Frame>
  );
}

function RulingNote({ event, live }: { event: EventOf<'ruling'>; live: boolean }) {
  return (
    <Frame tone="deal" title="Truce’s call" live={live}>
      <p>
        No deal, so the referee picks the fairest evening in the pool: the one that does best by both of you at once,
        weighted by the ledger.
      </p>
      <div className="referee__evening">
        <Voice kind="qloo">Qloo · the evening the referee picked</Voice>
        <Evening bundle={event.bundle} />
        {event.scores && <Scores scores={event.scores} />}
      </div>
    </Frame>
  );
}

export const RefereeNote = memo(function RefereeNote({ entry }: { entry: Exclude<FeedEntry, { kind: 'move' | 'declined' }> }) {
  const { names, turns } = useTruceCtx();
  const { live } = entry;
  switch (entry.kind) {
    case 'start': {
      const { opener, alphaA } = entry.event;
      const lean = Math.abs(alphaA - 0.5) < 0.005 ? null : alphaA > 0.5 ? 'a' : 'b';
      return (
        <Frame title="The referee seats the agents" live={live}>
          <p>
            {agentOf(names[opener])} opens. {capitalise(spelled(entry.event.turns))} turns, then a last call.{' '}
            {lean ? `The ledger leans toward ${agentOf(names[lean])} tonight.` : 'The ledger is even tonight.'}
          </p>
        </Frame>
      );
    }
    case 'rejected':
      return (
        <Frame tone="strike" title="Struck from the record" live={live}>
          <p>{strikeReason(entry.event, names[entry.event.side])} A by-the-book move stands in for it.</p>
        </Frame>
      );
    case 'lastcall': {
      const decider = entry.event.side;
      const offerer = decider === 'a' ? 'b' : 'a';
      return (
        <Frame title="Last call" live={live}>
          <p>
            {capitalise(spelled(turns))} turns and no deal. {agentOf(names[decider])} can take {possessive(names[offerer])} last offer
            as it stands, or leave the evening to the referee.
          </p>
        </Frame>
      );
    }
    case 'agreement': {
      const accepter = entry.accepted?.side;
      const when = isLastCall(entry.event.turn, turns) ? 'on the last call' : `on turn ${entry.event.turn}`;
      return (
        <Frame tone="deal" title="Agreed" live={live}>
          <p>{accepter ? `${agentOf(names[accepter])} accepted ${when}. You chose this together.` : `Both agents agreed ${when}.`}</p>
        </Frame>
      );
    }
    case 'ruling':
      return <RulingNote event={entry.event} live={live} />;
    case 'polish':
      return <PolishNote event={entry.event} live={live} />;
  }
});
