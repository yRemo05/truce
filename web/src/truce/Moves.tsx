import type { Side } from '@contract';
import { memo, type ReactNode } from 'react';
import { Avatar, Badge, cx, Icon, Voice } from '@/ui';
import { agentOf, SIDES } from '@/lib/people';
import { SLOT_ICON, SLOTS, turnLabel, type EventOf, type MoveEvent } from '@/lib/truce';
import { Because } from './Because';
import { useTruceCtx } from './context';
import { Evening, Scores } from './Evening';

/** One chat message from an agent: avatar on its person's side, a name line, the bubble. */
function Message({ side, meta, live, children, className }: { side: Side; meta?: ReactNode; live: boolean; children: ReactNode; className?: string }) {
  const { names, letters } = useTruceCtx();
  return (
    <article className={cx('msg', `msg--${side}`, live && 'enter', className)}>
      <Avatar side={side} letters={letters[side]} size="md" />
      <div className="msg__body">
        <p className="msg__meta">
          <span className="msg__who">{agentOf(names[side])}</span>
          <Voice kind="agent" />
          {meta}
        </p>
        <div className="bubble">{children}</div>
      </div>
    </article>
  );
}

/** Qloo's explanation of both scores, per pick, behind a disclosure. */
function Why({ move }: { move: MoveEvent }) {
  const { items } = useTruceCtx();
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
              {SIDES.map((side) => (
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

/** An agent's move: its words, then the evening it put forward (Qloo data). */
export const MoveCard = memo(function MoveCard({ move, live }: { move: MoveEvent; live: boolean }) {
  const { brain, turns } = useTruceCtx();
  const accept = move.action === 'accept';
  const meta = (
    <>
      <span className="msg__turn">{turnLabel(move.turn, turns)}</span>
      {accept && (
        <Badge variant="success" icon="check">
          Accepts
        </Badge>
      )}
    </>
  );
  return (
    <Message side={move.side} meta={meta} live={live}>
      <p className="bubble__text">{move.message}</p>
      {move.brain === 'rules' && brain === 'claude' && (
        <p className="bubble__note small muted">
          <Icon name="gavel" size={16} />
          The referee wrote this move: the AI&rsquo;s first try broke a rule.
        </p>
      )}
      <div className="offer">
        <p className="offer__head small muted">
          <Voice kind="qloo" />
          {accept ? 'The evening they accept' : 'The evening they offer'}
        </p>
        <Evening bundle={move.bundle} />
        <Scores scores={move.scores} />
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
        Declines
      </Badge>
    </>
  );
  return (
    <Message side={event.side} meta={meta} live={live}>
      <p className="bubble__text">{event.message}</p>
    </Message>
  );
});

export function ThinkingCard({ side, struck }: { side: Side; struck: boolean }) {
  return (
    <div aria-hidden="true">
      <Message side={side} live className="msg--thinking">
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
