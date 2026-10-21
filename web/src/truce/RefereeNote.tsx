import type { Side } from '@contract';
import { memo, type ReactNode } from 'react';
import { cx, Icon, InfoTip, type IconName } from '@/ui';
import { capitalise, spelled } from '@/lib/format';
import { EXPLAIN } from '@/lib/glossary';
import { agentOf, listNames, nameOf, possessive } from '@/lib/people';
import { isLastCall, SLOT_ICON, SLOT_LABEL, SLOTS, strikeReason, type Bundle, type EventOf, type FeedEntry } from '@/lib/truce';
import { useTruceCtx } from './context';

interface PillProps {
  icon: IconName;
  title: string;
  /** The ⓘ text for the title, when the title is jargon. */
  explain?: string;
  /** A deal or a ruling: a touch more weight than the other notes. */
  tone?: 'deal' | 'call';
  live: boolean;
  children: ReactNode;
}

/** The referee speaks like a chat's system message: a centred pill with a glyph. Rules, not AI. */
function Pill({ icon, title, explain, tone, live, children }: PillProps) {
  return (
    <aside className={cx('sys-pill', tone && `sys-pill--${tone}`, live && 'enter')}>
      <Icon name={icon} size={16} className="sys-pill__icon" />
      <p className="sys-pill__text">
        <span className="visually-hidden">Referee: </span>
        <strong>{title}</strong>
        {explain && (
          <>
            {' '}
            <InfoTip label={`About ${title.toLowerCase()}`}>{explain}</InfoTip>
          </>
        )}{' '}
        {children}
      </p>
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

/** "Delibal, Kör Agop and Sia", for a pill. */
function useEveningLine() {
  const { items } = useTruceCtx();
  return (bundle: Bundle) => listNames(SLOTS.map((s) => items[bundle[s]]?.name ?? 'an unknown pick'));
}

export const RefereeNote = memo(function RefereeNote({ entry }: { entry: Exclude<FeedEntry, { kind: 'move' | 'declined' }> }) {
  const { names, members, items, turns } = useTruceCtx();
  const eveningLine = useEveningLine();
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
        <Pill icon="gavel" title="The talks begin." live={live}>
          {order.length > 2 ? `The agents take turns: ${listNames(order.map(name))}. ${turnsLine}` : `${agentOf(name(entry.event.opener))} goes first. ${turnsLine}`}
          {lean && ` ${agentOf(name(lean))} has a bit more say tonight, from the ledger.`}
        </Pill>
      );
    }
    case 'finalround':
      return (
        <Pill icon="gavel" title="Final round." explain={EXPLAIN.shortlist} live={live}>
          Each agent now sees a shortlist of evenings everyone can accept.
        </Pill>
      );
    case 'rejected':
      return (
        <Pill icon="warning" title="Move replaced." explain={entry.event.code === 'below_minimum' ? EXPLAIN.minimum : EXPLAIN.referee} live={live}>
          {strikeReason(entry.event, name(entry.event.side))} The referee played a rule-based move instead.
        </Pill>
      );
    case 'lastcall': {
      const offer = entry.offer;
      const pending = offer ? members.filter((s) => !offer.acceptedBy.includes(s)) : [entry.event.side];
      return (
        <Pill icon="hourglass" title="Last call." explain={EXPLAIN.lastCall} live={live}>
          No deal after {spelled(turns)} turns.{' '}
          {offer
            ? pending.length === 1
              ? `${agentOf(name(pending[0]!))} can take ${possessive(name(offer.side))} last offer or leave it to the referee.`
              : `${listNames(pending.map(name))} each get one last chance at ${possessive(name(offer.side))} offer. One no, and the referee decides.`
            : 'The referee will decide.'}
        </Pill>
      );
    }
    case 'agreement': {
      const when = isLastCall(entry.event.turn, turns) ? 'on the last call' : `on turn ${entry.event.turn}`;
      return (
        <Pill icon="check-circle" title="Deal." tone="deal" live={live}>
          Everyone said yes {when}: {eveningLine(entry.event.bundle)}.
        </Pill>
      );
    }
    case 'ruling':
      return (
        <Pill icon="gavel" title="Truce’s call." explain={EXPLAIN.ruling} tone="call" live={live}>
          No deal, so the referee picked the fairest evening: {eveningLine(entry.event.bundle)}.
        </Pill>
      );
    case 'polish': {
      const swaps = SLOTS.filter((s) => entry.event.from[s] !== entry.event.to[s]).map(
        (s) => `${items[entry.event.to[s]]?.name ?? 'another pick'} instead of ${items[entry.event.from[s]]?.name ?? 'the first'}`,
      );
      return (
        <Pill icon="check-circle" title="Small improvement." explain={EXPLAIN.polish} live={live}>
          {listNames(swaps)}: at least as good for everyone.
        </Pill>
      );
    }
  }
});
