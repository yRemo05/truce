import type { Side } from '@contract';
import { memo, useId, type ReactNode } from 'react';
import { Chip, cx, Icon, Monogram, ScoreMeter, Voice } from '@/ui';
import { agentOf, SIDES } from '@/lib/people';
import { SLOT_ICON, SLOTS, turnLabel, type EventOf, type MoveEvent } from '@/lib/truce';
import { Because } from './Because';
import { useTruceCtx } from './context';
import { Evening } from './Evening';

/** Monogram, "Maya's agent", a line under it, and a chip on the right. */
function AgentHead({ side, sub, chip }: { side: Side; sub: ReactNode; chip?: ReactNode }) {
  const { names, letters } = useTruceCtx();
  return (
    <header className="move__head">
      <Monogram side={side} letters={letters[side]} size="md" />
      <div className="move__who">
        <p className="move__name">{agentOf(names[side])}</p>
        <p className="move__turn">{sub}</p>
      </div>
      {chip && <div className="move__chip">{chip}</div>}
    </header>
  );
}

function Speech({ text }: { text: string }) {
  return (
    <div className="move__speech">
      <Voice kind="agent" />
      <blockquote className="speech">
        <p>{text}</p>
      </blockquote>
    </div>
  );
}

/** Qloo's own explanation of both scores, per pick. Framed as a fit, never as a fact about a person. */
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
                <Because key={side} item={item} side={side} withScore />
              ))}
            </div>
          );
        })}
        <p className="why__note small muted">
          Qloo scores how well each pick fits the things a person named, and which of those things drive it. A fit, not a
          fact about anyone.
        </p>
      </div>
    </details>
  );
}

/** One agent's move: what it said (agent), and the evening it put on the table (Qloo). */
export const MoveCard = memo(function MoveCard({ move, live }: { move: MoveEvent; live: boolean }) {
  const { names, brain, turns } = useTruceCtx();
  const titleId = useId();
  const accept = move.action === 'accept';
  const chip = accept ? (
    <Chip tone="ok" icon="check">
      Accepts
    </Chip>
  ) : (
    <Chip icon="exchange">{move.turn === 1 ? 'Opening offer' : 'Counter-offer'}</Chip>
  );
  return (
    <article className={cx('move', `move--${move.side}`, live && 'enter')} aria-labelledby={titleId}>
      <span id={titleId} className="visually-hidden">
        {agentOf(names[move.side])}, {turnLabel(move.turn, turns).toLowerCase()}
      </span>
      <AgentHead side={move.side} sub={turnLabel(move.turn, turns)} chip={chip} />
      <Speech text={move.message} />
      {move.brain === 'rules' && brain === 'claude' && (
        <p className="move__rulebook small">
          <Icon name="gavel" size={16} />
          By the rulebook: the referee&rsquo;s stand-in agent made this move.
        </p>
      )}
      <div className="move__qloo">
        <Voice kind="qloo">{accept ? 'Qloo · the evening accepted' : 'Qloo · the evening on the table'}</Voice>
        <Evening bundle={move.bundle} />
        <div className="move__scores">
          {SIDES.map((side) => (
            <ScoreMeter key={side} side={side} name={names[side]} value={move.scores[side]} label={`Fit for ${names[side]}: ${move.scores[side]} of 100`} />
          ))}
        </div>
        <Why move={move} />
      </div>
    </article>
  );
});

export const DeclinedCard = memo(function DeclinedCard({ event, live }: { event: EventOf<'declined'>; live: boolean }) {
  const { turns } = useTruceCtx();
  return (
    <article className={cx('move', `move--${event.side}`, live && 'enter')}>
      <AgentHead
        side={event.side}
        sub={turnLabel(event.turn, turns)}
        chip={
          <Chip tone="danger" icon="x">
            Declines
          </Chip>
        }
      />
      <Speech text={event.message} />
    </article>
  );
});

export function ThinkingCard({ side, struck }: { side: Side; struck: boolean }) {
  return (
    <div className={cx('move', `move--${side}`, 'move--thinking', 'enter')} aria-hidden="true">
      <AgentHead
        side={side}
        sub={
          <span className="thinking">
            {struck ? 'Trying again, by the rulebook' : 'Thinking'}
            <span className="thinking__dots">
              <span />
              <span />
              <span />
            </span>
          </span>
        }
      />
    </div>
  );
}
