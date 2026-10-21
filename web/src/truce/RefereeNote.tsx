import type { Side } from '@contract';
import { memo, type ReactNode } from 'react';
import { cx, Icon, InfoTip, Voice, type IconName } from '@/ui';
import { capitalise, spelled } from '@/lib/format';
import { EXPLAIN } from '@/lib/glossary';
import { agentOf, listNames, nameOf, possessive } from '@/lib/people';
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

/** What the referee's polish swapped: old pick struck through, the new one after an arrow. */
export function Swaps({ event }: { event: EventOf<'polish'> }) {
  const { items } = useTruceCtx();
  return (
    <ul className="sys__swaps">
      {SLOTS.filter((s) => event.from[s] !== event.to[s]).map((slot) => (
        <li key={slot}>
          <Icon name={SLOT_ICON[slot]} size={16} />
          <span className="visually-hidden">{SLOT_LABEL[slot]}: </span>
          <s>{items[event.from[slot]]?.name}</s>
          <Icon name="arrow-right" size={16} />
          <strong>{items[event.to[slot]]?.name}</strong>
        </li>
      ))}
    </ul>
  );
}

function PolishNote({ event, live }: { event: EventOf<'polish'>; live: boolean }) {
  const { names, members } = useTruceCtx();
  return (
    <System icon="check-circle" title="Small improvement" explain={EXPLAIN.polish} live={live}>
      <Swaps event={event} />
      {event.scores && (
        <p className="small num">
          {members.map((s) => `${nameOf(names, s)} ${event.scores.from[s] ?? 0} → ${event.scores.to[s] ?? 0}`).join(' · ')}
        </p>
      )}
    </System>
  );
}

export const RefereeNote = memo(function RefereeNote({ entry }: { entry: Exclude<FeedEntry, { kind: 'move' | 'declined' }> }) {
  const { names, members, turns } = useTruceCtx();
  const name = (s: Side) => nameOf(names, s);
  const { live } = entry;
  switch (entry.kind) {
    case 'start': {
      const { order, alpha } = entry.event;
      const even = 1 / Math.max(members.length, 1);
      const lean = members.reduce<Side | null>((top, s) => {
        const a = alpha[s] ?? even;
        return a > even + 0.005 && (top === null || a > (alpha[top] ?? even)) ? s : top;
      }, null);
      const turnsLine = `${capitalise(spelled(entry.event.turns))} turns, then a last call.`;
      return (
        <System icon="gavel" title="The talks begin" live={live}>
          <p>
            {order.length > 2
              ? `The agents take turns: ${listNames(order.map(name))}. ${turnsLine}`
              : `${agentOf(name(entry.event.opener))} goes first. ${turnsLine}`}
            {lean && ` ${agentOf(name(lean))} has a bit more say tonight, from the ledger.`}
          </p>
        </System>
      );
    }
    case 'rejected':
      return (
        <System icon="warning" title="Move replaced" explain={entry.event.code === 'below_minimum' ? EXPLAIN.minimum : EXPLAIN.referee} live={live}>
          <p>{strikeReason(entry.event, name(entry.event.side))} The referee played a rule-based move instead.</p>
        </System>
      );
    case 'lastcall': {
      const offer = entry.offer;
      const pending = offer ? members.filter((s) => !offer.acceptedBy.includes(s)) : [entry.event.side];
      return (
        <System icon="hourglass" title="Last call" explain={EXPLAIN.lastCall} live={live}>
          <p>
            No deal after {spelled(turns)} turns.{' '}
            {offer
              ? pending.length === 1
                ? `${agentOf(name(pending[0]!))} can take ${possessive(name(offer.side))} last offer or leave it to the referee.`
                : `${listNames(pending.map(name))} each get one last chance at ${possessive(name(offer.side))} offer. One no, and the referee decides.`
              : 'The referee will decide.'}
          </p>
        </System>
      );
    }
    case 'agreement': {
      const when = isLastCall(entry.event.turn, turns) ? 'on the last call' : `on turn ${entry.event.turn}`;
      return (
        <System icon="check-circle" title="Deal" strong live={live}>
          <p>{`Everyone said yes ${when}. You chose this together.`}</p>
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
