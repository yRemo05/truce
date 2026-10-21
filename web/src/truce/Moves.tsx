import type { Side } from '@contract';
import { memo, type ReactNode } from 'react';
import { Avatar, Badge, cx, Icon, InfoTip, Voice } from '@/ui';
import { EXPLAIN } from '@/lib/glossary';
import { agentOf, listNames, nameOf } from '@/lib/people';
import { SLOT_ICON, SLOTS, turnLabel, type EventOf, type MoveEvent } from '@/lib/truce';
import { Because } from './Because';
import { useTruceCtx } from './context';
import { Evening, Scores } from './Evening';

/** One chat message from an agent, group-chat style: avatar in its person's colour, a name line, the bubble. */
function Message({ side, brain, meta, live, children, className }: { side: Side; brain: string | null; meta?: ReactNode; live: boolean; children: ReactNode; className?: string }) {
  const { names, letters, brain: truceBrain } = useTruceCtx();
  // A rule-based move says so, whether the whole truce runs on rules or the referee stood in for one move.
  const rules = (brain ?? truceBrain) === 'rules';
  return (
    <article className={cx('msg', live && 'enter', className)}>
      <Avatar side={side} letters={nameOf(letters, side)} size="md" />
      <div className="msg__body">
        <p className="msg__meta">
          <span className="msg__who">{agentOf(nameOf(names, side))}</span>
          {rules ? (
            <span className="msg__voice">
              <Voice kind="rules" />
              <InfoTip label="Why a rule-based agent">{EXPLAIN.rulesMode}</InfoTip>
            </span>
          ) : (
            <Voice kind="agent" />
          )}
          {meta}
        </p>
        <div className="bubble">{children}</div>
      </div>
    </article>
  );
}

/** Who has said yes to an offer so far: "Ömer ✓ Ecrin ✓ · waiting for Deniz". */
function Accepts({ acceptedBy }: { acceptedBy: readonly Side[] }) {
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

/** An agent's move: its words, then the evening it put forward (Qloo data) and who has said yes. */
export const MoveCard = memo(function MoveCard({ move, live }: { move: MoveEvent; live: boolean }) {
  const { brain, turns } = useTruceCtx();
  const accept = move.action === 'accept';
  const meta = (
    <>
      <span className="msg__turn">{turnLabel(move.turn, turns)}</span>
      {accept && (
        <Badge variant="success" icon="check">
          Says yes
        </Badge>
      )}
    </>
  );
  return (
    <Message side={move.side} brain={move.brain} meta={meta} live={live}>
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
          {accept ? 'The evening they said yes to' : 'The evening they offer'}
        </p>
        <Evening bundle={move.bundle} />
        <Scores scores={move.scores} />
        <Accepts acceptedBy={move.acceptedBy} />
        <Why move={move} />
      </div>
    </Message>
  );
});

export const DeclinedCard = memo(function DeclinedCard({ event, live }: { event: EventOf<'declined'>; live: boolean }) {
  const { turns } = useTruceCtx();
  const meta = (
    <>
      <span className="msg__turn">{turnLabel(event.turn, turns)}</span>
      <Badge variant="destructive" icon="x">
        Says no
      </Badge>
    </>
  );
  return (
    <Message side={event.side} brain={event.brain} meta={meta} live={live}>
      <p className="bubble__text">{event.message}</p>
    </Message>
  );
});

export function ThinkingCard({ side, struck }: { side: Side; struck: boolean }) {
  return (
    <div aria-hidden="true">
      <Message side={side} brain={null} live className="msg--thinking">
        <p className="thinking">
          {struck ? 'Trying again by the rules' : 'Thinking'}
          <span className="thinking__dots">
            <span />
            <span />
            <span />
          </span>
        </p>
      </Message>
    </div>
  );
}
