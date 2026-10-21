import { memo, type ReactNode } from 'react';
import { cx, Icon, InfoTip, Voice, type IconName } from '@/ui';
import { capitalise, spelled } from '@/lib/format';
import { EXPLAIN } from '@/lib/glossary';
import { agentOf, possessive } from '@/lib/people';
import { isLastCall, SLOT_ICON, SLOT_LABEL, SLOTS, strikeReason, type EventOf, type FeedEntry } from '@/lib/truce';
import { useTruceCtx } from './context';
import { Evening, Scores } from './Evening';

interface SystemProps {
  icon: IconName;
  title: string;
  /** The ⓘ text for the title, when the title is jargon. */
  explain?: string;
  /** A deal or a ruling: drawn as a card rather than a line. */
  strong?: boolean;
  live: boolean;
  children: ReactNode;
}

/** The referee speaks like a chat system message: centred, small, with a glyph. Rules, not AI. */
function System({ icon, title, explain, strong, live, children }: SystemProps) {
  return (
    <aside className={cx('sys', strong && 'sys--strong', live && 'enter')}>
      <p className="sys__head">
        <Icon name={icon} size={16} className="sys__icon" />
        <strong>{title}</strong>
        {explain && <InfoTip label={`About ${title.toLowerCase()}`}>{explain}</InfoTip>}
        <Voice kind="referee" />
      </p>
      <div className="sys__text">{children}</div>
    </aside>
  );
}

function PolishNote({ event, live }: { event: EventOf<'polish'>; live: boolean }) {
  const { names, items } = useTruceCtx();
  const swaps = SLOTS.filter((s) => event.from[s] !== event.to[s]);
  return (
    <System icon="check-circle" title="Small improvement" explain={EXPLAIN.polish} live={live}>
      <ul className="sys__swaps">
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
        <p className="small num">
          {names.a} {event.scores.from.a} → {event.scores.to.a} · {names.b} {event.scores.from.b} → {event.scores.to.b}
        </p>
      )}
    </System>
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
        <System icon="gavel" title="The talks begin" live={live}>
          <p>
            {agentOf(names[opener])} goes first. {capitalise(spelled(entry.event.turns))} turns, then a last call.
            {lean && ` ${agentOf(names[lean])} has a bit more say tonight, from the ledger.`}
          </p>
        </System>
      );
    }
    case 'rejected':
      return (
        <System icon="warning" title="Move replaced" explain={entry.event.code === 'below_minimum' ? EXPLAIN.minimum : EXPLAIN.referee} live={live}>
          <p>{strikeReason(entry.event, names[entry.event.side])} The referee put in a valid move instead.</p>
        </System>
      );
    case 'lastcall': {
      const decider = entry.event.side;
      const offerer = decider === 'a' ? 'b' : 'a';
      return (
        <System icon="hourglass" title="Last call" explain={EXPLAIN.lastCall} live={live}>
          <p>
            No deal after {spelled(turns)} turns. {agentOf(names[decider])} can accept {possessive(names[offerer])} last offer or leave it to
            the referee.
          </p>
        </System>
      );
    }
    case 'agreement': {
      const accepter = entry.accepted?.side;
      const when = isLastCall(entry.event.turn, turns) ? 'on the last call' : `on turn ${entry.event.turn}`;
      return (
        <System icon="check-circle" title="Deal" strong live={live}>
          <p>{accepter ? `${agentOf(names[accepter])} accepted ${when}. You chose this together.` : `Both agents agreed ${when}.`}</p>
        </System>
      );
    }
    case 'ruling':
      return (
        <System icon="gavel" title="Truce’s call" explain={EXPLAIN.ruling} strong live={live}>
          <p>No deal, so the referee picked the fairest evening.</p>
          <div className="sys__evening">
            <Evening bundle={entry.event.bundle} />
            {entry.event.scores && <Scores scores={entry.event.scores} />}
          </div>
        </System>
      );
    case 'polish':
      return <PolishNote event={entry.event} live={live} />;
  }
});
