import type { Side } from '@contract';
import { memo, type ReactNode } from 'react';
import { Avatar, cx, Icon, InfoTip, Thumb, Voice } from '@/ui';
import { EXPLAIN } from '@/lib/glossary';
import { agentOf, listNames, nameOf } from '@/lib/people';
import { SLOT_ICON, SLOT_LABEL, SLOTS, turnLabel, type EventOf, type MoveEvent } from '@/lib/truce';
import { Because } from './Because';
import { useTruceCtx } from './context';
import { ScoreRow } from './ScoreRow';
import { Serves } from './Serves';

interface BubbleProps {
  side: Side;
  brain: string | null;
  /** The first of a run of messages from one agent: it carries the name, the avatar and the tail. */
  first: boolean;
  live: boolean;
  /** Small meta at the bottom right, like a timestamp: "Turn 3". */
  foot?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * One agent message, as a chat bubble. The viewer's own person's agent sits
 * on the right; everyone else's on the left with their avatar. The name is in
 * the person's colour, the same as their score bars.
 */
function Bubble({ side, brain, first, live, foot, className, children }: BubbleProps) {
  const { names, letters, brain: truceBrain, mine } = useTruceCtx();
  const own = mine === side;
  // A rule-based move says so, whether the whole truce runs on rules or the referee stood in for one move.
  const rules = (brain ?? truceBrain) === 'rules';
  return (
    <article className={cx('bubble-row', own ? 'bubble-row--own' : 'bubble-row--in', first && 'is-first', `p-${side}`, live && 'enter', className)}>
      {!own && <span className="bubble-row__avatar">{first && <Avatar side={side} letters={nameOf(letters, side)} size="sm" />}</span>}
      <div className="bubble">
        {first && (
          <p className="bubble__who">
            <span className="bubble__name">{agentOf(nameOf(names, side))}</span>
            {rules ? (
              <span className="bubble__voice">
                <Voice kind="rules" />
                <InfoTip label="Why a rule-based agent">{EXPLAIN.rulesMode}</InfoTip>
              </span>
            ) : (
              <Voice kind="agent" />
            )}
          </p>
        )}
        {children}
        {foot && <p className="bubble__foot">{foot}</p>}
      </div>
    </article>
  );
}

/** Who has said yes to an offer so far, like read receipts: "Ömer ✓ · waiting for Ecrin and Vildan". */
export function Accepts({ acceptedBy }: { acceptedBy: readonly Side[] }) {
  const { members, names } = useTruceCtx();
  const waiting = members.filter((s) => !acceptedBy.includes(s));
  return (
    <p className="accepts small">
      {acceptedBy.map((s) => (
        <span key={s} className="accepts__yes">
          {nameOf(names, s)}
          <Icon name="check" size={16} label="said yes" />
        </span>
      ))}
      {waiting.length > 0 && <span className="muted">· waiting for {listNames(waiting.map((s) => nameOf(names, s)))}</span>}
    </p>
  );
}

/** Qloo's explanation of everyone's scores, per pick, behind a disclosure. */
function Why({ move }: { move: MoveEvent }) {
  const { items, members } = useTruceCtx();
  return (
    <details className="why">
      <summary className="why__summary">
        <Icon name="chevron-right" size={16} className="why__chevron" />
        Why these scores
      </summary>
      <div className="why__body">
        {SLOTS.map((slot) => {
          const item = items[move.bundle[slot]];
          if (!item) return null;
          return (
            <div key={slot} className="why__slot">
              <p className="why__item">
                <Icon name={SLOT_ICON[slot]} size={16} />
                {item.name}
              </p>
              {members.map((side) => (
                <Because key={side} item={item} side={side} />
              ))}
            </div>
          );
        })}
        <p className="small muted">A score is a fit with what each person named, not a fact about them.</p>
      </div>
    </details>
  );
}

/** The evening in a bubble: three small picks in a row (a list on a narrow bubble), with what each restaurant serves. */
function Picks({ move }: { move: MoveEvent }) {
  const { items } = useTruceCtx();
  return (
    <ul className="offer__picks">
      {SLOTS.map((slot) => {
        const item = items[move.bundle[slot]];
        return (
          <li key={slot} className="offer__pick">
            <Thumb name={item?.name ?? '?'} imageUrl={item?.imageUrl ?? null} slot={slot} />
            <span className="offer__pick-text">
              <span className="visually-hidden">{SLOT_LABEL[slot]}: </span>
              <span className="offer__pick-name">{item?.name ?? 'Unknown pick'}</span>
              {item && <Serves item={item} compact />}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** An agent's move: its words, then the evening it put forward (Qloo data), everyone's fit, and who has said yes. */
export const MoveCard = memo(function MoveCard({ move, first = true, live }: { move: MoveEvent; first?: boolean; live: boolean }) {
  const { brain, turns } = useTruceCtx();
  const accept = move.action === 'accept';
  const foot = (
    <>
      {accept && (
        <span className="bubble__said bubble__said--yes">
          <Icon name="check" size={16} />
          Says yes
        </span>
      )}
      {turnLabel(move.turn, turns)}
    </>
  );
  return (
    <Bubble side={move.side} brain={move.brain} first={first} live={live} foot={foot}>
      <p className="bubble__text">{move.message}</p>
      {move.brain === 'rules' && brain === 'claude' && (
        <p className="bubble__note small muted">
          <Icon name="gavel" size={16} />
          The referee wrote this move with simple rules.
        </p>
      )}
      {move.shortlisted && (
        <p className="bubble__note small muted">
          <Icon name="gavel" size={16} />
          From the referee&rsquo;s shortlist
          <InfoTip label="What the referee’s shortlist is">{EXPLAIN.shortlist}</InfoTip>
        </p>
      )}
      <div className="offer">
        <p className="offer__head small muted">
          <Voice kind="qloo" />
          {accept ? 'Says yes to' : 'Offers'}
        </p>
        <Picks move={move} />
        {!accept && <ScoreRow scores={move.scores} />}
        <Accepts acceptedBy={move.acceptedBy} />
        {!accept && <Why move={move} />}
      </div>
    </Bubble>
  );
});

export const DeclinedCard = memo(function DeclinedCard({ event, first = true, live }: { event: EventOf<'declined'>; first?: boolean; live: boolean }) {
  const { turns } = useTruceCtx();
  const foot = (
    <>
      <span className="bubble__said bubble__said--no">
        <Icon name="x" size={16} />
        Says no
      </span>
      {turnLabel(event.turn, turns)}
    </>
  );
  return (
    <Bubble side={event.side} brain={event.brain} first={first} live={live} foot={foot}>
      <p className="bubble__text">{event.message}</p>
    </Bubble>
  );
});

/** "Ecrin's agent is typing…", as WhatsApp shows it: a small bubble with three dots. */
export function ThinkingCard({ side, struck, first = true }: { side: Side; struck: boolean; first?: boolean }) {
  const { names } = useTruceCtx();
  return (
    <div aria-hidden="true">
      <Bubble side={side} brain={null} first={first} live className="bubble-row--typing">
        <p className="typing">
          {first ? '' : `${agentOf(nameOf(names, side))} `}
          {struck ? 'is trying again by the rules' : 'is typing'}
          <span className="typing__dots">
            <span />
            <span />
            <span />
          </span>
        </p>
      </Bubble>
    </div>
  );
}
